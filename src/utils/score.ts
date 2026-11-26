import type {
  ActiveTimerState,
  Habit,
  LogicalDate,
  ProductivityScoreBreakdown,
  RingMetric,
  StudySession,
  TodoTask,
} from '../types/domain';
import {
  formatDurationCompact,
  formatMinutesCompact,
  getLogicalDayEndTimestamp,
  getLogicalDayStartTimestamp,
  getLogicalStudyDate,
} from './date';

/**
 * Core daily productivity weights:
 * 45% Focus + 35% To-Do + 20% Habits = 100 points max.
 */
export const PRODUCTIVITY_SCORE_WEIGHTS = {
  focus: 45,
  todo: 35,
  habits: 20,
} as const;

/**
 * Extension hook for future score modifiers (e.g. deferred streak multiplier bonus).
 * Keeping modifiers separate ensures the base 45/35/20 ring calculation stays pure.
 */
export interface ScoreCalculationOptions {
  /** Reserved for future deferred streak multiplier bonus (currently unused). */
  deferredStreakMultiplier?: number;
}

export interface RingRatiosInput {
  focusRatio: number;
  todoRatio: number;
  habitsRatio: number;
}

/** Clamps any finite number into [0, 1]. Non-finite/negative numbers become 0. */
export function clampUnitRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(1, value);
}

/**
 * Computes the 0-100 Productivity Score from ring completion ratios.
 * Each ring contribution is capped at 100% (`clampedRatio <= 1`).
 */
export function calculateProductivityScore(
  { focusRatio, todoRatio, habitsRatio }: RingRatiosInput,
  _options?: ScoreCalculationOptions,
): number {
  const focusScore =
    clampUnitRatio(focusRatio) * PRODUCTIVITY_SCORE_WEIGHTS.focus;
  const todoScore =
    clampUnitRatio(todoRatio) * PRODUCTIVITY_SCORE_WEIGHTS.todo;
  const habitsScore =
    clampUnitRatio(habitsRatio) * PRODUCTIVITY_SCORE_WEIGHTS.habits;

  return Math.round(focusScore + todoScore + habitsScore);
}

/** Computes total elapsed milliseconds for an active timer at `nowMs`. */
export function getActiveTimerElapsedMs(
  activeTimer: ActiveTimerState | undefined,
  nowMs: number,
): number {
  if (!activeTimer || activeTimer.status === 'idle') {
    return 0;
  }

  const runningMs =
    activeTimer.status === 'running' && activeTimer.segmentStartTime !== null
      ? Math.max(0, nowMs - activeTimer.segmentStartTime)
      : 0;

  return Math.max(0, activeTimer.accumulatedMs) + runningMs;
}

/**
 * Computes how many seconds of an active (running or paused) timer belong
 * to `targetLogicalDate`, splitting live segments cleanly at 5:00 AM boundaries.
 */
export function getActiveTimerSecondsForLogicalDate(
  activeTimer: ActiveTimerState | undefined,
  targetLogicalDate: LogicalDate,
  nowMs: number,
): number {
  if (!activeTimer || activeTimer.status === 'idle') {
    return 0;
  }

  const dayStart = getLogicalDayStartTimestamp(targetLogicalDate);
  const dayEnd = getLogicalDayEndTimestamp(targetLogicalDate);

  let totalMsForDay = 0;

  if (activeTimer.accumulatedMs > 0) {
    const anchorTs = activeTimer.sessionStartTime ?? nowMs;
    if (getLogicalStudyDate(anchorTs) === targetLogicalDate) {
      totalMsForDay += activeTimer.accumulatedMs;
    }
  }

  if (
    activeTimer.status === 'running' &&
    activeTimer.segmentStartTime !== null &&
    nowMs > activeTimer.segmentStartTime
  ) {
    const overlapStart = Math.max(activeTimer.segmentStartTime, dayStart);
    const overlapEnd = Math.min(nowMs, dayEnd);
    if (overlapEnd > overlapStart) {
      totalMsForDay += overlapEnd - overlapStart;
    }
  }

  return Math.floor(totalMsForDay / 1000);
}

export interface DailyProductivityInput {
  logicalDate: LogicalDate;
  dailyStudyGoalMinutes: number;
  sessions: readonly StudySession[];
  tasks: readonly TodoTask[];
  habits: readonly Habit[];
  activeTimer?: ActiveTimerState;
  nowMs?: number;
}

