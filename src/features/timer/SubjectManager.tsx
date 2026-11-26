import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { LogicalDate, Subject } from '../../types/domain';
import {
  formatDurationCompact,
  formatMinutesCompact,
} from '../../utils/date';
import {
  QUICK_STARTER_SUBJECTS,
  SUBJECT_COLOR_OPTIONS,
} from './subjectColors';

interface SubjectManagerProps {
  selectedSubjectId: string | null;
  onSelectSubject: (subjectId: string | null) => void;
  todayLogicalDate: LogicalDate;
  liveSubjectId: string | null;
  liveSecondsToday: number;
  isTimerActive: boolean;
}

interface SubjectFormState {
  name: string;
  color: string;
  dailyGoalMinutes: number;
}

function SubjectEditorForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: SubjectFormState;
  submitLabel: string;
  onSubmit: (values: SubjectFormState) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(
    initial.dailyGoalMinutes,
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      name: trimmed,
      color,
      dailyGoalMinutes: Math.max(5, Math.min(720, Math.round(dailyGoalMinutes))),
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 dark:border-slate-800 dark:bg-slate-950/70"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_7.5rem]">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Subject name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Organic Chemistry"
            required
            maxLength={48}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Daily goal (min)
          </span>
          <input
            type="number"
            min={5}
            max={720}
            step={5}
            value={dailyGoalMinutes}
            onChange={(e) =>
              setDailyGoalMinutes(Number(e.target.value) || 30)
            }
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 focus:border-rose-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div
          role="radiogroup"
          aria-label="Subject color"
          className="flex flex-wrap items-center gap-1.5"
        >
          {SUBJECT_COLOR_OPTIONS.map((option) => {
            const selected = color === option.hex;
            return (
              <button
                key={option.hex}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Color ${option.name}`}
                onClick={() => setColor(option.hex)}
                className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                  selected
                    ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-950'
                    : 'opacity-80 hover:opacity-100'
                }`}
                style={{ backgroundColor: option.hex }}
              >
                {selected && (
                  <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Subject CRUD manager with color swatches, archiving, per-subject daily goals,
 * and live today study totals anchored to the 5:00 AM logical study day.
 */
export function SubjectManager({
  selectedSubjectId,
  onSelectSubject,
  todayLogicalDate,
  liveSubjectId,
  liveSecondsToday,
  isTimerActive,
}: SubjectManagerProps) {
  const subjects = useAppStore((state) => state.subjects);
  const sessions = useAppStore((state) => state.sessions);
  const addSubject = useAppStore((state) => state.addSubject);
  const updateSubject = useAppStore((state) => state.updateSubject);
  const toggleArchiveSubject = useAppStore(
    (state) => state.toggleArchiveSubject,
  );
  const deleteSubject = useAppStore((state) => state.deleteSubject);

  const [isAdding, setIsAdding] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const todaySecondsBySubject = useMemo(() => {
    const map = new Map<string, number>();
    for (const session of sessions) {
      if (session.logicalDate !== todayLogicalDate) continue;
      map.set(
        session.subjectId,
        (map.get(session.subjectId) ?? 0) + Math.max(0, session.durationSeconds),
      );
    }
    if (liveSecondsToday > 0 && liveSubjectId) {
      map.set(liveSubjectId, (map.get(liveSubjectId) ?? 0) + liveSecondsToday);
    }
    return map;
  }, [liveSecondsToday, liveSubjectId, sessions, todayLogicalDate]);

  const activeSubjects = useMemo(
    () => subjects.filter((subject) => !subject.archived),
    [subjects],
  );
  const archivedSubjects = useMemo(
    () => subjects.filter((subject) => subject.archived),
    [subjects],
  );

  const handleCreate = (values: SubjectFormState) => {
    const created = addSubject(values);
    if (!isTimerActive) {
      onSelectSubject(created.id);
    }
    setIsAdding(false);
  };

  const handleQuickStarter = (preset: (typeof QUICK_STARTER_SUBJECTS)[number]) => {
    const created = addSubject(preset);
    if (!isTimerActive) {
      onSelectSubject(created.id);
    }
  };

  const handleUpdate = (subject: Subject, values: SubjectFormState) => {
    updateSubject(subject.id, values);
    setEditingSubjectId(null);
  };

  const handleArchiveToggle = (subject: Subject) => {
    if (isTimerActive && selectedSubjectId === subject.id) return;
    if (!subject.archived && selectedSubjectId === subject.id) {
      onSelectSubject(null);
    }
    toggleArchiveSubject(subject.id);
  };

  const handleDelete = (subject: Subject) => {
    if (isTimerActive && selectedSubjectId === subject.id) return;
    deleteSubject(subject.id);
    if (selectedSubjectId === subject.id) {
      onSelectSubject(null);
    }
  };

  return (
    <section
      aria-labelledby="subjects-heading"
      className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900/70"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="subjects-heading"
              className="text-sm font-bold text-slate-900 dark:text-white"
            >
              Subjects
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tap a subject to focus · today&apos;s totals reset at 5:00 AM
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingSubjectId(null);
            setIsAdding((open) => !open);
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add Subject
        </button>
      </div>

      {isAdding && (
        <SubjectEditorForm
          initial={{
            name: '',
            color:
              SUBJECT_COLOR_OPTIONS[
                subjects.length % SUBJECT_COLOR_OPTIONS.length
              ].hex,
            dailyGoalMinutes: 60,
          }}
          submitLabel="Create Subject"
          onSubmit={handleCreate}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {activeSubjects.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
            No subjects yet. Quick-add one below or create your own:
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {QUICK_STARTER_SUBJECTS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => handleQuickStarter(preset)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: preset.color }}
                />
                + {preset.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {activeSubjects.map((subject) => {
            const isSelected = selectedSubjectId === subject.id;
            const isLocked = isTimerActive && isSelected;
            const secondsToday = todaySecondsBySubject.get(subject.id) ?? 0;
            const goalSeconds = Math.max(1, subject.dailyGoalMinutes * 60);
            const pct = Math.min(100, Math.round((secondsToday / goalSeconds) * 100));

            return (
              <li
                key={subject.id}
                className={`rounded-2xl border p-3 transition ${
                  isSelected
                    ? 'border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/25'
                    : 'border-slate-200/80 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={isTimerActive}
                    onClick={() =>
                      onSelectSubject(isSelected ? null : subject.id)
                    }
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-900"
                      style={{ backgroundColor: subject.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {subject.name}
                        </span>
                        {isSelected && (
                          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                            {isLocked ? 'Focusing' : 'Selected'}
                          </span>
                        )}
                      </div>
                      <p className="tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                        {formatDurationCompact(secondsToday)} /{' '}
                        {formatMinutesCompact(subject.dailyGoalMinutes)} daily goal ({pct}%)
                      </p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAdding(false);
                        setEditingSubjectId(
                          editingSubjectId === subject.id ? null : subject.id,
                        );
                      }}
                      aria-label={`Edit ${subject.name}`}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleArchiveToggle(subject)}
                      aria-label={`Archive ${subject.name}`}
                      title={
                        isLocked
                          ? 'Stop timer before archiving active subject'
                          : `Archive ${subject.name}`
                      }
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 disabled:opacity-35 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => handleDelete(subject)}
                      aria-label={`Delete ${subject.name}`}
                      title={
                        isLocked
                          ? 'Stop timer before deleting active subject'
                          : `Delete ${subject.name}`
                      }
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-100 hover:text-rose-600 disabled:opacity-35 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {/* Subject daily progress bar */}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: subject.color,
                    }}
                  />
                </div>

                {editingSubjectId === subject.id && (
                  <SubjectEditorForm
                    initial={{
                      name: subject.name,
                      color: subject.color,
                      dailyGoalMinutes: subject.dailyGoalMinutes,
                    }}
                    submitLabel="Save Changes"
                    onSubmit={(values) => handleUpdate(subject, values)}
                    onCancel={() => setEditingSubjectId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {archivedSubjects.length > 0 && (
        <div className="mt-3 border-t border-slate-200/80 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setShowArchived((open) => !open)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {showArchived ? 'Hide' : 'Show'} Archived ({archivedSubjects.length})
          </button>

          {showArchived && (
            <ul className="mt-2 space-y-1.5">
              {archivedSubjects.map((subject) => (
                <li
                  key={subject.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/40"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full opacity-60"
                      style={{ backgroundColor: subject.color }}
                    />
                    <span className="font-medium text-slate-600 dark:text-slate-300">
                      {subject.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleArchiveSubject(subject.id)}
                      aria-label={`Restore ${subject.name}`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <ArchiveRestore className="h-3 w-3" aria-hidden="true" />
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSubject(subject.id)}
                      aria-label={`Delete ${subject.name}`}
                      className="rounded-lg p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
