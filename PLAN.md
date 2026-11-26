# PLAN.md — UProSC Phased Implementation Plan

## 1. Product Vision & Core Loop
Build **UProSC**, an offline-first Progressive Web App (PWA) combining **YPT (Yeolpumta)** study tracking, **Apple Health** activity rings, **HabitKit** streak heatmaps, and **Duolingo** behavioral reinforcement.

- **Target Platforms:** iOS (Safari Add to Home Screen), Android (Chrome PWA), macOS, and Windows.
- **Strict Layout Rule:** Strictly **3 primary tabs** (`Timer`, `To-Do`, `Habits`) plus a persistent **3-Ring Header** and top-right **9-dot App Launcher**.

---

## 2. Confirmed Design Decisions
- **Workspace Cleanup:** Approved to delete leftover `.next/` directory and replace the Next.js `.gitignore` when starting Phase 1.
- **Day-1 Hosting:** **Cloudflare Pages + GitHub** (user will supply/connect their own chosen accounts; do not auto-link any existing account).
- **Zero-Item Ring Behavior:** `0%` when 0 tasks are due or 0 habits are active.
- **Productivity Score:** `45% Focus + 35% To-Do + 20% Habits` (each ring capped at `100%`). Streak multiplier bonus is deferred for later.
- **5:00 AM Boundary Crossing:** Split study sessions cleanly at `5:00 AM` local time across the two logical days.
- **Theme:** **System-adaptive** (light & dark matching OS preference from Day 1).
- **Multi-User Isolation & Cross-Device Sync (Added 2026-11-27):** Support multiple distinct users with strictly isolated local & synced data, zero data loss on webpage close (auto-restoring the active user from IndexedDB + `pagehide` flush), and **low-traffic cross-device sync** (visibility-gated periodic sync + user-forced **Sync Now**, revision-checked so unchanged polls transfer near-zero bytes). Added as **Phase 3B (immediate priority before Phase 4)** and carried through Phases 4–6.
- **Sync Backend (Confirmed Option 1 — 2026-11-27):** **Cloudflare Worker API (`/api/auth/*`, `/api/sync/*`) + Cloudflare D1 (SQLite)** running on the same origin as the deployed PWA (`wrangler.jsonc` + static assets + D1 binding) — zero extra vendor accounts, no 7-day inactivity sleep, and zero CORS preflight overhead.
- **Execution Workflow:** Explain *"what is implemented / what is going to be implemented"* and wait for user approval before executing each phase.

---

## 3. System Architecture

```mermaid
flowchart TD
    Shell["App Shell (3-Tab Navigation + Safe Areas)"]
    Header["Persistent 3-Ring Header + User/Sync Pill + 9-Dot Launcher"]
    Store["Zustand Store + User-Scoped IndexedDB (uprosc-app-state:userId)"]
    Sync["Low-Traffic Delta Sync Engine (Periodic + Forced Sync Now)"]
    Cloud["Same-Origin Cloud Sync API + D1 SQLite (Cloudflare Worker + D1)"]
    Time["Time Engine (getLogicalStudyDate - 5:00 AM Rule)"]
    Tab1["Tab 1: Focus Timer + Wake Lock + Analytics + D-Day"]
    Tab2["Tab 2: To-Do + Multi-Day Split + Calendar + .ics"]
    Tab3["Tab 3: Habits + Streaks + 5-Step Heatmap"]
    Registry["Sub-App Registry (src/subapps/registry.ts)"]
    Drawer["Drawer / Bottom Sheet Overlay (Background Timer Uninterrupted)"]

    Shell --> Header
    Shell --> Tab1
    Shell --> Tab2
    Shell --> Tab3
    Header -->|"Cmd+K / 9-Dot"| Drawer
    Drawer --> Registry
    Header --> Store
    Header -->|"Sync Now / Account"| Sync
    Tab1 --> Store
    Tab2 --> Store
    Tab3 --> Store
    Store --> Time
    Store <-->|"Dirty Deltas + Revision Check"| Sync
    Sync <-->|"Same-Origin JSON / ETag"| Cloud
```

### Shared Core Domain Types (`src/types/domain.ts`)

