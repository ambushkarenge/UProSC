import { useCallback, useEffect, useRef, useState } from 'react';
import { saveActiveTimerMirror } from '../store/idbStorage';
import {
  DEFAULT_COUNTDOWN_DURATION_MS,
  useAppStore,
} from '../store/useAppStore';
import type {
  ActiveTimerState,
  StudySession,
  TimerMode,
} from '../types/domain';
import { getLogicalStudyDate } from '../utils/date';
import { getActiveTimerElapsedMs } from '../utils/score';
import { playChime } from '../utils/sound';

export const COUNTDOWN_PRESET_MINUTES = [25, 50, 90] as const;
export const MIN_COUNTDOWN_MINUTES = 1;
export const MAX_COUNTDOWN_MINUTES = 240;

export interface TimerCompletionNotice {
  subjectId: string | null;
  durationSeconds: number;
  completedAt: number;
  kind: 'countdown' | 'manual';
  goalJustReached: boolean;
}

/** Formats non-negative whole seconds as `MM:SS` or `H:MM:SS`. */
export function formatClockSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function getRawElapsedMs(timer: ActiveTimerState, nowMs: number): number {
  if (timer.status === 'idle') return 0;
  const runningMs =
    timer.status === 'running' && timer.segmentStartTime !== null
      ? Math.max(0, nowMs - timer.segmentStartTime)
      : 0;
  return Math.max(0, timer.accumulatedMs) + runningMs;
}

function computeCappedSegmentEnd(
  timer: ActiveTimerState,
  candidateEndMs: number,
): number {
  if (timer.segmentStartTime === null) return candidateEndMs;
  if (
    timer.mode === 'countdown' &&
    typeof timer.targetDurationMs === 'number' &&
    timer.targetDurationMs > 0
  ) {
    const remainingForSeg = Math.max(
      0,
      timer.targetDurationMs - timer.accumulatedMs,
    );
    return Math.min(candidateEndMs, timer.segmentStartTime + remainingForSeg);
  }
  return candidateEndMs;
}

/**
 * Wall-clock timestamp timer hook supporting count-up stopwatch and countdown
 * Pomodoro/custom blocks persisted across reloads in IndexedDB + localStorage mirror.
 */
