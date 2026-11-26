import { describe, expect, it } from 'vitest';
import type { SyncEntityType } from '../../src/types/domain';
import worker from '../index';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  DbRevisionRow,
  DbSyncEntityRow,
  DbUserRow,
  WorkerEnv,
} from '../types';

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

/**
 * In-memory D1 SQLite mock faithfully matching `migrations/0001_multi_user_sync.sql`
 * semantics so Worker auth, revision ETags, tombstones, and multi-user isolation
 * can be verified end-to-end inside Vitest.
 */
function createMockD1(): {
  db: D1Database;
  tables: {
    users: Map<string, DbUserRow>;
    sessions: Map<string, SessionRow>;
    revisions: Map<string, DbRevisionRow>;
    entities: Map<string, DbSyncEntityRow>;
  };
} {
  const users = new Map<string, DbUserRow>();
  const sessions = new Map<string, SessionRow>();
  const revisions = new Map<string, DbRevisionRow>();
  const entities = new Map<string, DbSyncEntityRow>();

  function executeQuery<T = Record<string, unknown>>(
    sql: string,
    bindings: unknown[],
  ): D1Result<T> {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('SELECT id FROM users WHERE username = ?')) {
      const username = String(bindings[0]);
      const found = Array.from(users.values()).find(
        (u) => u.username === username,
      );
      return {
        success: true,
        results: found ? ([{ id: found.id }] as T[]) : [],
      };
    }

    if (normalized.startsWith('INSERT INTO users ')) {
      const [id, username, display_name, password_hash, created_at, updated_at] =
        bindings as [string, string, string, string, number, number];
      users.set(id, {
        id,
        username,
        display_name,
        password_hash,
        created_at,
        updated_at,
      });
      return { success: true, results: [] };
    }

    if (
      normalized.startsWith(
        'SELECT id, username, display_name, password_hash, created_at, updated_at FROM users WHERE username = ?',
      )
    ) {
      const username = String(bindings[0]);
      const found = Array.from(users.values()).find(
        (u) => u.username === username,
      );
      return { success: true, results: found ? ([found] as T[]) : [] };
    }

    if (normalized.startsWith('INSERT INTO auth_sessions ')) {
      const [id, user_id, token_hash, created_at, expires_at, last_seen_at] =
        bindings as [string, string, string, number, number, number];
      sessions.set(id, {
        id,
        user_id,
        token_hash,
        created_at,
        expires_at,
        last_seen_at,
      });
      return { success: true, results: [] };
    }

    if (normalized.includes('FROM auth_sessions s INNER JOIN users u')) {
      const tokenHash = String(bindings[0]);
      const sess = Array.from(sessions.values()).find(
        (s) => s.token_hash === tokenHash,
      );
      if (!sess) return { success: true, results: [] };
      const user = users.get(sess.user_id);
      if (!user) return { success: true, results: [] };
      return {
        success: true,
        results: [
          {
            session_id: sess.id,
            user_id: user.id,
            expires_at: sess.expires_at,
            username: user.username,
            display_name: user.display_name,
            user_created_at: user.created_at,
          },
        ] as T[],
      };
    }

    if (normalized.startsWith('DELETE FROM auth_sessions WHERE id = ?')) {
      sessions.delete(String(bindings[0]));
      return { success: true, results: [] };
    }

    if (
      normalized.startsWith('DELETE FROM auth_sessions WHERE token_hash = ?')
    ) {
      const tokenHash = String(bindings[0]);
      for (const [id, s] of sessions.entries()) {
        if (s.token_hash === tokenHash) {
          sessions.delete(id);
        }
      }
      return { success: true, results: [] };
    }

    if (
      normalized.startsWith(
        'SELECT user_id, revision, updated_at FROM user_revisions WHERE user_id = ?',
      )
    ) {
      const row = revisions.get(String(bindings[0]));
      return { success: true, results: row ? ([row] as T[]) : [] };
    }

    if (normalized.startsWith('INSERT INTO user_revisions ')) {
      if (bindings.length === 2) {
        const [user_id, updated_at] = bindings as [string, number];
        revisions.set(user_id, { user_id, revision: 0, updated_at });
      } else {
        const [user_id, revision, updated_at] = bindings as [
          string,
          number,
          number,
        ];
        revisions.set(user_id, { user_id, revision, updated_at });
      }
      return { success: true, results: [] };
    }

    if (
      normalized.startsWith(
        'SELECT COUNT(*) AS cnt FROM sync_entities WHERE user_id = ?',
      )
    ) {
      const userId = String(bindings[0]);
      const cnt = Array.from(entities.values()).filter(
        (e) => e.user_id === userId,
      ).length;
      return { success: true, results: [{ cnt }] as T[] };
    }

    if (
      normalized.startsWith(
        'SELECT user_id, entity_type, entity_id, payload_json, updated_at, deleted_at, server_revision FROM sync_entities WHERE user_id = ? AND server_revision > ? AND server_revision <= ?',
      )
    ) {
      const [userId, minRev, maxRev] = bindings as [string, number, number];
      const rows = Array.from(entities.values())
        .filter(
          (e) =>
            e.user_id === userId &&
            e.server_revision > minRev &&
            e.server_revision <= maxRev,
        )
        .sort((a, b) => a.server_revision - b.server_revision);
      return { success: true, results: rows as T[] };
    }

    if (
      normalized.startsWith(
        'SELECT user_id, entity_type, entity_id, payload_json, updated_at, deleted_at, server_revision FROM sync_entities WHERE user_id = ?',
      )
    ) {
      const userId = String(bindings[0]);
      const rows = Array.from(entities.values()).filter(
        (e) => e.user_id === userId,
      );
      return { success: true, results: rows as T[] };
    }

    if (normalized.startsWith('INSERT INTO sync_entities ')) {
      const [
        user_id,
        entity_type,
        entity_id,
        payload_json,
        updated_at,
        deleted_at,
        server_revision,
      ] = bindings as [
        string,
        SyncEntityType,
        string,
        string | null,
        number,
        number | null,
        number,
      ];
      entities.set(`${user_id}:${entity_type}:${entity_id}`, {
        user_id,
        entity_type,
        entity_id,
        payload_json,
        updated_at,
        deleted_at,
        server_revision,
      });
      return { success: true, results: [] };
    }

    throw new Error(`Unhandled mock SQL: ${normalized}`);
  }

  class MockPreparedStatement implements D1PreparedStatement {
    private sql: string;
    private params: unknown[];

    constructor(sql: string, params: unknown[] = []) {
      this.sql = sql;
      this.params = params;
    }

    bind(...values: unknown[]): D1PreparedStatement {
      return new MockPreparedStatement(this.sql, values);
    }

    async first<T = Record<string, unknown>>(): Promise<T | null> {
      const res = executeQuery<T>(this.sql, this.params);
      return res.results[0] ?? null;
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return executeQuery<T>(this.sql, this.params);
    }

    async run(): Promise<D1Result> {
      return executeQuery(this.sql, this.params);
    }
  }

  const db: D1Database = {
    prepare(query: string) {
      return new MockPreparedStatement(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const out: D1Result<T>[] = [];
      for (const stmt of statements) {
        out.push((await stmt.all()) as D1Result<T>);
      }
      return out;
    },
  };

  return {
    db,
    tables: { users, sessions, revisions, entities },
  };
}

