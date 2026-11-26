import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  applyRemoteEnvelopesToCollections,
  collectAllDirtyRefs,
  makeEntityKey,
} from '../sync/merge';
import type { MergeableAppCollections, SyncEntityEnvelope } from '../sync/types';
import type {
  ActiveTimerState,
  DDayGoal,
  DirtyEntityRef,
  Habit,
  LogicalDate,
  StudySession,
  Subject,
  SyncEntityType,
  SyncTombstone,
  TodoTask,
} from '../types/domain';
import { splitSessionByLogicalDay } from '../utils/date';
import { getActiveUserIdSync, setActiveProfileId } from './accountManager';
import {
  DEFAULT_LOCAL_USER_ID,
  clearActiveTimerMirror,
  clearStateSnapshotMirror,
  getUserStoreStorageKey,
  idbStorage,
  readActiveTimerMirror,
  readStateSnapshotMirror,
  saveActiveTimerMirror,
  saveStateSnapshotMirror,
} from './idbStorage';

export const DEFAULT_DAILY_STUDY_GOAL_MINUTES = 120;
export const MIN_DAILY_STUDY_GOAL_MINUTES = 15;
export const MAX_DAILY_STUDY_GOAL_MINUTES = 1440;
export const DEFAULT_COUNTDOWN_DURATION_MS = 25 * 60 * 1000;
const STORE_PERSIST_VERSION = 2;

export const DEFAULT_ACTIVE_TIMER: ActiveTimerState = {
  subjectId: null,
  mode: 'stopwatch',
  status: 'idle',
  segmentStartTime: null,
  accumulatedMs: 0,
  targetDurationMs: DEFAULT_COUNTDOWN_DURATION_MS,
  sessionStartTime: null,
  completedSegments: [],
};

function createId(prefix: string): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function clampDailyGoalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) {
    return DEFAULT_DAILY_STUDY_GOAL_MINUTES;
  }
  return Math.min(
    MAX_DAILY_STUDY_GOAL_MINUTES,
    Math.max(MIN_DAILY_STUDY_GOAL_MINUTES, Math.round(minutes)),
  );
}

export interface PersistedAppData extends MergeableAppCollections {
  activeUserId: string;
  stateUpdatedAt: number;
}