export function useTimestampTimer() {
  const activeUserId = useAppStore((state) => state.activeUserId);
  const activeTimer = useAppStore((state) => state.activeTimer);
  const activeTimerUpdatedAt = useAppStore((state) => state.activeTimerUpdatedAt);
  const setActiveTimer = useAppStore((state) => state.setActiveTimer);
  const logStudySession = useAppStore((state) => state.logStudySession);
  const soundEnabled = useAppStore((state) => state.soundEnabled);
  const dailyStudyGoalMinutes = useAppStore(
    (state) => state.dailyStudyGoalMinutes,
  );
  const sessions = useAppStore((state) => state.sessions);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [completionNotice, setCompletionNotice] =
    useState<TimerCompletionNotice | null>(null);
  const autoCompletedSessionRef = useRef<number | null>(null);

  // Clear transient completion alerts & reset auto-complete tracking when switching users
  useEffect(() => {
    autoCompletedSessionRef.current = null;
    setCompletionNotice(null);
    setNowMs(Date.now());
  }, [activeUserId]);

  // Synchronously flush active timer mirror on pagehide/hidden so closing tabs never loses a session
  useEffect(() => {
    const flushTimerMirror = () => {
      saveActiveTimerMirror(activeTimer, activeTimerUpdatedAt, activeUserId);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushTimerMirror();
      }
    };
    window.addEventListener('pagehide', flushTimerMirror);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', flushTimerMirror);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeTimer, activeTimerUpdatedAt, activeUserId]);

  useEffect(() => {
    setNowMs(Date.now());
    if (activeTimer.status !== 'running') {
      return;
    }

    const syncClock = () => setNowMs(Date.now());
    const intervalId = window.setInterval(syncClock, 250);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncClock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', syncClock);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', syncClock);
    };
  }, [activeTimer.status, activeTimer.segmentStartTime]);

  const targetDurationMs =
    activeTimer.targetDurationMs && activeTimer.targetDurationMs > 0
      ? activeTimer.targetDurationMs
      : DEFAULT_COUNTDOWN_DURATION_MS;

  const rawElapsedMs = getRawElapsedMs(activeTimer, nowMs);
  const elapsedMs = getActiveTimerElapsedMs(activeTimer, nowMs);
  const remainingMs =
    activeTimer.mode === 'countdown'
      ? activeTimer.status === 'idle'
        ? targetDurationMs
        : Math.max(0, targetDurationMs - elapsedMs)
      : 0;

  const displaySeconds =
    activeTimer.mode === 'countdown'
      ? Math.ceil(remainingMs / 1000)
      : Math.floor(elapsedMs / 1000);

  const commitTimerSegments = useCallback(
    (timer: ActiveTimerState, endTimestamp: number) => {
      const subjectId = timer.subjectId ?? 'unassigned';
      const intervals: Array<{ startTime: number; endTime: number }> = [];

      if (timer.completedSegments && timer.completedSegments.length > 0) {
        for (const seg of timer.completedSegments) {
          if (seg.endTime > seg.startTime) {
            intervals.push(seg);
          }
        }
      } else if (timer.accumulatedMs > 0) {
        const start =
          timer.sessionStartTime ?? endTimestamp - timer.accumulatedMs;
        intervals.push({
          startTime: start,
          endTime: start + timer.accumulatedMs,
        });
      }

      if (timer.status === 'running' && timer.segmentStartTime !== null) {
        const segEnd = computeCappedSegmentEnd(timer, endTimestamp);
        if (segEnd > timer.segmentStartTime) {
          intervals.push({
            startTime: timer.segmentStartTime,
            endTime: segEnd,
          });
        }
      }

      const todayLogicalDate = getLogicalStudyDate(endTimestamp);
      const beforeTodaySeconds = sessions.reduce(
        (sum, s) =>
          s.logicalDate === todayLogicalDate
            ? sum + Math.max(0, s.durationSeconds)
            : sum,
        0,
      );

      const savedSessions: StudySession[] = [];
      for (const interval of intervals) {
        const segments = logStudySession(
          subjectId,
          interval.startTime,
          interval.endTime,
        );
        savedSessions.push(...segments);
      }

      const totalLoggedSeconds = savedSessions.reduce(
        (sum, s) => sum + s.durationSeconds,
        0,
      );
      const addedTodaySeconds = savedSessions.reduce(
        (sum, s) =>
          s.logicalDate === todayLogicalDate ? sum + s.durationSeconds : sum,
        0,
      );

      const goalSeconds = dailyStudyGoalMinutes * 60;
      const goalJustReached =
        goalSeconds > 0 &&
        beforeTodaySeconds < goalSeconds &&
        beforeTodaySeconds + addedTodaySeconds >= goalSeconds;

      return { savedSessions, totalLoggedSeconds, goalJustReached };
    },
    [dailyStudyGoalMinutes, logStudySession, sessions],
  );

  // Auto-complete countdown timer when wall-clock delta reaches targetDurationMs
  useEffect(() => {
    if (
      activeTimer.status !== 'running' ||
      activeTimer.mode !== 'countdown' ||
      rawElapsedMs < targetDurationMs
    ) {
      return;
    }

    const sessionKey =
      activeTimer.sessionStartTime ?? activeTimer.segmentStartTime ?? nowMs;
    if (autoCompletedSessionRef.current === sessionKey) {
      return;
    }
    autoCompletedSessionRef.current = sessionKey;

    const { totalLoggedSeconds, goalJustReached } = commitTimerSegments(
      activeTimer,
      nowMs,
    );

    setActiveTimer(
      {
        subjectId: activeTimer.subjectId,
        mode: activeTimer.mode,
        status: 'idle',
        segmentStartTime: null,
        accumulatedMs: 0,
        targetDurationMs,
        sessionStartTime: null,
        completedSegments: [],
      },
      nowMs,
    );

    if (soundEnabled) {
      playChime(goalJustReached ? 'celebrate' : 'complete');
    }

    if (totalLoggedSeconds > 0) {
      setCompletionNotice({
        subjectId: activeTimer.subjectId,
        durationSeconds: totalLoggedSeconds,
        completedAt: nowMs,
        kind: 'countdown',
        goalJustReached,
      });
    }
  }, [
    activeTimer,
    commitTimerSegments,
    nowMs,
    rawElapsedMs,
    setActiveTimer,
    soundEnabled,
    targetDurationMs,
  ]);

  const selectSubject = useCallback(
    (subjectId: string | null) => {
      setActiveTimer((prev) =>
        prev.status === 'idle' ? { ...prev, subjectId } : prev,
      );
    },
    [setActiveTimer],
  );

  const setMode = useCallback(
    (mode: TimerMode) => {
      setActiveTimer((prev) =>
        prev.status === 'idle'
          ? {
              ...prev,
              mode,
              targetDurationMs:
                prev.targetDurationMs && prev.targetDurationMs > 0
                  ? prev.targetDurationMs
                  : DEFAULT_COUNTDOWN_DURATION_MS,
            }
          : prev,
      );
    },
    [setActiveTimer],
  );

  const setCountdownMinutes = useCallback(
    (minutes: number) => {
      if (!Number.isFinite(minutes)) return;
      const clamped = Math.min(
        MAX_COUNTDOWN_MINUTES,
        Math.max(MIN_COUNTDOWN_MINUTES, Math.round(minutes)),
      );
      setActiveTimer((prev) =>
        prev.status === 'idle'
          ? { ...prev, targetDurationMs: clamped * 60 * 1000 }
          : prev,
      );
    },
    [setActiveTimer],
  );

  const start = useCallback(
    (override?: {
      subjectId?: string | null;
      mode?: TimerMode;
      countdownMinutes?: number;
    }) => {
      const now = Date.now();
      autoCompletedSessionRef.current = null;
      setCompletionNotice(null);
      setNowMs(now);

      setActiveTimer((prev) => {
        const nextMode = override?.mode ?? prev.mode;
        const nextSubjectId =
          override?.subjectId !== undefined ? override.subjectId : prev.subjectId;
        const nextTargetDurationMs =
          override?.countdownMinutes !== undefined
            ? Math.min(
                MAX_COUNTDOWN_MINUTES,
                Math.max(
                  MIN_COUNTDOWN_MINUTES,
                  Math.round(override.countdownMinutes),
                ),
              ) *
              60 *
              1000
            : prev.targetDurationMs && prev.targetDurationMs > 0
              ? prev.targetDurationMs
              : DEFAULT_COUNTDOWN_DURATION_MS;

        return {
          subjectId: nextSubjectId,
          mode: nextMode,
          status: 'running',
          segmentStartTime: now,
          accumulatedMs: 0,
          targetDurationMs: nextTargetDurationMs,
          sessionStartTime: now,
          completedSegments: [],
        };
      }, now);
    },
    [setActiveTimer],
  );

  const pause = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    setActiveTimer((prev) => {
      if (prev.status !== 'running' || prev.segmentStartTime === null) {
        return prev;
      }
      const segEnd = computeCappedSegmentEnd(prev, now);
      const segmentDelta = Math.max(0, segEnd - prev.segmentStartTime);
      const nextCompleted = [
        ...(prev.completedSegments ?? []),
        ...(segEnd > prev.segmentStartTime
          ? [{ startTime: prev.segmentStartTime, endTime: segEnd }]
          : []),
      ];

      return {
        ...prev,
        status: 'paused',
        segmentStartTime: null,
        accumulatedMs: prev.accumulatedMs + segmentDelta,
        completedSegments: nextCompleted,
      };
    }, now);
  }, [setActiveTimer]);

  const resume = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    setActiveTimer((prev) => {
      if (prev.status !== 'paused') {
        return prev;
      }
      return {
        ...prev,
        status: 'running',
        segmentStartTime: now,
      };
    }, now);
  }, [setActiveTimer]);

  const finishAndSave = useCallback(() => {
    if (activeTimer.status === 'idle') {
      return { savedSessions: [], totalLoggedSeconds: 0 };
    }
    const now = Date.now();
    setNowMs(now);

    const { savedSessions, totalLoggedSeconds, goalJustReached } =
      commitTimerSegments(activeTimer, now);

    setActiveTimer(
      {
        subjectId: activeTimer.subjectId,
        mode: activeTimer.mode,
        status: 'idle',
        segmentStartTime: null,
        accumulatedMs: 0,
        targetDurationMs,
        sessionStartTime: null,
        completedSegments: [],
      },
      now,
    );

    if (totalLoggedSeconds > 0) {
      if (soundEnabled && goalJustReached) {
        playChime('celebrate');
      }
      setCompletionNotice({
        subjectId: activeTimer.subjectId,
        durationSeconds: totalLoggedSeconds,
        completedAt: now,
        kind: 'manual',
        goalJustReached,
      });
    }

    return { savedSessions, totalLoggedSeconds };
  }, [
    activeTimer,
    commitTimerSegments,
    setActiveTimer,
    soundEnabled,
    targetDurationMs,
  ]);

  const discard = useCallback(() => {
    const now = Date.now();
    setNowMs(now);
    autoCompletedSessionRef.current = null;
    setActiveTimer(
      (prev) => ({
        subjectId: prev.subjectId,
        mode: prev.mode,
        status: 'idle',
        segmentStartTime: null,
        accumulatedMs: 0,
        targetDurationMs:
          prev.targetDurationMs && prev.targetDurationMs > 0
            ? prev.targetDurationMs
            : DEFAULT_COUNTDOWN_DURATION_MS,
        sessionStartTime: null,
        completedSegments: [],
      }),
      now,
    );
  }, [setActiveTimer]);

  const dismissCompletionNotice = useCallback(() => {
    setCompletionNotice(null);
  }, []);

  return {
    activeTimer,
    nowMs,
    elapsedMs,
    remainingMs,
    targetDurationMs,
    countdownMinutes: Math.round(targetDurationMs / 60000),
    displaySeconds,
    formattedClock: formatClockSeconds(displaySeconds),
    progressRatio:
      activeTimer.mode === 'countdown' && targetDurationMs > 0
        ? Math.min(1, elapsedMs / targetDurationMs)
        : 0,
    completionNotice,
    dismissCompletionNotice,
    selectSubject,
    setMode,
    setCountdownMinutes,
    start,
    pause,
    resume,
    finishAndSave,
    discard,
  };
}
