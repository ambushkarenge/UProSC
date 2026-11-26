# PROGRESS.md — UProSC Live Status & Memory Log

**Current Status:** **Phase 1 Complete — Paused before Phase 2** (awaiting user's explicit go-ahead for Phase 2; Day-1 GitHub & Cloudflare Pages deployment guide ready).  
**Last Updated:** 2026-11-26

---

## 1. Current Workspace & Environment State
- **Workspace Path:** `/Users/varuntejbhukya/Documents/UProSC`
- **Phase 1 Implemented Files:**
  - `.gitignore`, `.node-version` (`22` for Cloudflare Pages compatibility)
  - `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
  - `public/icons/icon.svg`, `icon-192.png`, `icon-512.png`, `maskable-icon-512.png`, `apple-touch-icon.png`
  - `src/index.css`, `src/main.tsx`, `src/App.tsx`, `src/components/Header/AppHeader.tsx`
  - `src/test/setup.ts`, `src/__tests__/App.test.tsx`
- **Removed:** Leftover `.next/` directory deleted and Next.js `.gitignore` replaced.
- **Verified Local Toolchain & Phase 1 Checks:**
  - Node.js `v26.12.0` (`/opt/homebrew/bin/node`), npm `11.20.0`, Git `2.54.0` (`init.defaultbranch=main`)
  - `npx tsc --noEmit` passing
  - `npx vitest run` passing (`3` tests in `src/__tests__/App.test.tsx`)
  - `npm run build` passing (generates `dist/manifest.webmanifest`, `dist/sw.js` with 10 precache entries, and `dist/registerSW.js`)

---

## 2. Phase Checklist

- [ ] **Phase 1: Project Scaffold, Strict 3-Tab Shell, PWA Setup & Day-1 Live Deployment**
  - [x] Delete `.next/` and replace `.gitignore`
  - [x] Initialize Vite + React + TypeScript + Tailwind CSS + Vitest
  - [x] Configure `vite-plugin-pwa`, `manifest.webmanifest`, icons, and iOS meta tags
  - [x] Build System-Adaptive 3-Tab Shell (`Timer`, `To-Do`, `Habits`) + Header Skeleton
  - [x] Initialize local Git repository & commit #1
  - [ ] Push to chosen GitHub account & deploy via Cloudflare Pages (user step)
- [ ] **Phase 2: Time Engine, IndexedDB Persistence & Interactive 3-Ring Header**
  - [ ] Domain types (`src/types/domain.ts`)
  - [ ] 5:00 AM `getLogicalStudyDate` + boundary session splitting + unit tests
  - [ ] `45/35/20` Productivity Score + zero-item ring rules + unit tests
  - [ ] Zustand + IndexedDB (`idb-keyval`) persisted store
  - [ ] Interactive SVG 3-Ring Header + hover/long-press popovers
- [ ] **Phase 3: Focus Timer, Wake Lock, Analytics, Behavioral Engine & D-Day Tracker (Tab 1)**
  - [ ] Subject manager (CRUD, color, archive, daily goal, daily totals)
  - [ ] Timestamp-accurate Stopwatch + Countdown Pomodoro/custom timer
  - [ ] Full-Screen Mode + Screen Wake Lock API + Web Audio chime
  - [ ] D-Day target date & cumulative study-hour goal tracker
  - [ ] Daily timeline, subject donut, peak hours SVG analytics
  - [ ] Duolingo-inspired positive celebrations & pace/streak-at-risk companion
- [ ] **Phase 4: To-Do List, Multi-Day Auto-Split & Calendar / `.ics` Integration (Tab 2)**
  - [ ] Today's Tasks (5:00 AM boundary) + priority tags + Ring 2 sync
  - [ ] One-Time & Multi-Day tasks with *"Split Evenly Across Days"* + unit tests
  - [ ] Collapsible Monthly & Weekly Calendar view with task loads, spans, deadlines & D-Day
  - [ ] One-click RFC 5545 `.ics` export + unit tests
- [ ] **Phase 5: Daily Habits, Streak Engine & 5-Step Consistency Heatmap (Tab 3)**
  - [ ] Daily habits checklist (custom icons/colors, edit/archive) + Ring 3 sync
  - [ ] Current Streak & Best Streak engine (5:00 AM aware) + unit tests
  - [ ] 5-step (`0%` to `100%`) GitHub/HabitKit consistency heatmap
- [ ] **Phase 6: Modular Sub-Apps Architecture, Polish & Full PWA Audit**
  - [ ] `src/subapps/registry.ts` plugin contract & 9-dot / `Cmd+K` launcher
  - [ ] Slide-over drawer (desktop) / full-height bottom sheet (mobile) keeping timer uninterrupted
  - [ ] Starter sub-apps (Ambient Focus Audio, JSON Backup/Restore)
  - [ ] Offline airplane-mode, mobile PWA & Lighthouse verification

---

## 3. Decision & Change Log

- **2026-11-25 — Initial Audit & Plan Created:** Inspected workspace; identified Homebrew Node (`v26.12.0`), leftover `.next/` artifacts, and absence of `.git`. Designed 6-phase roadmap.
- **2026-11-25 — User Decisions Confirmed:**
  - Approved deleting leftover `.next/` and replacing `.gitignore`.
  - Chose **Cloudflare Pages + GitHub** for Day-1 hosting; user is new to both and requested **not** linking any existing local/browser account (user will supply/connect their chosen account when deploying).
  - Confirmed `0%` ring state when 0 tasks or 0 active habits exist.
  - Confirmed splitting study sessions crossing `5:00 AM` cleanly across the two logical days.
  - Confirmed **System-adaptive** light/dark theme from Day 1.
  - Confirmed **45% Focus + 35% To-Do + 20% Habits** score formula (deferred streak multiplier bonus for later).
  - Confirmed learning cadence: before each phase, explain what is implemented & what is next, then pause for explicit user go-ahead.
- **2026-11-26 — Shared Memory Docs Created:** Added `AGENT.md`, `PLAN.md`, and `PROGRESS.md` to workspace root prior to Phase 1.
- **2026-11-26 — Phase 1 Implemented & Verified:** Cleaned `.next/`, replaced `.gitignore`, added `.node-version` (`22`), scaffolded Vite 8 + React 19 + TypeScript 7 + Tailwind CSS v4 + Vitest 5 + `vite-plugin-pwa` 2, generated PNG/SVG PWA icons, built responsive 3-tab shell + 3-ring header skeleton, verified tests/build, and initialized local Git on `main`.

---

## 4. Next Immediate Step
Wait for the user's explicit go-ahead for **Phase 2** (while they optionally push Commit #1 to their chosen GitHub repo and connect Cloudflare Pages). On approval, install `zustand` and `idb-keyval`, create `src/types/domain.ts`, implement and unit-test `date.ts` (5:00 AM rule + boundary splitting) and `score.ts` (`45/35/20` + zero-item rule), wire IndexedDB persistence, and upgrade `AppHeader.tsx` with live interactive SVG rings and popovers.
