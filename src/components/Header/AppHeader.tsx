import { useEffect, useMemo, useRef, useState } from 'react';
import { Grip, Minus, Plus, Sparkles, X } from 'lucide-react';
import {
  DEFAULT_DAILY_STUDY_GOAL_MINUTES,
  MAX_DAILY_STUDY_GOAL_MINUTES,
  MIN_DAILY_STUDY_GOAL_MINUTES,
  useAppStore,
} from '../../store/useAppStore';
import {
  formatLogicalDateShort,
  formatMinutesCompact,
  getLogicalStudyDate,
} from '../../utils/date';
import {
  calculateDailyProductivity,
  PRODUCTIVITY_SCORE_WEIGHTS,
} from '../../utils/score';
import { ActivityRing, ConcentricActivityRings } from './ActivityRing';

const GOAL_PRESET_MINUTES = [60, 120, 240, 360] as const;
const LONG_PRESS_DURATION_MS = 420;
const HOVER_CLOSE_DELAY_MS = 140;

/**
 * Persistent top header holding the brand mark, live interactive 3-Ring
 * progress gauge + breakdown popover, Productivity Score, and 9-dot Launcher.
 */
export function AppHeader() {
  const dailyStudyGoalMinutes = useAppStore(
    (state) => state.dailyStudyGoalMinutes,
  );
  const setDailyStudyGoalMinutes = useAppStore(
    (state) => state.setDailyStudyGoalMinutes,
  );
  const sessions = useAppStore((state) => state.sessions);
  const tasks = useAppStore((state) => state.tasks);
  const habits = useAppStore((state) => state.habits);
  const activeTimer = useAppStore((state) => state.activeTimer);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [ringsPinnedOpen, setRingsPinnedOpen] = useState(false);
  const [ringsHoverOpen, setRingsHoverOpen] = useState(false);

  const ringsContainerRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const longPressOpenedRef = useRef(false);
  const lastTouchTimestampRef = useRef(0);

  const ringsOpen = ringsPinnedOpen || ringsHoverOpen;

  // Keep logical study date and live running timer progress accurate across time & 5:00 AM rollover
  useEffect(() => {
    const syncClock = () => setNowMs(Date.now());
    syncClock();
    const intervalMs = activeTimer.status === 'running' ? 1000 : 30000;
    const intervalId = window.setInterval(syncClock, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncClock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTimer.status]);

  // Dismiss open popovers on Escape or outside click/tap
  useEffect(() => {
    if (!launcherOpen && !ringsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLauncherOpen(false);
        setRingsPinnedOpen(false);
        setRingsHoverOpen(false);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        launcherOpen &&
        launcherRef.current &&
        !launcherRef.current.contains(target)
      ) {
        setLauncherOpen(false);
      }
      if (
        ringsOpen &&
        ringsContainerRef.current &&
        !ringsContainerRef.current.contains(target)
      ) {
        setRingsPinnedOpen(false);
        setRingsHoverOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [launcherOpen, ringsOpen]);

  // Cleanup any pending hover/long-press timers on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      if (hoverCloseTimerRef.current !== null) {
        window.clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  const logicalDate = getLogicalStudyDate(nowMs);
  const shortStudyDate = formatLogicalDateShort(logicalDate);

  const productivity = useMemo(
    () =>
      calculateDailyProductivity({
        logicalDate,
        dailyStudyGoalMinutes,
        sessions,
        tasks,
        habits,
        activeTimer,
        nowMs,
      }),
    [
      logicalDate,
      dailyStudyGoalMinutes,
      sessions,
      tasks,
      habits,
      activeTimer,
      nowMs,
    ],
  );

  const ringList = [
    {
      metric: productivity.rings.focus,
      weight: PRODUCTIVITY_SCORE_WEIGHTS.focus,
      colorClass: 'text-rose-500',
      badgeClass:
        'bg-rose-500/10 text-rose-700 dark:text-rose-300',
    },
    {
      metric: productivity.rings.todo,
      weight: PRODUCTIVITY_SCORE_WEIGHTS.todo,
      colorClass: 'text-emerald-500',
      badgeClass:
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    },
    {
      metric: productivity.rings.habits,
      weight: PRODUCTIVITY_SCORE_WEIGHTS.habits,
      colorClass: 'text-sky-500',
      badgeClass:
        'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    },
  ] as const;

  const cancelHoverClose = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleRingsMouseEnter = () => {
    if (Date.now() - lastTouchTimestampRef.current < 700) {
      return;
    }
    cancelHoverClose();
    setLauncherOpen(false);
    setRingsHoverOpen(true);
  };

  const handleRingsMouseLeave = () => {
    if (Date.now() - lastTouchTimestampRef.current < 700) {
      return;
    }
    cancelHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setRingsHoverOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };

  const handleRingsPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType === 'mouse') return;
    lastTouchTimestampRef.current = Date.now();
    longPressOpenedRef.current = false;
    clearLongPressTimer();

    longPressTimerRef.current = window.setTimeout(() => {
      longPressOpenedRef.current = true;
      setLauncherOpen(false);
      setRingsPinnedOpen(true);
    }, LONG_PRESS_DURATION_MS);
  };

  const handleRingsPointerEnd = (
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.pointerType === 'mouse') return;
    lastTouchTimestampRef.current = Date.now();
    clearLongPressTimer();
  };

  const handleRingsClick = () => {
    if (longPressOpenedRef.current) {
      longPressOpenedRef.current = false;
      return;
    }
    setLauncherOpen(false);
    setRingsHoverOpen(false);
    setRingsPinnedOpen((open) => !open);
  };

  const closeRingsPopover = () => {
    cancelHoverClose();
    setRingsPinnedOpen(false);
    setRingsHoverOpen(false);
  };

  const toggleLauncher = () => {
    closeRingsPopover();
    setLauncherOpen((open) => !open);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85">
      <div className="relative mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:gap-3 [@media(orientation:landscape)_and_(max-height:500px)]:py-1.5">
        {/* Brand Identity */}
        <div className="flex items-center gap-2.5">
          <img
            src="/icons/icon.svg"
            alt=""
            className="h-9 w-9 rounded-xl shadow-sm ring-1 ring-slate-200 dark:ring-slate-800"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                UProSC
              </span>
              <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 sm:inline-block dark:bg-slate-800 dark:text-slate-300">
                PWA
              </span>
            </div>
            <p
              className="text-[11px] text-slate-500 sm:text-xs dark:text-slate-400"
              title={`Logical study day (5:00 AM rollover): ${logicalDate}`}
            >
              <span className="hidden sm:inline">5:00 AM Day · </span>
              {shortStudyDate}
            </p>
          </div>
        </div>

        {/* Interactive 3-Ring Summary Pill + Popover */}
        <div
          ref={ringsContainerRef}
          onMouseEnter={handleRingsMouseEnter}
          onMouseLeave={handleRingsMouseLeave}
          className="flex items-center"
        >
          <button
            type="button"
            onClick={handleRingsClick}
            onPointerDown={handleRingsPointerDown}
            onPointerUp={handleRingsPointerEnd}
            onPointerCancel={handleRingsPointerEnd}
            aria-label="Daily activity rings summary"
            aria-expanded={ringsOpen}
            aria-controls="rings-breakdown-popover"
            className={`flex select-none items-center gap-3 rounded-2xl border px-3 py-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 active:scale-[0.98] ${
              ringsOpen
                ? 'border-sky-300 bg-white shadow-sm dark:border-sky-700 dark:bg-slate-900'
                : 'border-slate-200/80 bg-slate-100/75 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:bg-slate-900'
            }`}
          >
            <ConcentricActivityRings
              focusRatio={productivity.rings.focus.ratio}
              todoRatio={productivity.rings.todo.ratio}
              habitsRatio={productivity.rings.habits.ratio}
            />

            <div className="hidden items-center gap-3 sm:flex">
              {ringList.map(({ metric }) => (
                <div key={metric.key} className="flex flex-col leading-tight">
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    {metric.label}
                  </span>
                  <span className="tabular-nums text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {metric.displayValue}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-baseline gap-1 border-l border-slate-200 pl-2.5 dark:border-slate-700">
              <span
                data-testid="productivity-score-value"
                className="tabular-nums text-sm font-bold text-slate-900 dark:text-white"
              >
                {productivity.score}
              </span>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                /100
              </span>
            </div>
          </button>

          {ringsOpen && (
            <div
              id="rings-breakdown-popover"
              role="dialog"
              aria-label="Daily activity rings breakdown"
              className="absolute left-1/2 top-full z-40 mt-2 w-[min(23rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[calc(100dvh-4.5rem)] dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Daily Rings &amp; Score
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Study Day {logicalDate} · 5:00 AM rollover
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-900 dark:bg-slate-800 dark:text-white">
                    {productivity.score}/100
                  </span>
                  <button
                    type="button"
                    onClick={closeRingsPopover}
                    aria-label="Close rings breakdown"
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2.5">
                {ringList.map(({ metric, weight, colorClass, badgeClass }) => (
                  <div
                    key={metric.key}
                    className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-2.5 dark:border-slate-800 dark:bg-slate-950/60"
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5">
                        <ActivityRing
                          ringKey={metric.key}
                          label={metric.label}
                          ratio={metric.ratio}
                          colorClass={colorClass}
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">
                              {metric.label}
                            </span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass}`}
                            >
                              {weight}% weight
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            {metric.detailText}
                          </p>
                        </div>
                      </div>
                      <span className="tabular-nums text-xs font-bold text-slate-900 dark:text-white">
                        {metric.percentage}%
                      </span>
                    </div>

                    {metric.key === 'focus' && (
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 dark:border-slate-800">
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          Daily Goal:{' '}
                          <strong className="tabular-nums text-slate-800 dark:text-slate-200">
                            {formatMinutesCompact(
                              dailyStudyGoalMinutes ||
                                DEFAULT_DAILY_STUDY_GOAL_MINUTES,
                            )}
                          </strong>
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Decrease daily study goal"
                            disabled={
                              dailyStudyGoalMinutes <=
                              MIN_DAILY_STUDY_GOAL_MINUTES
                            }
                            onClick={() =>
                              setDailyStudyGoalMinutes(
                                dailyStudyGoalMinutes - 15,
                              )
                            }
                            className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Minus className="h-3 w-3" aria-hidden="true" />
                          </button>
                          {GOAL_PRESET_MINUTES.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setDailyStudyGoalMinutes(preset)}
                              className={`rounded-lg px-2 py-0.5 text-[11px] font-semibold transition ${
                                dailyStudyGoalMinutes === preset
                                  ? 'bg-rose-500 text-white'
                                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'
                              }`}
                            >
                              {formatMinutesCompact(preset)}
                            </button>
                          ))}
                          <button
                            type="button"
                            aria-label="Increase daily study goal"
                            disabled={
                              dailyStudyGoalMinutes >=
                              MAX_DAILY_STUDY_GOAL_MINUTES
                            }
                            onClick={() =>
                              setDailyStudyGoalMinutes(
                                dailyStudyGoalMinutes + 15,
                              )
                            }
                            className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Score weights: 45% Focus + 35% To-Do + 20% Habits (each ring
                capped at 100%). Changes save offline in IndexedDB.
              </p>
            </div>
          )}
        </div>

        {/* 9-Dot App Launcher */}
        <div ref={launcherRef} className="relative">
          <button
            type="button"
            onClick={toggleLauncher}
            aria-label="Open app launcher"
            aria-expanded={launcherOpen}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-700 shadow-xs transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 active:scale-95 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Grip className="h-5 w-5" aria-hidden="true" />
            <kbd className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 sm:inline-block dark:bg-slate-800 dark:text-slate-400">
              ⌘K
            </kbd>
          </button>

          {launcherOpen && (
            <div
              role="dialog"
              aria-label="Sub-App Launcher preview"
              className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[calc(100dvh-4.5rem)] dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Sub-Apps Launcher
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setLauncherOpen(false)}
                  aria-label="Close app launcher"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Modular sub-apps like Ambient Focus Audio and JSON Backup/Sync
                will open here in Phase 6 on top of your active tab without
                interrupting a running timer.
              </p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
