import type { SyncEntityType } from '../src/types/domain';

export interface D1Meta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export interface AssetsFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnv {
  DB: D1Database;
  ASSETS?: AssetsFetcher;
}

export interface DbUserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
}

export interface DbSessionJoinedRow {
  session_id: string;
  user_id: string;
  expires_at: number;
  username: string;
  display_name: string;
  user_created_at: number;
}

export interface DbRevisionRow {
  user_id: string;
  revision: number;
  updated_at: number;
}

export interface DbSyncEntityRow {
  user_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  payload_json: string | null;
  updated_at: number;
  deleted_at: number | null;
  server_revision: number;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  sessionId: string;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  return jsonResponse({ error: { code, message } }, status, extraHeaders);
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const raw = await request.text();
    if (!raw || raw.length > 2 * 1024 * 1024) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