export interface AppStoreState extends PersistedAppData {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  setDailyStudyGoalMinutes: (minutes: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  addSubject: (input: {
    name: string;
    color: string;
    dailyGoalMinutes?: number;
  }) => Subject;
  updateSubject: (
    id: string,
    patch: Partial<Pick<Subject, 'name' | 'color' | 'dailyGoalMinutes'>>,
  ) => void;
  toggleArchiveSubject: (id: string) => void;
  deleteSubject: (id: string) => void;
  logStudySession: (
    subjectId: string,
    startTime: number,
    endTime: number,
  ) => StudySession[];
  deleteStudySession: (sessionId: string) => void;
  addTask: (
    input: Omit<TodoTask, 'id' | 'completed'> & { completed?: boolean },
  ) => TodoTask;
  toggleTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  addHabit: (input: { name: string; icon: string; color: string }) => Habit;
  toggleHabitDate: (habitId: string, logicalDate: LogicalDate) => void;
  toggleArchiveHabit: (habitId: string) => void;
  setActiveTimer: (
    next:
      | ActiveTimerState
      | ((previous: ActiveTimerState) => ActiveTimerState),
    updatedAt?: number,
  ) => void;
  setDDayGoal: (goal: DDayGoal | null) => void;
  resetAllData: () => void;
}

function createInitialPersistedData(
  userId: string = getActiveUserIdSync(),
  skipMirror = false,
): PersistedAppData {
  const mirror = skipMirror ? null : readActiveTimerMirror(userId);
  return {
    activeUserId: userId,
    dailyStudyGoalMinutes: DEFAULT_DAILY_STUDY_GOAL_MINUTES,
    soundEnabled: true,
    settingsUpdatedAt: 0,
    subjects: [],
    sessions: [],
    tasks: [],
    multiDayPlans: [],
    habits: [],
    dDayGoal: null,
    dDayUpdatedAt: 0,
    activeTimer: mirror ? mirror.timer : { ...DEFAULT_ACTIVE_TIMER },
    activeTimerUpdatedAt: mirror ? mirror.updatedAt : 0,
    stateUpdatedAt: mirror ? mirror.updatedAt : 0,
    tombstones: {},
    dirtyEntities: {},
  };
}

export function extractPersistedAppData(state: PersistedAppData): PersistedAppData {
  return {
    activeUserId: state.activeUserId,
    dailyStudyGoalMinutes: state.dailyStudyGoalMinutes,
    soundEnabled: state.soundEnabled,
    settingsUpdatedAt: state.settingsUpdatedAt,
    subjects: state.subjects,
    sessions: state.sessions,
    tasks: state.tasks,
    multiDayPlans: state.multiDayPlans,
    habits: state.habits,
    dDayGoal: state.dDayGoal,
    dDayUpdatedAt: state.dDayUpdatedAt,
    activeTimer: state.activeTimer,
    activeTimerUpdatedAt: state.activeTimerUpdatedAt,
    stateUpdatedAt: state.stateUpdatedAt,
    tombstones: state.tombstones,
    dirtyEntities: state.dirtyEntities,
  };
}

function parseEnvelopeState(raw: string | null): PersistedAppData | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: Partial<PersistedAppData> };
    const s = parsed?.state;
    if (!s || typeof s !== 'object') return null;
    const base = createInitialPersistedData(
      typeof s.activeUserId === 'string' && s.activeUserId.length > 0
        ? s.activeUserId
        : DEFAULT_LOCAL_USER_ID,
      true,
    );
    return {
      ...base,
      ...s,
      subjects: Array.isArray(s.subjects) ? s.subjects : [],
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      tasks: Array.isArray(s.tasks) ? s.tasks : [],
      multiDayPlans: Array.isArray(s.multiDayPlans) ? s.multiDayPlans : [],
      habits: Array.isArray(s.habits) ? s.habits : [],
      tombstones:
        s.tombstones && typeof s.tombstones === 'object' ? s.tombstones : {},
      dirtyEntities:
        s.dirtyEntities && typeof s.dirtyEntities === 'object'
          ? s.dirtyEntities
          : {},
    };
  } catch {
    return null;
  }
}

function pickNewestSerializedEnvelope(
  idbRaw: string | null,
  mirrorRaw: string | null,
): string | null {
  if (!idbRaw) return mirrorRaw;
  if (!mirrorRaw) return idbRaw;

  const idbParsed = parseEnvelopeState(idbRaw);
  const mirrorParsed = parseEnvelopeState(mirrorRaw);
  if (!idbParsed) return mirrorRaw;
  if (!mirrorParsed) return idbRaw;

  return mirrorParsed.stateUpdatedAt > idbParsed.stateUpdatedAt
    ? mirrorRaw
    : idbRaw;
}

const userScopedStateStorage: StateStorage = {
  getItem: async (_name: string): Promise<string | null> => {
    const userId = getActiveUserIdSync();
    const idbRaw = await idbStorage.getItem(getUserStoreStorageKey(userId));
    const mirrorRaw = readStateSnapshotMirror(userId);
    return pickNewestSerializedEnvelope(idbRaw, mirrorRaw);
  },

  setItem: async (_name: string, value: string): Promise<void> => {
    const parsed = parseEnvelopeState(value);
    const targetUserId = parsed?.activeUserId || getActiveUserIdSync();
    await idbStorage.setItem(getUserStoreStorageKey(targetUserId), value);
  },

  removeItem: async (_name: string): Promise<void> => {
    const userId = getActiveUserIdSync();
    await idbStorage.removeItem(getUserStoreStorageKey(userId));
    clearStateSnapshotMirror(userId);
  },
};

function withDirtyMark(
  dirtyEntities: Record<string, DirtyEntityRef>,
  entityType: SyncEntityType,
  entityId: string,
  updatedAt: number,
): Record<string, DirtyEntityRef> {
  const key = makeEntityKey(entityType, entityId);
  return {
    ...dirtyEntities,
    [key]: { entityType, entityId, updatedAt },
  };
}

