# RecruitQuest — Technical Requirements Document (TRD)

**Version:** MVP 1.0 · **Status:** Final for implementation · **Last updated:** 2026-08-06

This document consolidates all implementation-level requirements from the PRD, app-flow, UI/UX, and architecture docs into a single reference for developers. It is the "what to build" checklist; the architecture doc explains "how it fits together."

---

## 1. Functional Requirements

### 1.1 Event & Activity Management

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| F-EVT-01 | Create/load an event config (JSON) | Admin can load a template, edit JSON in dashboard, validate against schema, save to DB |
| F-EVT-02 | Event lifecycle: draft → waiting → running → ended | State machine enforced server-side; transitions only via admin actions |
| F-EVT-03 | Activity sequence defined in config | Multiple activities of different types can be configured; order is from `activities[].seq` |
| F-EVT-04 | Activity lifecycle: Waiting → Running → Paused → Running → Completed → Scored | Shared `ActivityRuntime` drives transitions; each activity implements `onStart/onPause/onResume/onEnd` |
| F-EVT-05 | Admin passcode gate on `/admin` | Wrong passcode retries; no accounts; passcode stored hashed in event config |
| F-EVT-06 | Config hot-reload (where safe) | Admin can edit JSON, click Reload; non-disruptive changes apply immediately; disruptive changes warn |

### 1.2 Team Management

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| F-TEAM-01 | Create team: name → validate → generate Team Code | Unique name (case-insensitive), ≤20 chars, allowed charset; returns 6-char code (unambiguous alphabet) |
| F-TEAM-02 | Team Code shown once + copy + localStorage | Code displayed with "save this" callout; copy button; auto-stored in localStorage |
| F-TEAM-03 | Join by Team Code | Enter 6-char code → joins team; auto-reconnect if code in localStorage |
| F-TEAM-04 | Single active device per team | Second device with same code takes over; first device gets `session:inactive` |
| F-TEAM-05 | No team cap | Unlimited teams; admin can view/remove from roster |
| F-TEAM-06 | Reconnect restores state | Refresh/new device → server replays current activity state, locked answers preserved |

### 1.3 Quiz Activity

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| F-QUIZ-01 | One question at a time; per-question timer | Question + options rendered; timer counts down from `timerSeconds` |
| F-QUIZ-02 | Selecting locks immediately (no back) | Tap option → locked; visual feedback (accent-soft + checkmark); no change allowed |
| F-QUIZ-03 | Timer expiry locks and auto-advances | At 0:00 → answer locked (or blank recorded); 1–2s interstitial → next question |
| F-QUIZ-04 | Scoring: correctness × time window | Configurable: full points within first 25% of timer; reduced after; 0 if wrong |
| F-QUIZ-05 | Wrong lock shows danger, no correct-answer reveal | Row turns red; correct answer not shown |
| F-QUIZ-06 | Submissions idempotent, stored per (activity, team) | Duplicate submissions ignored; server authoritative |

### 1.4 Market Simulation Activity

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| F-MKT-01 | Initialize identical portfolios for all teams | Starting cash + 1 share of each company at initial price |
| F-MKT-02 | Scenario appears → decision window (Buy/Sell/Hold per company) | Scenario title/description shown; per-company segmented control; default Hold |
| F-MKT-03 | Decision window configurable (default 45–60s) | Timer counts down; server closes window at deadline |
| F-MKT-04 | Missing decisions = Hold | Teams that don't submit are recorded as Hold for all companies |
| F-MKT-05 | Price effects apply, portfolios recompute, next round | Effects from config applied; prices updated; holdings × new prices = new value |
| F-MKT-06 | Admin can Pause / Advance Next Scenario | Manual control overrides auto-advance |
| F-MKT-07 | Scoring = final portfolio value (cash + holdings × current price) | No manual scoring; higher value = higher rank |
| F-MKT-08 | Teams see live portfolio during simulation (cash, holdings, value) | Bottom strip always visible; updates after each round |
| F-MKT-09 | End state: only final portfolio value shown to teams | No history/charts; team screen shows final value |
| F-MKT-10 | Config flag for "predict-first" mode (future) | `mode: "reactive" | "predict-first"` in config; same engine, different sequencing |

