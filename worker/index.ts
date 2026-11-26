import {
  handleLogin,
  handleLogout,
  handleMe,
  handleRegister,
} from './auth';
import { handleSyncMeta, handleSyncPushPull } from './sync';
import { type WorkerEnv, errorResponse } from './types';

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith('/api/')) {
      try {
        if (pathname === '/api/auth/register' && request.method === 'POST') {
          return await handleRegister(request, env);
        }
        if (pathname === '/api/auth/login' && request.method === 'POST') {
          return await handleLogin(request, env);
        }
        if (pathname === '/api/auth/logout' && request.method === 'POST') {
          return await handleLogout(request, env);
        }
        if (pathname === '/api/auth/me' && request.method === 'GET') {
          return await handleMe(request, env);
        }
        if (pathname === '/api/sync/meta' && request.method === 'GET') {
          return await handleSyncMeta(request, env);
        }
        if (pathname === '/api/sync' && request.method === 'POST') {
          return await handleSyncPushPull(request, env);
        }

        return errorResponse(
          404,
          'not_found',
          `Unknown API endpoint: ${request.method} ${pathname}`,
        );
      } catch (err) {
        console.error('Worker API error:', err);
        return errorResponse(500, 'internal_error', 'Internal server error.');
      }
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return errorResponse(404, 'not_found', 'Not found.');
  },
};

export default worker;
