import { useState, type ComponentType } from 'react';
import { CheckSquare, Flame, Timer } from 'lucide-react';
import { AppHeader } from './components/Header/AppHeader';

export type CoreTabId = 'timer' | 'todo' | 'habits';

interface CoreTabDefinition {
  id: CoreTabId;
  label: string;
  phase: string;
  headline: string;
  summary: string;
  accentClass: string;
  badgeClass: string;
  highlights: readonly string[];
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}

const CORE_TABS: readonly CoreTabDefinition[] = [
  {
    id: 'timer',
    label: 'Timer',
    phase: 'Phase 3',
    headline: 'Focus Timer & Study Analytics',
    summary:
      'Count-up stopwatch and Pomodoro blocks with wall-clock timestamp accuracy, Full-Screen Wake Lock, D-Day goal tracking, and subject breakdown.',
    accentClass: 'text-rose-600 dark:text-rose-400',
    badgeClass:
      'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300',
    highlights: [
      'Wall-clock timestamp delta timing survives tab throttling',
      '5:00 AM boundary splits overnight study sessions cleanly',
      'Ring 1 fills toward your daily study target in real time',
    ],
    icon: Timer,
  },
  {
    id: 'todo',
    label: 'To-Do',
    phase: 'Phase 4',
    headline: 'Daily Tasks, Multi-Day Split & Calendar',
    summary:
      'Priority-tagged tasks anchored to your 5:00 AM logical study day, automatic multi-day workload splitting, and one-click .ics calendar export.',
    accentClass: 'text-emerald-600 dark:text-emerald-400',
    badgeClass:
      'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
    highlights: [
      'Split large assignments evenly across date ranges',
      'Collapsible weekly & monthly calendar view with D-Day markers',
      'Ring 2 tracks completed vs. due tasks for today',
    ],
    icon: CheckSquare,
  },
  {
    id: 'habits',
    label: 'Habits',
    phase: 'Phase 5',
    headline: 'Daily Habits, Streaks & 5-Step Heatmap',
    summary:
      'One-tap daily consistency checklist with streak protection across the 5:00 AM study rollover and a HabitKit-style 5-step intensity grid.',
    accentClass: 'text-sky-600 dark:text-sky-400',
    badgeClass: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
    highlights: [
      'Current & best streak engine without morning false-zero resets',
      '5-step consistency heatmap showing 0% to 100% daily adherence',
      'Ring 3 updates immediately on every habit toggle',
    ],
    icon: Flame,
  },
];

/**
 * Root application shell enforcing UProSC's strict 3-tab navigation
 * (`Timer`, `To-Do`, `Habits`) and persistent 3-Ring header.
 */
export function App() {
  const [activeTab, setActiveTab] = useState<CoreTabId>('timer');
  const currentTab =
    CORE_TABS.find((tab) => tab.id === activeTab) ?? CORE_TABS[0];

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader />

      {/* Strict 3-Tab Navigation: floating segmented pill on desktop, safe-area bottom bar on mobile */}
      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/90 px-3 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md md:static md:mx-auto md:mt-6 md:w-fit md:rounded-2xl md:border md:p-1.5 md:shadow-xs dark:border-slate-800/90 dark:bg-slate-900/90"
      >
        <div
          role="tablist"
          aria-label="Core views"
          className="mx-auto grid max-w-md grid-cols-3 gap-1 md:w-88"
        >
          {CORE_TABS.map((tab) => {
            const Icon = tab.icon;
            const isSelected = tab.id === activeTab;

            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={`panel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition md:flex-row md:gap-2 md:py-2 md:text-sm ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-xs dark:bg-white dark:text-slate-950'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden={true} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content Workspace */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-5 pb-28 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] md:pb-12">
        <section
          id={`panel-${currentTab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${currentTab.id}`}
          className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-xs sm:p-8 dark:border-slate-800 dark:bg-slate-900/70"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${currentTab.badgeClass}`}
            >
              <currentTab.icon className="h-3.5 w-3.5" aria-hidden={true} />
              {currentTab.label} Workspace
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              Shell Ready · Feature Target: {currentTab.phase}
            </span>
          </div>

          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
            {currentTab.headline}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base dark:text-slate-300">
            {currentTab.summary}
          </p>

          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {currentTab.highlights.map((item) => (
              <li
                key={item}
                className="rounded-2xl border border-slate-200/75 bg-slate-50/80 p-4 text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300"
              >
                <span
                  className={`mb-1.5 block text-[11px] font-bold uppercase tracking-wider ${currentTab.accentClass}`}
                >
                  Planned
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