### 1.5 Scoring & Leaderboards

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| F-SCR-01 | Automatic scoring per activity | `calculateScore` runs at `onEnd`; writes `score` rows with `source: 'auto'` |
| F-SCR-02 | Admin override score (value + optional note) | Admin edits a team's activity/total score; `source: 'admin_override'`; leaderboards recompute |
| F-SCR-03 | Overall total = sum of activity scores (with overrides) | Deterministic; ties broken by configured tie-breaker |
| F-SCR-04 | Per-activity and overall leaderboards | Rank, Team, Score; admin-only in-app |
| F-SCR-05 | Leaderboard projection: Rank + Value only (no P/L, delta) | Large high-contrast rows; live updates; external display only |

### 1.6 Real-Time & Reliability

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| F-RT-01 | Server-authoritative timers | Deadlines stored as `ends_at`; pause/resume recomputes; clients display + re-sync |
| F-RT-02 | Socket rooms isolate data | Admin room gets everything; team rooms get shared + private only; no cross-team leaks |
| F-RT-03 | Reconnect restores exact state | `event:state` snapshot scoped to team; current question/round, remaining time, locked answers |
| F-RT-04 | Server restart restores event | SQLite persisted state; runtime re-hydrated from timestamps; completed activities stay scored |
| F-RT-05 | Takeover is hard and instant | New socket → active; old socket → `session:inactive` immediately |

---

## 2. Non-Functional Requirements

| ID | Category | Requirement | Target |
|---|---|---|---|
| NF-PERF-01 | Latency | Socket round-trip on venue Wi-Fi | < 300ms p95 |
| NF-PERF-02 | Concurrency | Simultaneous connected clients (1 event) | 100+ |
| NF-PERF-03 | Startup | Cold boot to ready | < 10s |
| NF-REL-01 | Data loss | Zero data loss on refresh/reconnect/restart | Verified by tests |
| NF-REL-02 | Timer drift | Client vs server timer divergence | < 500ms (re-sync every 10s) |
| NF-SEC-01 | Admin access | Passcode gate; hashed storage | No plaintext passcode in DB |
| NF-SEC-02 | Team isolation | Team A never receives Team B's data | Enforced by socket rooms |
| NF-SEC-03 | Input validation | All submissions validated server-side (schema + state machine) | No client-trusted data |
| NF-UX-01 | Mobile-first | Team screens usable one-handed on 375px width | Verified on iPhone SE / Android small |
| NF-UX-02 | Readability | Timer ≥ 56px; body ≥ 17px; contrast ≥ 4.5:1 | Passes axe / Lighthouse |
| NF-UX-03 | Projector mode | Leaderboard readable at 3m on 1080p projector | Rank + Value at ≥ 48px |
| NF-OPS-01 | Deployment | Frontend on Vercel; backend on Railway/Render with persistent disk | One-command deploy |
| NF-OPS-02 | Backup/restore | SQLite file copy = full backup; restore = replace file | < 1 min |
| NF-MAINT-01 | Config change | New quiz questions / market scenarios / scoring weights require **only** JSON edit | No code deploy |
| NF-MAINT-02 | New activity | Add activity type by implementing interface + schema + renderer; **no** shell changes | < 1 day |

---

## 3. Technical Specifications

### 3.1 Stack (locked)

