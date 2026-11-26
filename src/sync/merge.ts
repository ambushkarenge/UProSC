import type {
  ActiveTimerState,
  DDayGoal,
  Habit,
  LogicalDate,
  MultiDayTaskPlan,
  StudySession,
  Subject,
  SyncEntityType,
  TodoTask,
  UserSettingsData,
} from '../types/domain';
import type {
  MergeableAppCollections,
  SyncEntityEnvelope,
  SyncEntityPayload,
} from './types';

export function makeEntityKey(
  entityType: SyncEntityType,
  entityId: string,
): string {
  return `${entityType}:${entityId}`;
}

export function getEffectiveTimestamp(
  updatedAt?: number | null,
  deletedAt?: number | null,
): number {
  const u = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0;
  const d = typeof deletedAt === 'number' && Number.isFinite(deletedAt) ? deletedAt : 0;
  return Math.max(u, d);
}

export function isTombstoneNewer(
  updatedAt?: number | null,
  deletedAt?: number | null,
): boolean {
  if (typeof deletedAt !== 'number' || !Number.isFinite(deletedAt) || deletedAt <= 0) {
    return false;
  }
  const u = typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0;
  return deletedAt >= u;
}

function getHabitDateTimestamp(
  habit: Habit,
  date: LogicalDate,
  fallbackUpdatedAt: number,
): number {
  const explicitTs = habit.completedDateUpdatedAt?.[date];
  if (typeof explicitTs === 'number' && Number.isFinite(explicitTs)) {
    return explicitTs;
  }
  // Only legacy checked entries (without per-day timestamps) fall back to habit.updatedAt;
  // untouched dates must remain 0 so editing another day never overwrites a peer's check-in.
  return habit.completedDates?.[date] ? fallbackUpdatedAt : 0;
}

/**
 * Merges two Habit records using per-date `completedDateUpdatedAt` timestamps
 * so concurrent check-ins on different days across devices never overwrite each other.
 */
export function mergeHabitRecords(existing: Habit, incoming: Habit): Habit {
  const existingUpdated = existing.updatedAt ?? existing.createdAt ?? 0;
  const incomingUpdated = incoming.updatedAt ?? incoming.createdAt ?? 0;
  const metadataSource = incomingUpdated >= existingUpdated ? incoming : existing;

  const allDates = new Set<LogicalDate>([
    ...Object.keys(existing.completedDates ?? {}),
    ...Object.keys(incoming.completedDates ?? {}),
    ...Object.keys(existing.completedDateUpdatedAt ?? {}),
    ...Object.keys(incoming.completedDateUpdatedAt ?? {}),
  ]);

  const completedDates: Record<LogicalDate, boolean> = {};
  const completedDateUpdatedAt: Record<LogicalDate, number> = {};

  for (const date of allDates) {
    const existingDateTs = getHabitDateTimestamp(existing, date, existingUpdated);
    const incomingDateTs = getHabitDateTimestamp(incoming, date, incomingUpdated);

    const existingVal = Boolean(existing.completedDates?.[date]);
    const incomingVal = Boolean(incoming.completedDates?.[date]);

    let winnerVal: boolean;
    let winnerTs: number;

    if (incomingDateTs > existingDateTs) {
      winnerVal = incomingVal;
      winnerTs = incomingDateTs;
    } else if (existingDateTs > incomingDateTs) {
      winnerVal = existingVal;
      winnerTs = existingDateTs;
    } else {
      winnerVal = incomingVal || existingVal;
      winnerTs = Math.max(existingDateTs, incomingDateTs);
    }

    if (winnerVal) {
      completedDates[date] = true;
    }
    if (winnerTs > 0) {
      completedDateUpdatedAt[date] = winnerTs;
    }
  }

  return {
    ...metadataSource,
    updatedAt: Math.max(existingUpdated, incomingUpdated),
    deletedAt: undefined,
    completedDates,
    completedDateUpdatedAt,
  };
}

export interface EnvelopeMergeResult {
  envelope: SyncEntityEnvelope;
  changedExisting: boolean;
  winner: 'existing' | 'incoming' | 'merged';
}

/**
 * Merges an existing stored envelope with an incoming envelope.
 * Used identically on both client (`syncEngine`) and server (`worker/sync`).
 */