function withoutTombstone(
  tombstones: Record<string, SyncTombstone>,
  entityType: SyncEntityType,
  entityId: string,
): Record<string, SyncTombstone> {
  const key = makeEntityKey(entityType, entityId);
  if (!(key in tombstones)) return tombstones;
  const next = { ...tombstones };
  delete next[key];
  return next;
}

function withTombstone(
  tombstones: Record<string, SyncTombstone>,
  entityType: SyncEntityType,
  entityId: string,
  deletedAt: number,
): Record<string, SyncTombstone> {
  const key = makeEntityKey(entityType, entityId);
  return {
    ...tombstones,
    [key]: { entityType, entityId, deletedAt },
  };
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialPersistedData(),
      hasHydrated: false,

      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      setDailyStudyGoalMinutes: (minutes) => {
        const now = Date.now();
        set((state) => ({
          dailyStudyGoalMinutes: clampDailyGoalMinutes(minutes),
          settingsUpdatedAt: now,
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'settings',
            'settings',
            now,
          ),
        }));
      },

      setSoundEnabled: (enabled) => {
        const now = Date.now();
        set((state) => ({
          soundEnabled: enabled,
          settingsUpdatedAt: now,
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'settings',
            'settings',
            now,
          ),
        }));
      },

      addSubject: ({ name, color, dailyGoalMinutes = 60 }) => {
        const now = Date.now();
        const created: Subject = {
          id: createId('subj'),
          name: name.trim(),
          color,
          dailyGoalMinutes: Math.max(5, Math.round(dailyGoalMinutes)),
          archived: false,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          subjects: [...state.subjects, created],
          stateUpdatedAt: now,
          tombstones: withoutTombstone(state.tombstones, 'subject', created.id),
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'subject',
            created.id,
            now,
          ),
        }));
        return created;
      },

      updateSubject: (id, patch) => {
        const now = Date.now();
        set((state) => ({
          subjects: state.subjects.map((subject) =>
            subject.id === id
              ? {
                  ...subject,
                  ...patch,
                  name:
                    patch.name !== undefined ? patch.name.trim() : subject.name,
                  dailyGoalMinutes:
                    patch.dailyGoalMinutes !== undefined
                      ? Math.max(5, Math.round(patch.dailyGoalMinutes))
                      : subject.dailyGoalMinutes,
                  updatedAt: now,
                }
              : subject,
          ),
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(state.dirtyEntities, 'subject', id, now),
        }));
      },

      toggleArchiveSubject: (id) => {
        const now = Date.now();
        set((state) => ({
          subjects: state.subjects.map((subject) =>
            subject.id === id
              ? { ...subject, archived: !subject.archived, updatedAt: now }
              : subject,
          ),
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(state.dirtyEntities, 'subject', id, now),
        }));
      },

      deleteSubject: (id) => {
        const now = Date.now();
        set((state) => {
          const shouldClearActive =
            state.activeTimer.status === 'idle' &&
            state.activeTimer.subjectId === id;
          const nextTimer = shouldClearActive
            ? { ...state.activeTimer, subjectId: null }
            : state.activeTimer;
          if (shouldClearActive) {
            saveActiveTimerMirror(nextTimer, now, state.activeUserId);
          }

          let nextDirty = withDirtyMark(state.dirtyEntities, 'subject', id, now);
          if (shouldClearActive) {
            nextDirty = withDirtyMark(nextDirty, 'activeTimer', 'activeTimer', now);
          }

          return {
            subjects: state.subjects.filter((subject) => subject.id !== id),
            activeTimer: nextTimer,
            activeTimerUpdatedAt: shouldClearActive
              ? now
              : state.activeTimerUpdatedAt,
            stateUpdatedAt: now,
            tombstones: withTombstone(state.tombstones, 'subject', id, now),
            dirtyEntities: nextDirty,
          };
        });
      },

      logStudySession: (subjectId, startTime, endTime) => {
        const now = Date.now();
        const rawSegments = splitSessionByLogicalDay({
          subjectId,
          startTime,
          endTime,
        });
        const segments: StudySession[] = rawSegments.map((seg) => ({
          ...seg,
          updatedAt: now,
        }));
        if (segments.length > 0) {
          set((state) => {
            let nextDirty = state.dirtyEntities;
            let nextTombstones = state.tombstones;
            for (const seg of segments) {
              nextDirty = withDirtyMark(nextDirty, 'session', seg.id, now);
              nextTombstones = withoutTombstone(
                nextTombstones,
                'session',
                seg.id,
              );
            }
            return {
              sessions: [...state.sessions, ...segments],
              stateUpdatedAt: now,
              tombstones: nextTombstones,
              dirtyEntities: nextDirty,
            };
          });
        }
        return segments;
      },

      deleteStudySession: (sessionId) => {
        const now = Date.now();
        set((state) => ({
          sessions: state.sessions.filter((session) => session.id !== sessionId),
          stateUpdatedAt: now,
          tombstones: withTombstone(state.tombstones, 'session', sessionId, now),
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'session',
            sessionId,
            now,
          ),
        }));
      },

      addTask: (input) => {
        const now = Date.now();
        const created: TodoTask = {
          ...input,
          id: createId('task'),
          completed: input.completed ?? false,
          updatedAt: now,
        };
        set((state) => ({
          tasks: [...state.tasks, created],
          stateUpdatedAt: now,
          tombstones: withoutTombstone(state.tombstones, 'task', created.id),
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'task',
            created.id,
            now,
          ),
        }));
        return created;
      },

      toggleTask: (taskId) => {
        const now = Date.now();
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId
              ? { ...task, completed: !task.completed, updatedAt: now }
              : task,
          ),
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(state.dirtyEntities, 'task', taskId, now),
        }));
      },

      deleteTask: (taskId) => {
        const now = Date.now();
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== taskId),
          stateUpdatedAt: now,
          tombstones: withTombstone(state.tombstones, 'task', taskId, now),
          dirtyEntities: withDirtyMark(state.dirtyEntities, 'task', taskId, now),
        }));
      },

      addHabit: ({ name, icon, color }) => {
        const now = Date.now();
        const created: Habit = {
          id: createId('habit'),
          name: name.trim(),
          icon,
          color,
          archived: false,
          createdAt: now,
          updatedAt: now,
          completedDates: {},
          completedDateUpdatedAt: {},
        };
        set((state) => ({
          habits: [...state.habits, created],
          stateUpdatedAt: now,
          tombstones: withoutTombstone(state.tombstones, 'habit', created.id),
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'habit',
            created.id,
            now,
          ),
        }));
        return created;
      },

      toggleHabitDate: (habitId, logicalDate) => {
        const now = Date.now();
        set((state) => ({
          habits: state.habits.map((habit) => {
            if (habit.id !== habitId) return habit;
            const nextCompletedDates = { ...habit.completedDates };
            const nextDateUpdatedAt = { ...(habit.completedDateUpdatedAt ?? {}) };
            if (nextCompletedDates[logicalDate]) {
              delete nextCompletedDates[logicalDate];
            } else {
              nextCompletedDates[logicalDate] = true;
            }
            nextDateUpdatedAt[logicalDate] = now;
            return {
              ...habit,
              updatedAt: now,
              completedDates: nextCompletedDates,
              completedDateUpdatedAt: nextDateUpdatedAt,
            };
          }),
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'habit',
            habitId,
            now,
          ),
        }));
      },

      toggleArchiveHabit: (habitId) => {
        const now = Date.now();
        set((state) => ({
          habits: state.habits.map((habit) =>
            habit.id === habitId
              ? { ...habit, archived: !habit.archived, updatedAt: now }
              : habit,
          ),
          stateUpdatedAt: now,
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'habit',
            habitId,
            now,
          ),
        }));
      },

      setActiveTimer: (next, updatedAt = Date.now()) => {
        const prev = get();
        const nextTimer =
          typeof next === 'function' ? next(prev.activeTimer) : next;
        saveActiveTimerMirror(nextTimer, updatedAt, prev.activeUserId);
        set((state) => ({
          activeTimer: nextTimer,
          activeTimerUpdatedAt: updatedAt,
          stateUpdatedAt: Math.max(state.stateUpdatedAt, updatedAt),
          dirtyEntities: withDirtyMark(
            state.dirtyEntities,
            'activeTimer',
            'activeTimer',
            updatedAt,
          ),
        }));
      },

      setDDayGoal: (goal) => {
        const now = Date.now();
        set((state) => {
          if (goal === null) {
            return {
              dDayGoal: null,
              dDayUpdatedAt: now,
              stateUpdatedAt: now,
              tombstones: state.dDayGoal
                ? withTombstone(state.tombstones, 'dday', 'dday', now)
                : state.tombstones,
              dirtyEntities: state.dDayGoal
                ? withDirtyMark(state.dirtyEntities, 'dday', 'dday', now)
                : state.dirtyEntities,
            };
          }

          const stamped: DDayGoal = {
            ...goal,
            updatedAt: now,
          };
          return {
            dDayGoal: stamped,
            dDayUpdatedAt: now,
            stateUpdatedAt: now,
            tombstones: withoutTombstone(state.tombstones, 'dday', 'dday'),
            dirtyEntities: withDirtyMark(
              state.dirtyEntities,
              'dday',
              'dday',
              now,
            ),
          };
        });
      },

      resetAllData: () => {
        const targetUserId = getActiveUserIdSync();
        clearActiveTimerMirror(targetUserId);
        clearStateSnapshotMirror(targetUserId);
        void idbStorage.removeItem(getUserStoreStorageKey(targetUserId));
        set({
          ...createInitialPersistedData(targetUserId, true),
        });
      },
    }),
    {
      name: 'uprosc-app-state',
      version: STORE_PERSIST_VERSION,
      storage: createJSONStorage(() => userScopedStateStorage),
      partialize: (state): PersistedAppData => extractPersistedAppData(state),
      onRehydrateStorage: () => (rehydratedState) => {
        if (!rehydratedState) return;
        const userId = rehydratedState.activeUserId || getActiveUserIdSync();
        const mirror = readActiveTimerMirror(userId);
        if (
          mirror &&
          mirror.updatedAt > rehydratedState.activeTimerUpdatedAt
        ) {
          rehydratedState.setActiveTimer(mirror.timer, mirror.updatedAt);
        }
        rehydratedState.setHasHydrated(true);
      },
    },
  ),
);

