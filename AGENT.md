# AGENT.md — UProSC Working Memory & Guidelines

Read `AGENT.md`, `PLAN.md`, and `PROGRESS.md` at the start of every new conversation before proposing or executing changes.

---

## 1. Project Identity & Stack
- **Project:** **UProSC** — Offline-first, cross-platform Productivity & Study PWA combining **YPT** study tracking, **Apple Health** activity rings, **HabitKit** consistency heatmaps, and **Duolingo** behavioral reinforcement.
- **Target Platforms:** iOS Safari (Add to Home Screen), Android Chrome (PWA), macOS, and Windows.
- **Tech Stack:** React + TypeScript + Vite + Tailwind CSS + Zustand + IndexedDB (`idb-keyval`) + `vite-plugin-pwa` + Lucide icons + Vitest.

---

## 2. Mandatory Pedagogical Cadence (User Learning Mode)
The user is learning web development simultaneously while building UProSC. Follow this rule strictly on **every phase**:
1. **Before writing code for any phase**, explain clearly:
   - **What is currently implemented** (which files exist and how the moving parts work together).
   - **What is going to be implemented** in the upcoming phase (files, architecture, and web development concepts covered).
2. **Pause and wait for the user's explicit go-ahead** before implementing that phase.
3. Keep explanations clear, practical, and tied directly to the code being built.
4. **End-of-Phase Checklist:** After `npx tsc --noEmit`, `npx vitest run`, and `npm run build` pass and `PROGRESS.md` (and `PLAN.md` if any design changed) is updated, commit locally and run `git push origin main`. *(Note: `git push` requires network access outside the terminal sandbox, so prompt the user once for approval unless they run `git push origin main` themselves.)*

---

## 3. Non-Negotiable Architecture & Product Rules
1. **Strict 3-Tab Layout:** Navigation must strictly contain **3 primary tabs** (`Timer`, `To-Do`, `Habits`) plus a persistent **3-Ring Header**. Never add extra tabs to the main navigation bar.
2. **Modular Sub-Apps Isolation:**
   - Entry point: compact **9-dot App Launcher** in top-right header + `Cmd/Ctrl + K` shortcut.
   - Sub-apps render inside a slide-over drawer (desktop) or full-height bottom sheet/modal (mobile) **on top of** the active tab without interrupting a running timer.
   - Every sub-app lives in `src/subapps/<app-name>/` and registers `{ id, name, icon, description, component }` in `src/subapps/registry.ts` without modifying the 3 core tabs.
3. **5:00 AM Logical Study Day (`getLogicalStudyDate`):**
   - Subtract 5 hours (`5 * 3600 * 1000` ms) from the timestamp before extracting **local** `YYYY-MM-DD` (never use `.toISOString()` UTC date slicing, which shifts days in non-UTC timezones like IST `+05:30`).
   - Sessions crossing 5:00 AM are split cleanly at the 5:00 AM boundary into two logical-day records.
   - Apply this rule consistently across Focus Sessions, Today's To-Do tasks, Habits/Streaks/Heatmap, and Behavioral Companion warnings.
4. **Rings & Productivity Score:**
   - **Ring 1 (Focus Time):** `loggedStudyMinutesToday / dailyStudyGoalMinutes` (includes live active session progress).
   - **Ring 2 (Tasks):** `completedTasksToday / totalTasksDueToday`.
   - **Ring 3 (Habits):** `completedHabitsToday / totalActiveHabitsToday`.
   - **Zero-Item Rule:** When `totalTasksDueToday === 0` or `totalActiveHabitsToday === 0`, that ring displays `0%` (never `100%`).
   - **Productivity Score (0–100):** `45% Focus + 35% To-Do + 20% Habits` (each ring capped at `100%`). Streak multiplier bonus is currently deferred (keep `score.ts` cleanly structured to allow adding it later).
5. **Timer & Hardware API Accuracy:**
   - Compute elapsed time from wall-clock timestamp deltas (`Date.now() - segmentStartTime + accumulatedMs`), never from `setInterval` tick counts.
   - Persist active timer state to both IndexedDB and `localStorage` so reloads/force-quits never lose running sessions.
   - Full-Screen Mode uses the Screen Wake Lock API (`navigator.wakeLock`) with `visibilitychange` re-acquisition and a CSS `inset-0` full-screen fallback (for iPhone Safari).
6. **Visual Theme:**
   - **System-adaptive** (light & dark matching OS preference from Day 1, respecting `env(safe-area-inset-*)` for mobile notches/home indicators).

---

## 4. Environment, Git & Deployment Guardrails
- **Node/npm `PATH`:** Node (`v26.12.0`) and npm (`11.20.0`) are installed via Homebrew at `/opt/homebrew/bin`, which is not on default non-interactive sandbox `PATH`. Always prefix shell commands with `export PATH="/opt/homebrew/bin:$PATH"`.
- **Hosting Target:** **GitHub + Cloudflare Pages** (chosen for unlimited free static bandwidth and easy Git auto-deploys; Service Worker + IndexedDB make the app run 100% offline once cached).
- **Git Remote & Account Guardrail:** Do **NOT** reconfigure `origin` or modify GitHub/Cloudflare account settings automatically. Follow the **End-of-Phase Checklist** above (`commit` locally and `git push origin main`, prompting once for sandbox network approval unless the user runs it themselves).
- **Verification & Cross-Platform Testing Discipline:**
  - Run `npx tsc --noEmit`, `npx vitest run`, and `npm run build` after changes and never mark a phase done with failing checks.
  - **After every phase**, add/update tests covering **macOS, Windows, iOS, and Android** in **both Portrait and Landscape** layouts (responsive layout/safe-area/orientation checks plus interactive behavior across all 8 platform × orientation profiles).
