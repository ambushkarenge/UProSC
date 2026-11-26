import { useEffect } from 'react';
import {
  Check,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useWakeLock } from '../../hooks/useWakeLock';
import type { useTimestampTimer } from '../../hooks/useTimestampTimer';
import type { RingMetric, Subject } from '../../types/domain';

interface FullScreenClockProps {
  isOpen: boolean;
  onClose: () => void;
  timer: ReturnType<typeof useTimestampTimer>;
  activeSubject: Subject | null;
  focusRing: RingMetric;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

/**
 * Full-Screen distraction-free focus clock combining the Screen Wake Lock API
 * (with visibility re-acquisition) and a CSS `fixed inset-0` fallback for iOS Safari.
 */
export function FullScreenClock({
  isOpen,
  onClose,
  timer,
  activeSubject,
  focusRing,
  soundEnabled,
  onToggleSound,
}: FullScreenClockProps) {
  const wakeLock = useWakeLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const { activeTimer, formattedClock, progressRatio } = timer;
  const isIdle = activeTimer.status === 'idle';
  const isRunning = activeTimer.status === 'running';
  const isPaused = activeTimer.status === 'paused';

  const wakeLabel =
    wakeLock.status === 'active'
      ? 'Screen Awake'
      : wakeLock.status === 'unsupported'
        ? 'CSS Full-Screen'
        : 'Wake Lock Standby';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Full-screen focus clock"
      className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-50 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] text-slate-900 dark:bg-slate-950 dark:text-slate-50"
    >
      {/* Top Bar */}
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-xs dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: activeSubject?.color ?? '#f43f5e' }}
            />
            {activeSubject?.name ?? 'General Focus'}
          </span>

          <span
            data-testid="wakelock-status-badge"
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              wakeLock.status === 'active'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : 'bg-slate-200/80 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {wakeLabel}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleSound}
            aria-label={soundEnabled ? 'Mute chime' : 'Enable chime'}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Exit full-screen clock"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
            <span>Exit</span>
          </button>
        </div>
      </div>

      {/* Main Clock & Controls (adapts horizontally in short mobile landscape) */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 [@media(orientation:landscape)_and_(max-height:500px)]:flex-row [@media(orientation:landscape)_and_(max-height:500px)]:justify-around [@media(orientation:landscape)_and_(max-height:500px)]:gap-4">
        <div className="flex flex-col items-center text-center">
          <span className="rounded-full bg-rose-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
            {activeTimer.mode === 'countdown'
              ? `Countdown · ${timer.countdownMinutes}m`
              : 'Stopwatch'}
            {isRunning ? ' · Running' : isPaused ? ' · Paused' : ' · Ready'}
          </span>

          <div
            data-testid="fullscreen-clock-readout"
            className="tabular-nums mt-4 text-6xl font-extrabold tracking-tight text-slate-950 sm:text-8xl [@media(orientation:landscape)_and_(max-height:500px)]:mt-2 [@media(orientation:landscape)_and_(max-height:500px)]:text-5xl dark:text-white"
          >
            {formattedClock}
          </div>

          {activeTimer.mode === 'countdown' && (
            <div className="mt-4 h-2 w-60 max-w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-rose-500 transition-[width] duration-300"
                style={{ width: `${Math.round(progressRatio * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {isIdle && (
            <button
              type="button"
              onClick={() => timer.start()}
              className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-6 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-rose-500 active:scale-[0.98]"
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
              className="inline-flex items-center gap-2 rounded-2xl bg-rose-600 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-rose-500"
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
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-md transition hover:bg-emerald-500"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Finish &amp; Save
              </button>
              <button
                type="button"
                onClick={timer.discard}
                aria-label="Discard active session"
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Discard
              </button>
            </>
          )}
        </div>
      </div>

      {/* Footer Daily Goal Strip */}
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center text-xs font-medium text-slate-500 dark:text-slate-400">
        Ring 1 Today: {focusRing.detailText}
      </div>
    </div>
  );
}
