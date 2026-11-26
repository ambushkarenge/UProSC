import { useSyncExternalStore } from 'react';
import {
  createDefaultLocalProfile,
  deleteUserProfile,
  getActiveUserProfileSync,
  loadAccountRegistry,
  markOtherCloudProfilesReauthRequired,
  migrateLegacySingleUserStateIfNeeded,
  subscribeAccountRegistry,
  updateUserProfileMeta,
  upsertUserProfile,
} from '../store/accountManager';
import {
  applySyncedResultForUser,
  copyCurrentUserDataToCloudProfile,
  extractPersistedAppData,
  flushCurrentUserSnapshotSync,
  flushCurrentUserToStorage,
  hydrateStoreForUser,
  switchActiveUserStore,
  useAppStore,
} from '../store/useAppStore';
import type { UserProfile } from '../types/domain';
import {
  ApiClientError,
  type SyncApiClient,
  defaultSyncApiClient,
} from './apiClient';
import { buildSyncChangesFromCollections } from './merge';
import type { SyncLifecycleStatus, SyncStatusSnapshot } from './types';

export const PERIODIC_SYNC_INTERVAL_MS = 60_000;
export const MIN_AUTO_SYNC_GAP_MS = 15_000;
export const FORCE_SYNC_COOLDOWN_MS = 3_000;
const KEEPALIVE_PAYLOAD_LIMIT_BYTES = 55 * 1024;

export interface SyncNowResult {
  synced: boolean;
  skippedReason?:
    | 'local_profile'
    | 'auth_required'
    | 'offline'
    | 'cooldown'
    | 'throttled';
  cooldownRemainingMs?: number;
  pulledCount: number;
  pushedCount: number;
  serverRevision: number;
  error?: string;
}

export interface SyncEngineDependencies {
  apiClient?: SyncApiClient;
  now?: () => number;
  isOnline?: () => boolean;
  getVisibilityState?: () => DocumentVisibilityState;
}

function defaultIsOnline(): boolean {
  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
    return navigator.onLine;
  }
  return true;
}

function defaultGetVisibilityState(): DocumentVisibilityState {
  if (typeof document !== 'undefined') {
    return document.visibilityState;
  }
  return 'visible';
}

export class SyncEngine {
  private apiClient: SyncApiClient;
  private now: () => number;
  private isOnline: () => boolean;
  private getVisibilityState: () => DocumentVisibilityState;

  private listeners = new Set<() => void>();
  private inFlightSync: { userId: string; promise: Promise<SyncNowResult> } | null = null;
  private intervalId: number | null = null;
  private lifecycleAttached = false;
  private lastAutoCheckAtByUser = new Map<string, number>();
  private lastManualSyncAtByUser = new Map<string, number>();
  private runtimeStatusByUser = new Map<
    string,
    {
      status: SyncLifecycleStatus;
      lastError: string | null;
      lastResultSummary: string | null;
    }
  >();
  private cachedSnapshot: SyncStatusSnapshot | null = null;

  constructor(deps: SyncEngineDependencies = {}) {
    this.apiClient = deps.apiClient ?? defaultSyncApiClient;
    this.now = deps.now ?? (() => Date.now());
    this.isOnline = deps.isOnline ?? defaultIsOnline;
    this.getVisibilityState = deps.getVisibilityState ?? defaultGetVisibilityState;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    const unsubStore = useAppStore.subscribe(() => {
      this.invalidateAndNotify();
    });
    const unsubRegistry = subscribeAccountRegistry(() => {
      this.reschedulePeriodicSync();
      this.invalidateAndNotify();
    });
    return () => {
      this.listeners.delete(listener);
      unsubStore();
      unsubRegistry();
    };
  };

