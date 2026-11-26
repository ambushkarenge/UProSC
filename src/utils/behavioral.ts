import type {
  ActiveTimerState,
  DDayGoal,
  LogicalDate,
  StudySession,
} from '../types/domain';
import {
  addDaysToLogicalDate,
  formatMinutesCompact,
  getLogicalDayEndTimestamp,
  getLogicalDayStartTimestamp,
} from './date';
import { computeDDayProgress } from './focusAnalytics';
import {
  clampUnitRatio,
  getActiveTimerSecondsForLogicalDate,
} from './score';

/** Minimum focus duration (in seconds) on a logical study day to qualify for a streak day. */
export const MIN_STREAK_DAY_SECONDS = 60;

export type BehavioralStatus =
  | 'goal_achieved'
  | 'active_flow'
  | 'streak_at_risk'
  | 'behind_pace'
  | 'fresh_start';

export type BehavioralTone =
  | 'positive'
  | 'active'
  | 'warning'
  | 'nudge'
  | 'neutral';

export interface StudyStreakSummary {
  currentStreakDays: number;
  bestStreakDays: number;
  todayLockedIn: boolean;
  streakAtRisk: boolean;
}

export interface BehavioralInsight {
  status: BehavioralStatus;
  tone: BehavioralTone;
  title: string;
  message: string;
  streak: StudyStreakSummary;
  todayMinutes: number;
  dailyGoalMinutes: number;
  hoursUntilRollover: number;
  suggestedSprintMinutes: number;
}

/**
 * Computes current and best consecutive focus streaks anchored to the 5:00 AM
 * logical study day without resetting to 0 before today's first session.
 */
export function computeStudyStreak({
  logicalDate,
  sessions,
  activeTimer,
  nowMs = Date.now(),
}: {
  logicalDate: LogicalDate;
  sessions: readonly StudySession[];
  activeTimer?: ActiveTimerState;
  nowMs?: number;
}): StudyStreakSummary {
  const secondsByDay = new Map<LogicalDate, number>();

  for (const session of sessions) {
    const prev = secondsByDay.get(session.logicalDate) ?? 0;
    secondsByDay.set(
      session.logicalDate,
      prev + Math.max(0, session.durationSeconds),
    );
  }

  const liveTodaySeconds = getActiveTimerSecondsForLogicalDate(
    activeTimer,
    logicalDate,
    nowMs,
  );
  if (liveTodaySeconds > 0) {
    secondsByDay.set(
      logicalDate,
      (secondsByDay.get(logicalDate) ?? 0) + liveTodaySeconds,
    );
  }

  const qualifiedDays = new Set<LogicalDate>();
  for (const [day, secs] of secondsByDay.entries()) {
    if (secs >= MIN_STREAK_DAY_SECONDS) {
      qualifiedDays.add(day);
    }
  }

  const todayLockedIn = qualifiedDays.has(logicalDate);

  // Count consecutive days ending yesterday
  let priorStreak = 0;
  let cursor = addDaysToLogicalDate(logicalDate, -1);
  while (qualifiedDays.has(cursor)) {
    priorStreak += 1;
    cursor = addDaysToLogicalDate(cursor, -1);
  }

  const currentStreakDays = todayLockedIn ? priorStreak + 1 : priorStreak;
  const streakAtRisk = !todayLockedIn && priorStreak >= 1;

  // Compute historical best streak across all qualified days
  const sortedDays = Array.from(qualifiedDays).sort();
  let bestStreakDays = currentStreakDays;
  let run = 0;
  let prevDay: LogicalDate | null = null;

  for (const day of sortedDays) {
    if (prevDay && addDaysToLogicalDate(prevDay, 1) === day) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > bestStreakDays) {
      bestStreakDays = run;
    }
    prevDay = day;
  }

  return {
    currentStreakDays,
    bestStreakDays,
    todayLockedIn,
    streakAtRisk,
  };
}

function formatRolloverCountdown(hoursUntilRollover: number): string {
  const safeHours = Math.max(0, hoursUntilRollover);
  if (safeHours < 1) {
    const mins = Math.max(1, Math.round(safeHours * 60));
    return `${mins}m left`;
  }
  const roundedHours = Math.floor(safeHours);
  const mins = Math.round((safeHours - roundedHours) * 60);
  return mins > 0 ? `${roundedHours}h ${mins}m left` : `${roundedHours}h left`;
}

/**
 * Derives Duolingo-inspired positive celebration or pace/streak-at-risk guidance
 * from today's focus progress, 5:00 AM rollover proximity, streak, and D-Day pace.
 */