function serializePersistedEnvelope(data: PersistedAppData): string {
  return JSON.stringify({
    state: extractPersistedAppData(data),
    version: STORE_PERSIST_VERSION,
  });
}

/**
 * Synchronously snapshots both active timer and full user state into `localStorage`
 * so `pagehide` / mobile Safari tab kills never lose data.
 */
export function flushCurrentUserSnapshotSync(): void {
  const state = useAppStore.getState();
  const userId = state.activeUserId || getActiveUserIdSync();
  const persisted = extractPersistedAppData({
    ...state,
    activeUserId: userId,
  });
  saveActiveTimerMirror(
    persisted.activeTimer,
    persisted.activeTimerUpdatedAt,
    userId,
  );
  saveStateSnapshotMirror(userId, serializePersistedEnvelope(persisted));
}

/**
 * Flushes the active user's state to both the synchronous `localStorage` safety
 * mirror and IndexedDB.
 */
export async function flushCurrentUserToStorage(): Promise<void> {
  flushCurrentUserSnapshotSync();
  const state = useAppStore.getState();
  const userId = state.activeUserId || getActiveUserIdSync();
  const envelope = serializePersistedEnvelope({
    ...extractPersistedAppData(state),
    activeUserId: userId,
  });
  await idbStorage.setItem(getUserStoreStorageKey(userId), envelope);
}

