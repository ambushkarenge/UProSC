import { describe, expect, it } from 'vitest';
import type { ActiveTimerState, StudySession } from '../../types/domain';
import { computeStudyStreak, deriveBehavioralInsight } from '../behavioral';

function makeSession(
  id: string,
  logicalDate: string,
  durationSeconds: number,
): StudySession {
  return {
    id,
    subjectId: 'math',
    startTime: 1000,
    endTime: 1000 + durationSeconds * 1000,
    durationSeconds,
    logicalDate,
  };
}

describe('behavioral.ts — Focus Streaks & Behavioral Companion', () => {
  it('preserves yesterday streak without morning false-zero reset and flags streak-at-risk', () => {
    const sessions: StudySession[] = [
      makeSession('s1', '2026-11-23', 1800),
      makeSession('s2', '2026-11-24', 1800),
      makeSession('s3', '2026-11-25', 1800),
    ];

    const morningNow = new Date(2026, 10, 26, 8, 30, 0).getTime();
    const streak = computeStudyStreak({
      logicalDate: '2026-11-26',
      sessions,
      nowMs: morningNow,
    });

    expect(streak.currentStreakDays).toBe(3);
    expect(streak.bestStreakDays).toBe(3);
    expect(streak.todayLockedIn).toBe(false);
    expect(streak.streakAtRisk).toBe(true);

    // Late at 11:00 PM with 6h left before 5:00 AM rollover => urgent streak-at-risk nudge
    const lateEveningNow = new Date(2026, 10, 26, 23, 0, 0).getTime();
    const insight = deriveBehavioralInsight({
      logicalDate: '2026-11-26',
      dailyStudyGoalMinutes: 120,
      sessions,
      nowMs: lateEveningNow,
    });

    expect(insight.status).toBe('streak_at_risk');
    expect(insight.tone).toBe('warning');
    expect(insight.title).toContain('3-Day Streak At Risk');
    expect(insight.hoursUntilRollover).toBeCloseTo(6, 2);
  });

  it('locks in today streak and celebrates when daily study goal is achieved', () => {
    const sessions: StudySession[] = [
      makeSession('s1', '2026-11-25', 3600),
      makeSession('s2', '2026-11-26', 8400), // 140m vs 120m goal
    ];

    const nowMs = new Date(2026, 10, 26, 19, 0, 0).getTime();
    const insight = deriveBehavioralInsight({
      logicalDate: '2026-11-26',
      dailyStudyGoalMinutes: 120,
      sessions,
      nowMs,
    });

    expect(insight.status).toBe('goal_achieved');
    expect(insight.tone).toBe('positive');
    expect(insight.streak.currentStreakDays).toBe(2);
    expect(insight.streak.todayLockedIn).toBe(true);
    expect(insight.streak.streakAtRisk).toBe(false);
    expect(insight.title).toContain('Overdrive Mode');
  });

  it('surfaces active_flow state when timer is currently running', () => {
    const nowMs = new Date(2026, 10, 26, 15, 0, 0).getTime();
    const activeTimer: ActiveTimerState = {
      subjectId: 'math',
      mode: 'countdown',
      status: 'running',
      segmentStartTime: nowMs - 15 * 60 * 1000,
      accumulatedMs: 0,
      targetDurationMs: 25 * 60 * 1000,
      sessionStartTime: nowMs - 15 * 60 * 1000,
    };

    const insight = deriveBehavioralInsight({
      logicalDate: '2026-11-26',
      dailyStudyGoalMinutes: 60,
      sessions: [],
      activeTimer,
      nowMs,
    });

    expect(insight.status).toBe('active_flow');
    expect(insight.tone).toBe('active');
    expect(insight.todayMinutes).toBe(15);
    expect(insight.message).toContain('45m more today');
  });
});
