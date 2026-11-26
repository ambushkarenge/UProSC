export type LogicalDate = string; // "YYYY-MM-DD" anchored to the 5:00 AM local study-day rollover

export type TaskPriority = 'low' | 'medium' | 'high';

export type SyncEntityType =
  | 'settings'
  | 'subject'
  | 'session'
  | 'task'
  | 'multiDayPlan'
  | 'habit'
  | 'dday'
  | 'activeTimer';

export interface SyncableRecord {
  updatedAt?: number; // epoch ms for per-entity last-write-wins merge
  deletedAt?: number; // tombstone epoch ms so cross-device deletes propagate cleanly
}

export type UserAuthMode = 'local' | 'cloud';
export type CloudAuthState = 'none' | 'authenticated' | 'reauth_required';

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  mode: UserAuthMode;
  authState: CloudAuthState;
  createdAt: number;
  lastSyncedAt: number | null;
  serverRevision: number;
}

export interface DirtyEntityRef {
  entityType: SyncEntityType;
  entityId: string;
  updatedAt: number;
}

export interface SyncTombstone {
  entityType: SyncEntityType;
  entityId: string;
  deletedAt: number;
}

export interface Subject extends SyncableRecord {
  id: string;
  name: string;
  color: string;
  dailyGoalMinutes: number;
  archived: boolean;
  createdAt: number;
}

export interface StudySession extends SyncableRecord {
  id: string;
  subjectId: string;
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  durationSeconds: number;
  logicalDate: LogicalDate;
}

export interface TodoTask extends SyncableRecord {
  id: string;
  title: string;
  logicalDate: LogicalDate;
  completed: boolean;
  priority: TaskPriority;
  parentMultiDayId?: string;
  sliceIndex?: number; // e.g., 1
  sliceTotal?: number; // e.g., 10
  unitTarget?: number; // e.g., 20 (pages)
  unitLabel?: string; // e.g., "pages"
  scheduledTime?: string; // "HH:mm" optional for .ics export
}

export interface MultiDayTaskPlan extends SyncableRecord {
  id: string;
  title: string;
  startDate: LogicalDate;
  endDate: LogicalDate;
  totalUnits?: number;
  unitLabel?: string;
  splitEvenly: boolean;
  priority: TaskPriority;
}

export interface Habit extends SyncableRecord {
  id: string;
  name: string;
  icon: string;
  color: string;
  archived: boolean;
  createdAt: number;
  completedDates: Record<LogicalDate, boolean>;
  completedDateUpdatedAt?: Record<LogicalDate, number>;
}

export interface DDayGoal extends SyncableRecord {
  id: string;
  title: string;
  targetDate: LogicalDate;
  targetStudyHours: number;
}

export interface UserSettingsData extends SyncableRecord {
  id: 'settings';
  dailyStudyGoalMinutes: number;
  soundEnabled: boolean;
}

export type TimerMode = 'stopwatch' | 'countdown';
export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerSegment {
  startTime: number; // epoch ms
  endTime: number; // epoch ms
}

export interface ActiveTimerState {
  subjectId: string | null;
  mode: TimerMode;
  status: TimerStatus;
  segmentStartTime: number | null; // epoch ms of current running segment start
  accumulatedMs: number; // elapsed ms prior to current running segment
  targetDurationMs?: number; // target duration for countdown mode
  sessionStartTime: number | null; // epoch ms when the overall session began
  completedSegments?: TimerSegment[]; // exact focused intervals before pause/resume
}

export type RingKey = 'focus' | 'todo' | 'habits';

export interface RingMetric {
  key: RingKey;
  label: string;
  completed: number;
  target: number;
  /** Unclamped completion ratio (e.g., 1.25 when exceeding daily study goal). */
  ratio: number;
  /** Completion ratio clamped to [0, 1] for score calculation and SVG arc fill. */
  clampedRatio: number;
  /** Whole percentage derived from ratio (0% when target is 0). */
  percentage: number;
  /** Compact header display string (e.g. "45m", "2/4", "1/3"). */
  displayValue: string;
  /** Detailed breakdown string for header popovers and accessibility. */
  detailText: string;
}

export interface ProductivityScoreBreakdown {
  logicalDate: LogicalDate;
  /** Weighted 0-100 score: 45% Focus + 35% To-Do + 20% Habits (each ring capped at 100%). */
  score: number;
  rings: {
    focus: RingMetric;
    todo: RingMetric;
    habits: RingMetric;
  };
}