```ts
export type LogicalDate = string; // "YYYY-MM-DD" shifted back by 5 hours (local time)

export interface UserProfile {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  lastSyncedAt: number | null;
  serverRevision: number;
}

export interface SyncableRecord {
  updatedAt: number;      // epoch ms for per-entity last-write-wins merge
  deletedAt?: number;     // tombstone epoch ms so cross-device deletes propagate cleanly
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
  endTime: number;   // epoch ms
  durationSeconds: number;
  logicalDate: LogicalDate;
}

export interface TodoTask extends SyncableRecord {
  id: string;
  title: string;
  logicalDate: LogicalDate;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  parentMultiDayId?: string;
  sliceIndex?: number;       // e.g., 1
  sliceTotal?: number;       // e.g., 10
  unitTarget?: number;       // e.g., 20 (pages)
  unitLabel?: string;        // e.g., "pages"
  scheduledTime?: string;    // "HH:mm" optional for .ics export
}

export interface MultiDayTaskPlan extends SyncableRecord {
  id: string;
  title: string;
  startDate: LogicalDate;
  endDate: LogicalDate;
  totalUnits?: number;
  unitLabel?: string;
  splitEvenly: boolean;
  priority: 'low' | 'medium' | 'high';
}

export interface Habit extends SyncableRecord {
  id: string;
  name: string;
  icon: string;
  color: string;
  archived: boolean;
  createdAt: number;
  completedDates: Record<LogicalDate, boolean>;
  completedDateUpdatedAt?: Record<LogicalDate, number>; // per-day merge timestamps
}
```

---

## 4. Phased Roadmap

