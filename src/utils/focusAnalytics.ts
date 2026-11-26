import type {
  ActiveTimerState,
  DDayGoal,
  LogicalDate,
  StudySession,
  Subject,
} from '../types/domain';
import {
  STUDY_DAY_ROLLOVER_HOUR,
  addDaysToLogicalDate,
  getLogicalDayEndTimestamp,
  getLogicalDayStartTimestamp,
  parseLogicalDate,
} from './date';
import {
  clampUnitRatio,
  getActiveTimerElapsedMs,
  getActiveTimerSecondsForLogicalDate,
} from './score';

export type AnalyticsRange = 'today' | '7d' | 'all';

export interface SubjectBreakdownSlice {
  subjectId: string;
  name: string;
  color: string;
  seconds: number;
  dailyGoalMinutes: number;
  share: number;
  percentage: number;
}

export interface SubjectBreakdownResult {
  totalSeconds: number;
  slices: SubjectBreakdownSlice[];
}

export interface TimelineBlock {
  id: string;
  subjectId: string;
  subjectName: string;
  color: string;
  startTime: number;
  endTime: number;
  durationSeconds: number;
  startFraction: number;
  widthFraction: number;
  isLive: boolean;
}

export interface PeakHourBucket {
  hour: number;
  shortLabel: string;
  rangeLabel: string;
  seconds: number;
  minutes: number;
  isPeak: boolean;
}

export interface PeakHoursResult {
  buckets: PeakHourBucket[];
  peakBucket: PeakHourBucket | null;
  maxSeconds: number;
}

export interface DDayProgress {
  goal: DDayGoal;
  daysRemaining: number;
  badgeText: string;
  loggedHours: number;
  remainingHours: number;
  progressRatio: number;
  clampedRatio: number;
  percentage: number;
  requiredDailyHours: number;
  isCompleted: boolean;
  isOverdue: boolean;
}

const FALLBACK_SUBJECT_NAME = 'General Focus';
const FALLBACK_SUBJECT_COLOR = '#64748b';

function resolveSubjectMeta(
  subjectId: string | null,
  subjectMap: Map<string, Subject>,
): { id: string; name: string; color: string; dailyGoalMinutes: number } {
  if (!subjectId) {
    return {
      id: 'unassigned',
      name: FALLBACK_SUBJECT_NAME,
      color: FALLBACK_SUBJECT_COLOR,
      dailyGoalMinutes: 0,
    };
  }
  const found = subjectMap.get(subjectId);
  if (!found) {
    return {
      id: subjectId,
      name: FALLBACK_SUBJECT_NAME,
      color: FALLBACK_SUBJECT_COLOR,
      dailyGoalMinutes: 0,
    };
  }
  return found;
}

function isLogicalDateInRange(
  candidate: LogicalDate,
  todayLogicalDate: LogicalDate,
  range: AnalyticsRange,
): boolean {
  if (range === 'all') return true;
  if (range === 'today') return candidate === todayLogicalDate;
  const startDate = addDaysToLogicalDate(todayLogicalDate, -6);
  return candidate >= startDate && candidate <= todayLogicalDate;
}

function extractActiveTimerIntervals(
  activeTimer: ActiveTimerState | undefined,
  nowMs: number,
): Array<{ startTime: number; endTime: number }> {
  if (!activeTimer || activeTimer.status === 'idle') {
    return [];
  }

  const intervals: Array<{ startTime: number; endTime: number }> = [];

  if (
    activeTimer.completedSegments &&
    activeTimer.completedSegments.length > 0
  ) {
    for (const seg of activeTimer.completedSegments) {
      if (seg.endTime > seg.startTime) {
        intervals.push({ startTime: seg.startTime, endTime: seg.endTime });
      }
    }
  } else if (activeTimer.accumulatedMs > 0) {
    const start = activeTimer.sessionStartTime ?? nowMs - activeTimer.accumulatedMs;
    intervals.push({
      startTime: start,
      endTime: start + activeTimer.accumulatedMs,
    });
  }

  if (
    activeTimer.status === 'running' &&
    activeTimer.segmentStartTime !== null &&
    nowMs > activeTimer.segmentStartTime
  ) {
    let endMs = nowMs;
    if (
      activeTimer.mode === 'countdown' &&
      typeof activeTimer.targetDurationMs === 'number' &&
      activeTimer.targetDurationMs > 0
    ) {
      const remaining = Math.max(
        0,
        activeTimer.targetDurationMs - activeTimer.accumulatedMs,
      );
      endMs = Math.min(nowMs, activeTimer.segmentStartTime + remaining);
    }
    if (endMs > activeTimer.segmentStartTime) {
      intervals.push({ startTime: activeTimer.segmentStartTime, endTime: endMs });
    }
  }

  return intervals;
}

