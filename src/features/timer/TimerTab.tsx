import { useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Hourglass,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Timer as TimerIcon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  COUNTDOWN_PRESET_MINUTES,
  MAX_COUNTDOWN_MINUTES,
  MIN_COUNTDOWN_MINUTES,
  useTimestampTimer,
} from '../../hooks/useTimestampTimer';
import { useAppStore } from '../../store/useAppStore';
import {
  formatDurationCompact,
  formatLogicalDateShort,
  getLogicalStudyDate,
} from '../../utils/date';
import {
  calculateDailyProductivity,
  getActiveTimerSecondsForLogicalDate,
} from '../../utils/score';
import { BehavioralCompanion } from './BehavioralCompanion';
import { DDayTracker } from './DDayTracker';
import { FocusAnalytics } from './FocusAnalytics';
import { FullScreenClock } from './FullScreenClock';
import { SubjectManager } from './SubjectManager';

/**
 * Tab 1: Focus Timer, Subject Manager, D-Day Tracker, Behavioral Companion,
 * Full-Screen Wake Lock Clock, and SVG Focus Analytics.
 */
export function TimerTab() {
  const subjects = useAppStore((state) => state.subjects);
  const sessions = useAppStore((state) => state.sessions);
  const tasks = useAppStore((state) => state.tasks);
  const habits = useAppStore((state) => state.habits);
  const dailyStudyGoalMinutes = useAppStore(
    (state) => state.dailyStudyGoalMinutes,
  );
  const soundEnabled = useAppStore((state) => state.soundEnabled);
  const setSoundEnabled = useAppStore((state) => state.setSoundEnabled);

  const timer = useTimestampTimer();
  const [fullScreenOpen, setFullScreenOpen] = useState(false);

  const {
    activeTimer,
    nowMs,
    formattedClock,
    countdownMinutes,
    progressRatio,
    completionNotice,
  } = timer;

  const logicalDate = getLogicalStudyDate(nowMs);
  const activeSubjects = useMemo(
    () => subjects.filter((subject) => !subject.archived),
    [subjects],
  );
  const activeSubject = useMemo(
    () =>
      subjects.find((subject) => subject.id === activeTimer.subjectId) ?? null,
    [activeTimer.subjectId, subjects],
  );

  const liveSecondsToday = useMemo(
    () => getActiveTimerSecondsForLogicalDate(activeTimer, logicalDate, nowMs),
    [activeTimer, logicalDate, nowMs],
  );

  const dailyProductivity = useMemo(
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
      activeTimer,
      dailyStudyGoalMinutes,
      habits,
      logicalDate,
      nowMs,
      sessions,
      tasks,
    ],
  );

  const isIdle = activeTimer.status === 'idle';
  const isRunning = activeTimer.status === 'running';
  const isPaused = activeTimer.status === 'paused';

  const openFullScreen = () => {
    setFullScreenOpen(true);
    try {
      const rootEl = document.documentElement;
      if (typeof rootEl.requestFullscreen === 'function' && !document.fullscreenElement) {
        void rootEl.requestFullscreen().catch(() => {});
      }
    } catch {
      // iOS Safari and sandboxed contexts smoothly use CSS fixed inset-0 fallback
    }
  };

  const closeFullScreen = () => {
    setFullScreenOpen(false);
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Ignore fullscreen exit errors
    }
  };

  const handleQuickSprint = (minutes: number) => {
    const fallbackSubjectId =
      activeTimer.subjectId ?? activeSubjects[0]?.id ?? null;
    timer.start({
      subjectId: fallbackSubjectId,
      mode: 'countdown',
      countdownMinutes: minutes,
    });
  };

  const noticeSubjectName = completionNotice?.subjectId
    ? (subjects.find((s) => s.id === completionNotice.subjectId)?.name ??
      'General Focus')
    : 'General Focus';

  return (
    <div className="space-y-4">
      {/* Workspace Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-slate-200/80 bg-white px-5 py-4 shadow-xs dark:border-slate-800 dark:bg-slate-900/70">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300">
            <TimerIcon className="h-3 w-3" aria-hidden="true" />
            Timer Workspace
          </span>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
            Focus Timer &amp; Study Analytics
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Study Day: {formatLogicalDateShort(logicalDate)}
          </span>
          <span
            data-testid="timer-status-pill"
            className={`rounded-full px-3 py-1 font-semibold ${
              isRunning
                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                : isPaused
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            }`}
          >
            {isRunning ? 'Focusing' : isPaused ? 'Paused' : 'Ready'}
          </span>
        </div>
      </div>

      {/* Completion Notification Banner */}
      {completionNotice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-300/90 bg-emerald-50 px-4 py-3 text-xs text-emerald-950 shadow-xs dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="font-semibold">
              {completionNotice.goalJustReached
                ? `Goal hit! Logged ${formatDurationCompact(completionNotice.durationSeconds)} to ${noticeSubjectName} — Ring 1 closed!`
                : `Saved ${formatDurationCompact(completionNotice.durationSeconds)} focus session to ${noticeSubjectName}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={timer.dismissCompletionNotice}
            aria-label="Dismiss completion message"
            className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-200/60 dark:text-emerald-300 dark:hover:bg-emerald-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Main Two-Column Responsive Grid */}
      <div className="grid gap-4 lg:grid-cols-12 lg:items-start">
        {/* Primary Focus Column */}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          {/* Hero Timer Card */}
          <section
            aria-label="Focus timer"
            className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6 dark:border-slate-800 dark:bg-slate-900/70"
          >
            {/* Top Controls: Mode Switcher + Sound + Full-Screen */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                role="group"
                aria-label="Timer mode"
                className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-950"
              >
                <button
                  type="button"
                  disabled={!isIdle}
                  onClick={() => timer.setMode('stopwatch')}
                  aria-pressed={activeTimer.mode === 'stopwatch'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                    activeTimer.mode === 'stopwatch'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Stopwatch
                </button>
                <button
                  type="button"
                  disabled={!isIdle}
                  onClick={() => timer.setMode('countdown')}
                  aria-pressed={activeTimer.mode === 'countdown'}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                    activeTimer.mode === 'countdown'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <Hourglass className="h-3.5 w-3.5" aria-hidden="true" />
                  Countdown
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  aria-label={
                    soundEnabled ? 'Mute completion chime' : 'Unmute completion chime'
                  }
                  aria-pressed={soundEnabled}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {soundEnabled ? (
                    <Volume2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <VolumeX className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={openFullScreen}
                  aria-label="Open full-screen focus clock"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Full-Screen</span>
                </button>
              </div>
            </div>

            {/* Countdown Presets & Custom Block Duration */}
            {activeTimer.mode === 'countdown' && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {COUNTDOWN_PRESET_MINUTES.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={!isIdle}
                    onClick={() => timer.setCountdownMinutes(preset)}
                    className={`rounded-xl px-3 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                      countdownMinutes === preset
                        ? 'bg-rose-600 text-white shadow-xs'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {preset}m
                  </button>
                ))}

                <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  <span>Custom</span>
                  <input
                    type="number"
                    aria-label="Custom countdown minutes"
                    disabled={!isIdle}
                    min={MIN_COUNTDOWN_MINUTES}
                    max={MAX_COUNTDOWN_MINUTES}
                    value={countdownMinutes}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val) && val >= 1) {
                        timer.setCountdownMinutes(val);
                      }
                    }}
                    className="w-12 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-slate-900 focus:border-rose-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <span>m</span>
                </label>
              </div>
            )}

            {/* Subject Quick-Select Pills */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                disabled={!isIdle}
                onClick={() => timer.selectSubject(null)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-70 ${
                  activeTimer.subjectId === null
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                    : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                General Focus
              </button>

              {activeSubjects.map((subject) => {
                const selected = activeTimer.subjectId === subject.id;
                return (
                  <button
                    key={subject.id}
                    type="button"
                    disabled={!isIdle}
                    onClick={() => timer.selectSubject(subject.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition disabled:opacity-70 ${
                      selected
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950'
                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: subject.color }}
                    />
                    {subject.name}
                  </button>
                );
              })}
            </div>

            {/* Wall-Clock Readout */}
            <div className="my-6 flex flex-col items-center text-center [@media(orientation:landscape)_and_(max-height:500px)]:my-3">
              <div
                data-testid="timer-clock-readout"
                className="tabular-nums text-5xl font-extrabold tracking-tight text-slate-950 sm:text-6xl dark:text-white"
              >
                {formattedClock}
              </div>

              <p className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                {activeSubject ? activeSubject.name : 'General Focus'} ·{' '}
                {dailyProductivity.rings.focus.detailText}
              </p>

              {activeTimer.mode === 'countdown' && (
                <div className="mt-3 h-2 w-64 max-w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-rose-500 transition-[width] duration-300"
                    style={{ width: `${Math.round(progressRatio * 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Primary Transport Controls */}
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {isIdle && (
                <button
                  type="button"
                  onClick={() => timer.start()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-rose-500 active:scale-[0.98]"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Start Focus
                </button>
              )}

              {isRunning && (
                <button
                  type="button"
                  onClick={timer.pause}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-900 shadow-xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-800"
                >
                  <Pause className="h-4 w-4" aria-hidden="true" />
                  Pause
                </button>
              )}

              {isPaused && (
                <button
                  type="button"
                  onClick={timer.resume}
                  className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-rose-500"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Resume
                </button>
              )}

              {!isIdle && (
                <>
                  <button
                    type="button"
                    onClick={timer.finishAndSave}
                    className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-500"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Finish &amp; Save
                  </button>
                  <button
                    type="button"
                    onClick={timer.discard}
                    aria-label="Discard active session"
                    className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Discard
                  </button>
                </>
              )}
            </div>
          </section>

          {/* Behavioral Companion */}
          <BehavioralCompanion
            logicalDate={logicalDate}
            nowMs={nowMs}
            isTimerRunning={isRunning}
            onQuickSprint={handleQuickSprint}
          />

          {/* Subject Manager */}
          <SubjectManager
            selectedSubjectId={activeTimer.subjectId}
            onSelectSubject={timer.selectSubject}
            todayLogicalDate={logicalDate}
            liveSubjectId={activeTimer.subjectId}
            liveSecondsToday={liveSecondsToday}
            isTimerActive={!isIdle}
          />
        </div>

        {/* Analytics & D-Day Column */}
        <div className="min-w-0 space-y-4 lg:col-span-5">
          <DDayTracker logicalDate={logicalDate} nowMs={nowMs} />
          <FocusAnalytics logicalDate={logicalDate} nowMs={nowMs} />
        </div>
      </div>

      <FullScreenClock
        isOpen={fullScreenOpen}
        onClose={closeFullScreen}
        timer={timer}
        activeSubject={activeSubject}
        focusRing={dailyProductivity.rings.focus}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
      />
    </div>
  );
}
