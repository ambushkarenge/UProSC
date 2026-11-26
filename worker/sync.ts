import {
  isTombstoneNewer,
  isValidSyncEntityType,
  mergeSyncEntityEnvelopes,
} from '../src/sync/merge';
import type { SyncEntityEnvelope } from '../src/sync/types';
import { authenticateRequest } from './auth';
import {
  type D1PreparedStatement,
  type DbRevisionRow,
  type DbSyncEntityRow,
  type WorkerEnv,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from './types';

function formatRevisionEtag(revision: number): string {
  return `"rev-${revision}"`;
}

function validateUserMatch(request: Request, authUserId: string): Response | null {
  const requestedUserId = request.headers.get('X-UProSC-User-Id');
  if (requestedUserId && requestedUserId !== authUserId) {
    return errorResponse(
      409,
      'user_mismatch',
      'Active session belongs to a different user. Please sign in again.',
    );
  }
  return null;
}

function rowToEnvelope(row: DbSyncEntityRow): SyncEntityEnvelope {
  let parsedData = null;
  if (row.payload_json) {
    try {
      parsedData = JSON.parse(row.payload_json);
    } catch {
      parsedData = null;
    }
  }
  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    data: parsedData,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    serverRevision: row.server_revision,
  };
}

function sanitizeIncomingEnvelope(
  raw: unknown,
): SyncEntityEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SyncEntityEnvelope>;
  if (
    typeof candidate.entityType !== 'string' ||
    !isValidSyncEntityType(candidate.entityType) ||
    typeof candidate.entityId !== 'string' ||
    candidate.entityId.length === 0 ||
    candidate.entityId.length > 128 ||
    typeof candidate.updatedAt !== 'number' ||
    !Number.isFinite(candidate.updatedAt)
  ) {
    return null;
  }

  const deletedAt =
    typeof candidate.deletedAt === 'number' && Number.isFinite(candidate.deletedAt)
      ? candidate.deletedAt
      : null;

  return {
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    data: isTombstoneNewer(candidate.updatedAt, deletedAt)
      ? null
      : (candidate.data ?? null),
    updatedAt: Math.max(0, Math.floor(candidate.updatedAt)),
    deletedAt,
  };
}

export async function handleSyncMeta(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse(401, 'unauthorized', 'Sign in required to check sync state.');
  }

  const mismatch = validateUserMatch(request, auth.id);
  if (mismatch) return mismatch;

  const revRow = await env.DB.prepare(
    'SELECT user_id, revision, updated_at FROM user_revisions WHERE user_id = ? LIMIT 1',
  )
    .bind(auth.id)
    .first<DbRevisionRow>();

  const serverRevision = revRow ? revRow.revision : 0;
  const updatedAt = revRow ? revRow.updated_at : 0;
  const etag = formatRevisionEtag(serverRevision);

  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && ifNoneMatch.trim() === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    });
  }

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM sync_entities WHERE user_id = ?',
  )
    .bind(auth.id)
    .first<{ cnt: number }>();

  return jsonResponse(
    {
      serverRevision,
      updatedAt,
      entityCount: Number(countRow?.cnt ?? 0),
    },
    200,
    { ETag: etag },
  );
}

