import { describe, expect, it } from 'vitest';
import type {
  ActiveTimerState,
  DDayGoal,
  StudySession,
  Subject,
} from '../../types/domain';
import {
  computeDDayProgress,
  computeDailyTimeline,
  computePeakHours,
  computeSubjectBreakdown,
} from '../focusAnalytics';

const SUBJECTS: Subject[] = [
  {
    id: 'math',
    name: 'Mathematics',
    color: '#f43f5e',
    dailyGoalMinutes: 90,
    archived: false,
    createdAt: 1,
  },
  {
    id: 'cs',
    name: 'Algorithms',
    color: '#0ea5e9',
    dailyGoalMinutes: 60,
    archived: false,
    createdAt: 2,
  },
];

describe('focusAnalytics.ts — Subject Donut, 5:00 AM Timeline, Peak Hours & D-Day', () => {
  it('aggregates subject breakdown across today, 7d, and all-time including live timer', () => {
    const today = '2026-11-26';
    const start1 = new Date(2026, 10, 26, 9, 0, 0).getTime();
    const end1 = new Date(2026, 10, 26, 10, 0, 0).getTime(); // 60m math today
    const startOld = new Date(2026, 10, 10, 14, 0, 0).getTime();
    const endOld = new Date(2026, 10, 10, 15, 0, 0).getTime(); // 60m cs 16 days ago
    const nowMs = new Date(2026, 10, 26, 11, 30, 0).getTime();

    const sessions: StudySession[] = [
      {
        id: 's1',
        subjectId: 'math',
        startTime: start1,
        endTime: end1,
        durationSeconds: 3600,
        logicalDate: today,
      },
      {
        id: 's2',
        subjectId: 'cs',
        startTime: startOld,
        endTime: endOld,
        durationSeconds: 3600,
        logicalDate: '2026-11-10',
      },
    ];

    const activeTimer: ActiveTimerState = {
      subjectId: 'cs',
      mode: 'stopwatch',
      status: 'running',
      segmentStartTime: nowMs - 30 * 60 * 1000,
      accumulatedMs: 0,
      sessionStartTime: nowMs - 30 * 60 * 1000,
    };

    const todayResult = computeSubjectBreakdown({
      logicalDate: today,
      range: 'today',
      subjects: SUBJECTS,
      sessions,
      activeTimer,
      nowMs,
    });

    expect(todayResult.totalSeconds).toBe(5400); // 60m math + 30m live cs
    expect(todayResult.slices.map((s) => [s.subjectId, s.seconds, s.percentage])).toEqual([
      ['math', 3600, 67],
      ['cs', 1800, 33],
    ]);

    const allTimeResult = computeSubjectBreakdown({
      logicalDate: today,
      range: 'all',
      subjects: SUBJECTS,
      sessions,
      activeTimer,
      nowMs,
    });

    expect(allTimeResult.totalSeconds).toBe(9000); // 60m math + 90m cs
    expect(allTimeResult.slices[0].subjectId).toBe('cs');
    expect(allTimeResult.slices[0].seconds).toBe(5400);
  });

  it('positions timeline blocks along the 5:00 AM -> 5:00 AM logical day', () => {
    const today = '2026-11-26';
    // 5:00 AM exact start => fraction 0
    const s1Start = new Date(2026, 10, 26, 5, 0, 0).getTime();
    const s1End = new Date(2026, 10, 26, 11, 0, 0).getTime(); // 6h = 0.25 width
    // 2:00 AM next morning (before 5:00 AM) => 21h after 5am => 0.875 start
    const s2Start = new Date(2026, 10, 27, 2, 0, 0).getTime();
    const s2End = new Date(2026, 10, 27, 3, 12, 0).getTime(); // 1.2h = 0.05 width

    const sessions: StudySession[] = [
      {
        id: 't1',
        subjectId: 'math',
        startTime: s1Start,
        endTime: s1End,
        durationSeconds: 21600,
        logicalDate: today,
      },
      {
        id: 't2',
        subjectId: 'cs',
        startTime: s2Start,
        endTime: s2End,
        durationSeconds: 4320,
        logicalDate: today,
      },
    ];

    const blocks = computeDailyTimeline({
      logicalDate: today,
      subjects: SUBJECTS,
      sessions,
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].startFraction).toBeCloseTo(0, 4);
    expect(blocks[0].widthFraction).toBeCloseTo(0.25, 4);
    expect(blocks[1].startFraction).toBeCloseTo(0.875, 4);
    expect(blocks[1].widthFraction).toBeCloseTo(0.05, 4);
  });

  it('splits cross-hour sessions accurately into 5:00 AM -> 4:00 AM peak hour buckets', () => {
    const today = '2026-11-26';
    // 20:45 to 22:15 => 15m in 8pm (20), 60m in 9pm (21), 15m in 10pm (22)
    const start = new Date(2026, 10, 26, 20, 45, 0).getTime();
    const end = new Date(2026, 10, 26, 22, 15, 0).getTime();

    const sessions: StudySession[] = [
      {
        id: 'p1',
        subjectId: 'math',
        startTime: start,
        endTime: end,
        durationSeconds: 5400,
        logicalDate: today,
      },
    ];

    const peak = computePeakHours({
      logicalDate: today,
      range: 'today',
      sessions,
    });

    expect(peak.buckets[0].hour).toBe(5);
    expect(peak.buckets[23].hour).toBe(4);
    expect(peak.peakBucket?.hour).toBe(21);
    expect(peak.peakBucket?.minutes).toBe(60);

    const bucket20 = peak.buckets.find((b) => b.hour === 20);
    const bucket22 = peak.buckets.find((b) => b.hour === 22);
    expect(bucket20?.minutes).toBe(15);
    expect(bucket22?.minutes).toBe(15);
  });

  it('computes D-Day badge, cumulative hours, and required daily pace', () => {
    const dDayGoal: DDayGoal = {
      id: 'exam',
      title: 'Finals',
      targetDate: '2026-12-06', // 10 days from 2026-11-26
      targetStudyHours: 40,
    };

    const sessions: StudySession[] = [
      {
        id: 'd1',
        subjectId: 'math',
        startTime: 1000,
        endTime: 36001000,
        durationSeconds: 10 * 3600, // 10h logged
        logicalDate: '2026-11-25',
      },
    ];

    const progress = computeDDayProgress({
      logicalDate: '2026-11-26',
      dDayGoal,
      sessions,
    });

    expect(progress.daysRemaining).toBe(10);
    expect(progress.badgeText).toBe('D-10');
    expect(progress.loggedHours).toBeCloseTo(10, 4);
    expect(progress.remainingHours).toBeCloseTo(30, 4);
    expect(progress.percentage).toBe(25);
    expect(progress.requiredDailyHours).toBeCloseTo(3, 4); // 30h / 10 days = 3h/day
  });
});
