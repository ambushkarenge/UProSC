import type {
  AuthResponseDTO,
  SyncEntityEnvelope,
  SyncMetaResponseDTO,
  SyncPushPullResponseDTO,
} from './types';

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

async function parseApiError(response: Response): Promise<ApiClientError> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    const code = body?.error?.code ?? `http_${response.status}`;
    const message =
      body?.error?.message ?? `Request failed with status ${response.status}.`;
    return new ApiClientError(response.status, code, message);
  } catch {
    return new ApiClientError(
      response.status,
      `http_${response.status}`,
      `Request failed with status ${response.status}.`,
    );
  }
}

async function requestJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetchImpl(url, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return (await response.json()) as T;
}

export function createSyncApiClient(fetchImpl: FetchLike = (...args) => fetch(...args)) {
  return {
    register(input: {
      username: string;
      password: string;
      displayName?: string;
    }): Promise<AuthResponseDTO> {
      return requestJson<AuthResponseDTO>(fetchImpl, '/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    login(input: {
      username: string;
      password: string;
    }): Promise<AuthResponseDTO> {
      return requestJson<AuthResponseDTO>(fetchImpl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },

    logout(): Promise<{ ok: boolean }> {
      return requestJson<{ ok: boolean }>(fetchImpl, '/api/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },

    me(): Promise<AuthResponseDTO> {
      return requestJson<AuthResponseDTO>(fetchImpl, '/api/auth/me', {
        method: 'GET',
      });
    },

    async getSyncMeta(input: {
      userId: string;
      knownRevision: number;
    }): Promise<SyncMetaResponseDTO> {
      const response = await fetchImpl(
        `/api/sync/meta?since=${encodeURIComponent(String(input.knownRevision))}`,
        {
          method: 'GET',
          credentials: 'include',
          headers: {
            'If-None-Match': `"rev-${input.knownRevision}"`,
            'X-UProSC-User-Id': input.userId,
          },
        },
      );

      if (response.status === 304) {
        return {
          serverRevision: input.knownRevision,
          updatedAt: 0,
          entityCount: 0,
          notModified: true,
        };
      }

      if (!response.ok) {
        throw await parseApiError(response);
      }

      return (await response.json()) as SyncMetaResponseDTO;
    },

    postSync(input: {
      userId: string;
      sinceRevision: number;
      changes: SyncEntityEnvelope[];
      keepalive?: boolean;
    }): Promise<SyncPushPullResponseDTO> {
      return requestJson<SyncPushPullResponseDTO>(fetchImpl, '/api/sync', {
        method: 'POST',
        keepalive: Boolean(input.keepalive),
        headers: {
          'X-UProSC-User-Id': input.userId,
        },
        body: JSON.stringify({
          sinceRevision: input.sinceRevision,
          clientTime: Date.now(),
          changes: input.changes,
        }),
      });
    },
  };
}

export type SyncApiClient = ReturnType<typeof createSyncApiClient>;
export const defaultSyncApiClient = createSyncApiClient();
