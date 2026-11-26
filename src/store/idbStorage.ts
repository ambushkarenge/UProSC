import { del, get, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';
import type { ActiveTimerState } from '../types/domain';

export const ACTIVE_TIMER_MIRROR_KEY = 'uprosc:active-timer-mirror';

const memoryFallbackStore = new Map<string, string>();

function canUseIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function safeLocalStorageGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
  return memoryFallbackStore.get(key) ?? null;
}

function safeLocalStorageSet(key: string, value: string): void {
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

function safeLocalStorageRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
  memoryFallbackStore.delete(key);
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
 * Synchronously mirrors the active timer state to `localStorage` so sudden
 * tab closes or iOS PWA terminations never lose an active running session.
 */
export function saveActiveTimerMirror(
  timer: ActiveTimerState,
  updatedAt = Date.now(),
): void {
  const payload: ActiveTimerMirrorPayload = { timer, updatedAt };
  safeLocalStorageSet(ACTIVE_TIMER_MIRROR_KEY, JSON.stringify(payload));
}

/** Reads the synchronous `localStorage` mirror of the active timer if valid. */
export function readActiveTimerMirror(): ActiveTimerMirrorPayload | null {
  const raw = safeLocalStorageGet(ACTIVE_TIMER_MIRROR_KEY);
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

/** Clears the synchronous `localStorage` active timer mirror. */
export function clearActiveTimerMirror(): void {
  safeLocalStorageRemove(ACTIVE_TIMER_MIRROR_KEY);
}
