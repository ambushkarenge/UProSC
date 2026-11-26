import { useMemo, useState } from 'react';
import { BarChart3, Clock, PieChart, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { LogicalDate } from '../../types/domain';
import { formatDurationCompact } from '../../utils/date';
import {
  computeDailyTimeline,
  computePeakHours,
  computeSubjectBreakdown,
  type AnalyticsRange,
} from '../../utils/focusAnalytics';

interface FocusAnalyticsProps {
  logicalDate: LogicalDate;
  nowMs: number;
}

const RANGE_OPTIONS: ReadonlyArray<{ id: AnalyticsRange; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 Days' },
  { id: 'all', label: 'All' },
];

const TIMELINE_TICKS = [
  { label: '5a', fraction: 0 },
  { label: '9a', fraction: 4 / 24 },
  { label: '1p', fraction: 8 / 24 },
  { label: '5p', fraction: 12 / 24 },
  { label: '9p', fraction: 16 / 24 },
  { label: '1a', fraction: 20 / 24 },
  { label: '5a', fraction: 1 },
] as const;

function formatLocalTimeHm(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestampMs));
}

/**
 * Custom offline SVG focus analytics suite:
 * Subject Breakdown Donut, 5:00 AM -> 5:00 AM Daily Timeline, and 24-Hour Peak Hours chart.
 */