/**
 * Loads isolated persisted state for `userId` from IndexedDB + synchronous mirrors.
 */
export async function loadPersistedDataForUser(
  userId: string,
): Promise<PersistedAppData> {
  const idbRaw = await idbStorage.getItem(getUserStoreStorageKey(userId));
  const mirrorRaw = readStateSnapshotMirror(userId);
  const newestRaw = pickNewestSerializedEnvelope(idbRaw, mirrorRaw);
  const parsed = parseEnvelopeState(newestRaw);

  const base = parsed
    ? { ...parsed, activeUserId: userId }
    : createInitialPersistedData(userId, true);

  const timerMirror = readActiveTimerMirror(userId);
  if (timerMirror && timerMirror.updatedAt > base.activeTimerUpdatedAt) {
    base.activeTimer = timerMirror.timer;
    base.activeTimerUpdatedAt = timerMirror.updatedAt;
    base.stateUpdatedAt = Math.max(base.stateUpdatedAt, timerMirror.updatedAt);
  }

  return base;
}

/**
 * Hydrates Zustand synchronously for `userId` without bleeding state from any other user.
 */
export async function hydrateStoreForUser(userId: string): Promise<void> {
  const data = await loadPersistedDataForUser(userId);
  useAppStore.setState({
    ...data,
    hasHydrated: true,
  });
}

