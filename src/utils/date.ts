import type { LogicalDate, StudySession } from '../types/domain';

/** Local hour (0-23) when a new UProSC study day begins. */
export const STUDY_DAY_ROLLOVER_HOUR = 5;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats local calendar parts into a `YYYY-MM-DD` LogicalDate string. */
export function formatLocalDateParts(
  year: number,
  monthIndex: number,
  day: number,
): LogicalDate {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

/** Parses and validates a `YYYY-MM-DD` LogicalDate into local calendar parts. */
export function parseLogicalDate(logicalDate: LogicalDate): {
  year: number;
  monthIndex: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalDate);
  if (!match) {
    throw new Error(`Invalid LogicalDate format: "${logicalDate}"`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const check = new Date(year, monthIndex, day, 12, 0, 0, 0);

  if (
    check.getFullYear() !== year ||
    check.getMonth() !== monthIndex ||
    check.getDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${logicalDate}"`);
  }

  return { year, monthIndex, day };
}

/**
 * Returns the logical study date (`YYYY-MM-DD`) anchored at 5:00 AM local time.
 *
 * Timestamps from 00:00:00 up to 04:59:59.999 belong to the previous calendar day.
 * Using local calendar components avoids UTC date shifts caused by `.toISOString()`
 * in non-UTC timezones (such as IST +05:30) and remains accurate across DST shifts.
 */
export function getLogicalStudyDate(
  input: Date | number = Date.now(),
): LogicalDate {
  const localDate =
    input instanceof Date ? new Date(input.getTime()) : new Date(input);

  if (Number.isNaN(localDate.getTime())) {
    throw new Error('Invalid date/timestamp passed to getLogicalStudyDate');
  }

  if (localDate.getHours() < STUDY_DAY_ROLLOVER_HOUR) {
    localDate.setDate(localDate.getDate() - 1);
  }

  return formatLocalDateParts(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
  );
}

/** Shifts a `LogicalDate` by `days` calendar days using local noon to avoid DST midnight shifts. */
export function addDaysToLogicalDate(
  logicalDate: LogicalDate,
  days: number,
): LogicalDate {
  const { year, monthIndex, day } = parseLogicalDate(logicalDate);
  const shifted = new Date(year, monthIndex, day + days, 12, 0, 0, 0);
  return formatLocalDateParts(
    shifted.getFullYear(),
    shifted.getMonth(),
    shifted.getDate(),
  );
}

/** Returns the inclusive 5:00 AM local start timestamp (epoch ms) for a logical study date. */
export function getLogicalDayStartTimestamp(logicalDate: LogicalDate): number {
  const { year, monthIndex, day } = parseLogicalDate(logicalDate);
  return new Date(year, monthIndex, day, STUDY_DAY_ROLLOVER_HOUR, 0, 0, 0).getTime();
}

/** Returns the exclusive 5:00 AM local end timestamp (next day's rollover) for a logical study date. */
export function getLogicalDayEndTimestamp(logicalDate: LogicalDate): number {
  const { year, monthIndex, day } = parseLogicalDate(logicalDate);
  return new Date(
    year,
    monthIndex,
    day + 1,
    STUDY_DAY_ROLLOVER_HOUR,
    0,
    0,
    0,
  ).getTime();
}

function defaultCreateId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface SplitSessionInput {
  subjectId: string;
  startTime: number;
  endTime: number;
  createId?: () => string;
}

/**
 * Splits a study session cleanly at every 5:00 AM local boundary into
 * per-logical-day `StudySession` segments.
 */
export function splitSessionByLogicalDay({
  subjectId,
  startTime,
  endTime,
  createId = defaultCreateId,
}: SplitSessionInput): StudySession[] {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime <= startTime
  ) {
    return [];
  }

  const segments: StudySession[] = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const logicalDate = getLogicalStudyDate(cursor);
    const boundary = getLogicalDayEndTimestamp(logicalDate);
    const segmentEnd = Math.min(endTime, boundary);
    const durationSeconds = Math.round((segmentEnd - cursor) / 1000);

    if (durationSeconds > 0) {
      segments.push({
        id: createId(),
        subjectId,
        startTime: cursor,
        endTime: segmentEnd,
        durationSeconds,
        logicalDate,
      });
    }

    // Defensive forward progress guard
    cursor = segmentEnd > cursor ? segmentEnd : endTime;
  }

  return segments;
}

/** Formats a minute total concisely (e.g. "0m", "45m", "2h", "1h 35m"). */
export function formatMinutesCompact(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  if (safeMinutes < 60) {
    return `${safeMinutes}m`;
  }
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Formats a second total concisely for the header ring readout ("0m", "<1m", "25m", "1h 10m"). */
export function formatDurationCompact(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  if (safeSeconds === 0) {
    return '0m';
  }
  if (safeSeconds < 60) {
    return '<1m';
  }
  return formatMinutesCompact(Math.floor(safeSeconds / 60));
}

/** Formats a `LogicalDate` for readable UI badges (e.g. "Nov 26"). */
export function formatLogicalDateShort(logicalDate: LogicalDate): string {
  const { year, monthIndex, day } = parseLogicalDate(logicalDate);
  const date = new Date(year, monthIndex, day, 12, 0, 0, 0);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}
