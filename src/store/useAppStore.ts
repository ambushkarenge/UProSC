import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ActiveTimerState,
  DDayGoal,
  Habit,
  LogicalDate,
  MultiDayTaskPlan,
  StudySession,
  Subject,
  TodoTask,
} from '../types/domain';
import { splitSessionByLogicalDay } from '../utils/date';
import {
  clearActiveTimerMirror,
  idbStorage,
  readActiveTimerMirror,
  saveActiveTimerMirror,
} from './idbStorage';

export const STORE_STORAGE_KEY = 'uprosc-app-state';
export const DEFAULT_DAILY_STUDY_GOAL_MINUTES = 120;
export const MIN_DAILY_STUDY_GOAL_MINUTES = 15;
export const MAX_DAILY_STUDY_GOAL_MINUTES = 1440;

export const DEFAULT_ACTIVE_TIMER: ActiveTimerState = {
  subjectId: null,
  mode: 'stopwatch',
  status: 'idle',
  segmentStartTime: null,
  accumulatedMs: 0,
  sessionStartTime: null,
};

function createId(prefix: string): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function clampDailyGoalMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) {
    return DEFAULT_DAILY_STUDY_GOAL_MINUTES;
  }
  return Math.min(
    MAX_DAILY_STUDY_GOAL_MINUTES,
    Math.max(MIN_DAILY_STUDY_GOAL_MINUTES, Math.round(minutes)),
  );
}

export interface PersistedAppData {
  dailyStudyGoalMinutes: number;
  subjects: Subject[];
  sessions: StudySession[];
  tasks: TodoTask[];
  multiDayPlans: MultiDayTaskPlan[];
  habits: Habit[];
  dDayGoal: DDayGoal | null;
  activeTimer: ActiveTimerState;
  activeTimerUpdatedAt: number;
}

export interface AppStoreState extends PersistedAppData {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  setDailyStudyGoalMinutes: (minutes: number) => void;
  addSubject: (input: {
    name: string;
    color: string;
    dailyGoalMinutes?: number;
  }) => Subject;
  updateSubject: (
    id: string,
    patch: Partial<Pick<Subject, 'name' | 'color' | 'dailyGoalMinutes'>>,
  ) => void;
  toggleArchiveSubject: (id: string) => void;
  logStudySession: (
    subjectId: string,
    startTime: number,
    endTime: number,
  ) => StudySession[];
  addTask: (
    input: Omit<TodoTask, 'id' | 'completed'> & { completed?: boolean },
  ) => TodoTask;
  toggleTask: (taskId: string) => void;
  deleteTask: (taskId: string) => void;
  addHabit: (input: { name: string; icon: string; color: string }) => Habit;
  toggleHabitDate: (habitId: string, logicalDate: LogicalDate) => void;
  toggleArchiveHabit: (habitId: string) => void;
  setActiveTimer: (
    next:
      | ActiveTimerState
      | ((previous: ActiveTimerState) => ActiveTimerState),
    updatedAt?: number,
  ) => void;
  setDDayGoal: (goal: DDayGoal | null) => void;
  resetAllData: () => void;
}

