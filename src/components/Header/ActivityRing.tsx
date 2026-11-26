import type { RingKey } from '../../types/domain';
import { clampUnitRatio } from '../../utils/score';

export interface RingLayerSpec {
  key: RingKey;
  label: string;
  radius: number;
  colorClass: string;
  ratio: number;
}

interface RingCirclePairProps {
  center: number;
  radius: number;
  strokeWidth: number;
  colorClass: string;
  ratio: number;
  ringKey: RingKey;
}

function RingCirclePair({
  center,
  radius,
  strokeWidth,
  colorClass,
  ratio,
  ringKey,
}: RingCirclePairProps) {
  const clamped = clampUnitRatio(ratio);
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);

  return (
    <g data-ring={ringKey}>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className={`${colorClass} opacity-20`}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        data-testid={`ring-progress-${ringKey}`}
        className={`${colorClass} transition-[stroke-dashoffset,opacity] duration-300 ease-out ${
          clamped > 0 ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </g>
  );
}

export interface ActivityRingProps {
  ringKey: RingKey;
  label: string;
  ratio: number;
  colorClass: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * Single SVG circular progress ring using `stroke-dasharray` / `stroke-dashoffset`.
 */
export function ActivityRing({
  ringKey,
  label,
  ratio,
  colorClass,
  size = 28,
  strokeWidth = 3.5,
  className = 'h-7 w-7 shrink-0 -rotate-90',
}: ActivityRingProps) {
  const center = size / 2;
  const radius = Math.max(2, center - strokeWidth / 2 - 0.5);
  const pct = Math.round(Math.max(0, ratio) * 100);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`${label} ring ${pct}%`}
    >
      <RingCirclePair
        center={center}
        radius={radius}
        strokeWidth={strokeWidth}
        colorClass={colorClass}
        ratio={ratio}
        ringKey={ringKey}
      />
    </svg>
  );
}

export interface ConcentricActivityRingsProps {
  focusRatio: number;
  todoRatio: number;
  habitsRatio: number;
  className?: string;
}

const CONCENTRIC_SPECS: readonly Omit<RingLayerSpec, 'ratio'>[] = [
  { key: 'focus', label: 'Focus', radius: 17, colorClass: 'text-rose-500' },
  { key: 'todo', label: 'To-Do', radius: 12, colorClass: 'text-emerald-500' },
  { key: 'habits', label: 'Habits', radius: 7, colorClass: 'text-sky-500' },
];

/**
 * Nested 3-Ring Apple Health–style progress gauge (Focus outer, To-Do middle, Habits inner).
 */
export function ConcentricActivityRings({
  focusRatio,
  todoRatio,
  habitsRatio,
  className = 'h-10 w-10 shrink-0 -rotate-90',
}: ConcentricActivityRingsProps) {
  const ratios: Record<RingKey, number> = {
    focus: focusRatio,
    todo: todoRatio,
    habits: habitsRatio,
  };

  const focusPct = Math.round(Math.max(0, focusRatio) * 100);
  const todoPct = Math.round(Math.max(0, todoRatio) * 100);
  const habitsPct = Math.round(Math.max(0, habitsRatio) * 100);

  return (
    <svg
      viewBox="0 0 44 44"
      className={className}
      role="img"
      aria-label={`Activity rings: Focus ${focusPct}%, To-Do ${todoPct}%, Habits ${habitsPct}%`}
    >
      {CONCENTRIC_SPECS.map((spec) => (
        <RingCirclePair
          key={spec.key}
          center={22}
          radius={spec.radius}
          strokeWidth={3.5}
          colorClass={spec.colorClass}
          ratio={ratios[spec.key]}
          ringKey={spec.key}
        />
      ))}
    </svg>
  );
}
