import type {
  DDayGoal,
  Habit,
  MultiDayTaskPlan,
  StudySession,
  Subject,
  TodoTask,
  UserProfile,
} from '../types/domain';
import {
  DEFAULT_LOCAL_USER_ID,
  STORE_STORAGE_KEY,
  clearActiveTimerMirror,
  clearLegacyActiveTimerMirror,
  clearStateSnapshotMirror,
  getUserStoreStorageKey,
  idbStorage,
  readLegacyActiveTimerMirror,
  safeLocalStorageGet,
  safeLocalStorageSet,
  saveActiveTimerMirror,
  saveStateSnapshotMirror,
} from './idbStorage';

export const ACCOUNT_REGISTRY_IDB_KEY = 'uprosc:account-registry';
export const ACCOUNT_REGISTRY_MIRROR_KEY = 'uprosc:account-registry-mirror';

export interface AccountRegistry {
  activeUserId: string;
  profiles: UserProfile[];
  legacyMigrated: boolean;
}

type RegistryListener = (registry: AccountRegistry) => void;
const registryListeners = new Set<RegistryListener>();

export function createDefaultLocalProfile(nowMs = 0): UserProfile {
  return {
    id: DEFAULT_LOCAL_USER_ID,
    username: 'local',
    displayName: 'Local Study Profile',
    mode: 'local',
    authState: 'none',
    createdAt: nowMs,
    lastSyncedAt: null,
    serverRevision: 0,
  };
}

function createInitialRegistry(): AccountRegistry {
  return {
    activeUserId: DEFAULT_LOCAL_USER_ID,
    profiles: [createDefaultLocalProfile(0)],
    legacyMigrated: false,
  };
}

function normalizeRegistry(raw: unknown): AccountRegistry {
  if (!raw || typeof raw !== 'object') {
    return createInitialRegistry();
  }
  const candidate = raw as Partial<AccountRegistry>;
  const profiles = Array.isArray(candidate.profiles)
    ? candidate.profiles.filter(
        (p): p is UserProfile =>
          Boolean(p) &&
          typeof p.id === 'string' &&
          p.id.length > 0 &&
          typeof p.username === 'string' &&
          typeof p.displayName === 'string',
      )
    : [];

  if (profiles.length === 0) {
    profiles.push(createDefaultLocalProfile(0));
  }

  const hasActive = profiles.some((p) => p.id === candidate.activeUserId);
  const activeUserId = hasActive
    ? (candidate.activeUserId as string)
    : profiles[0].id;

  return {
    activeUserId,
    profiles,
    legacyMigrated: Boolean(candidate.legacyMigrated),
  };
}

function notifyRegistryListeners(registry: AccountRegistry): void {
  for (const listener of registryListeners) {
    listener(registry);
  }
}

export function subscribeAccountRegistry(listener: RegistryListener): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * Synchronously reads the active user registry mirror from `localStorage`
 * so reloads restore the active user on frame 1 before async IDB hydration.
 */
export function readAccountRegistrySync(): AccountRegistry {
  const raw = safeLocalStorageGet(ACCOUNT_REGISTRY_MIRROR_KEY);
  if (!raw) {
    return createInitialRegistry();
  }
  try {
    return normalizeRegistry(JSON.parse(raw));
  } catch {
    return createInitialRegistry();
  }
}

export function getActiveUserIdSync(): string {
  return readAccountRegistrySync().activeUserId;
}

export function getActiveUserProfileSync(): UserProfile {
  const registry = readAccountRegistrySync();
  return (
    registry.profiles.find((p) => p.id === registry.activeUserId) ??
    registry.profiles[0]
  );
}

export async function loadAccountRegistry(): Promise<AccountRegistry> {
  const rawIdb = await idbStorage.getItem(ACCOUNT_REGISTRY_IDB_KEY);
  if (rawIdb) {
    try {
      const normalized = normalizeRegistry(JSON.parse(rawIdb));
      safeLocalStorageSet(
        ACCOUNT_REGISTRY_MIRROR_KEY,
        JSON.stringify(normalized),
      );
      return normalized;
    } catch {
      // Fall back to mirror
    }
  }
  const mirror = readAccountRegistrySync();
  await idbStorage.setItem(ACCOUNT_REGISTRY_IDB_KEY, JSON.stringify(mirror));
  return mirror;
}