  private invalidateAndNotify(): void {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) {
      listener();
    }
  }

  getSnapshot = (): SyncStatusSnapshot => {
    const profile = getActiveUserProfileSync();
    const storeState = useAppStore.getState();
    const pendingCount =
      storeState.activeUserId === profile.id
        ? Object.keys(storeState.dirtyEntities).length
        : 0;
    const runtime = this.runtimeStatusByUser.get(profile.id);
    const lastManual = this.lastManualSyncAtByUser.get(profile.id) ?? 0;
    const cooldownUntil =
      lastManual > 0 ? lastManual + FORCE_SYNC_COOLDOWN_MS : 0;

    let status: SyncLifecycleStatus;
    if (profile.mode === 'local') {
      status = 'local';
    } else if (profile.authState === 'reauth_required') {
      status = 'auth_required';
    } else if (!this.isOnline()) {
      status = 'offline';
    } else if (runtime?.status) {
      status = runtime.status;
    } else if (profile.lastSyncedAt !== null && pendingCount === 0) {
      status = 'synced';
    } else {
      status = 'idle';
    }

    const next: SyncStatusSnapshot = {
      userId: profile.id,
      mode: profile.mode,
      status,
      pendingCount,
      lastSyncedAt: profile.lastSyncedAt,
      serverRevision: profile.serverRevision,
      lastError: runtime?.lastError ?? null,
      lastResultSummary: runtime?.lastResultSummary ?? null,
      cooldownUntil,
    };

    if (
      this.cachedSnapshot &&
      this.cachedSnapshot.userId === next.userId &&
      this.cachedSnapshot.mode === next.mode &&
      this.cachedSnapshot.status === next.status &&
      this.cachedSnapshot.pendingCount === next.pendingCount &&
      this.cachedSnapshot.lastSyncedAt === next.lastSyncedAt &&
      this.cachedSnapshot.serverRevision === next.serverRevision &&
      this.cachedSnapshot.lastError === next.lastError &&
      this.cachedSnapshot.lastResultSummary === next.lastResultSummary &&
      this.cachedSnapshot.cooldownUntil === next.cooldownUntil
    ) {
      return this.cachedSnapshot;
    }

    this.cachedSnapshot = next;
    return next;
  };

  private setUserRuntimeStatus(
    userId: string,
    status: SyncLifecycleStatus,
    lastError: string | null = null,
    lastResultSummary: string | null = null,
  ): void {
    this.runtimeStatusByUser.set(userId, {
      status,
      lastError,
      lastResultSummary,
    });
    this.invalidateAndNotify();
  }

  async syncNow(options: {
    force?: boolean;
    reason?: 'manual' | 'periodic' | 'visible' | 'online' | 'auth';
  } = {}): Promise<SyncNowResult> {
    const force = Boolean(options.force);
    const profile = getActiveUserProfileSync();

    if (profile.mode === 'local') {
      return {
        synced: false,
        skippedReason: 'local_profile',
        pulledCount: 0,
        pushedCount: 0,
        serverRevision: 0,
      };
    }

    if (profile.authState === 'reauth_required') {
      this.setUserRuntimeStatus(
        profile.id,
        'auth_required',
        'Session expired or belongs to another account. Sign in again to sync.',
      );
      return {
        synced: false,
        skippedReason: 'auth_required',
        pulledCount: 0,
        pushedCount: 0,
        serverRevision: profile.serverRevision,
      };
    }

    if (!this.isOnline()) {
      this.setUserRuntimeStatus(
        profile.id,
        'offline',
        null,
        'Offline — changes saved locally',
      );
      return {
        synced: false,
        skippedReason: 'offline',
        pulledCount: 0,
        pushedCount: 0,
        serverRevision: profile.serverRevision,
      };
    }

    const nowMs = this.now();
    if (force && options.reason === 'manual') {
      const lastManual = this.lastManualSyncAtByUser.get(profile.id) ?? 0;
      const elapsed = nowMs - lastManual;
      if (lastManual > 0 && elapsed < FORCE_SYNC_COOLDOWN_MS) {
        const cooldownRemainingMs = FORCE_SYNC_COOLDOWN_MS - elapsed;
        return {
          synced: false,
          skippedReason: 'cooldown',
          cooldownRemainingMs,
          pulledCount: 0,
          pushedCount: 0,
          serverRevision: profile.serverRevision,
        };
      }
    }

    const storeState = useAppStore.getState();
    const pendingCount =
      storeState.activeUserId === profile.id
        ? Object.keys(storeState.dirtyEntities).length
        : 0;

    if (!force && pendingCount === 0) {
      const lastAuto = this.lastAutoCheckAtByUser.get(profile.id) ?? 0;
      if (lastAuto > 0 && nowMs - lastAuto < MIN_AUTO_SYNC_GAP_MS) {
        return {
          synced: false,
          skippedReason: 'throttled',
          pulledCount: 0,
          pushedCount: 0,
          serverRevision: profile.serverRevision,
        };
      }
    }

    if (this.inFlightSync && this.inFlightSync.userId === profile.id) {
      return this.inFlightSync.promise;
    }

    const runPromise = this.executeSyncCycle(profile, force, options.reason ?? 'manual');
    this.inFlightSync = { userId: profile.id, promise: runPromise };

    try {
      return await runPromise;
    } finally {
      if (this.inFlightSync?.promise === runPromise) {
        this.inFlightSync = null;
      }
    }
  }

  private async executeSyncCycle(
    profile: UserProfile,
    force: boolean,
    reason: string,
  ): Promise<SyncNowResult> {
    const userId = profile.id;
    const startMs = this.now();
    this.lastAutoCheckAtByUser.set(userId, startMs);
    if (force && reason === 'manual') {
      this.lastManualSyncAtByUser.set(userId, startMs);
    }

    this.setUserRuntimeStatus(userId, 'syncing', null, null);

    try {
      const currentState = useAppStore.getState();
      const persisted = extractPersistedAppData(currentState);
      const isActiveInStore = persisted.activeUserId === userId;
      const changes = isActiveInStore
        ? buildSyncChangesFromCollections(persisted)
        : [];
      const pushedWatermark: Record<string, number> = {};
      if (isActiveInStore) {
        for (const [key, ref] of Object.entries(persisted.dirtyEntities)) {
          pushedWatermark[key] = ref.updatedAt;
        }
      }

      // Zero-traffic idle check when no local edits are pending
      if (changes.length === 0) {
        const meta = await this.apiClient.getSyncMeta({
          userId,
          knownRevision: profile.serverRevision,
        });
        if (meta.notModified || meta.serverRevision === profile.serverRevision) {
          const checkTime = this.now();
          await updateUserProfileMeta(userId, {
            lastSyncedAt: checkTime,
            authState: 'authenticated',
          });
          this.setUserRuntimeStatus(
            userId,
            'synced',
            null,
            'Up to date (0 changes)',
          );
          return {
            synced: true,
            pulledCount: 0,
            pushedCount: 0,
            serverRevision: profile.serverRevision,
          };
        }
      }

      const response = await this.apiClient.postSync({
        userId,
        sinceRevision: profile.serverRevision,
        changes,
      });

      await applySyncedResultForUser(userId, response.entities, pushedWatermark);
      await updateUserProfileMeta(userId, {
        serverRevision: response.serverRevision,
        lastSyncedAt: response.serverTime,
        authState: 'authenticated',
      });

      const summary =
        changes.length === 0 && response.entities.length === 0
          ? 'Up to date'
          : `Synced (${changes.length} sent, ${response.entities.length} received)`;

      this.setUserRuntimeStatus(userId, 'synced', null, summary);
      return {
        synced: true,
        pulledCount: response.entities.length,
        pushedCount: changes.length,
        serverRevision: response.serverRevision,
      };
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.status === 401 || error.status === 409)
      ) {
        await updateUserProfileMeta(userId, {
          authState: 'reauth_required',
        });
        this.setUserRuntimeStatus(userId, 'auth_required', error.message, null);
        return {
          synced: false,
          skippedReason: 'auth_required',
          pulledCount: 0,
          pushedCount: 0,
          serverRevision: profile.serverRevision,
          error: error.message,
        };
      }

      const message =
        error instanceof Error ? error.message : 'Unable to reach sync server.';
      const nextStatus: SyncLifecycleStatus = this.isOnline()
        ? 'error'
        : 'offline';
      this.setUserRuntimeStatus(userId, nextStatus, message, null);
      return {
        synced: false,
        pulledCount: 0,
        pushedCount: 0,
        serverRevision: profile.serverRevision,
        error: message,
      };
    }
  }

  /**
   * Flushes active state synchronously to `localStorage` on `pagehide` / `hidden`
   * and fires a lightweight `keepalive` delta push only when dirty cloud edits exist.
   */
  flushOnPageExit(): void {
    flushCurrentUserSnapshotSync();

    const profile = getActiveUserProfileSync();
    if (
      profile.mode !== 'cloud' ||
      profile.authState !== 'authenticated' ||
      !this.isOnline()
    ) {
      return;
    }

    const state = useAppStore.getState();
    if (state.activeUserId !== profile.id) return;
    if (Object.keys(state.dirtyEntities).length === 0) return;

    const changes = buildSyncChangesFromCollections(extractPersistedAppData(state));
    if (changes.length === 0) return;

    const estimatedBytes = JSON.stringify(changes).length;
    if (estimatedBytes > KEEPALIVE_PAYLOAD_LIMIT_BYTES) {
      return;
    }

    const pushedWatermark: Record<string, number> = {};
    for (const [key, ref] of Object.entries(state.dirtyEntities)) {
      pushedWatermark[key] = ref.updatedAt;
    }

    void this.apiClient
      .postSync({
        userId: profile.id,
        sinceRevision: profile.serverRevision,
        changes,
        keepalive: true,
      })
      .then(async (response) => {
        await applySyncedResultForUser(
          profile.id,
          response.entities,
          pushedWatermark,
        );
        await updateUserProfileMeta(profile.id, {
          serverRevision: response.serverRevision,
          lastSyncedAt: response.serverTime,
        });
      })
      .catch(() => {
        // Local synchronous snapshot already safeguarded all changes
      });
  }

  private handleVisibilityChange = (): void => {
    if (this.getVisibilityState() === 'hidden') {
      this.reschedulePeriodicSync();
      this.flushOnPageExit();
      return;
    }

    this.reschedulePeriodicSync();
    const profile = getActiveUserProfileSync();
    if (profile.mode === 'cloud' && profile.authState === 'authenticated') {
      void this.syncNow({ force: false, reason: 'visible' });
    }
  };

  private handleOnline = (): void => {
    this.invalidateAndNotify();
    const profile = getActiveUserProfileSync();
    if (profile.mode === 'cloud' && profile.authState === 'authenticated') {
      void this.syncNow({ force: false, reason: 'online' });
    }
  };

  private handleOffline = (): void => {
    this.invalidateAndNotify();
  };

  private handlePageHide = (): void => {
    this.flushOnPageExit();
  };

  reschedulePeriodicSync(): void {
    if (typeof window === 'undefined') return;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const profile = getActiveUserProfileSync();
    const shouldPoll =
      this.lifecycleAttached &&
      profile.mode === 'cloud' &&
      profile.authState === 'authenticated' &&
      this.getVisibilityState() === 'visible';

    if (!shouldPoll) return;

    this.intervalId = window.setInterval(() => {
      if (this.getVisibilityState() === 'visible') {
        void this.syncNow({ force: false, reason: 'periodic' });
      }
    }, PERIODIC_SYNC_INTERVAL_MS);
  }

  startLifecycle(): void {
    if (typeof window === 'undefined' || this.lifecycleAttached) return;
    this.lifecycleAttached = true;

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('pagehide', this.handlePageHide);

    this.reschedulePeriodicSync();
  }

  stopLifecycle(): void {
    if (typeof window === 'undefined') return;
    this.lifecycleAttached = false;

    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    window.removeEventListener('pagehide', this.handlePageHide);
  }

  resetInternalStateForTests(): void {
    this.stopLifecycle();
    this.inFlightSync = null;
    this.lastAutoCheckAtByUser.clear();
    this.lastManualSyncAtByUser.clear();
    this.runtimeStatusByUser.clear();
    this.cachedSnapshot = null;
  }
}

