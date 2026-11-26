import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVE_TIMER } from '../../store/useAppStore';
import type { Habit, StudySession, Subject } from '../../types/domain';
import {
  applyRemoteEnvelopesToCollections,
  buildSyncChangesFromCollections,
  makeEntityKey,
  mergeHabitRecords,
  mergeSyncEntityEnvelopes,
} from '../merge';
import type { MergeableAppCollections, SyncEntityEnvelope } from '../types';

function createEmptyCollections(): MergeableAppCollections {
  return {
    dailyStudyGoalMinutes: 120,
    soundEnabled: true,
    settingsUpdatedAt: 0,
    subjects: [],
    sessions: [],
    tasks: [],
    multiDayPlans: [],
    habits: [],
    dDayGoal: null,
    dDayUpdatedAt: 0,
    activeTimer: { ...DEFAULT_ACTIVE_TIMER },
    activeTimerUpdatedAt: 0,
    tombstones: {},
    dirtyEntities: {},
  };
}

describe('sync/merge — LWW, Tombstones & Per-Date Habit Merging', () => {
  it('merges concurrent habit check-ins on different dates across devices without data loss', () => {
    const phoneHabit: Habit = {
      id: 'h1',
      name: 'Flashcards',
      icon: 'flame',
      color: '#0ea5e9',
      archived: false,
      createdAt: 1000,
      updatedAt: 2000,
      completedDates: { '2026-11-26': true },
      completedDateUpdatedAt: { '2026-11-26': 2000 },
    };

    const laptopHabit: Habit = {
      id: 'h1',
      name: 'Anki Flashcards',
      icon: 'flame',
      color: '#0ea5e9',
      archived: false,
      createdAt: 1000,
      updatedAt: 3000,
      completedDates: { '2026-11-27': true },
      completedDateUpdatedAt: { '2026-11-27': 3000 },
    };

    const merged = mergeHabitRecords(phoneHabit, laptopHabit);
    expect(merged.name).toBe('Anki Flashcards');
    expect(merged.completedDates).toEqual({
      '2026-11-26': true,
      '2026-11-27': true,
    });
    expect(merged.completedDateUpdatedAt).toEqual({
      '2026-11-26': 2000,
      '2026-11-27': 3000,
    });

    // Unchecking on one device with a newer timestamp beats an older check
    const uncheckedRemote: Habit = {
      ...merged,
      updatedAt: 4000,
      completedDates: { '2026-11-27': true },
      completedDateUpdatedAt: { '2026-11-26': 4000, '2026-11-27': 3000 },
    };
    const afterUncheck = mergeHabitRecords(merged, uncheckedRemote);
    expect(afterUncheck.completedDates).toEqual({ '2026-11-27': true });
    expect(afterUncheck.completedDateUpdatedAt?.['2026-11-26']).toBe(4000);
  });

  it('resolves updates vs tombstones cleanly and allows newer resurrection', () => {
    const subj: Subject = {
      id: 's1',
      name: 'Physics',
      color: '#f43f5e',
      dailyGoalMinutes: 60,
      archived: false,
      createdAt: 1000,
      updatedAt: 2000,
    };

    const existing: SyncEntityEnvelope<Subject> = {
      entityType: 'subject',
      entityId: 's1',
      data: subj,
      updatedAt: 2000,
      deletedAt: null,
    };

    const newerDelete: SyncEntityEnvelope<Subject> = {
      entityType: 'subject',
      entityId: 's1',
      data: null,
      updatedAt: 3000,
      deletedAt: 3000,
    };

    const deleteOutcome = mergeSyncEntityEnvelopes(existing, newerDelete);
    expect(deleteOutcome.envelope.deletedAt).toBe(3000);
    expect(deleteOutcome.envelope.data).toBeNull();

    // Older edit arriving late does not resurrect a newer tombstone
    const staleEdit: SyncEntityEnvelope<Subject> = {
      entityType: 'subject',
      entityId: 's1',
      data: { ...subj, name: 'Stale', updatedAt: 2500 },
      updatedAt: 2500,
      deletedAt: null,
    };
    const staleOutcome = mergeSyncEntityEnvelopes(
      deleteOutcome.envelope,
      staleEdit,
    );
    expect(staleOutcome.winner).toBe('existing');
    expect(staleOutcome.envelope.deletedAt).toBe(3000);
  });

  it('serializes ONLY dirty entities and merges remote sessions + deletes cleanly', () => {
    const localSession: StudySession = {
      id: 'sess-local',
      subjectId: 'math',
      startTime: 1000,
      endTime: 3601000,
      durationSeconds: 3600,
      logicalDate: '2026-11-26',
      updatedAt: 5000,
    };
    const cleanSubject: Subject = {
      id: 'math',
      name: 'Math',
      color: '#3b82f6',
      dailyGoalMinutes: 60,
      archived: false,
      createdAt: 1000,
      updatedAt: 1000,
    };
    const dirtySubject: Subject = {
      id: 'chem',
      name: 'Chemistry',
      color: '#10b981',
      dailyGoalMinutes: 45,
      archived: false,
      createdAt: 1000,
      updatedAt: 6000,
    };

    const base = createEmptyCollections();
    base.subjects = [cleanSubject, dirtySubject];
    base.sessions = [localSession];
    base.dirtyEntities = {
      [makeEntityKey('subject', 'chem')]: {
        entityType: 'subject',
        entityId: 'chem',
        updatedAt: 6000,
      },
    };

    // Only dirty subject is serialized — clean subject & clean session are NOT pushed
    const changes = buildSyncChangesFromCollections(base);
    expect(changes).toHaveLength(1);
    expect(changes[0].entityId).toBe('chem');

    // Remote sends another session from Device B and deletes cleanSubject 'math'
    const remoteEnvelopes: SyncEntityEnvelope[] = [
      {
        entityType: 'session',
        entityId: 'sess-remote',
        data: {
          id: 'sess-remote',
          subjectId: 'chem',
          startTime: 4000000,
          endTime: 5800000,
          durationSeconds: 1800,
          logicalDate: '2026-11-26',
          updatedAt: 7000,
        },
        updatedAt: 7000,
        deletedAt: null,
      },
      {
        entityType: 'subject',
        entityId: 'math',
        data: null,
        updatedAt: 8000,
        deletedAt: 8000,
      },
    ];

    const merged = applyRemoteEnvelopesToCollections(base, remoteEnvelopes);
    expect(merged.sessions.map((s) => s.id)).toEqual([
      'sess-local',
      'sess-remote',
    ]);
    expect(merged.subjects.map((s) => s.id)).toEqual(['chem']);
    expect(merged.tombstones['subject:math']?.deletedAt).toBe(8000);
  });
});
