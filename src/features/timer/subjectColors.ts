export interface SubjectColorOption {
  name: string;
  hex: string;
}

export const SUBJECT_COLOR_OPTIONS: readonly SubjectColorOption[] = [
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Orange', hex: '#f97316' },
] as const;

export const QUICK_STARTER_SUBJECTS = [
  { name: 'Mathematics', color: '#f43f5e', dailyGoalMinutes: 90 },
  { name: 'Coding', color: '#0ea5e9', dailyGoalMinutes: 90 },
  { name: 'Reading', color: '#10b981', dailyGoalMinutes: 45 },
  { name: 'Deep Work', color: '#8b5cf6', dailyGoalMinutes: 60 },
] as const;