export const syncEngine = new SyncEngine();

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(
    syncEngine.subscribe,
    syncEngine.getSnapshot,
    syncEngine.getSnapshot,
  );
}

/**
 * Bootstraps legacy Phase 1-3 migration, restores the active user profile from
 * IndexedDB/mirrors, attaches `pagehide`/visibility lifecycle listeners, and
 * kicks off background sync when signed into a cloud profile.
 */
export async function initializeAppPersistence(): Promise<void> {
  const registry = await migrateLegacySingleUserStateIfNeeded();
  await hydrateStoreForUser(registry.activeUserId);
  syncEngine.startLifecycle();

  const active =
    registry.profiles.find((p) => p.id === registry.activeUserId) ??
    registry.profiles[0];

  if (active?.mode === 'cloud' && active.authState === 'authenticated') {
    void syncEngine.syncNow({ force: false, reason: 'visible' });
  }
}

export function teardownAppPersistence(): void {
  syncEngine.stopLifecycle();
}

function createLocalUserId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `local_${crypto.randomUUID()}`;
  }
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function createLocalProfileAndSwitch(
  displayName: string,
): Promise<UserProfile> {
  const trimmed = displayName.trim().slice(0, 40) || 'Study Profile';
  const slug =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'local';
  const now = Date.now();
  const profile: UserProfile = {
    id: createLocalUserId(),
    username: slug,
    displayName: trimmed,
    mode: 'local',
    authState: 'none',
    createdAt: now,
    lastSyncedAt: null,
    serverRevision: 0,
  };

  await flushCurrentUserToStorage();
  await upsertUserProfile(profile, true);
  await switchActiveUserStore(profile.id);
  return profile;
}