export function FocusAnalytics({ logicalDate, nowMs }: FocusAnalyticsProps) {
  const subjects = useAppStore((state) => state.subjects);
  const sessions = useAppStore((state) => state.sessions);
  const activeTimer = useAppStore((state) => state.activeTimer);
  const deleteStudySession = useAppStore((state) => state.deleteStudySession);

  const [range, setRange] = useState<AnalyticsRange>('today');

  const breakdown = useMemo(
    () =>
      computeSubjectBreakdown({
        logicalDate,
        range,
        subjects,
        sessions,
        activeTimer,
        nowMs,
      }),
    [activeTimer, logicalDate, nowMs, range, sessions, subjects],
  );

  const timelineBlocks = useMemo(
    () =>
      computeDailyTimeline({
        logicalDate,
        subjects,
        sessions,
        activeTimer,
        nowMs,
      }),
    [activeTimer, logicalDate, nowMs, sessions, subjects],
  );

  const peakHours = useMemo(
    () =>
      computePeakHours({
        logicalDate,
        range,
        sessions,
        activeTimer,
        nowMs,
      }),
    [activeTimer, logicalDate, nowMs, range, sessions],
  );

  const todaySessions = useMemo(() => {
    const subjectMap = new Map(subjects.map((s) => [s.id, s]));
    return sessions
      .filter((s) => s.logicalDate === logicalDate)
      .slice()
      .sort((a, b) => b.startTime - a.startTime)
      .map((s) => ({
        session: s,
        subject: subjectMap.get(s.subjectId),
      }));
  }, [logicalDate, sessions, subjects]);

  const donutRadius = 44;
  const donutCircumference = 2 * Math.PI * donutRadius;

  let cumulativeOffset = 0;
  const donutSegments = breakdown.slices.map((slice) => {
    const arcLength = slice.share * donutCircumference;
    const segment = {
      ...slice,
      dashArray: `${arcLength} ${donutCircumference}`,
      dashOffset: -cumulativeOffset,
    };
    cumulativeOffset += arcLength;
    return segment;
  });

  return (
    <section
      aria-labelledby="analytics-heading"
      className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900/70"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="analytics-heading"
              className="text-sm font-bold text-slate-900 dark:text-white"
            >
              Focus Analytics
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Subject share, 5a–5a timeline &amp; peak hours
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Analytics range"
          className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-800 dark:bg-slate-950"
        >
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setRange(option.id)}
              aria-pressed={range === option.id}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                range === option.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-800 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Subject Breakdown Donut */}
      <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
          <PieChart className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />
          <span>Subject Breakdown</span>
        </div>

        {breakdown.totalSeconds === 0 ? (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            No focus time recorded for this range yet. Start a timer to see your
            subject distribution.
          </p>
        ) : (
          <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative h-28 w-28 shrink-0">
              <svg
                viewBox="0 0 120 120"
                className="h-full w-full -rotate-90"
                role="img"
                aria-label={`Subject focus donut totaling ${formatDurationCompact(breakdown.totalSeconds)}`}
              >
                <circle
                  cx={60}
                  cy={60}
                  r={donutRadius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={14}
                  className="text-slate-200 dark:text-slate-800"
                />
                {donutSegments.map((seg) => (
                  <circle
                    key={seg.subjectId}
                    cx={60}
                    cy={60}
                    r={donutRadius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={14}
                    strokeLinecap="butt"
                    strokeDasharray={seg.dashArray}
                    strokeDashoffset={seg.dashOffset}
                    data-testid={`donut-slice-${seg.subjectId}`}
                  >
                    <title>
                      {`${seg.name}: ${formatDurationCompact(seg.seconds)} (${seg.percentage}%)`}
                    </title>
                  </circle>
                ))}
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="tabular-nums text-sm font-extrabold text-slate-900 dark:text-white">
                  {formatDurationCompact(breakdown.totalSeconds)}
                </span>
                <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                  total
                </span>
              </div>
            </div>

            <ul className="w-full min-w-0 flex-1 space-y-1.5">
              {breakdown.slices.map((slice) => (
                <li
                  key={slice.subjectId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                      {slice.name}
                    </span>
                  </div>
                  <span className="tabular-nums shrink-0 font-semibold text-slate-600 dark:text-slate-300">
                    {formatDurationCompact(slice.seconds)} ({slice.percentage}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 2. Daily Timeline (5:00 AM -> 5:00 AM) */}
      <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Clock className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
            <span>Today&apos;s Timeline (5:00 AM – 5:00 AM)</span>
          </div>
          <span className="tabular-nums text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {timelineBlocks.length}{' '}
            {timelineBlocks.length === 1 ? 'block' : 'blocks'}
          </span>
        </div>

        <svg
          viewBox="0 0 480 48"
          className="mt-3 h-12 w-full overflow-visible"
          role="img"
          aria-label={`Daily study timeline with ${timelineBlocks.length} blocks`}
        >
          {/* 24h track */}
          <rect
            x={0}
            y={6}
            width={480}
            height={18}
            rx={6}
            fill="currentColor"
            className="text-slate-200/80 dark:text-slate-800"
          />
          {timelineBlocks.map((block) => {
            const x = block.startFraction * 480;
            const width = Math.max(4, block.widthFraction * 480);
            return (
              <rect
                key={block.id}
                x={x}
                y={6}
                width={width}
                height={18}
                rx={4}
                fill={block.color}
                opacity={block.isLive ? 0.85 : 1}
                stroke={block.isLive ? '#ffffff' : 'none'}
                strokeWidth={block.isLive ? 1.2 : 0}
                data-testid={`timeline-block-${block.id}`}
              >
                <title>
                  {`${block.subjectName}: ${formatLocalTimeHm(block.startTime)} – ${formatLocalTimeHm(block.endTime)} (${formatDurationCompact(block.durationSeconds)})`}
                </title>
              </rect>
            );
          })}

          {/* Tick labels */}
          {TIMELINE_TICKS.map((tick, index) => {
            const x = tick.fraction * 480;
            const textAnchor =
              index === 0
                ? 'start'
                : index === TIMELINE_TICKS.length - 1
                  ? 'end'
                  : 'middle';
            return (
              <g key={`${tick.label}-${index}`}>
                <line
                  x1={x}
                  y1={24}
                  x2={x}
                  y2={29}
                  stroke="currentColor"
                  strokeWidth={1}
                  className="text-slate-300 dark:text-slate-700"
                />
                <text
                  x={x}
                  y={42}
                  textAnchor={textAnchor}
                  fill="currentColor"
                  className="fill-slate-500 text-[10px] font-medium dark:fill-slate-400"
                >
                  {tick.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 3. Peak Hours SVG Bar Chart */}
      <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Peak Focus Hours
          </span>
          {peakHours.peakBucket ? (
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
              Peak: {peakHours.peakBucket.rangeLabel} (
              {formatDurationCompact(peakHours.peakBucket.seconds)})
            </span>
          ) : (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              No peak hour yet
            </span>
          )}
        </div>

        <svg
          viewBox="0 0 480 96"
          className="mt-3 h-24 w-full overflow-visible"
          role="img"
          aria-label={
            peakHours.peakBucket
              ? `Peak focus hour ${peakHours.peakBucket.rangeLabel}`
              : 'Peak focus hours chart empty'
          }
        >
          {peakHours.buckets.map((bucket, idx) => {
            const slotWidth = 480 / 24;
            const barWidth = slotWidth - 4;
            const x = idx * slotWidth + 2;
            const maxBarHeight = 68;
            const height =
              peakHours.maxSeconds > 0 && bucket.seconds > 0
                ? Math.max(4, (bucket.seconds / peakHours.maxSeconds) * maxBarHeight)
                : 3;
            const y = 74 - height;

            return (
              <g key={bucket.hour}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx={3}
                  className={
                    bucket.seconds === 0
                      ? 'fill-slate-200 dark:fill-slate-800'
                      : bucket.isPeak
                        ? 'fill-rose-500'
                        : 'fill-sky-500/75 dark:fill-sky-400/75'
                  }
                >
                  <title>
                    {`${bucket.rangeLabel}: ${formatDurationCompact(bucket.seconds)}`}
                  </title>
                </rect>
                {idx % 4 === 0 && (
                  <text
                    x={x + barWidth / 2}
                    y={90}
                    textAnchor="middle"
                    className="fill-slate-500 text-[10px] font-medium dark:fill-slate-400"
                  >
                    {bucket.shortLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* 4. Today's Session Log */}
      {todaySessions.length > 0 && (
        <div className="mt-3 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Today&apos;s Logged Sessions ({todaySessions.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {todaySessions.slice(0, 6).map(({ session, subject }) => {
              const name = subject?.name ?? 'General Focus';
              const color = subject?.color ?? '#64748b';
              return (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/80"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate font-semibold text-slate-800 dark:text-slate-200">
                      {name}
                    </span>
                    <span className="hidden text-slate-400 sm:inline">·</span>
                    <span className="hidden tabular-nums text-[11px] text-slate-500 sm:inline dark:text-slate-400">
                      {formatLocalTimeHm(session.startTime)} –{' '}
                      {formatLocalTimeHm(session.endTime)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums font-bold text-slate-700 dark:text-slate-200">
                      {formatDurationCompact(session.durationSeconds)}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteStudySession(session.id)}
                      aria-label={`Delete ${name} session`}
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
