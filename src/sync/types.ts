import type {
  ActiveTimerState,
  DDayGoal,
  DirtyEntityRef,
  Habit,
  MultiDayTaskPlan,
  StudySession,
  Subject,
  SyncEntityType,
  SyncTombstone,
  TodoTask,
  UserSettingsData,
} from '../types/domain';

export const SYNC_ENTITY_TYPES: readonly SyncEntityType[] = [
  'settings',
  'subject',
  'session',
  'task',
  'multiDayPlan',
  'habit',
  'dday',
  'activeTimer',
] as const;

export type SyncEntityPayload =
  | UserSettingsData
  | Subject
  | StudySession
  | TodoTask
  | MultiDayTaskPlan
  | Habit
  | DDayGoal
  | ActiveTimerState;

export interface SyncEntityEnvelope<TPayload = SyncEntityPayload> {
  entityType: SyncEntityType;
  entityId: string;
  data: TPayload | null;
  updatedAt: number;
  deletedAt?: number | null;
  serverRevision?: number;
}

export interface AuthUserDTO {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  serverRevision: number;
}

export interface AuthResponseDTO {
  user: AuthUserDTO;
}

export interface SyncMetaResponseDTO {
  serverRevision: number;
  updatedAt: number;
  entityCount: number;
  notModified?: boolean;
}

export interface SyncPushPullRequestDTO {
  sinceRevision: number;
  clientTime: number;
  changes: SyncEntityEnvelope[];
}

export interface SyncPushPullResponseDTO {
  serverRevision: number;
  serverTime: number;
  acceptedCount: number;
  entities: SyncEntityEnvelope[];
}

export interface MergeableAppCollections {
  dailyStudyGoalMinutes: number;
  soundEnabled: boolean;
  settingsUpdatedAt: number;
  subjects: Subject[];
  sessions: StudySession[];
  tasks: TodoTask[];
  multiDayPlans: MultiDayTaskPlan[];
  habits: Habit[];
  dDayGoal: DDayGoal | null;
  dDayUpdatedAt: number;
  activeTimer: ActiveTimerState;
  activeTimerUpdatedAt: number;
  tombstones: Record<string, SyncTombstone>;
  dirtyEntities: Record<string, DirtyEntityRef>;
}

export type SyncLifecycleStatus =
  | 'local'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'auth_required'
  | 'error';

export interface SyncStatusSnapshot {
  userId: string;
  mode: 'local' | 'cloud';
  status: SyncLifecycleStatus;
  pendingCount: number;
  lastSyncedAt: number | null;
  serverRevision: number;
  lastError: string | null;
  lastResultSummary: string | null;
  cooldownUntil: number;
}