| Layer | Technology | Version constraint |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | React ≥18, Vite ≥5, TS ≥5 |
| Styling | Tailwind CSS | ≥3.4 |
| Routing | React Router | ≥6 |
| Realtime | Socket.IO client + server | ≥4.7 |
| Backend | Node.js + Express + TypeScript | Node 20 LTS, Express ≥4.18 |
| ORM | Drizzle ORM | ≥0.30 |
| Database | SQLite (better-sqlite3) | ≥9 |
| Admin UI kit | shadcn/ui (Radix + Tailwind) | Latest |
| Client state | Zustand | ≥4.5 |
| Validation | Zod | ≥3.22 |
| Testing | Vitest (unit) + Playwright (e2e) | Latest |
| Lint/Format | ESLint + Prettier | Flat config |

### 3.2 Shared Types Package (`packages/types`)

Exports (consumed by both `apps/web` and `apps/server`):

- `EventConfig`, `ActivityConfig` (discriminated union by `type`)
- `QuizConfig`, `MarketConfig` with full zod schemas
- Socket event payload types (client↔server)
- `Team`, `Activity`, `Submission`, `Score` DTOs
- `ActivityType = 'quiz' | 'market-simulation'`

### 3.3 Activity Package (`packages/activities`)

Per activity type, exports:

```ts
export const QuizActivity: Activity<QuizConfig> = { ... }
export const MarketActivity: Activity<MarketConfig> = { ... }
export const activityRegistry = { quiz: QuizActivity, 'market-simulation': MarketActivity }
export const quizConfigSchema = z.object({ ... })
export const marketConfigSchema = z.object({ ... })
```

Server imports logic; client imports only schemas + type guards for rendering.

### 3.4 Database Schema (Drizzle → SQLite)

```sql
-- event
CREATE TABLE event (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config JSON NOT NULL,
  passcode_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','waiting','running','ended')),
  created_at TEXT, started_at TEXT, ended_at TEXT
);

-- team
CREATE TABLE team (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id),
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  team_code TEXT NOT NULL UNIQUE,
  total_score REAL NOT NULL DEFAULT 0,
  active_conn TEXT,   -- runtime socket id
  created_at TEXT
);
CREATE UNIQUE INDEX team_name_lower ON team(event_id, name_lower);

-- activity
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES event(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  config JSON NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT, ended_at TEXT
);

-- submission
CREATE TABLE submission (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activity(id),
  team_id TEXT NOT NULL REFERENCES team(id),
  payload JSON NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE(activity_id, team_id)
);

-- score
CREATE TABLE score (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activity(id),
  team_id TEXT NOT NULL REFERENCES team(id),
  value REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto','admin_override')),
  note TEXT,
  adjusted_at TEXT NOT NULL,
  UNIQUE(activity_id, team_id)
);
```

### 3.5 Socket Event Contract

**Namespaces / Rooms**

- `event:{eventId}:admin` — admin only
- `event:{eventId}:team` — all teams
- `team:{teamId}` — single active device per team
- `event:{eventId}` — global broadcast (start/end)

**Server → Team**

| Event | Payload | When |
|---|---|---|
| `event:state` | `{ event, activity, phase, timer, nextUp }` | On join, reconnect, any state change |
| `activity:started` | `{ activityId, type, config, deadline }` | Admin starts activity |
| `activity:paused` | `{ pausedAt, remainingMs }` | Admin pauses |
| `activity:resumed` | `{ deadline }` | Admin resumes |
| `activity:ended` | `{ activityId }` | Admin ends activity |
| `activity:next-up` | `{ seq, type, title, duration }` | Between activities |
| `timer:sync` | `{ now, deadline }` | Every ~10s + on pause/resume |
| `quiz:question` | `{ index, total, question, options, deadline }` | New question (or on reconnect) |
| `quiz:locked` | `{ index, answer, correct, points }` | After lock (timer expiry or selection) |
| `quiz:complete` | `{ totalScore }` | After last question |
| `market:scenario` | `{ round, total, scenario, companies, prices, deadline }` | New round |
| `market:decision-closed` | `{ round, effects, newPrices, portfolio }` | Window closed |
| `market:finished` | `{ finalValue }` | After last round |
| `team:takeover` | `{ reason: 'new_device' }` | Another device joined |
| `session:inactive` | `{ reason }` | This device lost control |