export async function switchToUserProfile(userId: string): Promise<void> {
  await switchActiveUserStore(userId);
  const registry = await loadAccountRegistry();
  const target = registry.profiles.find((p) => p.id === userId);
  if (target?.mode === 'cloud' && target.authState === 'authenticated') {
    void syncEngine.syncNow({ force: false, reason: 'auth' });
  }
}

export async function registerCloudAccount(input: {
  username: string;
  password: string;
  displayName?: string;
  copyCurrentLocalData?: boolean;
}): Promise<UserProfile> {
  const currentProfile = getActiveUserProfileSync();
  const { user } = await defaultSyncApiClient.register({
    username: input.username,
    password: input.password,
    displayName: input.displayName,
  });

  const profile: UserProfile = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    mode: 'cloud',
    authState: 'authenticated',
    createdAt: user.createdAt,
    lastSyncedAt: null,
    serverRevision: user.serverRevision,
  };

  await flushCurrentUserToStorage();
  await markOtherCloudProfilesReauthRequired(profile.id);
  await upsertUserProfile(profile, true);

  if (input.copyCurrentLocalData && currentProfile.mode === 'local') {
    await copyCurrentUserDataToCloudProfile(profile.id);
  } else {
    await switchActiveUserStore(profile.id);
  }

  await syncEngine.syncNow({ force: true, reason: 'auth' });
  return profile;
}

