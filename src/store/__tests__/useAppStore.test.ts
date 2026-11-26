import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_REGISTRY_IDB_KEY,
  ACCOUNT_REGISTRY_MIRROR_KEY,
  loadAccountRegistry,
  migrateLegacySingleUserStateIfNeeded,
  readAccountRegistrySync,
} from '../accountManager';
import {
  ACTIVE_TIMER_MIRROR_KEY,
  DEFAULT_LOCAL_USER_ID,
  STORE_STORAGE_KEY,
  getActiveTimerMirrorKey,
  getUserStoreStorageKey,
  idbStorage,
  readActiveTimerMirror,
  readStateSnapshotMirror,
} from '../idbStorage';
import {
  DEFAULT_DAILY_STUDY_GOAL_MINUTES,
  MAX_DAILY_STUDY_GOAL_MINUTES,
  MIN_DAILY_STUDY_GOAL_MINUTES,
  flushCurrentUserSnapshotSync,
  hydrateStoreForUser,
  useAppStore,
} from '../useAppStore';
import {
  createLocalProfileAndSwitch,
  switchToUserProfile,
  syncEngine,
} from '../../sync/syncEngine';

describe('useAppStore, multi-user isolation & offline persistence', () => {
  beforeEach(() => {
    syncEngine.resetInternalStateForTests();
    localStorage.clear();
    useAppStore.getState().resetAllData();
  });

  it('clamps daily study goal minutes between 15m and 1440m', () => {
    const store = useAppStore.getState();
    expect(store.dailyStudyGoalMinutes).toBe(DEFAULT_DAILY_STUDY_GOAL_MINUTES);

    store.setDailyStudyGoalMinutes(5);
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(
      MIN_DAILY_STUDY_GOAL_MINUTES,
    );

    store.setDailyStudyGoalMinutes(5000);
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(
      MAX_DAILY_STUDY_GOAL_MINUTES,
    );

    store.setDailyStudyGoalMinutes(180);
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(180);
  });

  it('splits logged study sessions crossing 5:00 AM cleanly in store state', () => {
    const start = new Date(2026, 10, 26, 4, 30, 0).getTime();
    const end = new Date(2026, 10, 26, 5, 20, 0).getTime();

    const segments = useAppStore
      .getState()
      .logStudySession('subj-1', start, end);

    expect(segments).toHaveLength(2);
    expect(useAppStore.getState().sessions).toHaveLength(2);
    expect(useAppStore.getState().sessions.map((s) => s.logicalDate)).toEqual([
      '2026-11-25',
      '2026-11-26',
    ]);
    expect(
      useAppStore.getState().sessions.map((s) => s.durationSeconds),
    ).toEqual([1800, 1200]);
  });

  it('synchronously mirrors user-scoped active timer state to localStorage alongside store updates', () => {
    const startedAt = new Date(2026, 10, 26, 9, 0, 0).getTime();

    useAppStore.getState().setActiveTimer(
      {
        subjectId: 'math',
        mode: 'stopwatch',
        status: 'running',
        segmentStartTime: startedAt,
        accumulatedMs: 0,
        sessionStartTime: startedAt,
      },
      startedAt,
    );

    const mirror = readActiveTimerMirror(DEFAULT_LOCAL_USER_ID);
    expect(mirror).not.toBeNull();
    expect(mirror?.timer.status).toBe('running');
    expect(mirror?.timer.subjectId).toBe('math');
    expect(
      localStorage.getItem(getActiveTimerMirrorKey(DEFAULT_LOCAL_USER_ID)),
    ).toContain('running');

    useAppStore.getState().resetAllData();
    expect(readActiveTimerMirror(DEFAULT_LOCAL_USER_ID)).toBeNull();
  });

  it('persists and reads state safely via idbStorage adapter', async () => {
    await idbStorage.setItem('test-key', JSON.stringify({ ok: true }));
    expect(await idbStorage.getItem('test-key')).toBe('{"ok":true}');

    await idbStorage.removeItem('test-key');
    expect(await idbStorage.getItem('test-key')).toBeNull();
  });

  it('falls back to localStorage cleanly when idb-keyval throws in restricted mode', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {} as IDBFactory,
    });

    const spyWarn = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await idbStorage.setItem('fallback-key', '{"saved":1}');
      expect(await idbStorage.getItem('fallback-key')).toBe('{"saved":1}');
      await idbStorage.removeItem('fallback-key');
    } finally {
      spyWarn.mockRestore();
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it('supports subject CRUD, sound preference, and deleting logged sessions with tombstones', () => {
    const store = useAppStore.getState();
    const subj = store.addSubject({
      name: 'Physics',
      color: '#f43f5e',
      dailyGoalMinutes: 90,
    });

    expect(useAppStore.getState().subjects).toHaveLength(1);
    store.updateSubject(subj.id, {
      name: 'Quantum Physics',
      dailyGoalMinutes: 120,
    });
    expect(useAppStore.getState().subjects[0].name).toBe('Quantum Physics');
    expect(useAppStore.getState().subjects[0].dailyGoalMinutes).toBe(120);

    store.toggleArchiveSubject(subj.id);
    expect(useAppStore.getState().subjects[0].archived).toBe(true);

    const end = new Date(2026, 10, 26, 12, 0, 0).getTime();
    const created = store.logStudySession(subj.id, end - 1800_000, end);
    expect(useAppStore.getState().sessions).toHaveLength(1);

    store.deleteStudySession(created[0].id);
    expect(useAppStore.getState().sessions).toHaveLength(0);
    expect(
      useAppStore.getState().tombstones[`session:${created[0].id}`],
    ).toBeDefined();

    store.deleteSubject(subj.id);
    expect(useAppStore.getState().subjects).toHaveLength(0);
    expect(
      useAppStore.getState().tombstones[`subject:${subj.id}`],
    ).toBeDefined();

    store.setSoundEnabled(false);
    expect(useAppStore.getState().soundEnabled).toBe(false);
  });

  it('strictly isolates subjects, sessions, tasks, habits, D-Day, settings, and active timers per user', async () => {
    // User 1 populates full data
    const user1Subject = useAppStore.getState().addSubject({
      name: 'User 1 Biology',
      color: '#10b981',
      dailyGoalMinutes: 60,
    });
    const end = new Date(2026, 10, 26, 15, 0, 0).getTime();
    useAppStore
      .getState()
      .logStudySession(user1Subject.id, end - 3600_000, end);
    useAppStore.getState().setDailyStudyGoalMinutes(240);
    useAppStore.getState().setDDayGoal({
      id: 'dday-1',
      title: 'MCAT',
      targetDate: '2026-12-20',
      targetStudyHours: 120,
    });
    useAppStore.getState().setActiveTimer(
      {
        subjectId: user1Subject.id,
        mode: 'stopwatch',
        status: 'running',
        segmentStartTime: end,
        accumulatedMs: 0,
        sessionStartTime: end,
      },
      end,
    );

    // Create and switch to User 2
    const profileB = await createLocalProfileAndSwitch('User Two');
    expect(useAppStore.getState().activeUserId).toBe(profileB.id);
    expect(useAppStore.getState().subjects).toEqual([]);
    expect(useAppStore.getState().sessions).toEqual([]);
    expect(useAppStore.getState().dDayGoal).toBeNull();
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(
      DEFAULT_DAILY_STUDY_GOAL_MINUTES,
    );
    expect(useAppStore.getState().activeTimer.status).toBe('idle');

    // Add distinct data for User 2
    useAppStore.getState().addSubject({
      name: 'User 2 Algorithms',
      color: '#0ea5e9',
      dailyGoalMinutes: 90,
    });
    useAppStore.getState().setDailyStudyGoalMinutes(180);

    // Switch back to User 1 -> User 1's data & running timer are completely intact and User 2's subject did not leak
    await switchToUserProfile(DEFAULT_LOCAL_USER_ID);
    expect(useAppStore.getState().activeUserId).toBe(DEFAULT_LOCAL_USER_ID);
    expect(useAppStore.getState().subjects.map((s) => s.name)).toEqual([
      'User 1 Biology',
    ]);
    expect(useAppStore.getState().sessions).toHaveLength(1);
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(240);
    expect(useAppStore.getState().dDayGoal?.title).toBe('MCAT');
    expect(useAppStore.getState().activeTimer.status).toBe('running');

    // Switch back to User 2 -> User 2's data is intact and isolated
    await switchToUserProfile(profileB.id);
    expect(useAppStore.getState().subjects.map((s) => s.name)).toEqual([
      'User 2 Algorithms',
    ]);
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(180);
    expect(readAccountRegistrySync().activeUserId).toBe(profileB.id);
  });

  it('flushes state synchronously via pagehide mirror and restores active user on reload', async () => {
    const profileB = await createLocalProfileAndSwitch('Reload User');
    useAppStore.getState().addSubject({
      name: 'Organic Chemistry',
      color: '#f59e0b',
      dailyGoalMinutes: 45,
    });

    // Simulate pagehide flush (writes synchronous localStorage snapshot)
    flushCurrentUserSnapshotSync();
    expect(readStateSnapshotMirror(profileB.id)).toContain('Organic Chemistry');

    // Clear in-memory Zustand state (simulating fresh page load) while keeping persisted storage
    useAppStore.setState({
      activeUserId: DEFAULT_LOCAL_USER_ID,
      subjects: [],
      sessions: [],
    });

    const registry = await loadAccountRegistry();
    expect(registry.activeUserId).toBe(profileB.id);
    await hydrateStoreForUser(registry.activeUserId);

    expect(useAppStore.getState().activeUserId).toBe(profileB.id);
    expect(useAppStore.getState().subjects.map((s) => s.name)).toEqual([
      'Organic Chemistry',
    ]);
  });

  it('migrates legacy Phase 1-3 unscoped data once into the default user namespace', async () => {
    await idbStorage.removeItem(ACCOUNT_REGISTRY_IDB_KEY);
    localStorage.removeItem(ACCOUNT_REGISTRY_MIRROR_KEY);
    await idbStorage.removeItem(getUserStoreStorageKey(DEFAULT_LOCAL_USER_ID));

    const legacyPayload = {
      state: {
        dailyStudyGoalMinutes: 150,
        soundEnabled: false,
        subjects: [
          {
            id: 'legacy-subj',
            name: 'Legacy Math',
            color: '#6366f1',
            dailyGoalMinutes: 60,
            archived: false,
            createdAt: 1700000000000,
          },
        ],
        sessions: [],
        tasks: [],
        multiDayPlans: [],
        habits: [],
        dDayGoal: null,
        activeTimer: {
          subjectId: 'legacy-subj',
          mode: 'stopwatch',
          status: 'idle',
          segmentStartTime: null,
          accumulatedMs: 0,
          sessionStartTime: null,
        },
        activeTimerUpdatedAt: 0,
      },
      version: 1,
    };

    await idbStorage.setItem(STORE_STORAGE_KEY, JSON.stringify(legacyPayload));
    localStorage.setItem(
      ACTIVE_TIMER_MIRROR_KEY,
      JSON.stringify({
        timer: {
          subjectId: 'legacy-subj',
          mode: 'stopwatch',
          status: 'paused',
          segmentStartTime: null,
          accumulatedMs: 90000,
          sessionStartTime: 1700000000000,
        },
        updatedAt: 1700000090000,
      }),
    );

    const migratedRegistry = await migrateLegacySingleUserStateIfNeeded();
    expect(migratedRegistry.legacyMigrated).toBe(true);
    expect(migratedRegistry.activeUserId).toBe(DEFAULT_LOCAL_USER_ID);

    await hydrateStoreForUser(DEFAULT_LOCAL_USER_ID);
    expect(useAppStore.getState().dailyStudyGoalMinutes).toBe(150);
    expect(useAppStore.getState().soundEnabled).toBe(false);
    expect(useAppStore.getState().subjects[0].name).toBe('Legacy Math');
    expect(useAppStore.getState().subjects[0].updatedAt).toBe(1700000000000);
    expect(useAppStore.getState().activeTimer.status).toBe('paused');
    expect(await idbStorage.getItem(STORE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_TIMER_MIRROR_KEY)).toBeNull();
  });
});
