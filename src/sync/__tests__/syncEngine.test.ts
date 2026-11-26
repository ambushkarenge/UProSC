import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAccountRegistry } from '../../store/accountManager';
import { useAppStore } from '../../store/useAppStore';
import type { UserProfile } from '../../types/domain';
import { createSyncApiClient } from '../apiClient';
import { FORCE_SYNC_COOLDOWN_MS, SyncEngine } from '../syncEngine';

const CLOUD_USER: UserProfile = {
  id: 'usr_cloud_1',
  username: 'alice',
  displayName: 'Alice',
  mode: 'cloud',
  authState: 'authenticated',
  createdAt: 1000,
  lastSyncedAt: null,
  serverRevision: 2,
};

describe('SyncEngine — Low-Traffic Polling, Cooldown, PageHide & Auth Guards', () => {
  beforeEach(async () => {
    localStorage.clear();
    useAppStore.getState().resetAllData();
    await saveAccountRegistry({
      activeUserId: CLOUD_USER.id,
      profiles: [CLOUD_USER],
      legacyMigrated: true,
    });
    useAppStore.setState({ activeUserId: CLOUD_USER.id, dirtyEntities: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses /api/sync/meta ETag 304 and transfers zero entity payload when clean and unchanged', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/api/sync/meta?since=2');
      return new Response(null, { status: 304 });
    });

    const engine = new SyncEngine({
      apiClient: createSyncApiClient(fetchMock),
      now: () => 50_000,
      isOnline: () => true,
      getVisibilityState: () => 'visible',
    });

    const result = await engine.syncNow({ force: false, reason: 'periodic' });
    expect(result.synced).toBe(true);
    expect(result.pushedCount).toBe(0);
    expect(result.pulledCount).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().status).toBe('synced');
  });

  it('pushes only dirty deltas, pulls remote updates, and preserves edits made mid-flight', async () => {
    const subj = useAppStore.getState().addSubject({
      name: 'Linear Algebra',
      color: '#6366f1',
      dailyGoalMinutes: 60,
    });

    let resolveFetch!: (res: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/api/sync');
      const body = JSON.parse(String(init?.body)) as {
        sinceRevision: number;
        changes: Array<{ entityId: string }>;
      };
      expect(body.sinceRevision).toBe(2);
      expect(body.changes.map((c) => c.entityId)).toEqual([subj.id]);
      return fetchPromise;
    });

    const engine = new SyncEngine({
      apiClient: createSyncApiClient(fetchMock),
      now: () => 100_000,
      isOnline: () => true,
      getVisibilityState: () => 'visible',
    });

    const syncPromise = engine.syncNow({ force: true, reason: 'manual' });

    // Edit a setting WHILE the HTTP sync request is still in-flight
    await new Promise((r) => setTimeout(r, 5));
    useAppStore.getState().setDailyStudyGoalMinutes(180);

    resolveFetch(
      new Response(
        JSON.stringify({
          serverRevision: 3,
          serverTime: 100_500,
          acceptedCount: 1,
          entities: [
            {
              entityType: 'task',
              entityId: 'remote-task-1',
              data: {
                id: 'remote-task-1',
                title: 'Synced Task',
                logicalDate: '2026-11-26',
                completed: false,
                priority: 'high',
                updatedAt: 100_100,
              },
              updatedAt: 100_100,
              deletedAt: null,
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await syncPromise;
    expect(result.synced).toBe(true);
    expect(result.serverRevision).toBe(3);

    // Pushed subject dirty entry cleared, remote task applied, mid-flight settings edit STILL dirty!
    const state = useAppStore.getState();
    expect(state.tasks.map((t) => t.id)).toEqual(['remote-task-1']);
    expect(state.dirtyEntities[`subject:${subj.id}`]).toBeUndefined();
    expect(state.dirtyEntities['settings:settings']).toBeDefined();
  });

  it('enforces forced Sync Now cooldown to prevent hammering the backend', async () => {
    let clock = 10_000;
    const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));

    const engine = new SyncEngine({
      apiClient: createSyncApiClient(fetchMock),
      now: () => clock,
      isOnline: () => true,
      getVisibilityState: () => 'visible',
    });

    const first = await engine.syncNow({ force: true, reason: 'manual' });
    expect(first.synced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 1000;
    const second = await engine.syncNow({ force: true, reason: 'manual' });
    expect(second.synced).toBe(false);
    expect(second.skippedReason).toBe('cooldown');
    expect(second.cooldownRemainingMs).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += FORCE_SYNC_COOLDOWN_MS;
    const third = await engine.syncNow({ force: true, reason: 'manual' });
    expect(third.synced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('marks profile auth_required on 401/409 without wiping local data', async () => {
    useAppStore.getState().addSubject({
      name: 'Keep Me Safe',
      color: '#10b981',
      dailyGoalMinutes: 60,
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: 'user_mismatch', message: 'Wrong user cookie' },
        }),
        { status: 409 },
      ),
    );

    const engine = new SyncEngine({
      apiClient: createSyncApiClient(fetchMock),
      now: () => 20_000,
      isOnline: () => true,
    });

    const res = await engine.syncNow({ force: true, reason: 'manual' });
    expect(res.synced).toBe(false);
    expect(res.skippedReason).toBe('auth_required');
    expect(engine.getSnapshot().status).toBe('auth_required');
    expect(useAppStore.getState().subjects.map((s) => s.name)).toEqual([
      'Keep Me Safe',
    ]);
  });

  it('flushes synchronous snapshot and keepalive sync when pagehide fires with pending changes', async () => {
    useAppStore.getState().addSubject({
      name: 'Exit Flush',
      color: '#f43f5e',
      dailyGoalMinutes: 30,
    });

    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.keepalive).toBe(true);
      return new Response(
        JSON.stringify({
          serverRevision: 3,
          serverTime: 90_000,
          acceptedCount: 1,
          entities: [],
        }),
        { status: 200 },
      );
    });

    const engine = new SyncEngine({
      apiClient: createSyncApiClient(fetchMock),
      now: () => 90_000,
      isOnline: () => true,
    });

    engine.flushOnPageExit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