function createInitialPersistedData(): PersistedAppData {
  const mirror = readActiveTimerMirror();
  return {
    dailyStudyGoalMinutes: DEFAULT_DAILY_STUDY_GOAL_MINUTES,
    subjects: [],
    sessions: [],
    tasks: [],
    multiDayPlans: [],
    habits: [],
    dDayGoal: null,
    activeTimer: mirror ? mirror.timer : { ...DEFAULT_ACTIVE_TIMER },
    activeTimerUpdatedAt: mirror ? mirror.updatedAt : 0,
  };
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialPersistedData(),
      hasHydrated: false,

      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      setDailyStudyGoalMinutes: (minutes) =>
        set({
          dailyStudyGoalMinutes: clampDailyGoalMinutes(minutes),
        }),

      addSubject: ({ name, color, dailyGoalMinutes = 60 }) => {
        const created: Subject = {
          id: createId('subj'),
          name: name.trim(),
          color,
          dailyGoalMinutes: Math.max(5, Math.round(dailyGoalMinutes)),
          archived: false,
          createdAt: Date.now(),
        };
        set((state) => ({ subjects: [...state.subjects, created] }));
        return created;
      },

      updateSubject: (id, patch) =>
        set((state) => ({
          subjects: state.subjects.map((subject) =>
            subject.id === id ? { ...subject, ...patch } : subject,
          ),
        })),

      toggleArchiveSubject: (id) =>
        set((state) => ({
          subjects: state.subjects.map((subject) =>
            subject.id === id
              ? { ...subject, archived: !subject.archived }
              : subject,
          ),
        })),

      logStudySession: (subjectId, startTime, endTime) => {
        const segments = splitSessionByLogicalDay({
          subjectId,
          startTime,
          endTime,
        });
        if (segments.length > 0) {
          set((state) => ({
            sessions: [...state.sessions, ...segments],
          }));
        }
        return segments;
      },

      addTask: (input) => {
        const created: TodoTask = {
          ...input,
          id: createId('task'),
          completed: input.completed ?? false,
        };
        set((state) => ({ tasks: [...state.tasks, created] }));
        return created;
      },

      toggleTask: (taskId) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === taskId ? { ...task, completed: !task.completed } : task,
          ),
        })),

      deleteTask: (taskId) =>
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== taskId),
        })),

      addHabit: ({ name, icon, color }) => {
        const created: Habit = {
          id: createId('habit'),
          name: name.trim(),
          icon,
          color,
          archived: false,
          createdAt: Date.now(),
          completedDates: {},
        };
        set((state) => ({ habits: [...state.habits, created] }));
        return created;
      },

      toggleHabitDate: (habitId, logicalDate) =>
        set((state) => ({
          habits: state.habits.map((habit) => {
            if (habit.id !== habitId) return habit;
            const nextCompletedDates = { ...habit.completedDates };
            if (nextCompletedDates[logicalDate]) {
              delete nextCompletedDates[logicalDate];
            } else {
              nextCompletedDates[logicalDate] = true;
            }
            return { ...habit, completedDates: nextCompletedDates };
          }),
        })),

      toggleArchiveHabit: (habitId) =>
        set((state) => ({
          habits: state.habits.map((habit) =>
            habit.id === habitId
              ? { ...habit, archived: !habit.archived }
              : habit,
          ),
        })),

      setActiveTimer: (next, updatedAt = Date.now()) => {
        const nextTimer =
          typeof next === 'function' ? next(get().activeTimer) : next;
        saveActiveTimerMirror(nextTimer, updatedAt);
        set({
          activeTimer: nextTimer,
          activeTimerUpdatedAt: updatedAt,
        });
      },

      setDDayGoal: (goal) => set({ dDayGoal: goal }),

      resetAllData: () => {
        clearActiveTimerMirror();
        set({
          dailyStudyGoalMinutes: DEFAULT_DAILY_STUDY_GOAL_MINUTES,
          subjects: [],
          sessions: [],
          tasks: [],
          multiDayPlans: [],
          habits: [],
          dDayGoal: null,
          activeTimer: { ...DEFAULT_ACTIVE_TIMER },
          activeTimerUpdatedAt: 0,
        });
      },
    }),
    {
      name: STORE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state): PersistedAppData => ({
        dailyStudyGoalMinutes: state.dailyStudyGoalMinutes,
        subjects: state.subjects,
        sessions: state.sessions,
        tasks: state.tasks,
        multiDayPlans: state.multiDayPlans,
        habits: state.habits,
        dDayGoal: state.dDayGoal,
        activeTimer: state.activeTimer,
        activeTimerUpdatedAt: state.activeTimerUpdatedAt,
      }),
      onRehydrateStorage: () => (rehydratedState) => {
        if (!rehydratedState) return;
        const mirror = readActiveTimerMirror();
        if (
          mirror &&
          mirror.updatedAt > rehydratedState.activeTimerUpdatedAt
        ) {
          rehydratedState.setActiveTimer(mirror.timer, mirror.updatedAt);
        }
        rehydratedState.setHasHydrated(true);
      },
    },
  ),
);