export async function handleSyncPushPull(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse(401, 'unauthorized', 'Sign in required to sync.');
  }

  const mismatch = validateUserMatch(request, auth.id);
  if (mismatch) return mismatch;

  const body = await parseJsonBody<{
    sinceRevision?: unknown;
    changes?: unknown;
  }>(request);
  if (!body) {
    return errorResponse(400, 'invalid_json', 'Invalid sync payload.');
  }

  const rawSince =
    typeof body.sinceRevision === 'number' && Number.isFinite(body.sinceRevision)
      ? Math.max(0, Math.floor(body.sinceRevision))
      : 0;
  const incomingList = Array.isArray(body.changes) ? body.changes : [];

  if (incomingList.length > 500) {
    return errorResponse(
      413,
      'batch_too_large',
      'Sync batch exceeds 500 entities per request.',
    );
  }

  const sanitized: SyncEntityEnvelope[] = [];
  for (const item of incomingList) {
    const clean = sanitizeIncomingEnvelope(item);
    if (!clean) {
      return errorResponse(400, 'invalid_entity', 'Malformed sync entity record.');
    }
    sanitized.push(clean);
  }

  const nowMs = Date.now();
  const revRow = await env.DB.prepare(
    'SELECT user_id, revision, updated_at FROM user_revisions WHERE user_id = ? LIMIT 1',
  )
    .bind(auth.id)
    .first<DbRevisionRow>();

  const currentRevision = revRow ? revRow.revision : 0;
  const effectiveSince = rawSince > currentRevision ? 0 : rawSince;

  // Read any existing rows that collide with incoming changes so we can resolve LWW / per-date habit merges
  const existingByKey = new Map<string, SyncEntityEnvelope>();
  if (sanitized.length > 0) {
    const existingResult = await env.DB.prepare(
      `SELECT user_id, entity_type, entity_id, payload_json, updated_at, deleted_at, server_revision
       FROM sync_entities
       WHERE user_id = ?`,
    )
      .bind(auth.id)
      .all<DbSyncEntityRow>();

    for (const row of existingResult.results) {
      existingByKey.set(`${row.entity_type}:${row.entity_id}`, rowToEnvelope(row));
    }
  }

  const statements: D1PreparedStatement[] = [];
  const nextRevision = currentRevision + 1;
  const authoritativeWinners = new Map<string, SyncEntityEnvelope>();
  let mutatedCount = 0;

  for (const incoming of sanitized) {
    const key = `${incoming.entityType}:${incoming.entityId}`;
    const existing = existingByKey.get(key) ?? null;
    const merged = mergeSyncEntityEnvelopes(existing, incoming, 'incoming');

    if (merged.changedExisting) {
      mutatedCount += 1;
      const storedEnvelope: SyncEntityEnvelope = {
        ...merged.envelope,
        serverRevision: nextRevision,
      };
      existingByKey.set(key, storedEnvelope);

      const isDeleted = Boolean(
        storedEnvelope.deletedAt &&
          storedEnvelope.deletedAt >= storedEnvelope.updatedAt,
      );
      const payloadJson =
        isDeleted || storedEnvelope.data === null
          ? null
          : JSON.stringify(storedEnvelope.data);

      statements.push(
        env.DB.prepare(
          `INSERT INTO sync_entities (
             user_id, entity_type, entity_id, payload_json, updated_at, deleted_at, server_revision
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, entity_type, entity_id) DO UPDATE SET
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at,
             server_revision = excluded.server_revision`,
        ).bind(
          auth.id,
          storedEnvelope.entityType,
          storedEnvelope.entityId,
          payloadJson,
          storedEnvelope.updatedAt,
          storedEnvelope.deletedAt ?? null,
          nextRevision,
        ),
      );

      // Return merged habit or conflict-resolved record so the pushing device converges immediately
      if (merged.winner === 'merged') {
        authoritativeWinners.set(key, storedEnvelope);
      }
    } else if (existing && merged.winner === 'existing') {
      // Server held a newer version than what the client tried to push
      authoritativeWinners.set(key, existing);
    }
  }

  const finalRevision = mutatedCount > 0 ? nextRevision : currentRevision;

  if (mutatedCount > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO user_revisions (user_id, revision, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
      ).bind(auth.id, finalRevision, nowMs),
    );
    await env.DB.batch(statements);
  }

  // Pull remote entities strictly belonging to this authenticated user with server_revision > effectiveSince
  const pullRows = await env.DB.prepare(
    `SELECT user_id, entity_type, entity_id, payload_json, updated_at, deleted_at, server_revision
     FROM sync_entities
     WHERE user_id = ? AND server_revision > ? AND server_revision <= ?
     ORDER BY server_revision ASC`,
  )
    .bind(auth.id, effectiveSince, currentRevision)
    .all<DbSyncEntityRow>();

  const responseEntities = new Map<string, SyncEntityEnvelope>();
  for (const row of pullRows.results) {
    responseEntities.set(`${row.entity_type}:${row.entity_id}`, rowToEnvelope(row));
  }
  for (const [key, envelope] of authoritativeWinners.entries()) {
    responseEntities.set(key, envelope);
  }

  return jsonResponse(
    {
      serverRevision: finalRevision,
      serverTime: nowMs,
      acceptedCount: mutatedCount,
      entities: Array.from(responseEntities.values()),
    },
    200,
    { ETag: formatRevisionEtag(finalRevision) },
  );
}
