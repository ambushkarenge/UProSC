import { useMemo } from 'react';
import {
  AlertTriangle,
  Flame,
  Play,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { LogicalDate } from '../../types/domain';
import { deriveBehavioralInsight, type BehavioralTone } from '../../utils/behavioral';

interface BehavioralCompanionProps {
  logicalDate: LogicalDate;
  nowMs: number;
  isTimerRunning: boolean;
  onQuickSprint: (minutes: number) => void;
}

const TONE_STYLES: Record<
  BehavioralTone,
  {
    container: string;
    iconBox: string;
    title: string;
    badge: string;
  }
> = {
  positive: {
    container:
      'border-emerald-200/90 bg-emerald-50/75 dark:border-emerald-800/70 dark:bg-emerald-950/30',
    iconBox: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    title: 'text-emerald-950 dark:text-emerald-100',
    badge:
      'bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  },
  active: {
    container:
      'border-rose-200/90 bg-rose-50/70 dark:border-rose-800/70 dark:bg-rose-950/25',
    iconBox: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    title: 'text-rose-950 dark:text-rose-100',
    badge: 'bg-rose-500/15 text-rose-800 dark:text-rose-200',
  },
  warning: {
    container:
      'border-amber-300/90 bg-amber-50/85 dark:border-amber-700/80 dark:bg-amber-950/35',
    iconBox: 'bg-amber-500/20 text-amber-700 dark:text-amber-300',
    title: 'text-amber-950 dark:text-amber-100',
    badge: 'bg-amber-500/20 text-amber-900 dark:text-amber-200',
  },
  nudge: {
    container:
      'border-sky-200/90 bg-sky-50/75 dark:border-sky-800/70 dark:bg-sky-950/25',
    iconBox: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    title: 'text-sky-950 dark:text-sky-100',
    badge: 'bg-sky-500/15 text-sky-800 dark:text-sky-200',
  },
  neutral: {
    container:
      'border-slate-200/90 bg-white dark:border-slate-800 dark:bg-slate-900/70',
    iconBox: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    title: 'text-slate-900 dark:text-white',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

/**
 * Duolingo-inspired positive celebration and pace / streak-at-risk behavioral companion.
 */
export function BehavioralCompanion({
  logicalDate,
  nowMs,
  isTimerRunning,
  onQuickSprint,
}: BehavioralCompanionProps) {
  const dailyStudyGoalMinutes = useAppStore(
    (state) => state.dailyStudyGoalMinutes,
  );
  const sessions = useAppStore((state) => state.sessions);
  const activeTimer = useAppStore((state) => state.activeTimer);
  const dDayGoal = useAppStore((state) => state.dDayGoal);

  const insight = useMemo(
    () =>
      deriveBehavioralInsight({
        logicalDate,
        dailyStudyGoalMinutes,
        sessions,
        activeTimer,
        dDayGoal,
        nowMs,
      }),
    [
      activeTimer,
      dDayGoal,
      dailyStudyGoalMinutes,
      logicalDate,
      nowMs,
      sessions,
    ],
  );

  const styles = TONE_STYLES[insight.tone];

  const renderIcon = () => {
    switch (insight.status) {
      case 'goal_achieved':
        return <Trophy className="h-4 w-4" aria-hidden="true" />;
      case 'streak_at_risk':
        return <AlertTriangle className="h-4 w-4" aria-hidden="true" />;
      case 'active_flow':
        return <Flame className="h-4 w-4" aria-hidden="true" />;
      case 'behind_pace':
        return <TrendingUp className="h-4 w-4" aria-hidden="true" />;
      default:
        return <Sparkles className="h-4 w-4" aria-hidden="true" />;
    }
  };

  return (
    <section
      aria-label="Focus behavioral companion"
      data-behavioral-status={insight.status}
      className={`rounded-3xl border p-4 shadow-xs transition-colors ${styles.container}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${styles.iconBox}`}
          >
            {renderIcon()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`text-sm font-bold ${styles.title}`}>
                {insight.title}
              </h2>
              <span
                data-testid="focus-streak-badge"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${styles.badge}`}
              >
                <Flame className="h-3 w-3" aria-hidden="true" />
                {insight.streak.currentStreakDays}d streak
                {insight.streak.bestStreakDays > insight.streak.currentStreakDays
                  ? ` · best ${insight.streak.bestStreakDays}d`
                  : ''}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {insight.message}
            </p>
          </div>
        </div>

        {!isTimerRunning && insight.status !== 'goal_achieved' && (
          <button
            type="button"
            onClick={() => onQuickSprint(insight.suggestedSprintMinutes)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 active:scale-[0.98] dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Start {insight.suggestedSprintMinutes}m Sprint
          </button>
        )}
      </div>
    </section>
  );
}
