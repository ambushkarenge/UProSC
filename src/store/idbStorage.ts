import { del, get, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';
import type { ActiveTimerState } from '../types/domain';

export const DEFAULT_LOCAL_USER_ID = 'local-default';
export const STORE_STORAGE_KEY = 'uprosc-app-state';
export const ACTIVE_TIMER_MIRROR_KEY = 'uprosc:active-timer-mirror';
export const STATE_SNAPSHOT_MIRROR_KEY = 'uprosc:state-mirror';

const memoryFallbackStore = new Map<string, string>();

function canUseIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return memoryFallbackStore.get(key) ?? null;
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
  } catch {
    // Ignore quota or restricted-mode errors
  }
  memoryFallbackStore.set(key, value);
}

export function safeLocalStorageRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
  memoryFallbackStore.delete(key);
}

export function getUserStoreStorageKey(userId: string): string {
  return `${STORE_STORAGE_KEY}:${userId || DEFAULT_LOCAL_USER_ID}`;
}

export function getActiveTimerMirrorKey(
  userId: string = DEFAULT_LOCAL_USER_ID,
): string {
  return `${ACTIVE_TIMER_MIRROR_KEY}:${userId || DEFAULT_LOCAL_USER_ID}`;
}

export function getStateSnapshotMirrorKey(
  userId: string = DEFAULT_LOCAL_USER_ID,
): string {
  return `${STATE_SNAPSHOT_MIRROR_KEY}:${userId || DEFAULT_LOCAL_USER_ID}`;
}

/**
 * Offline-first storage adapter backed by IndexedDB (`idb-keyval`), with
 * graceful fallback to `localStorage` (and memory in headless tests) when
 * IndexedDB is unavailable.
 */
export const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (canUseIndexedDB()) {
      try {
        const value = await get<string>(name);
        if (value !== undefined) {
          return value;
        }
      } catch {
        // Fall through to localStorage fallback
      }
    }
    return safeLocalStorageGet(name);
  },

  setItem: async (name: string, value: string): Promise<void> => {
    if (canUseIndexedDB()) {
      try {
        await set(name, value);
        return;
      } catch {
        // Fall through to localStorage fallback
      }
    }
    safeLocalStorageSet(name, value);
  },

  removeItem: async (name: string): Promise<void> => {
    if (canUseIndexedDB()) {
      try {
        await del(name);
      } catch {
        // Ignore IDB error and still clear fallback
      }
    }
    safeLocalStorageRemove(name);
  },
};

export interface ActiveTimerMirrorPayload {
  timer: ActiveTimerState;
  updatedAt: number;
}

/**
 * Synchronously mirrors the active timer state per `userId` to `localStorage`
 * so sudden tab closes or iOS PWA terminations never lose a running session.
 */
export function saveActiveTimerMirror(
  timer: ActiveTimerState,
  updatedAt = Date.now(),
  userId: string = DEFAULT_LOCAL_USER_ID,
): void {
  const payload: ActiveTimerMirrorPayload = { timer, updatedAt };
  safeLocalStorageSet(getActiveTimerMirrorKey(userId), JSON.stringify(payload));
}

function parseTimerMirrorRaw(raw: string | null): ActiveTimerMirrorPayload | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ActiveTimerMirrorPayload>;
    if (
      parsed &&
      typeof parsed.updatedAt === 'number' &&
      parsed.timer &&
      typeof parsed.timer === 'object' &&
      typeof parsed.timer.status === 'string' &&
      typeof parsed.timer.mode === 'string' &&
      typeof parsed.timer.accumulatedMs === 'number'
    ) {
      return parsed as ActiveTimerMirrorPayload;
    }
  } catch {
    // Ignore corrupted mirror JSON
  }
  return null;
}

/** Reads the synchronous `localStorage` mirror of the active timer for a user. */
export function readActiveTimerMirror(
  userId: string = DEFAULT_LOCAL_USER_ID,
): ActiveTimerMirrorPayload | null {
  return parseTimerMirrorRaw(safeLocalStorageGet(getActiveTimerMirrorKey(userId)));
}

/** Reads the legacy Phase 1-3 unscoped active timer mirror if present. */
export function readLegacyActiveTimerMirror(): ActiveTimerMirrorPayload | null {
  return parseTimerMirrorRaw(safeLocalStorageGet(ACTIVE_TIMER_MIRROR_KEY));
}

/** Clears the synchronous `localStorage` active timer mirror for a user. */
export function clearActiveTimerMirror(
  userId: string = DEFAULT_LOCAL_USER_ID,
): void {
  safeLocalStorageRemove(getActiveTimerMirrorKey(userId));
}

export function clearLegacyActiveTimerMirror(): void {
  safeLocalStorageRemove(ACTIVE_TIMER_MIRROR_KEY);
}

/**
 * Synchronous safety mirror for full user state flushed on `pagehide` / `visibilitychange`
 * so closing a webpage never loses changes even if async IndexedDB writes haven't settled.
 */
export function saveStateSnapshotMirror(userId: string, serializedEnvelope: string): void {
  safeLocalStorageSet(getStateSnapshotMirrorKey(userId), serializedEnvelope);
}

export function readStateSnapshotMirror(userId: string): string | null {
  return safeLocalStorageGet(getStateSnapshotMirrorKey(userId));
}

export function clearStateSnapshotMirror(userId: string): void {
  safeLocalStorageRemove(getStateSnapshotMirrorKey(userId));
}