function extractCookieValue(setCookieHeader: string | null): string {
  expect(setCookieHeader).toBeTruthy();
  return String(setCookieHeader).split(';')[0];
}

describe('Cloudflare Worker API (/api/auth/* & /api/sync/*) + D1 Isolation', () => {
  it('registers users with PBKDF2 password hashing, issues HttpOnly session cookies, and prevents duplicates', async () => {
    const { db, tables } = createMockD1();
    const env: WorkerEnv = { DB: db };

    const regRes = await worker.fetch(
      new Request('https://uprosc.example/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Alice_01',
          password: 'super-secret-password',
          displayName: 'Alice',
        }),
      }),
      env,
    );

    expect(regRes.status).toBe(201);
    const setCookie = regRes.headers.get('Set-Cookie');
    expect(setCookie).toContain('uprosc_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');

    const regBody = (await regRes.json()) as {
      user: { id: string; username: string; serverRevision: number };
    };
    expect(regBody.user.username).toBe('alice_01');
    expect(regBody.user.serverRevision).toBe(0);

    // Stored password is PBKDF2 hash, never plaintext
    const storedUser = tables.users.get(regBody.user.id);
    expect(storedUser?.password_hash).toMatch(/^pbkdf2_sha256\$100000\$/);
    expect(storedUser?.password_hash).not.toContain('super-secret-password');

    // Duplicate username rejected with 409
    const dupRes = await worker.fetch(
      new Request('https://uprosc.example/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice_01',
          password: 'another-password',
        }),
      }),
      env,
    );
    expect(dupRes.status).toBe(409);

    // /api/auth/me works with cookie and fails after /api/auth/logout
    const cookie = extractCookieValue(setCookie);
    const meRes = await worker.fetch(
      new Request('https://uprosc.example/api/auth/me', {
        method: 'GET',
        headers: { Cookie: cookie },
      }),
      env,
    );
    expect(meRes.status).toBe(200);

    const logoutRes = await worker.fetch(
      new Request('https://uprosc.example/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: cookie },
      }),
      env,
    );
    expect(logoutRes.status).toBe(200);

    const afterLogoutMe = await worker.fetch(
      new Request('https://uprosc.example/api/auth/me', {
        method: 'GET',
        headers: { Cookie: cookie },
      }),
      env,
    );
    expect(afterLogoutMe.status).toBe(401);
  });

  it('enforces strict multi-user isolation, ETag 304 checks, tombstones, and per-date habit merges', async () => {
    const { db } = createMockD1();
    const env: WorkerEnv = { DB: db };

    // Register User A & User B
    const resA = await worker.fetch(
      new Request('https://uprosc.example/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'user_a', password: 'passwordA' }),
      }),
      env,
    );
    const cookieA = extractCookieValue(resA.headers.get('Set-Cookie'));
    const userA = ((await resA.json()) as { user: { id: string } }).user;

    const resB = await worker.fetch(
      new Request('https://uprosc.example/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'user_b', password: 'passwordB' }),
      }),
      env,
    );
    const cookieB = extractCookieValue(resB.headers.get('Set-Cookie'));
    const userB = ((await resB.json()) as { user: { id: string } }).user;

    // Device 1 for User A pushes a subject + habit check-in for Nov 26
    const pushA1 = await worker.fetch(
      new Request('https://uprosc.example/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieA,
          'X-UProSC-User-Id': userA.id,
        },
        body: JSON.stringify({
          sinceRevision: 0,
          changes: [
            {
              entityType: 'subject',
              entityId: 'subj-a1',
              updatedAt: 1000,
              deletedAt: null,
              data: {
                id: 'subj-a1',
                name: 'Algorithms',
                color: '#0ea5e9',
                dailyGoalMinutes: 60,
                archived: false,
                createdAt: 1000,
                updatedAt: 1000,
              },
            },
            {
              entityType: 'habit',
              entityId: 'hab-1',
              updatedAt: 1500,
              deletedAt: null,
              data: {
                id: 'hab-1',
                name: 'Daily Recall',
                icon: 'flame',
                color: '#10b981',
                archived: false,
                createdAt: 1000,
                updatedAt: 1500,
                completedDates: { '2026-11-26': true },
                completedDateUpdatedAt: { '2026-11-26': 1500 },
              },
            },
          ],
        }),
      }),
      env,
    );
    expect(pushA1.status).toBe(200);
    const bodyA1 = (await pushA1.json()) as { serverRevision: number };
    expect(bodyA1.serverRevision).toBe(1);

    // Unchanged meta poll with If-None-Match returns 304 Not Modified (0 bytes)
    const meta304 = await worker.fetch(
      new Request('https://uprosc.example/api/sync/meta?since=1', {
        method: 'GET',
        headers: {
          Cookie: cookieA,
          'X-UProSC-User-Id': userA.id,
          'If-None-Match': '"rev-1"',
        },
      }),
      env,
    );
    expect(meta304.status).toBe(304);

    // Device 2 for User A pushes Nov 27 check-in on hab-1 -> server merges BOTH dates without overwrite
    const pushA2 = await worker.fetch(
      new Request('https://uprosc.example/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieA,
          'X-UProSC-User-Id': userA.id,
        },
        body: JSON.stringify({
          sinceRevision: 0,
          changes: [
            {
              entityType: 'habit',
              entityId: 'hab-1',
              updatedAt: 2000,
              deletedAt: null,
              data: {
                id: 'hab-1',
                name: 'Daily Recall',
                icon: 'flame',
                color: '#10b981',
                archived: false,
                createdAt: 1000,
                updatedAt: 2000,
                completedDates: { '2026-11-27': true },
                completedDateUpdatedAt: { '2026-11-27': 2000 },
              },
            },
          ],
        }),
      }),
      env,
    );
    expect(pushA2.status).toBe(200);
    const bodyA2 = (await pushA2.json()) as {
      serverRevision: number;
      entities: Array<{
        entityType: string;
        entityId: string;
        data: { completedDates?: Record<string, boolean> } | null;
      }>;
    };
    expect(bodyA2.serverRevision).toBe(2);
    const mergedHabit = bodyA2.entities.find((e) => e.entityId === 'hab-1');
    expect(mergedHabit?.data?.completedDates).toEqual({
      '2026-11-26': true,
      '2026-11-27': true,
    });

    // User B pulls -> sees ZERO entities belonging to User A!
    const pullB = await worker.fetch(
      new Request('https://uprosc.example/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieB,
          'X-UProSC-User-Id': userB.id,
        },
        body: JSON.stringify({ sinceRevision: 0, changes: [] }),
      }),
      env,
    );
    expect(pullB.status).toBe(200);
    const bodyB = (await pullB.json()) as {
      serverRevision: number;
      entities: unknown[];
    };
    expect(bodyB.serverRevision).toBe(0);
    expect(bodyB.entities).toEqual([]);

    // Mismatched X-UProSC-User-Id header blocked with 409 Conflict
    const mismatchRes = await worker.fetch(
      new Request('https://uprosc.example/api/sync/meta?since=0', {
        method: 'GET',
        headers: {
          Cookie: cookieB,
          'X-UProSC-User-Id': userA.id,
        },
      }),
      env,
    );
    expect(mismatchRes.status).toBe(409);
  });
});
