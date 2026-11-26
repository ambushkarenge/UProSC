import { useEffect, useRef, useState } from 'react';
import { Grip, Sparkles, X } from 'lucide-react';

interface RingIndicatorSpec {
  id: string;
  label: string;
  radius: number;
  colorClass: string;
  valueText: string;
}

const HEADER_RING_SPECS: readonly RingIndicatorSpec[] = [
  {
    id: 'focus',
    label: 'Focus',
    radius: 17,
    colorClass: 'text-rose-500',
    valueText: '0m',
  },
  {
    id: 'todo',
    label: 'To-Do',
    radius: 12,
    colorClass: 'text-emerald-500',
    valueText: '0/0',
  },
  {
    id: 'habits',
    label: 'Habits',
    radius: 7,
    colorClass: 'text-sky-500',
    valueText: '0/0',
  },
];

/**
 * Persistent top header holding the brand mark, 3-Ring overview skeleton,
 * productivity score badge, and top-right 9-dot Sub-App Launcher trigger.
 */
export function AppHeader() {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!launcherOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLauncherOpen(false);
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      if (
        launcherRef.current &&
        !launcherRef.current.contains(event.target as Node)
      ) {
        setLauncherOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [launcherOpen]);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
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
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                PWA
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              5:00 AM Study Day
            </p>
          </div>
        </div>

        {/* 3-Ring Skeleton + Score Pill */}
        <div
          className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-100/75 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/80"
          aria-label="Daily activity rings summary"
        >
          <svg
            viewBox="0 0 44 44"
            className="h-10 w-10 shrink-0 -rotate-90"
            role="img"
            aria-label="3-ring progress preview"
          >
            {HEADER_RING_SPECS.map((ring) => (
              <circle
                key={ring.id}
                cx="22"
                cy="22"
                r={ring.radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                className={`${ring.colorClass} opacity-25`}
              />
            ))}
          </svg>

          <div className="hidden items-center gap-3 sm:flex">
            {HEADER_RING_SPECS.map((ring) => (
              <div key={ring.id} className="flex flex-col leading-tight">
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  {ring.label}
                </span>
                <span className="tabular-nums text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {ring.valueText}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-baseline gap-1 border-l border-slate-200 pl-2.5 dark:border-slate-700">
            <span className="tabular-nums text-sm font-bold text-slate-900 dark:text-white">
              0
            </span>
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              /100
            </span>
          </div>
        </div>

        {/* 9-Dot App Launcher */}
        <div ref={launcherRef} className="relative">
          <button
            type="button"
            onClick={() => setLauncherOpen((open) => !open)}
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
              className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900"
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