export async function saveAccountRegistry(
  registry: AccountRegistry,
): Promise<AccountRegistry> {
  const normalized = normalizeRegistry(registry);
  const serialized = JSON.stringify(normalized);
  safeLocalStorageSet(ACCOUNT_REGISTRY_MIRROR_KEY, serialized);
  await idbStorage.setItem(ACCOUNT_REGISTRY_IDB_KEY, serialized);
  notifyRegistryListeners(normalized);
  return normalized;
}

export async function upsertUserProfile(
  profile: UserProfile,
  activate = true,
): Promise<AccountRegistry> {
  const current = await loadAccountRegistry();
  const idx = current.profiles.findIndex((p) => p.id === profile.id);
  const nextProfiles =
    idx === -1
      ? [...current.profiles, profile]
      : current.profiles.map((p, i) => (i === idx ? profile : p));

  return saveAccountRegistry({
    ...current,
    activeUserId: activate ? profile.id : current.activeUserId,
    profiles: nextProfiles,
  });
}

export async function updateUserProfileMeta(
  userId: string,
  patch: Partial<
    Pick<
      UserProfile,
      'displayName' | 'authState' | 'lastSyncedAt' | 'serverRevision'
    >
  >,
): Promise<AccountRegistry> {
  const current = await loadAccountRegistry();
  const nextProfiles = current.profiles.map((profile) =>
    profile.id === userId ? { ...profile, ...patch } : profile,
  );
  return saveAccountRegistry({
    ...current,
    profiles: nextProfiles,
  });
}

export async function markOtherCloudProfilesReauthRequired(
  activeCloudUserId: string,
): Promise<AccountRegistry> {
  const current = await loadAccountRegistry();
  const nextProfiles = current.profiles.map((profile) =>
    profile.mode === 'cloud' && profile.id !== activeCloudUserId
      ? { ...profile, authState: 'reauth_required' as const }
      : profile,
  );
  return saveAccountRegistry({
    ...current,
    profiles: nextProfiles,
  });
}

export async function setActiveProfileId(userId: string): Promise<AccountRegistry> {
  const current = await loadAccountRegistry();
  if (!current.profiles.some((p) => p.id === userId)) {
    return current;
  }
  return saveAccountRegistry({
    ...current,
    activeUserId: userId,
  });
}

export async function deleteUserProfile(userId: string): Promise<{
  registry: AccountRegistry;
  nextActiveUserId: string;
}> {
  const current = await loadAccountRegistry();
  const remaining = current.profiles.filter((p) => p.id !== userId);
  if (remaining.length === 0) {
    remaining.push(createDefaultLocalProfile(Date.now()));
  }

  const nextActiveUserId =
    current.activeUserId === userId ? remaining[0].id : current.activeUserId;

  await idbStorage.removeItem(getUserStoreStorageKey(userId));
  clearActiveTimerMirror(userId);
  clearStateSnapshotMirror(userId);

  const registry = await saveAccountRegistry({
    ...current,
    activeUserId: nextActiveUserId,
    profiles: remaining,
  });

  return { registry, nextActiveUserId };
}