/**
 * Aggregates logged sessions and live active timer seconds by subject
 * for Today, Last 7 Days, or All Time using 5:00 AM logical dates.
 */
export function computeSubjectBreakdown({
  logicalDate,
  range,
  subjects,
  sessions,
  activeTimer,
  nowMs = Date.now(),
}: {
  logicalDate: LogicalDate;
  range: AnalyticsRange;
  subjects: readonly Subject[];
  sessions: readonly StudySession[];
  activeTimer?: ActiveTimerState;
  nowMs?: number;
}): SubjectBreakdownResult {
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));
  const totals = new Map<string, number>();

  for (const session of sessions) {
    if (!isLogicalDateInRange(session.logicalDate, logicalDate, range)) {
      continue;
    }
    const seconds = Math.max(0, session.durationSeconds);
    if (seconds === 0) continue;
    totals.set(
      session.subjectId,
      (totals.get(session.subjectId) ?? 0) + seconds,
    );
  }

  if (activeTimer && activeTimer.status !== 'idle') {
    const liveSeconds =
      range === 'today'
        ? getActiveTimerSecondsForLogicalDate(activeTimer, logicalDate, nowMs)
        : Math.floor(getActiveTimerElapsedMs(activeTimer, nowMs) / 1000);

    if (liveSeconds > 0) {
      const key = activeTimer.subjectId ?? 'unassigned';
      totals.set(key, (totals.get(key) ?? 0) + liveSeconds);
    }
  }

  let totalSeconds = 0;
  for (const value of totals.values()) {
    totalSeconds += value;
  }

  const slices: SubjectBreakdownSlice[] = Array.from(totals.entries())
    .map(([subjectId, seconds]) => {
      const meta = resolveSubjectMeta(
        subjectId === 'unassigned' ? null : subjectId,
        subjectMap,
      );
      const share = totalSeconds > 0 ? seconds / totalSeconds : 0;
      return {
        subjectId,
        name: meta.name,
        color: meta.color,
        seconds,
        dailyGoalMinutes: meta.dailyGoalMinutes,
        share,
        percentage: Math.round(share * 100),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  return { totalSeconds, slices };
}

/**
 * Computes timeline blocks across the 24-hour 5:00 AM -> 5:00 AM logical study day.
 */
export function computeDailyTimeline({
  logicalDate,
  subjects,
  sessions,
  activeTimer,
  nowMs = Date.now(),
}: {
  logicalDate: LogicalDate;
  subjects: readonly Subject[];
  sessions: readonly StudySession[];
  activeTimer?: ActiveTimerState;
  nowMs?: number;
}): TimelineBlock[] {
  const dayStart = getLogicalDayStartTimestamp(logicalDate);
  const dayEnd = getLogicalDayEndTimestamp(logicalDate);
  const daySpan = Math.max(1, dayEnd - dayStart);
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const blocks: TimelineBlock[] = [];

  for (const session of sessions) {
    if (session.logicalDate !== logicalDate) continue;
    const clampedStart = Math.max(session.startTime, dayStart);
    const clampedEnd = Math.min(session.endTime, dayEnd);
    if (clampedEnd <= clampedStart) continue;

    const meta = resolveSubjectMeta(session.subjectId, subjectMap);
    blocks.push({
      id: session.id,
      subjectId: session.subjectId,
      subjectName: meta.name,
      color: meta.color,
      startTime: clampedStart,
      endTime: clampedEnd,
      durationSeconds: Math.round((clampedEnd - clampedStart) / 1000),
      startFraction: (clampedStart - dayStart) / daySpan,
      widthFraction: (clampedEnd - clampedStart) / daySpan,
      isLive: false,
    });
  }

  const liveIntervals = extractActiveTimerIntervals(activeTimer, nowMs);
  liveIntervals.forEach((interval, index) => {
    const clampedStart = Math.max(interval.startTime, dayStart);
    const clampedEnd = Math.min(interval.endTime, dayEnd);
    if (clampedEnd <= clampedStart) return;

    const meta = resolveSubjectMeta(activeTimer?.subjectId ?? null, subjectMap);
    blocks.push({
      id: `live-${index}`,
      subjectId: meta.id,
      subjectName: meta.name,
      color: meta.color,
      startTime: clampedStart,
      endTime: clampedEnd,
      durationSeconds: Math.round((clampedEnd - clampedStart) / 1000),
      startFraction: (clampedStart - dayStart) / daySpan,
      widthFraction: (clampedEnd - clampedStart) / daySpan,
      isLive: true,
    });
  });

  return blocks.sort((a, b) => a.startTime - b.startTime);
}

function formatHourShort(hour24: number): string {
  const normalized = ((hour24 % 24) + 24) % 24;
  if (normalized === 0) return '12a';
  if (normalized === 12) return '12p';
  return normalized < 12 ? `${normalized}a` : `${normalized - 12}p`;
}

function formatHourRangeLabel(hour24: number): string {
  const start = ((hour24 % 24) + 24) % 24;
  const end = (start + 1) % 24;
  const formatSingle = (h: number) => {
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:00 ${suffix}`;
  };
  return `${formatSingle(start)} – ${formatSingle(end)}`;
}

function accumulateIntervalIntoHourBuckets(
  startTime: number,
  endTime: number,
  hourTotalsMs: number[],
): void {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return;
  }

  let cursor = startTime;
  while (cursor < endTime) {
    const cursorDate = new Date(cursor);
    const nextHourBoundary = new Date(
      cursorDate.getFullYear(),
      cursorDate.getMonth(),
      cursorDate.getDate(),
      cursorDate.getHours() + 1,
      0,
      0,
      0,
    ).getTime();

    const chunkEnd = Math.min(endTime, nextHourBoundary);
    const hour = cursorDate.getHours();
    hourTotalsMs[hour] += Math.max(0, chunkEnd - cursor);
    cursor = chunkEnd > cursor ? chunkEnd : endTime;
  }
}

/**
 * Buckets study time into 24 local clock hours ordered from 5:00 AM -> 4:00 AM
 * and detects the user's peak productivity hour.
 */
export function computePeakHours({
  logicalDate,
  range,
  sessions,
  activeTimer,
  nowMs = Date.now(),
}: {
  logicalDate: LogicalDate;
  range: AnalyticsRange;
  sessions: readonly StudySession[];
  activeTimer?: ActiveTimerState;
  nowMs?: number;
}): PeakHoursResult {
  const hourTotalsMs = Array.from({ length: 24 }, () => 0);

  for (const session of sessions) {
    if (!isLogicalDateInRange(session.logicalDate, logicalDate, range)) {
      continue;
    }
    accumulateIntervalIntoHourBuckets(
      session.startTime,
      session.endTime,
      hourTotalsMs,
    );
  }

  const dayStart = getLogicalDayStartTimestamp(logicalDate);
  const dayEnd = getLogicalDayEndTimestamp(logicalDate);
  for (const interval of extractActiveTimerIntervals(activeTimer, nowMs)) {
    if (range === 'today') {
      accumulateIntervalIntoHourBuckets(
        Math.max(interval.startTime, dayStart),
        Math.min(interval.endTime, dayEnd),
        hourTotalsMs,
      );
    } else {
      accumulateIntervalIntoHourBuckets(
        interval.startTime,
        interval.endTime,
        hourTotalsMs,
      );
    }
  }

  const orderedHours = Array.from(
    { length: 24 },
    (_, offset) => (STUDY_DAY_ROLLOVER_HOUR + offset) % 24,
  );

  let maxSeconds = 0;
  for (const h of orderedHours) {
    const secs = Math.round(hourTotalsMs[h] / 1000);
    if (secs > maxSeconds) {
      maxSeconds = secs;
    }
  }

  let peakBucket: PeakHourBucket | null = null;
  const buckets: PeakHourBucket[] = orderedHours.map((hour) => {
    const seconds = Math.round(hourTotalsMs[hour] / 1000);
    const isPeak = maxSeconds > 0 && seconds === maxSeconds;
    const bucket: PeakHourBucket = {
      hour,
      shortLabel: formatHourShort(hour),
      rangeLabel: formatHourRangeLabel(hour),
      seconds,
      minutes: Math.round(seconds / 60),
      isPeak,
    };
    if (isPeak && !peakBucket) {
      peakBucket = bucket;
    }
    return bucket;
  });

  return { buckets, peakBucket, maxSeconds };
}

/**
 * Computes D-Day countdown days remaining, cumulative study hours logged,
 * and required daily study hours to hit the D-Day target.
 */
export function computeDDayProgress({
  logicalDate,
  dDayGoal,
  sessions,
  activeTimer,
  nowMs = Date.now(),
}: {
  logicalDate: LogicalDate;
  dDayGoal: DDayGoal;
  sessions: readonly StudySession[];
  activeTimer?: ActiveTimerState;
  nowMs?: number;
}): DDayProgress {
  const todayParts = parseLogicalDate(logicalDate);
  const targetParts = parseLogicalDate(dDayGoal.targetDate);

  const todayUtcNoon = Date.UTC(
    todayParts.year,
    todayParts.monthIndex,
    todayParts.day,
    12,
    0,
    0,
  );
  const targetUtcNoon = Date.UTC(
    targetParts.year,
    targetParts.monthIndex,
    targetParts.day,
    12,
    0,
    0,
  );
  const daysRemaining = Math.round(
    (targetUtcNoon - todayUtcNoon) / 86_400_000,
  );

  let badgeText = 'D-Day';
  if (daysRemaining > 0) {
    badgeText = `D-${daysRemaining}`;
  } else if (daysRemaining < 0) {
    badgeText = `D+${Math.abs(daysRemaining)}`;
  }

  const loggedSessionSeconds = sessions.reduce(
    (sum, session) => sum + Math.max(0, session.durationSeconds),
    0,
  );
  const liveSeconds = Math.floor(
    getActiveTimerElapsedMs(activeTimer, nowMs) / 1000,
  );
  const loggedHours = (loggedSessionSeconds + liveSeconds) / 3600;
  const targetHours = Math.max(0, dDayGoal.targetStudyHours);
  const remainingHours = Math.max(0, targetHours - loggedHours);
  const progressRatio = targetHours > 0 ? loggedHours / targetHours : 0;
  const clampedRatio = clampUnitRatio(progressRatio);
  const percentage = Math.round(progressRatio * 100);

  const divisorDays = daysRemaining > 0 ? daysRemaining : 1;
  const requiredDailyHours =
    remainingHours > 0 ? remainingHours / divisorDays : 0;

  return {
    goal: dDayGoal,
    daysRemaining,
    badgeText,
    loggedHours,
    remainingHours,
    progressRatio,
    clampedRatio,
    percentage,
    requiredDailyHours,
    isCompleted: targetHours > 0 && remainingHours <= 0,
    isOverdue: daysRemaining < 0 && remainingHours > 0,
  };
}