### Phase 1: Project Scaffold, Strict 3-Tab Shell, PWA Setup & Day-1 Live Deployment
- **Goal:** Create a clean, installable Vite + React + TS + Tailwind PWA shell with strict 3-tab navigation and initialize local Git ready for Cloudflare Pages deployment.
- **Web Dev Concepts:** Vite bundling, TypeScript config, Tailwind utility layout & iOS `env(safe-area-inset-*)`, PWA `manifest.webmanifest` + Service Workers (`vite-plugin-pwa`), Git workflow & Cloudflare Pages CI/CD.
- **Files:**
  - `[DELETE]` `.next/`
  - `[MODIFY]` `.gitignore`
  - `[NEW]` `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `public/icons/*`
  - `[NEW]` `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/components/Header/AppHeader.tsx`
- **Hosting Step:** Initialize local `git init` and initial commit, then guide the user to push to their chosen GitHub repo and connect Cloudflare Pages for an immediate `https://...` PWA URL.

### Phase 2: Time Engine, IndexedDB Persistence & Interactive 3-Ring Header
- **Goal:** Build the 5:00 AM logical date engine, offline-first Zustand + IndexedDB store, and live interactive 3-Ring Global Header with `45/35/20` Productivity Score.
- **Web Dev Concepts:** Local vs UTC `Date` pitfalls, Vitest unit testing, IndexedDB (`idb-keyval`) vs `localStorage`, Zustand selectors, SVG circle progress geometry (`stroke-dasharray` / `stroke-dashoffset`), hover & touch-hold popovers.
- **Files:**
  - `[NEW]` `src/types/domain.ts`, `src/utils/date.ts`, `src/utils/score.ts`, `src/utils/__tests__/date.test.ts`, `src/utils/__tests__/score.test.ts`
  - `[NEW]` `src/store/idbStorage.ts`, `src/store/useAppStore.ts`
  - `[NEW]` `src/components/Header/ActivityRing.tsx`, `[MODIFY]` `AppHeader.tsx`

### Phase 3: Focus Timer, Wake Lock, Analytics, Behavioral Engine & D-Day Tracker (Tab 1)
- **Goal:** Implement count-up stopwatch + countdown Pomodoro/custom blocks, subject management, timestamp-accurate logging, Full-Screen + Screen Wake Lock API, D-Day goal tracker, SVG analytics charts, and Duolingo-inspired positive/loss-aversion companion.
- **Web Dev Concepts:** Timestamp-delta timing vs `setInterval` throttling, Screen Wake Lock & Page Visibility APIs, Web Audio synthesis chimes, custom SVG charts (timeline, donut, peak hours), behavioral pace derivation.
- **Files:**
  - `[NEW]` `src/hooks/useTimestampTimer.ts`, `src/hooks/useWakeLock.ts`, `src/utils/sound.ts`, `src/utils/focusAnalytics.ts`, `src/utils/behavioral.ts`
  - `[NEW]` `src/features/timer/TimerTab.tsx`, `FullScreenClock.tsx`, `SubjectManager.tsx`, `DDayTracker.tsx`, `BehavioralCompanion.tsx`, `FocusAnalytics.tsx`, `subjectColors.ts`
  - `[MODIFY]` `src/types/domain.ts`, `src/utils/score.ts`, `src/store/useAppStore.ts`, `src/components/Header/AppHeader.tsx`, `src/App.tsx`

### Phase 3B (Immediate Priority Before Phase 4): Multi-User Profiles, Isolated Persistence & Low-Traffic Cross-Device Sync
- **Goal:** Support multiple users with strictly isolated local & cloud data, guarantee zero data loss across webpage closes (auto-restoring the active user immediately from IndexedDB + `pagehide` flush + seamless migration of any Phase 1–3 single-user data), and add low-traffic cross-device sync (visibility-gated periodic sync + user-forced **Sync Now** without hammering user bandwidth or server traffic).
- **Web Dev Concepts:** Multi-tenant client storage namespacing (`uprosc-app-state:${userId}`), WebCrypto PBKDF2 password hashing & signed HttpOnly/Bearer tokens on Cloudflare Workers, D1 SQLite schema & migrations, offline-first dirty tracking & tombstone deletions (`updatedAt` / `deletedAt`), delta sync & ETag/revision checks (zero payload when idle), `pagehide` + `keepalive` reliability, and entity-level conflict resolution.
- **Files:**
  - `[NEW]` `wrangler.jsonc` (Cloudflare Worker + Static Assets `./dist` + D1 database binding `DB`)
  - `[NEW]` `migrations/0001_multi_user_sync.sql` (D1 SQLite tables: `users`, `auth_sessions`, `user_revisions`, `sync_entities`)
  - `[NEW]` `worker/index.ts`, `worker/auth.ts`, `worker/sync.ts` (Cloudflare Worker routes `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/sync/meta`, `/api/sync`)
  - `[NEW]` `src/store/accountManager.ts` (active user index, profile switching, one-time migration of legacy `uprosc-app-state` to first user)
  - `[NEW]` `src/sync/syncEngine.ts`, `src/sync/merge.ts`, `src/sync/types.ts`, `src/sync/apiClient.ts` (revision check, delta push/pull, per-entity last-write-wins + session/habit-date merge, visibility-gated periodic sync, forced sync cooldown)
  - `[NEW]` `src/sync/__tests__/merge.test.ts`, `src/sync/__tests__/syncEngine.test.ts`, `worker/__tests__/syncWorker.test.ts`
  - `[NEW]` `src/components/Header/AccountSyncModal.tsx` (sign-in/register/switch local or synced user, **Sync Now** button, last-synced & pending-changes status)
  - `[MODIFY]` `vite.config.ts` (local `/api` dev proxy + exclude `/api/*` from PWA navigation fallback), `src/types/domain.ts`, `src/store/idbStorage.ts`, `src/store/useAppStore.ts`, `src/components/Header/AppHeader.tsx`, `src/hooks/useTimestampTimer.ts`, `src/__tests__/crossPlatformLayout.test.tsx`

### Phase 4: To-Do List, Multi-Day Auto-Split & Calendar / `.ics` Integration (Tab 2)
- **Goal:** Implement Today's Tasks (5:00 AM boundary) with priority tags feeding Ring 2, One-Time & Multi-Day tasks with *"Split Evenly Across Days"*, collapsible Monthly/Weekly Calendar view (task loads, spans, deadlines, D-Day), and one-click RFC 5545 `.ics` export — with all tasks and plans scoped strictly per active user (`userId`) and stamped (`updatedAt` / `deletedAt`) for low-traffic cross-device delta sync.
- **Web Dev Concepts:** Relational client state (`MultiDayTaskPlan` + daily `TodoTask` slices), remainder-balanced integer division, CSS Grid calendar layouts, client-side `Blob` download + `.ics` spec, and per-task sync dirty marking without per-click network calls.
- **Files:**
  - `[NEW]` `src/utils/taskSplit.ts`, `src/utils/icsExport.ts`, `src/utils/__tests__/taskSplit.test.ts`, `src/utils/__tests__/icsExport.test.ts`
  - `[NEW]` `src/features/todo/TodoTab.tsx`, `TaskComposerModal.tsx`, `CalendarView.tsx`
  - `[MODIFY]` `src/store/useAppStore.ts`, `src/sync/merge.ts` (add user-scoped `MultiDayTaskPlan` & `TodoTask` sync merge support)

### Phase 5: Daily Habits, Streak Engine & 5-Step Consistency Heatmap (Tab 3)
- **Goal:** Implement Daily Habits checklist (one-tap checkboxes, custom icons/colors) feeding Ring 3, Current & Best Streak engine (5:00 AM boundary aware), and a GitHub/HabitKit-style 5-step intensity consistency heatmap — scoped strictly per active user (`userId`) with per-date check-in merge timestamps so concurrent habit check-ins on phone and desktop merge seamlessly without overwriting each other.
- **Web Dev Concepts:** Time-series streak calculation (avoiding morning false-zero resets), 5-step discrete intensity mapping (`0%` to `100%`), memoized grid aggregation, touch/hover heatmap tooltips, and per-date map CRDT/LWW merging across devices.
- **Files:**
  - `[NEW]` `src/utils/habitStats.ts`, `src/utils/__tests__/habitStats.test.ts`
  - `[NEW]` `src/features/habits/HabitsTab.tsx`, `ConsistencyHeatmap.tsx`
  - `[MODIFY]` `src/store/useAppStore.ts`, `src/sync/merge.ts` (per-date `completedDateUpdatedAt` merge across devices)

### Phase 6: Modular Sub-Apps Architecture, Landscape Optimization & Full PWA Audit
- **Goal:** Implement `src/subapps/registry.ts` plugin registry, 9-dot App Launcher (`Cmd/Ctrl + K`), responsive Drawer (desktop) / Bottom Sheet (mobile) overlay keeping active timers uninterrupted, starter sub-apps (Ambient Focus Audio + User-Scoped JSON Backup/Sync Diagnostics), **Landscape Optimization** across all 3 tabs + Header user/sync pill + Full-Screen Timer (handling short viewports, left/right notched safe areas `env(safe-area-inset-left/right)`, and split two-column layouts on mobile/tablet landscape), and full offline/cross-platform PWA audit.
- **Web Dev Concepts:** Plugin/registry architecture, `React.lazy` & `Suspense` code splitting, global keyboard shortcuts & accessible modals, Web Audio noise synthesis, responsive `orientation: landscape` & short-viewport (`max-height`) CSS/Tailwind layouts + safe-area insets, Lighthouse PWA & offline verification.
- **Files:**
  - `[NEW]` `src/subapps/types.ts`, `src/subapps/registry.ts`, `src/components/SubAppHost/AppLauncherPopover.tsx`, `SubAppDrawer.tsx`
  - `[NEW]` `src/subapps/ambient-audio/*`, `src/subapps/backup-sync/*` (user-scoped backup export/import + sync diagnostics/conflict inspector)
  - `[MODIFY]` App shell, Header (including user/sync pill), Full-Screen Timer, Calendar, and Heatmap layouts for **Landscape Optimization**

---

## 5. Verification Plan
- **Automated Tests (Vitest), Typecheck & Build:** Run `export PATH="/opt/homebrew/bin:$PATH" && npx tsc --noEmit && npx vitest run && npm run build` after every phase.
- **Per-Phase Cross-Platform Portrait & Landscape Tests:** After every phase, add/update automated tests covering **macOS, Windows, iOS, and Android** in **both Portrait and Landscape** layouts (verifying safe-area insets, short-viewport landscape rules, light/dark `prefers-color-scheme` support, and phase UI interactions across all 8 profiles in `src/__tests__/crossPlatformLayout.test.tsx` or feature tests).
- **Manual Cross-Platform PWA Verification:**
  - Install via iOS Safari (`Add to Home Screen`) and Chrome (`Install App`) using live Cloudflare HTTPS URL.
  - Verify strict 3-tab + 3-ring layout with safe-area padding (portrait & **Landscape Optimization** on mobile/tablet) on macOS, Windows, iOS, and Android, plus light/dark OS theme adaptation.
  - Verify multi-user data isolation (switching between 2 users keeps subjects, sessions, timers, tasks, and habits 100% separate), webpage close/reopen retention, periodic background sync (zero-byte/minimal traffic when unchanged), manual **Sync Now**, and cross-device consistency.
  - Test Airplane Mode offline reload, background timer wall-clock accuracy, Screen Wake Lock in full-screen, cross-tab Ring/Score updates, and uninterrupted background timer while opening Sub-Apps.