/**
 * Aggregates logged sessions (+ live active timer), today's tasks, and active habits
 * into the 3 activity rings and 0-100 Productivity Score for `logicalDate`.
 */
export function calculateDailyProductivity({
  logicalDate,
  dailyStudyGoalMinutes,
  sessions,
  tasks,
  habits,
  activeTimer,
  nowMs = Date.now(),
}: DailyProductivityInput): ProductivityScoreBreakdown {
  // Ring 1: Focus Time (logged sessions for logicalDate + live active timer overlap)
  const loggedSeconds = sessions.reduce(
    (sum, session) =>
      session.logicalDate === logicalDate
        ? sum + Math.max(0, session.durationSeconds)
        : sum,
    0,
  );
  const liveSeconds = getActiveTimerSecondsForLogicalDate(
    activeTimer,
    logicalDate,
    nowMs,
  );
  const totalFocusSeconds = loggedSeconds + liveSeconds;
  const totalFocusMinutes = totalFocusSeconds / 60;
  const safeGoalMinutes = Math.max(0, dailyStudyGoalMinutes);
  const focusRatio =
    safeGoalMinutes > 0 ? totalFocusMinutes / safeGoalMinutes : 0;
  const focusPercentage = Math.round(focusRatio * 100);

  const focusRing: RingMetric = {
    key: 'focus',
    label: 'Focus',
    completed: Math.floor(totalFocusMinutes),
    target: safeGoalMinutes,
    ratio: focusRatio,
    clampedRatio: clampUnitRatio(focusRatio),
    percentage: focusPercentage,
    displayValue: formatDurationCompact(totalFocusSeconds),
    detailText:
      safeGoalMinutes > 0
        ? `${formatDurationCompact(totalFocusSeconds)} of ${formatMinutesCompact(safeGoalMinutes)} goal (${focusPercentage}%)`
        : 'Set a daily study goal',
  };

  // Ring 2: Tasks due today (Zero-Item Rule: 0 tasks due => 0%)
  const tasksToday = tasks.filter((task) => task.logicalDate === logicalDate);
  const completedTasksCount = tasksToday.filter((task) => task.completed).length;
  const totalTasksCount = tasksToday.length;
  const todoRatio =
    totalTasksCount > 0 ? completedTasksCount / totalTasksCount : 0;
  const todoPercentage = Math.round(todoRatio * 100);

  const todoRing: RingMetric = {
    key: 'todo',
    label: 'To-Do',
    completed: completedTasksCount,
    target: totalTasksCount,
    ratio: todoRatio,
    clampedRatio: clampUnitRatio(todoRatio),
    percentage: todoPercentage,
    displayValue: `${completedTasksCount}/${totalTasksCount}`,
    detailText:
      totalTasksCount === 0
        ? '0 tasks due today (0% — zero-item rule)'
        : `${completedTasksCount} of ${totalTasksCount} tasks done (${todoPercentage}%)`,
  };

  // Ring 3: Active Habits today (Zero-Item Rule: 0 active habits => 0%)
  const activeHabits = habits.filter((habit) => !habit.archived);
  const completedHabitsCount = activeHabits.filter((habit) =>
    Boolean(habit.completedDates[logicalDate]),
  ).length;
  const totalHabitsCount = activeHabits.length;
  const habitsRatio =
    totalHabitsCount > 0 ? completedHabitsCount / totalHabitsCount : 0;
  const habitsPercentage = Math.round(habitsRatio * 100);

  const habitsRing: RingMetric = {
    key: 'habits',
    label: 'Habits',
    completed: completedHabitsCount,
    target: totalHabitsCount,
    ratio: habitsRatio,
    clampedRatio: clampUnitRatio(habitsRatio),
    percentage: habitsPercentage,
    displayValue: `${completedHabitsCount}/${totalHabitsCount}`,
    detailText:
      totalHabitsCount === 0
        ? '0 active habits (0% — zero-item rule)'
        : `${completedHabitsCount} of ${totalHabitsCount} habits done (${habitsPercentage}%)`,
  };

  const score = calculateProductivityScore({
    focusRatio: focusRing.ratio,
    todoRatio: todoRing.ratio,
    habitsRatio: habitsRing.ratio,
  });

  return {
    logicalDate,
    score,
    rings: {
      focus: focusRing,
      todo: todoRing,
      habits: habitsRing,
    },
  };
}
