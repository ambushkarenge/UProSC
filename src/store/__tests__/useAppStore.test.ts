import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_TIMER_MIRROR_KEY,
  idbStorage,
  readActiveTimerMirror,
} from '../idbStorage';
import {
  DEFAULT_DAILY_STUDY_GOAL_MINUTES,
  MAX_DAILY_STUDY_GOAL_MINUTES,
  MIN_DAILY_STUDY_GOAL_MINUTES,
  useAppStore,
} from '../useAppStore';

describe('useAppStore & offline persistence', () => {
  beforeEach(() => {
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

  it('synchronously mirrors active timer state to localStorage alongside store updates', () => {
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

    const mirror = readActiveTimerMirror();
    expect(mirror).not.toBeNull();
    expect(mirror?.timer.status).toBe('running');
    expect(mirror?.timer.subjectId).toBe('math');
    expect(localStorage.getItem(ACTIVE_TIMER_MIRROR_KEY)).toContain('running');

    useAppStore.getState().resetAllData();
    expect(readActiveTimerMirror()).toBeNull();
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

  it('supports subject CRUD, sound preference, and deleting logged sessions', () => {
    const store = useAppStore.getState();
    const subj = store.addSubject({
      name: 'Physics',
      color: '#f43f5e',
      dailyGoalMinutes: 90,
    });

    expect(useAppStore.getState().subjects).toHaveLength(1);
    store.updateSubject(subj.id, { name: 'Quantum Physics', dailyGoalMinutes: 120 });
    expect(useAppStore.getState().subjects[0].name).toBe('Quantum Physics');
    expect(useAppStore.getState().subjects[0].dailyGoalMinutes).toBe(120);

    store.toggleArchiveSubject(subj.id);
    expect(useAppStore.getState().subjects[0].archived).toBe(true);

    const end = new Date(2026, 10, 26, 12, 0, 0).getTime();
    const created = store.logStudySession(subj.id, end - 1800_000, end);
    expect(useAppStore.getState().sessions).toHaveLength(1);

    store.deleteStudySession(created[0].id);
    expect(useAppStore.getState().sessions).toHaveLength(0);

    store.deleteSubject(subj.id);
    expect(useAppStore.getState().subjects).toHaveLength(0);

    store.setSoundEnabled(false);
    expect(useAppStore.getState().soundEnabled).toBe(false);
  });
});