**Server → Admin**

| Event | Payload |
|---|---|
| `teams:list` | `TeamSummary[]` (name, code, online, score, status) |
| `team:joined` \| `team:left` \| `team:online` \| `team:offline` | `{ teamId }` |
| `submission:received` | `{ activityId, teamId, payload, at }` |
| `activity:scored` | `{ activityId, scores: { teamId, value, source }[] }` |
| `leaderboard:per-activity` | `{ activityId, rows: { rank, teamId, name, score }[] }` |
| `leaderboard:overall` | `{ rows: { rank, teamId, name, totalScore }[] }` |
| `score:override-applied` | `{ activityId?, teamId, newValue, source, note }` |

**Client → Server**

| Event | Payload | Auth |
|---|---|---|
| `team:create` | `{ name }` | None |
| `team:join` | `{ code }` | None |
| `team:submit` | `{ activityId, payload }` | Team room membership |
| `admin:auth` | `{ passcode }` | None |
| `admin:start-activity` | `{ activityId }` | Admin token |
| `admin:pause-activity` | `{ activityId }` | Admin token |
| `admin:resume-activity` | `{ activityId }` | Admin token |
| `admin:end-activity` | `{ activityId }` | Admin token |
| `admin:next-scenario` | `{ activityId }` | Admin token |
| `admin:override-score` | `{ activityId?, teamId, value, note }` | Admin token |
| `admin:reveal-leaderboard` | `{ activityId?, scope: 'per-activity'|'overall' }` | Admin token |
| `admin:reload-config` | `{ eventId }` | Admin token |

### 3.6 API Endpoints (HTTP, for bootstrapping only)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/event/:id/config` | Initial config load for admin editor |
| POST | `/api/event` | Create event from template (admin) |
| GET | `/api/event/:id` | Event summary (admin dashboard) |
| GET | `/api/team/:code/validate` | Quick validate code exists (optional) |

All realtime operations use Socket.IO; HTTP is only for initial page data.

### 3.7 Timer Service Spec

- **Single source of truth**: `TimerService` holds a `Map<activityId, { deadline, pausedAt?, pausedDuration? }>`
- **Start**: `deadline = Date.now() + durationMs`; persist to DB
- **Pause**: `pausedAt = Date.now()`; broadcast `pausedAt` + `remainingMs = deadline - pausedAt`
- **Resume**: `pausedDuration += Date.now() - pausedAt`; `deadline = Date.now() + remainingMs`; persist
- **Tick**: every 10s broadcast `timer:sync { now: Date.now(), deadline }` to relevant rooms
- **Expiry**: `setTimeout` at `deadline` fires `onTimerExpiry(activityId)` → activity handles (lock question, close market window, etc.)

### 3.8 Scoring Formulas (Configurable)

**Quiz** (per question):
```ts
// config.scoring = { timeWindow: 0.25, fullPointsWindow: true, slope?: number }
if (!correct) return 0;
const elapsedRatio = elapsedMs / timerMs;
if (elapsedRatio <= timeWindow) return fullPoints;
if (fullPointsWindow) return Math.round(fullPoints * (1 - (elapsedRatio - timeWindow) / (1 - timeWindow)));
return Math.round(fullPoints * 0.5); // fallback reduced
```

**Market**: `finalValue = cash + Σ(holdings[company] × currentPrice[company])`

**Tie-breakers** (config per activity):
- `total-response-time` (quiz)
- `total-correct` (quiz)
- `earlier-registration` (default)

### 3.9 UI Token Spec (from ui-ux.md)