export function mergeSyncEntityEnvelopes(
  existing: SyncEntityEnvelope | null,
  incoming: SyncEntityEnvelope,
  tieBreakWinner: 'existing' | 'incoming' = 'incoming',
): EnvelopeMergeResult {
  if (!existing) {
    return {
      envelope: incoming,
      changedExisting: true,
      winner: 'incoming',
    };
  }

  const existingDeleted = isTombstoneNewer(existing.updatedAt, existing.deletedAt);
  const incomingDeleted = isTombstoneNewer(incoming.updatedAt, incoming.deletedAt);
  const existingTs = getEffectiveTimestamp(existing.updatedAt, existing.deletedAt);
  const incomingTs = getEffectiveTimestamp(incoming.updatedAt, incoming.deletedAt);

  if (
    incoming.entityType === 'habit' &&
    !existingDeleted &&
    !incomingDeleted &&
    existing.data &&
    incoming.data
  ) {
    const mergedHabit = mergeHabitRecords(
      existing.data as Habit,
      incoming.data as Habit,
    );
    const mergedEnvelope: SyncEntityEnvelope<Habit> = {
      entityType: 'habit',
      entityId: incoming.entityId,
      data: mergedHabit,
      updatedAt: mergedHabit.updatedAt ?? Math.max(existingTs, incomingTs),
      deletedAt: null,
      serverRevision: incoming.serverRevision ?? existing.serverRevision,
    };
    const changedExisting =
      JSON.stringify(existing.data) !== JSON.stringify(mergedHabit);
    return {
      envelope: mergedEnvelope,
      changedExisting,
      winner: 'merged',
    };
  }

  if (incomingTs > existingTs) {
    return {
      envelope: incoming,
      changedExisting: true,
      winner: 'incoming',
    };
  }

  if (existingTs > incomingTs) {
    return {
      envelope: existing,
      changedExisting: false,
      winner: 'existing',
    };
  }

  if (tieBreakWinner === 'incoming') {
    const samePayload =
      existingDeleted === incomingDeleted &&
      JSON.stringify(existing.data) === JSON.stringify(incoming.data);
    return {
      envelope: incoming,
      changedExisting: !samePayload,
      winner: 'incoming',
    };
  }

  return {
    envelope: existing,
    changedExisting: false,
    winner: 'existing',
  };
}

function findEntityInCollections(
  collections: MergeableAppCollections,
  entityType: SyncEntityType,
  entityId: string,
): SyncEntityEnvelope | null {
  const key = makeEntityKey(entityType, entityId);
  const tombstone = collections.tombstones[key];

  switch (entityType) {
    case 'settings': {
      const data: UserSettingsData = {
        id: 'settings',
        dailyStudyGoalMinutes: collections.dailyStudyGoalMinutes,
        soundEnabled: collections.soundEnabled,
        updatedAt: collections.settingsUpdatedAt,
      };
      return {
        entityType: 'settings',
        entityId: 'settings',
        data,
        updatedAt: collections.settingsUpdatedAt,
        deletedAt: null,
      };
    }
    case 'subject': {
      const found = collections.subjects.find((item) => item.id === entityId);
      if (found) {
        const updatedAt = found.updatedAt ?? found.createdAt ?? 0;
        if (!tombstone || updatedAt >= tombstone.deletedAt) {
          return {
            entityType,
            entityId,
            data: { ...found, updatedAt },
            updatedAt,
            deletedAt: null,
          };
        }
      }
      break;
    }
    case 'session': {
      const found = collections.sessions.find((item) => item.id === entityId);
      if (found) {
        const updatedAt = found.updatedAt ?? found.endTime ?? 0;
        if (!tombstone || updatedAt >= tombstone.deletedAt) {
          return {
            entityType,
            entityId,
            data: { ...found, updatedAt },
            updatedAt,
            deletedAt: null,
          };
        }
      }
      break;
    }
    case 'task': {
      const found = collections.tasks.find((item) => item.id === entityId);
      if (found) {
        const updatedAt = found.updatedAt ?? 0;
        if (!tombstone || updatedAt >= tombstone.deletedAt) {
          return {
            entityType,
            entityId,
            data: { ...found, updatedAt },
            updatedAt,
            deletedAt: null,
          };
        }
      }
      break;
    }
    case 'multiDayPlan': {
      const found = collections.multiDayPlans.find((item) => item.id === entityId);
      if (found) {
        const updatedAt = found.updatedAt ?? 0;
        if (!tombstone || updatedAt >= tombstone.deletedAt) {
          return {
            entityType,
            entityId,
            data: { ...found, updatedAt },
            updatedAt,
            deletedAt: null,
          };
        }
      }
      break;
    }
    case 'habit': {
      const found = collections.habits.find((item) => item.id === entityId);
      if (found) {
        const updatedAt = found.updatedAt ?? found.createdAt ?? 0;
        if (!tombstone || updatedAt >= tombstone.deletedAt) {
          return {
            entityType,
            entityId,
            data: { ...found, updatedAt },
            updatedAt,
            deletedAt: null,
          };
        }
      }
      break;
    }
    case 'dday': {
      const found = collections.dDayGoal;
      if (found) {
        const updatedAt = found.updatedAt ?? collections.dDayUpdatedAt ?? 0;
        if (!tombstone || updatedAt >= tombstone.deletedAt) {
          return {
            entityType: 'dday',
            entityId: 'dday',
            data: { ...found, updatedAt },
            updatedAt,
            deletedAt: null,
          };
        }
      }
      break;
    }
    case 'activeTimer': {
      return {
        entityType: 'activeTimer',
        entityId: 'activeTimer',
        data: collections.activeTimer,
        updatedAt: collections.activeTimerUpdatedAt,
        deletedAt: null,
      };
    }
  }

  if (tombstone) {
    return {
      entityType,
      entityId,
      data: null,
      updatedAt: tombstone.deletedAt,
      deletedAt: tombstone.deletedAt,
    };
  }

  return null;
}

