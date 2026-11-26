import { useMemo, useState } from 'react';
import { CalendarClock, Check, Pencil, Plus, Target, Trash2, X } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { LogicalDate } from '../../types/domain';
import { addDaysToLogicalDate, formatLogicalDateShort } from '../../utils/date';
import { computeDDayProgress } from '../../utils/focusAnalytics';

interface DDayTrackerProps {
  logicalDate: LogicalDate;
  nowMs: number;
}

/**
 * D-Day Goal & Cumulative Study Hours tracker showing days remaining,
 * cumulative focus progress, and required daily study pace.
 */
export function DDayTracker({ logicalDate, nowMs }: DDayTrackerProps) {
  const dDayGoal = useAppStore((state) => state.dDayGoal);
  const setDDayGoal = useAppStore((state) => state.setDDayGoal);
  const sessions = useAppStore((state) => state.sessions);
  const activeTimer = useAppStore((state) => state.activeTimer);

  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(dDayGoal?.title ?? '');
  const [targetDate, setTargetDate] = useState(
    dDayGoal?.targetDate ?? addDaysToLogicalDate(logicalDate, 30),
  );
  const [targetStudyHours, setTargetStudyHours] = useState(
    dDayGoal?.targetStudyHours ?? 100,
  );

  const progress = useMemo(() => {
    if (!dDayGoal) return null;
    return computeDDayProgress({
      logicalDate,
      dDayGoal,
      sessions,
      activeTimer,
      nowMs,
    });
  }, [activeTimer, dDayGoal, logicalDate, nowMs, sessions]);

  const openEditor = () => {
    setTitle(dDayGoal?.title ?? '');
    setTargetDate(
      dDayGoal?.targetDate ?? addDaysToLogicalDate(logicalDate, 30),
    );
    setTargetStudyHours(dDayGoal?.targetStudyHours ?? 100);
    setIsEditing(true);
  };

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || !targetDate) return;
    setDDayGoal({
      id: dDayGoal?.id ?? 'dday-primary',
      title: trimmed,
      targetDate,
      targetStudyHours: Math.max(1, Math.min(5000, Math.round(targetStudyHours))),
    });
    setIsEditing(false);
  };

  const handleClear = () => {
    setDDayGoal(null);
    setIsEditing(false);
  };

  return (
    <section
      aria-labelledby="dday-heading"
      className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900/70"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="dday-heading"
              className="text-sm font-bold text-slate-900 dark:text-white"
            >
              D-Day Study Goal
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Countdown target &amp; cumulative hours
            </p>
          </div>
        </div>

        {!isEditing && !dDayGoal && (
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Set D-Day Goal
          </button>
        )}

        {!isEditing && dDayGoal && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openEditor}
              aria-label="Edit D-Day goal"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear D-Day goal"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <form
          onSubmit={handleSave}
          className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/70"
        >
          <div className="space-y-2.5">
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Milestone / Exam Title
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Finals Week"
                required
                maxLength={60}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Target Date
                </span>
                <input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Target Study Hours
                </span>
                <input
                  type="number"
                  min={1}
                  max={5000}
                  value={targetStudyHours}
                  onChange={(e) =>
                    setTargetStudyHours(Number(e.target.value) || 1)
                  }
                  required
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-amber-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !targetDate}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Save D-Day
            </button>
          </div>
        </form>
      ) : progress ? (
        <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  data-testid="dday-badge"
                  className={`tabular-nums rounded-xl px-2.5 py-1 text-xs font-extrabold tracking-tight ${
                    progress.isCompleted
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : progress.daysRemaining <= 3
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {progress.badgeText}
                </span>
                <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                  {progress.goal.title}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Target {formatLogicalDateShort(progress.goal.targetDate)} (
                {progress.goal.targetDate})
              </p>
            </div>

            <div className="shrink-0 text-right">
              <span className="tabular-nums text-base font-extrabold text-slate-900 dark:text-white">
                {progress.percentage}%
              </span>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                of {progress.goal.targetStudyHours}h
              </p>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="D-Day cumulative study hours progress"
            aria-valuenow={Math.min(100, progress.percentage)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${
                progress.isCompleted ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.round(progress.clampedRatio * 100)}%` }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="tabular-nums font-medium text-slate-700 dark:text-slate-300">
              {progress.loggedHours.toFixed(1)}h logged ·{' '}
              {progress.remainingHours.toFixed(1)}h left
            </span>
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300">
              <Target className="h-3.5 w-3.5" aria-hidden="true" />
              {progress.isCompleted
                ? 'Target hours achieved!'
                : progress.daysRemaining > 0
                  ? `Need ${progress.requiredDailyHours.toFixed(1)}h/day`
                  : `${progress.remainingHours.toFixed(1)}h remaining`}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-3.5 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
          Set an exam or milestone date with a cumulative study-hour target to
          track D-Day countdown and required daily hours.
        </p>
      )}
    </section>
  );
}
