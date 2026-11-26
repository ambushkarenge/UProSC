import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Check,
  Cloud,
  CloudOff,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  type AccountRegistry,
  readAccountRegistrySync,
  subscribeAccountRegistry,
} from '../../store/accountManager';
import { useAppStore } from '../../store/useAppStore';
import {
  createLocalProfileAndSwitch,
  loginCloudAccount,
  logoutActiveCloudAccount,
  registerCloudAccount,
  removeUserProfileAndSwitch,
  switchToUserProfile,
  syncEngine,
  useSyncStatus,
} from '../../sync/syncEngine';

type ModalFormTab = 'local' | 'login' | 'register';

interface AccountSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatSyncTimestamp(ts: number | null): string {
  if (!ts) return 'Never synced';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

/**
 * Multi-user profile switcher, cloud sign-in/registration, and low-traffic
 * manual/periodic sync status modal.
 */
export function AccountSyncModal({ isOpen, onClose }: AccountSyncModalProps) {
  const syncStatus = useSyncStatus();
  const subjectsCount = useAppStore((s) => s.subjects.length);
  const sessionsCount = useAppStore((s) => s.sessions.length);
  const tasksCount = useAppStore((s) => s.tasks.length);
  const habitsCount = useAppStore((s) => s.habits.length);

  const [registry, setRegistry] = useState<AccountRegistry>(() =>
    readAccountRegistrySync(),
  );
  const [activeFormTab, setActiveFormTab] = useState<ModalFormTab>('local');

  const [localDisplayName, setLocalDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [copyLocalData, setCopyLocalData] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'error' | 'info' | 'success';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setRegistry(readAccountRegistrySync());
    const unsub = subscribeAccountRegistry((next) => {
      setRegistry(next);
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsub();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const activeProfile =
    registry.profiles.find((p) => p.id === registry.activeUserId) ??
    registry.profiles[0];

  const hasLocalData =
    subjectsCount > 0 || sessionsCount > 0 || tasksCount > 0 || habitsCount > 0;

  const handleSyncNow = async () => {
    setFeedback(null);
    const result = await syncEngine.syncNow({ force: true, reason: 'manual' });
    if (result.skippedReason === 'cooldown') {
      const secs = Math.max(
        1,
        Math.ceil((result.cooldownRemainingMs ?? 1000) / 1000),
      );
      setFeedback({
        tone: 'info',
        text: `Sync cooldown: wait ${secs}s before forcing another check.`,
      });
    } else if (result.error) {
      setFeedback({ tone: 'error', text: result.error });
    } else if (result.synced) {
      setFeedback({
        tone: 'success',
        text: `Synced (${result.pushedCount} sent, ${result.pulledCount} received · rev #${result.serverRevision}).`,
      });
    }
  };

  const handleCreateLocal = async (event: FormEvent) => {
    event.preventDefault();
    if (!localDisplayName.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const created = await createLocalProfileAndSwitch(localDisplayName);
      setLocalDisplayName('');
      setFeedback({
        tone: 'success',
        text: `Switched to isolated local profile "${created.displayName}".`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloudAuth = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      if (activeFormTab === 'login') {
        const profile = await loginCloudAccount({ username, password });
        setPassword('');
        setFeedback({
          tone: 'success',
          text: `Signed in as @${profile.username}. Data isolated & synced.`,
        });
      } else {
        const profile = await registerCloudAccount({
          username,
          password,
          displayName,
          copyCurrentLocalData:
            activeProfile.mode === 'local' && copyLocalData,
        });
        setPassword('');
        setCopyLocalData(false);
        setFeedback({
          tone: 'success',
          text: `Account @${profile.username} created and synced.`,
        });
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Authentication request failed.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchProfile = async (userId: string) => {
    if (userId === activeProfile.id) return;
    setFeedback(null);
    await switchToUserProfile(userId);
  };

  const handleRemoveProfile = async (userId: string, name: string) => {
    setFeedback(null);
    await removeUserProfileAndSwitch(userId);
    setFeedback({
      tone: 'info',
      text: `Removed local workspace for "${name}".`,
    });
  };

  const handleLogout = async () => {
    setFeedback(null);
    await logoutActiveCloudAccount();
    setFeedback({
      tone: 'info',
      text: 'Signed out. Your cached study data stays safely on this device.',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xs"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Accounts and cloud sync"
        className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Profiles &amp; Cloud Sync
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Strict per-user IndexedDB isolation + low-traffic delta sync
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account and sync modal"
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Active Profile & Sync Status Card */}
        <div className="mt-4 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {activeProfile.displayName}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    activeProfile.mode === 'cloud'
                      ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                      : 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {activeProfile.mode === 'cloud' ? 'Cloud Sync' : 'Local Only'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                @{activeProfile.username} ·{' '}
                {syncStatus.pendingCount === 0
                  ? '0 pending changes'
                  : `${syncStatus.pendingCount} pending ${syncStatus.pendingCount === 1 ? 'change' : 'changes'}`}
              </p>
            </div>

            {activeProfile.mode === 'cloud' && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleSyncNow()}
                  disabled={syncStatus.status === 'syncing'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-500 disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      syncStatus.status === 'syncing' ? 'animate-spin' : ''
                    }`}
                    aria-hidden="true"
                  />
                  {syncStatus.status === 'syncing' ? 'Syncing…' : 'Sync Now'}
                </button>
                {activeProfile.authState === 'authenticated' && (
                  <button
                    type="button"
                    onClick={() => void handleLogout()}
                    aria-label="Sign out of cloud sync"
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    Sign Out
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200/80 pt-2.5 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              {activeProfile.mode === 'cloud' ? (
                syncStatus.status === 'offline' ? (
                  <CloudOff className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                ) : (
                  <Cloud className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                )
              ) : (
                <User className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              )}
              {activeProfile.mode === 'cloud'
                ? `Last sync: ${formatSyncTimestamp(syncStatus.lastSyncedAt)} (rev #${syncStatus.serverRevision})`
                : 'Stored offline on this device in IndexedDB'}
            </span>
            {syncStatus.lastResultSummary && activeProfile.mode === 'cloud' && (
              <span className="text-slate-600 dark:text-slate-300">
                {syncStatus.lastResultSummary}
              </span>
            )}
          </div>

          {syncStatus.status === 'auth_required' && (
            <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Session needs re-authentication. Sign in below as @
              {activeProfile.username} to resume cloud sync.
            </p>
          )}
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            role="status"
            className={`mt-3 rounded-xl px-3 py-2 text-xs font-medium ${
              feedback.tone === 'error'
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : feedback.tone === 'success'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Saved Profiles List */}
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Device Profiles ({registry.profiles.length})
          </h3>
          <ul className="mt-2 space-y-1.5">
            {registry.profiles.map((profile) => {
              const isActive = profile.id === activeProfile.id;
              return (
                <li
                  key={profile.id}
                  className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs ${
                    isActive
                      ? 'border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30'
                      : 'border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleSwitchProfile(profile.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isActive
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {profile.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">
                        {profile.displayName}
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        @{profile.username} ·{' '}
                        {profile.mode === 'cloud' ? 'Cloud' : 'Local'}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-600/10 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleSwitchProfile(profile.id)}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Switch
                      </button>
                    )}

                    {registry.profiles.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove profile ${profile.displayName}`}
                        onClick={() =>
                          void handleRemoveProfile(profile.id, profile.displayName)
                        }
                        className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Create Local / Sign In / Register Tabs */}
        <div className="mt-5 border-t border-slate-200/80 pt-4 dark:border-slate-800">
          <div
            role="tablist"
            aria-label="Add or connect account"
            className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80"
          >
            {(
              [
                { id: 'local', label: 'New Local' },
                { id: 'login', label: 'Sign In' },
                { id: 'register', label: 'Register Cloud' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeFormTab === tab.id}
                onClick={() => {
                  setActiveFormTab(tab.id);
                  setFeedback(null);
                }}
                className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                  activeFormTab === tab.id
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeFormTab === 'local' ? (
            <form onSubmit={handleCreateLocal} className="mt-3 space-y-2.5">
              <div>
                <label
                  htmlFor="local-profile-name"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Local Profile Name
                </label>
                <input
                  id="local-profile-name"
                  type="text"
                  required
                  maxLength={40}
                  value={localDisplayName}
                  onChange={(e) => setLocalDisplayName(e.target.value)}
                  placeholder="e.g., Guest, Exam Prep, Work"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !localDisplayName.trim()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Create Isolated Local Profile
              </button>
            </form>
          ) : (
            <form onSubmit={handleCloudAuth} className="mt-3 space-y-2.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="cloud-username"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Username
                  </label>
                  <input
                    id="cloud-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="study_user"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                {activeFormTab === 'register' && (
                  <div>
                    <label
                      htmlFor="cloud-display-name"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Display Name (optional)
                    </label>
                    <input
                      id="cloud-display-name"
                      type="text"
                      maxLength={50}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                )}

                <div className={activeFormTab === 'login' ? '' : 'sm:col-span-2'}>
                  <label
                    htmlFor="cloud-password"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Password
                  </label>
                  <input
                    id="cloud-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={
                      activeFormTab === 'login'
                        ? 'current-password'
                        : 'new-password'
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              {activeFormTab === 'register' &&
                activeProfile.mode === 'local' &&
                hasLocalData && (
                  <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={copyLocalData}
                      onChange={(e) => setCopyLocalData(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span>
                      Copy data from current local profile (
                      <strong>{activeProfile.displayName}</strong>) into this
                      new cloud account
                    </span>
                  </label>
                )}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                {submitting
                  ? 'Connecting…'
                  : activeFormTab === 'login'
                    ? 'Sign In & Sync'
                    : 'Register & Enable Sync'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