/**
 * Serializes ONLY locally dirty entities (and tombstones) for low-traffic sync pushes.
 */
export function buildSyncChangesFromCollections(
  collections: MergeableAppCollections,
): SyncEntityEnvelope[] {
  const changes: SyncEntityEnvelope[] = [];

  for (const dirtyRef of Object.values(collections.dirtyEntities)) {
    const envelope = findEntityInCollections(
      collections,
      dirtyRef.entityType,
      dirtyRef.entityId,
    );
    if (envelope) {
      changes.push(envelope);
    }
  }

  return changes;
}

/**
 * Builds full snapshot envelopes for every live entity in a profile (used when
 * explicitly migrating an unsynced local profile into a brand-new cloud account).
 */
export function collectAllDirtyRefs(
  collections: MergeableAppCollections,
  nowMs = Date.now(),
): Record<string, { entityType: SyncEntityType; entityId: string; updatedAt: number }> {
  const dirty: Record<
    string,
    { entityType: SyncEntityType; entityId: string; updatedAt: number }
  > = {};

  const mark = (entityType: SyncEntityType, entityId: string, updatedAt: number) => {
    dirty[makeEntityKey(entityType, entityId)] = {
      entityType,
      entityId,
      updatedAt,
    };
  };

  if (collections.settingsUpdatedAt > 0) {
    mark('settings', 'settings', collections.settingsUpdatedAt);
  }
  for (const s of collections.subjects) {
    mark('subject', s.id, s.updatedAt ?? s.createdAt ?? nowMs);
  }
  for (const sess of collections.sessions) {
    mark('session', sess.id, sess.updatedAt ?? sess.endTime ?? nowMs);
  }
  for (const t of collections.tasks) {
    mark('task', t.id, t.updatedAt ?? nowMs);
  }
  for (const p of collections.multiDayPlans) {
    mark('multiDayPlan', p.id, p.updatedAt ?? nowMs);
  }
  for (const h of collections.habits) {
    mark('habit', h.id, h.updatedAt ?? h.createdAt ?? nowMs);
  }
  if (collections.dDayGoal) {
    mark('dday', 'dday', collections.dDayGoal.updatedAt ?? collections.dDayUpdatedAt ?? nowMs);
  }
  if (collections.activeTimerUpdatedAt > 0) {
    mark('activeTimer', 'activeTimer', collections.activeTimerUpdatedAt);
  }

  return dirty;
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((existing) => existing.id === item.id);
  if (idx === -1) {
    return [...list, item];
  }
  const next = list.slice();
  next[idx] = item;
  return next;
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((item) => item.id !== id);
}