/**
 * Safely switches the active user profile: flushes outgoing user data first,
 * activates `nextUserId`, and loads `nextUserId`'s isolated IndexedDB workspace.
 */
export async function switchActiveUserStore(nextUserId: string): Promise<void> {
  const currentUserId = useAppStore.getState().activeUserId;
  if (currentUserId && currentUserId !== nextUserId) {
    await flushCurrentUserToStorage();
  }
  await setActiveProfileId(nextUserId);
  await hydrateStoreForUser(nextUserId);
}

/**
 * Explicitly copies the current local profile's data into a newly registered cloud
 * user profile (only called when the user explicitly opts in) and marks all items dirty.
 */
export async function copyCurrentUserDataToCloudProfile(
  targetUserId: string,
): Promise<void> {
  const source = extractPersistedAppData(useAppStore.getState());
  const now = Date.now();
  const cloned: PersistedAppData = {
    ...source,
    activeUserId: targetUserId,
    stateUpdatedAt: now,
    dirtyEntities: collectAllDirtyRefs(source, now),
  };
  const serialized = serializePersistedEnvelope(cloned);
  saveActiveTimerMirror(cloned.activeTimer, cloned.activeTimerUpdatedAt, targetUserId);
  saveStateSnapshotMirror(targetUserId, serialized);
  await idbStorage.setItem(getUserStoreStorageKey(targetUserId), serialized);
  await setActiveProfileId(targetUserId);
  useAppStore.setState({
    ...cloned,
    hasHydrated: true,
  });
}

/**
 * Applies remote synced envelopes and clears only dirty entries whose `updatedAt`
 * is <= the snapshot pushed in this sync cycle.
 */
export async function applySyncedResultForUser(
  userId: string,
  remoteEntities: readonly SyncEntityEnvelope[],
  pushedWatermark: Record<string, number>,
): Promise<void> {
  const clearSettledDirty = (
    dirtyEntities: Record<string, DirtyEntityRef>,
  ): Record<string, DirtyEntityRef> => {
    const nextDirty: Record<string, DirtyEntityRef> = {};
    for (const [key, ref] of Object.entries(dirtyEntities)) {
      const pushedAt = pushedWatermark[key];
      if (pushedAt === undefined || ref.updatedAt > pushedAt) {
        nextDirty[key] = ref;
      }
    }
    return nextDirty;
  };

  if (useAppStore.getState().activeUserId === userId) {
    useAppStore.setState((state) => {
      const current = extractPersistedAppData(state);
      const merged = applyRemoteEnvelopesToCollections(current, remoteEntities);
      const nextDirty = clearSettledDirty(merged.dirtyEntities);
      const nextTimer = merged.activeTimer;
      const nextTimerUpdatedAt = merged.activeTimerUpdatedAt;
      if (nextTimerUpdatedAt > state.activeTimerUpdatedAt) {
        saveActiveTimerMirror(nextTimer, nextTimerUpdatedAt, userId);
      }

      return {
        ...merged,
        dirtyEntities: nextDirty,
        stateUpdatedAt: Date.now(),
      };
    });
    await flushCurrentUserToStorage();
    return;
  }

  // If user switched profiles while sync was in-flight, persist strictly under target userId
  const stored = await loadPersistedDataForUser(userId);
  const merged = applyRemoteEnvelopesToCollections(stored, remoteEntities);
  const nextData: PersistedAppData = {
    ...stored,
    ...merged,
    activeUserId: userId,
    dirtyEntities: clearSettledDirty(merged.dirtyEntities),
    stateUpdatedAt: Date.now(),
  };
  const serialized = serializePersistedEnvelope(nextData);
  saveStateSnapshotMirror(userId, serialized);
  await idbStorage.setItem(getUserStoreStorageKey(userId), serialized);
}
