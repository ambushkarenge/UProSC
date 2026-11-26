import { describe, expect, it } from 'vitest';
import type {
  ActiveTimerState,
  Habit,
  StudySession,
  TodoTask,
} from '../../types/domain';
import {
  calculateDailyProductivity,
  calculateProductivityScore,
  getActiveTimerSecondsForLogicalDate,
} from '../score';

describe('score.ts — 45/35/20 Productivity Score & Zero-Item Ring Rules', () => {
  it('enforces the 0% zero-item rule when 0 tasks or 0 active habits exist', () => {
    const result = calculateDailyProductivity({
      logicalDate: '2026-11-26',
      dailyStudyGoalMinutes: 120,
      sessions: [],
      tasks: [],
      habits: [],
    });

    expect(result.score).toBe(0);
    expect(result.rings.focus.percentage).toBe(0);
    expect(result.rings.focus.clampedRatio).toBe(0);
    expect(result.rings.todo.percentage).toBe(0);
    expect(result.rings.todo.displayValue).toBe('0/0');
    expect(result.rings.habits.percentage).toBe(0);
    expect(result.rings.habits.displayValue).toBe('0/0');
  });

  it('computes 45% Focus + 35% To-Do + 20% Habits and caps each ring at 100%', () => {
    expect(
      calculateProductivityScore({
        focusRatio: 1,
        todoRatio: 1,
        habitsRatio: 1,
      }),
    ).toBe(100);

    expect(
      calculateProductivityScore({
        focusRatio: 0.5,
        todoRatio: 0.5,
        habitsRatio: 1,
      }),
    ).toBe(60); // 22.5 + 17.5 + 20 = 60

    // Over-achieving focus (200%) with 0 tasks and 0 habits caps focus contribution at 45
    expect(
      calculateProductivityScore({
        focusRatio: 2,
        todoRatio: 0,
        habitsRatio: 0,
      }),
    ).toBe(45);
  });

  it('filters sessions, tasks, and non-archived habits strictly by logical study date', () => {
    const sessions: StudySession[] = [
      {
        id: 's1',
        subjectId: 'math',
        startTime: 1000,
        endTime: 3601000,
        durationSeconds: 3600, // 60m on today
        logicalDate: '2026-11-26',
      },
      {
        id: 's2',
        subjectId: 'math',
        startTime: 0,
        endTime: 7200000,
        durationSeconds: 7200, // yesterday
        logicalDate: '2026-11-25',
      },
    ];

    const tasks: TodoTask[] = [
      {
        id: 't1',
        title: 'Chapter 1',
        logicalDate: '2026-11-26',
        completed: true,
        priority: 'high',
      },
      {
        id: 't2',
        title: 'Chapter 2',
        logicalDate: '2026-11-26',
        completed: false,
        priority: 'medium',
      },
      {
        id: 't3',
        title: 'Yesterday task',
        logicalDate: '2026-11-25',
        completed: true,
        priority: 'low',
      },
    ];

    const habits: Habit[] = [
      {
        id: 'h1',
        name: 'Hydrate',
        icon: 'droplet',
        color: '#0ea5e9',
        archived: false,
        createdAt: 1,
        completedDates: { '2026-11-26': true },
      },
      {
        id: 'h2',
        name: 'Read',
        icon: 'book',
        color: '#22c55e',
        archived: false,
        createdAt: 1,
        completedDates: { '2026-11-25': true },
      },
      {
        id: 'h3',
        name: 'Archived habit',
        icon: 'flame',
        color: '#f97316',
        archived: true,
        createdAt: 1,
        completedDates: {},
      },
    ];

    const summary = calculateDailyProductivity({
      logicalDate: '2026-11-26',
      dailyStudyGoalMinutes: 120,
      sessions,
      tasks,
      habits,
    });

    expect(summary.rings.focus.percentage).toBe(50);
    expect(summary.rings.focus.displayValue).toBe('1h');
    expect(summary.rings.todo.displayValue).toBe('1/2');
    expect(summary.rings.todo.percentage).toBe(50);
    expect(summary.rings.habits.displayValue).toBe('1/2'); // archived h3 excluded
    expect(summary.rings.habits.percentage).toBe(50);
    expect(summary.score).toBe(50); // 22.5 + 17.5 + 10 = 50
  });

  it('includes live active timer progress in Ring 1 and clips across 5:00 AM', () => {
    const startBefore5Am = new Date(2026, 10, 26, 4, 45, 0).getTime();
    const nowAfter5Am = new Date(2026, 10, 26, 5, 15, 0).getTime();

    const activeTimer: ActiveTimerState = {
      subjectId: 'math',
      mode: 'stopwatch',
      status: 'running',
      segmentStartTime: startBefore5Am,
      accumulatedMs: 0,
      sessionStartTime: startBefore5Am,
    };

    expect(
      getActiveTimerSecondsForLogicalDate(
        activeTimer,
        '2026-11-25',
        nowAfter5Am,
      ),
    ).toBe(900); // 15m before 5:00 AM
    expect(
      getActiveTimerSecondsForLogicalDate(
        activeTimer,
        '2026-11-26',
        nowAfter5Am,
      ),
    ).toBe(900); // 15m after 5:00 AM

    const todaySummary = calculateDailyProductivity({
      logicalDate: '2026-11-26',
      dailyStudyGoalMinutes: 60,
      sessions: [],
      tasks: [],
      habits: [],
      activeTimer,
      nowMs: nowAfter5Am,
    });

    expect(todaySummary.rings.focus.displayValue).toBe('15m');
    expect(todaySummary.rings.focus.percentage).toBe(25);
    expect(todaySummary.score).toBe(11); // round(0.25 * 45) = 11
  });

  it('uses completedSegments across pause/resume cycles and caps countdown overrun', () => {
    const seg1Start = new Date(2026, 10, 26, 4, 40, 0).getTime();
    const seg1End = new Date(2026, 10, 26, 4, 55, 0).getTime(); // 15m on Nov 25
    const seg2Start = new Date(2026, 10, 26, 5, 10, 0).getTime();
    const nowMs = new Date(2026, 10, 26, 6, 0, 0).getTime(); // 50m elapsed in seg2, but 25m countdown target!

    const activeTimer: ActiveTimerState = {
      subjectId: 'math',
      mode: 'countdown',
      status: 'running',
      segmentStartTime: seg2Start,
      accumulatedMs: 15 * 60 * 1000,
      targetDurationMs: 25 * 60 * 1000, // only 10m left for seg2
      sessionStartTime: seg1Start,
      completedSegments: [{ startTime: seg1Start, endTime: seg1End }],
    };

    expect(
      getActiveTimerSecondsForLogicalDate(activeTimer, '2026-11-25', nowMs),
    ).toBe(900); // 15m
    expect(
      getActiveTimerSecondsForLogicalDate(activeTimer, '2026-11-26', nowMs),
    ).toBe(600); // capped at remaining 10m
  });
});