/**
 * Applies remote entity envelopes (creates, updates, and tombstones) onto local
 * user collections using deterministic LWW + per-date habit merging.
 */
export function applyRemoteEnvelopesToCollections(
  collections: MergeableAppCollections,
  remoteEnvelopes: readonly SyncEntityEnvelope[],
): MergeableAppCollections {
  if (remoteEnvelopes.length === 0) {
    return collections;
  }

  let next: MergeableAppCollections = {
    ...collections,
    subjects: collections.subjects.slice(),
    sessions: collections.sessions.slice(),
    tasks: collections.tasks.slice(),
    multiDayPlans: collections.multiDayPlans.slice(),
    habits: collections.habits.slice(),
    tombstones: { ...collections.tombstones },
    dirtyEntities: { ...collections.dirtyEntities },
  };

  for (const remote of remoteEnvelopes) {
    const key = makeEntityKey(remote.entityType, remote.entityId);
    const localEnvelope = findEntityInCollections(
      next,
      remote.entityType,
      remote.entityId,
    );
    const merged = mergeSyncEntityEnvelopes(
      localEnvelope,
      remote,
      'incoming',
    ).envelope;
    const deleted = isTombstoneNewer(merged.updatedAt, merged.deletedAt);

    if (deleted) {
      const deletedAt = merged.deletedAt ?? merged.updatedAt;
      next.tombstones[key] = {
        entityType: remote.entityType,
        entityId: remote.entityId,
        deletedAt,
      };
    } else {
      delete next.tombstones[key];
    }

    switch (remote.entityType) {
      case 'settings': {
        if (!deleted && merged.data) {
          const settings = merged.data as UserSettingsData;
          next.dailyStudyGoalMinutes = settings.dailyStudyGoalMinutes;
          next.soundEnabled = settings.soundEnabled;
          next.settingsUpdatedAt = merged.updatedAt;
        }
        break;
      }
      case 'subject': {
        next.subjects =
          deleted || !merged.data
            ? removeById(next.subjects, remote.entityId)
            : upsertById(next.subjects, merged.data as Subject);
        break;
      }
      case 'session': {
        next.sessions =
          deleted || !merged.data
            ? removeById(next.sessions, remote.entityId)
            : upsertById(next.sessions, merged.data as StudySession);
        break;
      }
      case 'task': {
        next.tasks =
          deleted || !merged.data
            ? removeById(next.tasks, remote.entityId)
            : upsertById(next.tasks, merged.data as TodoTask);
        break;
      }
      case 'multiDayPlan': {
        next.multiDayPlans =
          deleted || !merged.data
            ? removeById(next.multiDayPlans, remote.entityId)
            : upsertById(next.multiDayPlans, merged.data as MultiDayTaskPlan);
        break;
      }
      case 'habit': {
        next.habits =
          deleted || !merged.data
            ? removeById(next.habits, remote.entityId)
            : upsertById(next.habits, merged.data as Habit);
        break;
      }
      case 'dday': {
        if (deleted || !merged.data) {
          next.dDayGoal = null;
          next.dDayUpdatedAt = merged.deletedAt ?? merged.updatedAt;
        } else {
          next.dDayGoal = merged.data as DDayGoal;
          next.dDayUpdatedAt = merged.updatedAt;
        }
        break;
      }
      case 'activeTimer': {
        if (!deleted && merged.data) {
          next.activeTimer = merged.data as ActiveTimerState;
          next.activeTimerUpdatedAt = merged.updatedAt;
        }
        break;
      }
    }
  }

  return next;
}

export function isValidSyncEntityType(value: string): value is SyncEntityType {
  return (
    value === 'settings' ||
    value === 'subject' ||
    value === 'session' ||
    value === 'task' ||
    value === 'multiDayPlan' ||
    value === 'habit' ||
    value === 'dday' ||
    value === 'activeTimer'
  );
}

export function normalizePayloadUpdatedAt<T extends SyncEntityPayload>(
  payload: T,
  updatedAt: number,
): T {
  return {
    ...payload,
    updatedAt,
  };
}