function stampLegacyDataForUser(
  rawJson: string,
  targetUserId: string,
  nowMs: number,
): string | null {
  try {
    const parsed = JSON.parse(rawJson) as {
      state?: Record<string, unknown>;
      version?: number;
    };
    const stateObj =
      parsed && typeof parsed === 'object' && parsed.state
        ? parsed.state
        : (parsed as Record<string, unknown>);
    if (!stateObj || typeof stateObj !== 'object') {
      return null;
    }

    const subjects = Array.isArray(stateObj.subjects)
      ? (stateObj.subjects as Subject[]).map((s) => ({
          ...s,
          updatedAt: s.updatedAt ?? s.createdAt ?? nowMs,
        }))
      : [];
    const sessions = Array.isArray(stateObj.sessions)
      ? (stateObj.sessions as StudySession[]).map((s) => ({
          ...s,
          updatedAt: s.updatedAt ?? s.endTime ?? nowMs,
        }))
      : [];
    const tasks = Array.isArray(stateObj.tasks)
      ? (stateObj.tasks as TodoTask[]).map((t) => ({
          ...t,
          updatedAt: t.updatedAt ?? nowMs,
        }))
      : [];
    const multiDayPlans = Array.isArray(stateObj.multiDayPlans)
      ? (stateObj.multiDayPlans as MultiDayTaskPlan[]).map((p) => ({
          ...p,
          updatedAt: p.updatedAt ?? nowMs,
        }))
      : [];
    const habits = Array.isArray(stateObj.habits)
      ? (stateObj.habits as Habit[]).map((h) => ({
          ...h,
          updatedAt: h.updatedAt ?? h.createdAt ?? nowMs,
        }))
      : [];
    const rawDDay = stateObj.dDayGoal as DDayGoal | null | undefined;
    const dDayGoal = rawDDay
      ? { ...rawDDay, updatedAt: rawDDay.updatedAt ?? nowMs }
      : null;

    const migratedState = {
      ...stateObj,
      activeUserId: targetUserId,
      subjects,
      sessions,
      tasks,
      multiDayPlans,
      habits,
      dDayGoal,
      settingsUpdatedAt:
        typeof stateObj.settingsUpdatedAt === 'number'
          ? stateObj.settingsUpdatedAt
          : nowMs,
      dDayUpdatedAt:
        typeof stateObj.dDayUpdatedAt === 'number'
          ? stateObj.dDayUpdatedAt
          : dDayGoal
            ? nowMs
            : 0,
      stateUpdatedAt:
        typeof stateObj.stateUpdatedAt === 'number'
          ? stateObj.stateUpdatedAt
          : nowMs,
      tombstones:
        stateObj.tombstones && typeof stateObj.tombstones === 'object'
          ? stateObj.tombstones
          : {},
      dirtyEntities:
        stateObj.dirtyEntities && typeof stateObj.dirtyEntities === 'object'
          ? stateObj.dirtyEntities
          : {},
    };

    return JSON.stringify({
      state: migratedState,
      version: typeof parsed.version === 'number' ? parsed.version : 2,
    });
  } catch {
    return null;
  }
}

/**
 * One-time migration moving any Phase 1-3 single-user IndexedDB / localStorage
 * data (`uprosc-app-state`) safely into the default user's isolated namespace.
 */
export async function migrateLegacySingleUserStateIfNeeded(): Promise<AccountRegistry> {
  const registry = await loadAccountRegistry();
  if (registry.legacyMigrated) {
    return registry;
  }

  const targetUserId = DEFAULT_LOCAL_USER_ID;
  const targetKey = getUserStoreStorageKey(targetUserId);
  const existingUserRaw = await idbStorage.getItem(targetKey);
  const legacyRaw = await idbStorage.getItem(STORE_STORAGE_KEY);
  const nowMs = Date.now();

  if (legacyRaw && !existingUserRaw) {
    const migratedEnvelope = stampLegacyDataForUser(
      legacyRaw,
      targetUserId,
      nowMs,
    );
    if (migratedEnvelope) {
      await idbStorage.setItem(targetKey, migratedEnvelope);
      saveStateSnapshotMirror(targetUserId, migratedEnvelope);
    }
  }

  const legacyTimerMirror = readLegacyActiveTimerMirror();
  if (legacyTimerMirror) {
    saveActiveTimerMirror(
      legacyTimerMirror.timer,
      legacyTimerMirror.updatedAt,
      targetUserId,
    );
    clearLegacyActiveTimerMirror();
  }

  if (legacyRaw) {
    await idbStorage.removeItem(STORE_STORAGE_KEY);
  }

  return saveAccountRegistry({
    ...registry,
    legacyMigrated: true,
  });
}