export function deriveBehavioralInsight({
  logicalDate,
  dailyStudyGoalMinutes,
  sessions,
  activeTimer,
  dDayGoal,
  nowMs = Date.now(),
}: {
  logicalDate: LogicalDate;
  dailyStudyGoalMinutes: number;
  sessions: readonly StudySession[];
  activeTimer?: ActiveTimerState;
  dDayGoal?: DDayGoal | null;
  nowMs?: number;
}): BehavioralInsight {
  const streak = computeStudyStreak({
    logicalDate,
    sessions,
    activeTimer,
    nowMs,
  });

  const loggedTodaySeconds = sessions.reduce(
    (sum, session) =>
      session.logicalDate === logicalDate
        ? sum + Math.max(0, session.durationSeconds)
        : sum,
    0,
  );
  const liveTodaySeconds = getActiveTimerSecondsForLogicalDate(
    activeTimer,
    logicalDate,
    nowMs,
  );
  const todayMinutes = Math.floor((loggedTodaySeconds + liveTodaySeconds) / 60);
  const safeGoalMinutes = Math.max(1, dailyStudyGoalMinutes);
  const remainingGoalMinutes = Math.max(0, safeGoalMinutes - todayMinutes);
  const suggestedSprintMinutes =
    remainingGoalMinutes > 0 ? Math.min(25, remainingGoalMinutes) : 25;

  const dayStart = getLogicalDayStartTimestamp(logicalDate);
  const dayEnd = getLogicalDayEndTimestamp(logicalDate);
  const hoursUntilRollover = Math.max(0, (dayEnd - nowMs) / 3_600_000);
  const dayElapsedRatio = clampUnitRatio((nowMs - dayStart) / (dayEnd - dayStart));

  // 1. Positive celebration when daily focus goal is closed
  if (todayMinutes >= safeGoalMinutes) {
    const extraMinutes = todayMinutes - safeGoalMinutes;
    return {
      status: 'goal_achieved',
      tone: 'positive',
      title:
        extraMinutes >= 15
          ? `Overdrive Mode (+${formatMinutesCompact(extraMinutes)})`
          : 'Daily Focus Ring Closed!',
      message:
        streak.currentStreakDays >= 2
          ? `${formatMinutesCompact(todayMinutes)} logged today · ${streak.currentStreakDays}-day focus streak locked in.`
          : `${formatMinutesCompact(todayMinutes)} logged today — Ring 1 is at 100%.`,
      streak,
      todayMinutes,
      dailyGoalMinutes: safeGoalMinutes,
      hoursUntilRollover,
      suggestedSprintMinutes: 25,
    };
  }

  // 2. Active focus flow state while timer is running
  if (activeTimer?.status === 'running') {
    return {
      status: 'active_flow',
      tone: 'active',
      title: 'Deep Focus in Progress',
      message:
        remainingGoalMinutes > 0
          ? `${formatMinutesCompact(remainingGoalMinutes)} more today closes Ring 1 (${formatMinutesCompact(todayMinutes)}/${formatMinutesCompact(safeGoalMinutes)}).`
          : 'Ring 1 is already full — keep stacking extra focus time!',
      streak,
      todayMinutes,
      dailyGoalMinutes: safeGoalMinutes,
      hoursUntilRollover,
      suggestedSprintMinutes,
    };
  }

  // 3. Loss-aversion nudge when yesterday had a streak and today is still empty
  if (streak.streakAtRisk) {
    const rolloverText = formatRolloverCountdown(hoursUntilRollover);
    const isUrgent = hoursUntilRollover <= 10;
    return {
      status: 'streak_at_risk',
      tone: 'warning',
      title: isUrgent
        ? `${streak.currentStreakDays}-Day Streak At Risk`
        : `Protect Your ${streak.currentStreakDays}-Day Streak`,
      message: isUrgent
        ? `Only ${rolloverText} before the 5:00 AM rollover. Log even 15m now so you don't lose your ${streak.currentStreakDays}-day streak.`
        : `Yesterday's momentum is waiting — start a ${suggestedSprintMinutes}m block before 5:00 AM to extend to ${streak.currentStreakDays + 1} days.`,
      streak,
      todayMinutes,
      dailyGoalMinutes: safeGoalMinutes,
      hoursUntilRollover,
      suggestedSprintMinutes,
    };
  }

  // 4. Pace check against today's goal or D-Day required daily pace
  const dDayInfo = dDayGoal
    ? computeDDayProgress({
        logicalDate,
        dDayGoal,
        sessions,
        activeTimer,
        nowMs,
      })
    : null;
  const dDayNeedsDailyHours =
    dDayInfo && !dDayInfo.isCompleted && dDayInfo.requiredDailyHours > 0
      ? dDayInfo.requiredDailyHours
      : 0;
  const behindDDayPace =
    dDayNeedsDailyHours > 0 && todayMinutes / 60 < dDayNeedsDailyHours * 0.5 && dayElapsedRatio >= 0.35;
  const behindDailyPace =
    dayElapsedRatio >= 0.45 && todayMinutes / safeGoalMinutes < dayElapsedRatio * 0.65;

  if (behindDDayPace || behindDailyPace) {
    return {
      status: 'behind_pace',
      tone: 'nudge',
      title: behindDDayPace
        ? `${dDayInfo?.badgeText} Pace Check`
        : 'Gentle Pace Nudge',
      message: behindDDayPace
        ? `${dDayInfo?.goal.title} needs ${dDayNeedsDailyHours.toFixed(1)}h/day. A ${suggestedSprintMinutes}m sprint moves both Ring 1 and D-Day forward.`
        : `${formatMinutesCompact(remainingGoalMinutes)} left for today's Ring 1 (${formatRolloverCountdown(hoursUntilRollover)} before 5:00 AM).`,
      streak,
      todayMinutes,
      dailyGoalMinutes: safeGoalMinutes,
      hoursUntilRollover,
      suggestedSprintMinutes,
    };
  }

  // 5. Fresh / Steady encouragement
  return {
    status: 'fresh_start',
    tone: 'neutral',
    title:
      todayMinutes > 0
        ? `Steady Progress (${formatMinutesCompact(todayMinutes)})`
        : 'Ready for Deep Focus',
    message:
      todayMinutes > 0
        ? `${formatMinutesCompact(remainingGoalMinutes)} remaining to close Ring 1 today.`
        : `Start a ${suggestedSprintMinutes}m Pomodoro or stopwatch session to fill Ring 1.`,
    streak,
    todayMinutes,
    dailyGoalMinutes: safeGoalMinutes,
    hoursUntilRollover,
    suggestedSprintMinutes,
  };
}