```css
:root {
  --bg: #FAFAFA;
  --surface: #FFFFFF;
  --ink: #111827;
  --muted: #6B7280;
  --accent: #4F46E5;       /* indigo — single accent */
  --accent-soft: rgba(79,70,229,0.1);
  --danger: #DC2626;
  --success: #16A34A;
  --border: #E5E7EB;
}
```

Typography scale (team screens):
- Timer hero: 64px / 700 / `--accent` (running) / `--ink` (paused)
- Title: 24px / 600
- Body: 18px
- Control: 16px
- Meta: 13px / `--muted`

---

## 4. Implementation Milestones (from architecture.md §15)

| # | Milestone | Deliverable | Exit Criteria |
|---|---|---|---|
| 1 | **Skeleton** | Monorepo, shared types, socket echo, `/team` + `/admin` shells | Two phones + admin connect; `team:create` → lobby; admin sees roster |
| 2 | **Teams** | Create/join/takeover/reconnect, admin roster | Refresh mid-lobby restores; device takeover works; no duplicate names |
| 3 | **Config System** | Zod schemas, JSON editor with validation, template loader | Default template loads; edit → validate → save → reload works |
| 4 | **Quiz** | Lifecycle, per-question timers, scoring, admin control | 10-question quiz runs end-to-end; scores appear in admin; pause/resume/end works |
| 5 | **Market** | Portfolio init, rounds, decisions, effects, scoring | 5-round market runs; live portfolio on team; final values score correctly |
| 6 | **Leaderboards + Projection** | Admin per-activity/overall boards, projector mode, winner reveal | Projector view shows Rank+Value large; winner reveal screen exists |
| 7 | **Reliability + Deploy** | Reconnect polish, restart recovery, Vercel + Railway deploy | Full event survives refresh/server restart; deployed URLs work |

---

## 5. Test Requirements (from architecture.md §14)

| Layer | Coverage |
|---|---|
| Activity engines | 100% of lifecycle transitions, scoring formulas, market math, Hold defaults |
| Timer service | Fake-timer tests for lock/advance/expiry/pause/resume paths |
| Socket wiring | Two team sockets + admin socket; assert room isolation, takeover, reconnect snapshot |
| Reliability | Reconnect restores exact state; duplicate submissions idempotent; takeover instant |
| E2E (thin) | Playwright: create team → quiz → market → results (happy path) |
| Config | Schema validation tests; default template passes its own schema |

---

## 6. Deployment & Ops

| Item | Spec |
|---|---|
| Frontend | `vercel deploy --prod` from `apps/web` |
| Backend | Railway/Render service from `apps/server`; Node 20; `npm run start` |
| SQLite | Persistent volume at `/data/event.db`; backup = `cp /data/event.db /backup/event-$(date +%F).db` |
| Env vars | `VITE_SOCKET_URL` (frontend); `PORT=3000`, `DATABASE_URL=file:/data/event.db` (backend) |
| Scaling | Single instance for MVP; multi-instance path documented in architecture §12–13 |

---

## 7. Acceptance Checklist (Definition of Done)

The MVP is **done** when all of the following are true:

- [ ] A full event (Quiz 15min + Market 15min) runs from one admin dashboard with **zero code changes**
- [ ] 30+ teams onboard in < 5 minutes with no organizer assistance
- [ ] Quiz scores (correctness × time) and Market scores (final portfolio) compute automatically
- [ ] Admin can override any score; leaderboards recompute deterministically
- [ ] Projector leaderboard shows Rank + Value in large high-contrast rows; teams never see it
- [ ] Browser refresh / lost Wi-Fi / device switch / server restart → **zero data loss**, state restored
- [ ] Teams spend ≥ 80% of activity time discussing, not tapping screens (qualitative)
- [ ] Default event template (quiz questions, 10 companies, 8 scenarios) works out of the box
- [ ] All NFR targets in §2 met (latency, concurrency, accessibility, readability)
- [ ] Deployed to Vercel + Railway/Render; one-command redeploy works