export async function loginCloudAccount(input: {
  username: string;
  password: string;
}): Promise<UserProfile> {
  const { user } = await defaultSyncApiClient.login(input);
  const registry = await loadAccountRegistry();
  const existing = registry.profiles.find((p) => p.id === user.id);

  const profile: UserProfile = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    mode: 'cloud',
    authState: 'authenticated',
    createdAt: user.createdAt,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    serverRevision: existing?.serverRevision ?? 0,
  };

  await flushCurrentUserToStorage();
  await markOtherCloudProfilesReauthRequired(profile.id);
  await upsertUserProfile(profile, true);
  await switchActiveUserStore(profile.id);
  await syncEngine.syncNow({ force: true, reason: 'auth' });
  return profile;
}

export async function logoutActiveCloudAccount(): Promise<void> {
  const active = getActiveUserProfileSync();
  try {
    await defaultSyncApiClient.logout();
  } catch {
    // Offline sign-out still transitions local authState cleanly
  }

  if (active.mode === 'cloud') {
    await updateUserProfileMeta(active.id, { authState: 'reauth_required' });
  }
}

export async function removeUserProfileAndSwitch(
  userId: string,
): Promise<UserProfile> {
  const active = getActiveUserProfileSync();
  if (active.id === userId && active.mode === 'cloud' && active.authState === 'authenticated') {
    try {
      await defaultSyncApiClient.logout();
    } catch {
      // Ignore network errors while deleting local profile copy
    }
  }

  const { registry, nextActiveUserId } = await deleteUserProfile(userId);
  await hydrateStoreForUser(nextActiveUserId);
  return (
    registry.profiles.find((p) => p.id === nextActiveUserId) ??
    createDefaultLocalProfile(Date.now())
  );
}
