import { describe, expect, it } from 'vitest';
import {
  addDaysToLogicalDate,
  formatDurationCompact,
  formatMinutesCompact,
  getLogicalDayEndTimestamp,
  getLogicalDayStartTimestamp,
  getLogicalStudyDate,
  parseLogicalDate,
  splitSessionByLogicalDay,
} from '../date';

describe('date.ts — 5:00 AM Logical Study Day Engine', () => {
  it('treats timestamps before 5:00 AM local time as the previous logical study date', () => {
    const justAfterMidnight = new Date(2026, 10, 26, 0, 0, 1);
    const beforeRollover = new Date(2026, 10, 26, 4, 59, 59, 999);
    const exactRollover = new Date(2026, 10, 26, 5, 0, 0, 0);
    const lateNight = new Date(2026, 10, 26, 23, 45, 0);

    expect(getLogicalStudyDate(justAfterMidnight)).toBe('2026-11-25');
    expect(getLogicalStudyDate(beforeRollover)).toBe('2026-11-25');
    expect(getLogicalStudyDate(exactRollover)).toBe('2026-11-26');
    expect(getLogicalStudyDate(lateNight)).toBe('2026-11-26');
  });

  it('handles month, leap-year, and year rollovers cleanly before 5:00 AM', () => {
    expect(getLogicalStudyDate(new Date(2026, 2, 1, 3, 30, 0))).toBe(
      '2026-02-28',
    );
    expect(getLogicalStudyDate(new Date(2024, 2, 1, 3, 30, 0))).toBe(
      '2024-02-29',
    );
    expect(getLogicalStudyDate(new Date(2026, 0, 1, 4, 15, 0))).toBe(
      '2025-12-31',
    );
  });

  it('computes local 5:00 AM start/end boundaries and calendar day shifts accurately', () => {
    const start = getLogicalDayStartTimestamp('2026-11-25');
    const end = getLogicalDayEndTimestamp('2026-11-25');

    expect(start).toBe(new Date(2026, 10, 25, 5, 0, 0, 0).getTime());
    expect(end).toBe(new Date(2026, 10, 26, 5, 0, 0, 0).getTime());
    expect(getLogicalStudyDate(end - 1)).toBe('2026-11-25');
    expect(getLogicalStudyDate(end)).toBe('2026-11-26');
    expect(addDaysToLogicalDate('2026-11-25', 1)).toBe('2026-11-26');
    expect(addDaysToLogicalDate('2026-11-25', -1)).toBe('2026-11-24');
  });

  it('keeps sessions crossing midnight but staying before 5:00 AM on a single logical day', () => {
    const start = new Date(2026, 10, 25, 23, 30, 0).getTime();
    const end = new Date(2026, 10, 26, 1, 30, 0).getTime();

    let idSeq = 0;
    const segments = splitSessionByLogicalDay({
      subjectId: 'math',
      startTime: start,
      endTime: end,
      createId: () => `s-${++idSeq}`,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      id: 's-1',
      subjectId: 'math',
      startTime: start,
      endTime: end,
      durationSeconds: 7200,
      logicalDate: '2026-11-25',
    });
  });

  it('splits a study session crossing 5:00 AM cleanly into two logical-day records', () => {
    const start = new Date(2026, 10, 26, 4, 0, 0).getTime();
    const boundary = new Date(2026, 10, 26, 5, 0, 0).getTime();
    const end = new Date(2026, 10, 26, 5, 45, 0).getTime();

    let idSeq = 0;
    const segments = splitSessionByLogicalDay({
      subjectId: 'physics',
      startTime: start,
      endTime: end,
      createId: () => `seg-${++idSeq}`,
    });

    expect(segments).toEqual([
      {
        id: 'seg-1',
        subjectId: 'physics',
        startTime: start,
        endTime: boundary,
        durationSeconds: 3600,
        logicalDate: '2026-11-25',
      },
      {
        id: 'seg-2',
        subjectId: 'physics',
        startTime: boundary,
        endTime: end,
        durationSeconds: 2700,
        logicalDate: '2026-11-26',
      },
    ]);
  });

  it('splits sessions spanning multiple 5:00 AM boundaries and ignores invalid ranges', () => {
    const start = new Date(2026, 10, 26, 4, 0, 0).getTime();
    const end = new Date(2026, 10, 27, 6, 0, 0).getTime();

    let idSeq = 0;
    const segments = splitSessionByLogicalDay({
      subjectId: 'cs',
      startTime: start,
      endTime: end,
      createId: () => `m-${++idSeq}`,
    });

    expect(segments.map((s) => [s.logicalDate, s.durationSeconds])).toEqual([
      ['2026-11-25', 3600],
      ['2026-11-26', 86400],
      ['2026-11-27', 3600],
    ]);

    expect(
      splitSessionByLogicalDay({
        subjectId: 'cs',
        startTime: end,
        endTime: end,
      }),
    ).toEqual([]);
    expect(
      splitSessionByLogicalDay({
        subjectId: 'cs',
        startTime: end,
        endTime: start,
      }),
    ).toEqual([]);
  });

  it('rejects invalid logical date strings and formats durations concisely', () => {
    expect(() => parseLogicalDate('2026-02-30')).toThrow();
    expect(() => parseLogicalDate('not-a-date')).toThrow();

    expect(formatMinutesCompact(0)).toBe('0m');
    expect(formatMinutesCompact(45)).toBe('45m');
    expect(formatMinutesCompact(120)).toBe('2h');
    expect(formatMinutesCompact(135)).toBe('2h 15m');

    expect(formatDurationCompact(0)).toBe('0m');
    expect(formatDurationCompact(25)).toBe('<1m');
    expect(formatDurationCompact(3660)).toBe('1h 1m');
  });
});