---

## 8. Future-Proofing Notes (not MVP, but designed for)

- **New activities**: Implement `Activity<TConfig>` interface + register; add team renderer; done.
- **Predict-first market**: Add `mode: "predict-first"` to market config; engine sequences trades → reveal → effects.
- **PostgreSQL**: Swap Drizzle driver; run migrations; no query changes.
- **i18n**: All strings in `config.copy`; replace with locale map.
- **Multi-event**: Add `eventId` to URL; run concurrent events on same server (requires Redis adapter for Socket.IO).
- **Analytics**: Append-only event log table; no changes to hot path.

---

## 9. Appendix: File/Folder Map (for implementers)

```
EventWeb/
├── docs/
│   ├── PRD.md
│   ├── app-flow.md
│   ├── ui-ux.md
│   ├── architecture.md
│   └── TRD.md            ← this file
├── package.json           ← workspaces: packages/*, apps/*
├── packages/
│   ├── types/
│   │   ├── src/
│   │   │   ├── event.ts
│   │   │   ├── activities/
│   │   │   │   ├── quiz.ts
│   │   │   │   └── market.ts
│   │   │   ├── socket.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── activities/
│       ├── src/
│       │   ├── quiz/
│       │   │   ├── config.ts
│       │   │   ├── engine.ts
│       │   │   └── scoring.ts
│       │   ├── market/
│       │   │   ├── config.ts
│       │   │   ├── engine.ts
│       │   │   └── scoring.ts
│       │   ├── registry.ts
│       │   └── index.ts
│       └── package.json
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Landing.tsx
│   │   │   │   ├── Team.tsx
│   │   │   │   └── Admin.tsx
│   │   │   ├── activities/
│   │   │   │   ├── quiz/TeamScreen.tsx
│   │   │   │   ├── market/TeamScreen.tsx
│   │   │   │   └── index.ts
│   │   │   ├── admin/
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── sections/
│   │   │   │   └── components/
│   │   │   ├── hooks/
│   │   │   │   ├── useSocket.ts
│   │   │   │   ├── useCountdown.ts
│   │   │   │   └── useEventState.ts
│   │   │   ├── store/
│   │   │   │   └── eventStore.ts
│   │   │   ├── components/
│   │   │   │   ├── Timer.tsx
│   │   │   │   ├── OptionRow.tsx
│   │   │   │   ├── SegmentedControl.tsx
│   │   │   │   ├── CodeField.tsx
│   │   │   │   ├── StatusDot.tsx
│   │   │   │   └── ...
│   │   │   ├── styles/
│   │   │   │   └── tokens.css
│   │   │   └── utils/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   └── package.json
│   └── server/
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.ts
│       │   ├── engine/
│       │   │   ├── ActivityRuntime.ts
│       │   │   ├── TimerService.ts
│       │   │   └── ActivityContext.ts
│       │   ├── activities/
│       │   │   ├── quiz/
│       │   │   │   ├── QuizActivity.ts
│       │   │   │   └── QuizScoring.ts
│       │   │   └── market/
│       │   │       ├── MarketActivity.ts
│       │   │       └── MarketScoring.ts
│       │   ├── db/
│       │   │   ├── schema.ts
│       │   │   ├── repository.ts
│       │   │   └── migrations/
│       │   ├── socket/
│       │   │   ├── rooms.ts
│       │   │   ├── events.ts
│       │   │   └── adminAuth.ts
│       │   ├── api/
│       │   │   └── routes.ts
│       │   └── config/
│       │       └── templates/
│       │           └── default-event.json
│       ├── drizzle.config.ts
│       └── package.json
└── turbo.json              ← (optional) Turborepo for build orchestration
```

---

**End of TRD.** All implementation decisions are captured. The four docs in `docs/` (PRD, app-flow, ui-ux, architecture) + this TRD form the complete specification for RecruitQuest MVP.