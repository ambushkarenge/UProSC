import {
  type AuthenticatedUser,
  type DbRevisionRow,
  type DbSessionJoinedRow,
  type DbUserRow,
  type WorkerEnv,
  errorResponse,
  jsonResponse,
  parseJsonBody,
} from './types';

export const SESSION_COOKIE_NAME = 'uprosc_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000;
const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePbkdf2Bits(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(derived)}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = Number(parts[1]);
  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  if (
    !Number.isFinite(iterations) ||
    iterations < 10_000 ||
    iterations > 200_000 ||
    !salt ||
    !expected
  ) {
    return false;
  }
  const derived = await derivePbkdf2Bits(password, salt, iterations);
  return constantTimeEquals(derived, expected);
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

function generateOpaqueToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return USERNAME_REGEX.test(trimmed) ? trimmed : null;
}

function normalizeDisplayName(raw: unknown, fallbackUsername: string): string {
  if (typeof raw !== 'string') return fallbackUsername;
  const trimmed = raw.trim().slice(0, 50);
  return trimmed.length > 0 ? trimmed : fallbackUsername;
}

export function extractSessionToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length >= 32) {
      return token;
    }
  }

  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const key = pair.slice(0, eqIndex).trim();
    if (key === SESSION_COOKIE_NAME) {
      const value = decodeURIComponent(pair.slice(eqIndex + 1).trim());
      if (value.length >= 32) {
        return value;
      }
    }
  }
  return null;
}

function buildSessionCookie(token: string, request: Request, maxAgeSeconds: number): string {
  const isHttps = new URL(request.url).protocol === 'https:';
  const secureFlag = isHttps ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secureFlag}`;
}

export async function authenticateRequest(
  request: Request,
  env: WorkerEnv,
  nowMs = Date.now(),
): Promise<AuthenticatedUser | null> {
  const token = extractSessionToken(request);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT
       s.id AS session_id,
       s.user_id AS user_id,
       s.expires_at AS expires_at,
       u.username AS username,
       u.display_name AS display_name,
       u.created_at AS user_created_at
     FROM auth_sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1`,
  )
    .bind(tokenHash)
    .first<DbSessionJoinedRow>();

  if (!row) return null;

  if (row.expires_at <= nowMs) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?')
      .bind(row.session_id)
      .run();
    return null;
  }

  return {
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    createdAt: row.user_created_at,
    sessionId: row.session_id,
  };
}

async function createSessionForUser(
  env: WorkerEnv,
  userId: string,
  nowMs: number,
): Promise<string> {
  const token = generateOpaqueToken();
  const tokenHash = await sha256Hex(token);
  const sessionId = crypto.randomUUID();
  const expiresAt = nowMs + SESSION_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(sessionId, userId, tokenHash, nowMs, expiresAt, nowMs)
    .run();

  return token;
}

async function readUserRevision(env: WorkerEnv, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT user_id, revision, updated_at FROM user_revisions WHERE user_id = ? LIMIT 1',
  )
    .bind(userId)
    .first<DbRevisionRow>();
  return row ? row.revision : 0;
}

export async function handleRegister(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const body = await parseJsonBody<{
    username?: unknown;
    password?: unknown;
    displayName?: unknown;
  }>(request);
  if (!body) {
    return errorResponse(400, 'invalid_json', 'Invalid request payload.');
  }

  const username = normalizeUsername(body.username);
  if (!username) {
    return errorResponse(
      400,
      'invalid_username',
      'Username must be 3–32 characters using letters, numbers, ".", "_", or "-".',
    );
  }

  if (
    typeof body.password !== 'string' ||
    body.password.length < 6 ||
    body.password.length > 200
  ) {
    return errorResponse(
      400,
      'invalid_password',
      'Password must be between 6 and 200 characters.',
    );
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ? LIMIT 1',
  )
    .bind(username)
    .first<{ id: string }>();

  if (existing) {
    return errorResponse(
      409,
      'username_taken',
      'That username is already registered.',
    );
  }

  const nowMs = Date.now();
  const userId = `usr_${crypto.randomUUID()}`;
  const displayName = normalizeDisplayName(body.displayName, username);
  const passwordHash = await hashPassword(body.password);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(userId, username, displayName, passwordHash, nowMs, nowMs),
    env.DB.prepare(
      `INSERT INTO user_revisions (user_id, revision, updated_at)
       VALUES (?, 0, ?)`,
    ).bind(userId, nowMs),
  ]);

  const token = await createSessionForUser(env, userId, nowMs);
  return jsonResponse(
    {
      user: {
        id: userId,
        username,
        displayName,
        createdAt: nowMs,
        serverRevision: 0,
      },
    },
    201,
    {
      'Set-Cookie': buildSessionCookie(
        token,
        request,
        Math.floor(SESSION_TTL_MS / 1000),
      ),
    },
  );
}

export async function handleLogin(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const body = await parseJsonBody<{
    username?: unknown;
    password?: unknown;
  }>(request);
  if (!body) {
    return errorResponse(400, 'invalid_json', 'Invalid request payload.');
  }

  const username = normalizeUsername(body.username);
  if (!username || typeof body.password !== 'string' || body.password.length > 200) {
    return errorResponse(401, 'invalid_credentials', 'Invalid username or password.');
  }

  const user = await env.DB.prepare(
    `SELECT id, username, display_name, password_hash, created_at, updated_at
     FROM users
     WHERE username = ?
     LIMIT 1`,
  )
    .bind(username)
    .first<DbUserRow>();

  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return errorResponse(401, 'invalid_credentials', 'Invalid username or password.');
  }

  const nowMs = Date.now();
  const token = await createSessionForUser(env, user.id, nowMs);
  const serverRevision = await readUserRevision(env, user.id);

  return jsonResponse(
    {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        createdAt: user.created_at,
        serverRevision,
      },
    },
    200,
    {
      'Set-Cookie': buildSessionCookie(
        token,
        request,
        Math.floor(SESSION_TTL_MS / 1000),
      ),
    },
  );
}

export async function handleLogout(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const token = extractSessionToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run();
  }

  return jsonResponse({ ok: true }, 200, {
    'Set-Cookie': buildSessionCookie('', request, 0),
  });
}

export async function handleMe(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (!auth) {
    return errorResponse(401, 'unauthorized', 'Not signed in.');
  }
  const serverRevision = await readUserRevision(env, auth.id);
  return jsonResponse({
    user: {
      id: auth.id,
      username: auth.username,
      displayName: auth.displayName,
      createdAt: auth.createdAt,
      serverRevision,
    },
  });
}
