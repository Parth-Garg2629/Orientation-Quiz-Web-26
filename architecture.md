# RecruitQuest — Technical Architecture

**Version:** MVP 1.0 · **Status:** Draft for discussion · **Last updated:** 2026-08-05

Pairs with [PRD.md](./PRD.md), [app-flow.md](./app-flow.md), and [ui-ux.md](./ui-ux.md).

---

## 1. High-level overview

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│ Team phone  │   │ Team phone  │   │ Admin laptop│
│ (mobile)    │   │ (mobile)    │   │ (desktop)   │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │                 │                 │
       └─────────────┬───┴─────────┬───────┘
                     ▼             ▼
            ┌─────────────────────────────┐
            │   Vercel — React SPA        │
            │   /team/*  /admin           │
            └──────────────┬──────────────┘
                           │  Socket.IO  (HTTPS/WSS)
            ┌──────────────▼──────────────┐
            │   Node.js + Express +       │
            │   Socket.IO server          │
            │   ┌─────────────────────┐   │
            │   │ Activity Engine     │   │  ← quiz, market, future
            │   │ Scoring Engine      │   │
            │   │ Timer Service       │   │  ← server-authoritative
            │   │ Event/Team Service  │   │
            │   └─────────┬───────────┘   │
            └─────────────┬───────────────┘
                          │  Drizzle
            ┌─────────────▼───────────────┐
            │   SQLite (persistent disk)  │   ← single source of truth
            │   Railway / Render volume   │
            └─────────────────────────────┘
```

- **SPA frontend** served by Vercel; talks to the backend only over Socket.IO (plus plain
  HTTP for bootstrapping config/initial state if needed).
- **Backend** is the single owner of all game state; it is the only process that writes.
- **SQLite** persists the durable event/team/score records so a server restart is
  non-destructive. Hot runtime state (timers, live round) lives in memory.

---

## 2. Tech stack & rationale

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Fast dev, SPA is enough (no SEO/SSR) |
| Styling | Tailwind CSS | Token-driven, matches ui-ux doc |
| Routing | React Router | `/`, `/team`, `/admin` |
| Realtime | Socket.IO (client + server) | Rooms, auto-reconnect, battle-tested |
| Backend | Node.js + Express + TypeScript | PRD choice, minimal |
| ORM | Drizzle | Light, TS-first, SQLite→Postgres swap is a config change |
| DB | SQLite (better-sqlite3) | Single event scale, zero-ops, on persistent disk |
| Admin UI | shadcn/ui (Radix + Tailwind) | Fast, accessible dashboard scaffolding |
| State (client) | Zustand + a thin socket event reducer | Simple; socket is the source of truth |

TypeScript is shared via a `packages/types` workspace so config schemas and socket payloads
are compile-checked on both ends.

---

## 3. Repository layout (monorepo)

```
EventWeb/
├── docs/                     ← this documentation set
├── packages/
│   ├── types/                ← shared TS types, zod schemas, socket event contracts
│   └── activities/           ← activity definitions (quiz, market) + config schemas
├── apps/
│   ├── web/                  ← React SPA (Vercel)
│   │   ├── src/pages/        ← landing, team, admin
│   │   ├── src/activities/   ← team-screen renderers per activity type
│   │   └── src/admin/        ← dashboard
│   └── server/               ← Express + Socket.IO (Railway/Render)
│       ├── src/engine/       ← activity engine, lifecycle, timer service
│       ├── src/activities/   ← server-side activity logic + scoring
│       ├── src/db/           ← drizzle schema + repository layer
│       └── src/socket/       ← event wiring, rooms, auth-by-code
└── package.json              ← workspaces
```

The SPA never imports server code; both import from `packages/*`.

---

## 4. Data model

### 4.1 Entities (Drizzle → SQLite)

```
event
  id            text PK
  name          text
  config        json       -- full event config (see §5)
  passcode_hash text
  status        text       -- 'draft' | 'waiting' | 'running' | 'ended'
  created_at, started_at, ended_at

team
  id            text PK
  event_id      text FK
  name          text
  name_lower    text       -- for case-insensitive uniqueness (indexed)
  team_code     text       -- 6 chars, unique, unambig alphabet
  total_score   real
  active_conn   text       -- active socket id (runtime; persisted for takeover)
  created_at

activity
  id            text PK
  event_id      text FK
  seq           int        -- order in the event
  type          text       -- 'quiz' | 'market-simulation' | ...
  config        json       -- activity-specific config
  status        text       -- lifecycle state
  started_at, ended_at

submission
  id            text PK
  activity_id   text FK
  team_id       text FK
  payload       json       -- activity-specific answers/trades
  submitted_at  text
  UNIQUE(activity_id, team_id)

score
  id            text PK
  activity_id   text FK
  team_id       text FK
  value         real
  source        text       -- 'auto' | 'admin_override'
  note          text       -- optional organizer note
  adjusted_at   text
  UNIQUE(activity_id, team_id)
```

### 4.2 Runtime-only state (in-memory, rebuildable)

- Current timer deadlines (`ends_at` per activity/round).
- Live quiz index + per-question deadlines per team.
- Market round index, current scenario, decision-window deadline, pending trades.
- Socket↔team mapping.

All of it is derivable from SQLite + the activity config, so a restart restores the event
by replaying state (§ 7.3).

---

## 5. Configuration system ("rules are data")

### 5.1 Structure

Every event has a JSON config:

```jsonc
{
  "passcode": "EVENT2026",               // admin door
  "copy": { "eventName": "TechSprint" }, // team-visible strings
  "activities": [
    {
      "seq": 1,
      "type": "quiz",
      "config": {
        "questions": [
          {
            "text": "Which company makes the most popular EV battery?",
            "options": ["Tesla", "Panasonic", "CATL", "Samsung"],
            "correct": 2,                     // index
            "timerSeconds": 30,
            "points": 100
          }
        ],
        "scoring": { "timeWindow": 0.25, "fullPointsWindow": true },
        "tieBreaker": "total-response-time"
      }
    },
    {
      "seq": 2,
      "type": "market-simulation",
      "config": {
        "startingCash": 10000,
        "companies": [
          { "name": "Apple", "initialPrice": 100 },
          { "name": "Tesla", "initialPrice": 120 }
        ],
        "rounds": [
          {
            "title": "Tesla battery breakthrough",
            "description": "…",
            "decisionSeconds": 50,
            "effects": { "Tesla": 0.15, "Nvidia": 0.05, "Oil&Gas": -0.08 }
          }
        ],
        "decision": { "default": "hold" },
        "mode": "reactive"                  // future: "predict-first"
      }
    }
  ]
}
```

### 5.2 Validation & templates

- Each activity type declares a **zod schema** in `packages/activities`.
- Admin editor validates live; schema errors are shown inline.
- A **default event template** ships (a handful of quiz Qs, 10 companies, ~8 scenarios) so
  the first event runs with zero setup.
- Stored in the `event.config` row; editable and reloadable from the admin dashboard.

---

## 6. Activity Engine

### 6.1 Interface (shared contract)

```ts
interface Activity<TConfig = unknown> {
  type: string;                    // 'quiz', 'market-simulation'
  configSchema: z.ZodSchema<TConfig>;

  onStart(ctx: ActivityContext): void;      // Waiting → Running
  onPause(ctx: ActivityContext): void;
  onResume(ctx: ActivityContext): void;
  onEnd(ctx: ActivityContext): void;        // Running → Completed → scored

  // Called when a team submits during Running
  onSubmit(ctx: ActivityContext, teamId: string, payload: unknown): SubmissionResult;

  // Runs at onEnd (or admin "recalculate"); writes scores
  calculateScore(ctx: ActivityContext): Score[];
}
```

`ActivityContext` gives the activity: its config, the event's teams, a
`broadcast(topic, payload)` channel, and the timer service.

### 6.2 Lifecycle driver

A shared `ActivityRuntime` drives the state machine for every activity:

```
Waiting ──start──▶ Running ──pause──▶ Paused ──resume──▶ Running
                      │
                      └──end──▶ Completed ──score──▶ Scored
```

- The runtime owns the state; activities implement the hooks. The admin shell and team shell
  only ever talk to the runtime, **never to an activity's internals**.
- `onEnd` returns the final activity status and triggers `calculateScore`; results land in
  `score` rows and broadcast to the admin room only.

### 6.3 Registering a new activity

1. Add a schema + logic module in `packages/activities` / `apps/server/src/activities`.
2. Register it in an activity registry (`type` → class).
3. Done. No changes to the shell, team renderer list, or scoring pipeline beyond adding a
   team-screen renderer in `apps/web/src/activities`.

### 6.4 Quiz engine (server-side)

- Timeline per team: question index + per-question deadline.
- `onSubmit` validates the answer, checks the deadline, and stores a `Submission`.
- Auto-advance: a scheduled tick ends the current question when its deadline passes, locks
  the answer, advances the index, and broadcasts the next question.
- Scoring (`calculateScore`): correctness × time-window formula from config (see PRD §9.2).
  Unanswered/late = 0.

### 6.5 Market engine (server-side)

- On start, materializes each team's portfolio from `startingCash` + companies.
- A **round clock** per scenario; `decisionSeconds` window. Admin can pause/advance.
- `onSubmit` records per-company Buy/Sell/Hold; **missing decisions default to Hold**.
- When the window closes, effects apply to prices, holdings/values recompute, round
  advances, and the next scenario broadcasts.
- `calculateScore` = final portfolio value (cash + holdings × current price).
- **Future mode (`predict-first`)**: same engine, different sequencing — trades are placed
  *before* the scenario reveal, then effects apply. A config flag, not new code.

---

## 7. Realtime design (Socket.IO)

### 7.1 Rooms

| Room | Members | Receives |
|---|---|---|
| `event:{id}:admin` | Admin socket(s) | Everything: state, submissions, scores, leaderboards |
| `event:{id}:team` | All team sockets | Shared event/activity state, timers, "next up" |
| `team:{teamId}` | The active device for that team | Team-private state (its quiz question, its portfolio) |
| `event:{id}` | All clients | Global transitions (start/end) |

Team sockets join both `event:{id}:team` and `team:{teamId}`; the admin joins the admin room
only. **No team ever joins another team's room** → leaderboards can't leak.

**Leaderboard projection**: the admin leaderboard shows **Rank and Value only** (no P/L, no
delta). Teams never receive leaderboard data — when the organizer wants the room to see
scores, they project the admin screen externally.

### 7.2 Wire events (topics)

```
server → team        event:state, activity:started/paused/resumed/ended,
                     activity:next-up, timer:sync,
                     quiz:question, quiz:locked, quiz:complete,
                     market:scenario, market:decision-closed, market:round, market:finished,
                     team:takeover, session:inactive

server → admin       teams:list, team:joined/left/online/offline,
                     submission:received, activity:scored,
                     leaderboard:per-activity/overall, score:override-applied

client → server      team:create, team:join, team:submit,
                     admin:auth, admin:start/pause/resume/end,
                     admin:next-scenario, admin:override-score, admin:reveal
```

### 7.3 Server-authoritative timers

- The server is the only place a deadline is set: `ends_at = now + duration`, persisted.
- Clients **display** a countdown derived from `ends_at` and a server-provided `now`, and
  **re-sync** on `timer:sync` (every ~10s) and on any state broadcast.
- Pause computes a paused-at offset; resume recomputes `ends_at`. A paused client shows the
  frozen value; drift is impossible because the server's `ends_at` is truth.
- Network hiccups cause display wobble, never rule changes: the server closes windows and
  locks answers regardless of what any client thinks.

### 7.4 Reliability & reconnect

- Client stores `team_code` in localStorage; on load it calls `team:join` automatically.
- Server keeps submissions by `(activity_id, team_id)` — duplicates are idempotent.
- On reconnect, the server sends a full `event:state` snapshot scoped to the team room
  (current activity, current question/round, remaining time, locked answers). The team UI
  re-renders from that snapshot.
- **Takeover**: a `team:join` for a code that has an active connection marks the old socket
  `session:inactive` and the new one active. The old screen becomes read-only.

### 7.5 Restart recovery

On boot the server loads the event from SQLite, re-hydrates runtime state (question index,
round index, deadlines derived from timestamps), and broadcasts a state snapshot. Completed
activities stay scored; an interrupted timer resumes from its stored deadline (or a
configurable "continue from pause" rule).

---

## 8. Admin API & auth

- `/admin` is a passcode gate: `admin:auth { passcode }` → server issues a short-lived
  admin token (cookie) bound to the admin room. No accounts; a wrong guess just retries.
- All admin writes are validated server-side and are state-machine aware (e.g. `end` is
  rejected unless `Running`).
- Passcode stored hashed; set per event in config.

---

## 9. Scoring engine

- Strategy pattern: `Activity.calculateScore` returns `Score[]` written via the repository.
- **Override**: `admin:override-score` updates a `score` row with `source: 'admin_override'`
  (+ optional note), then leaderboards recompute deterministically.
- Overall totals = sum of activity scores (overrides included). Ties broken by the event's
  configured tie-breaker (§ PRD 9.4).
- Leaderboard updates broadcast to the **admin room only** (§ 7.1).

---

## 10. Frontend architecture

### 10.1 Client state

- **Zustand store** fed by a single `useSocket` hook + a reducer-style subscription over the
  event topics.
- The store holds the last known `event:state` snapshot and team-private state; React
  components are pure renders of it.
- Timer display is a local `useCountdown(ends_at)` hook that re-syncs on `timer:sync`; it
  never decides anything.

### 10.2 Team renderer registry

```
src/activities/<type>/TeamScreen.tsx
```

`/team` renders the shell, then mounts the renderer for the current activity type. Unknown
types fall back to a generic "awaiting organizer" screen — adding a game never breaks the
shell.

### 10.3 Admin

Standard React + TanStack Query for bootstrapping, socket subscriptions for live updates,
shadcn/ui components throughout.

---

## 11. Security

- **Passcode gate** on `/admin` (§ 8); teams cannot reach admin rooms or leaderboard data.
- **Server-side validation** of every submission and command (schema, state-machine legal
  moves, deadlines). The client is never trusted.
- **Team scoping**: a socket only ever receives its own team room + shared event room.
- **Input limits**: team name charset/length, code format, submission size caps.
- Basic rate limiting on `team:create` / `admin:auth` to keep venue mishaps from wedging
  the server.

---

## 12. Deployment

| Piece | Host | Notes |
|---|---|---|
| Web SPA | **Vercel** | Static build; env: `VITE_SOCKET_URL` |
| Server | **Railway** or **Render** | Node 20; Socket.IO with sticky sessions not needed (single instance for MVP) |
| SQLite | Persistent disk volume | Backup = copy the file; restores are instant |
| Env | `PASSPHRASE`? none — passcode comes from event config | |

**Scaling note:** single-instance for MVP (one event, ~100 clients). If concurrency grows,
SQLite→Postgres (§ 13) + multi-instance with Socket.IO `redis-adapter` + sticky sessions
is the documented path.

---

## 13. SQLite → PostgreSQL migration path

1. Repository layer is the only DB contact (§ 4) — swap Drizzle driver (`better-sqlite3`
   → `postgres-js`/`pg`) and change one connection string.
2. JSON columns map cleanly (SQLite JSON ↔ Postgres `jsonb`).
3. Ship Drizzle migrations; run a one-time export/import.
No query rewrites, no engine changes.

---

## 14. Testing strategy

| Layer | Approach |
|---|---|
| Activity engines | Unit tests: lifecycle transitions, scoring formulas, market round math, Hold defaults |
| Timer service | Fake-clock tests for lock/advance/expiry paths |
| Socket wiring | Integration: two team sockets + admin socket, assert room isolation |
| Reliability | Tests for reconnect snapshot, idempotent submissions, takeover |
| E2E (thin) | Playwright happy path: create team → quiz → market → results |
| Config | Schema validation tests; a golden-file default template passes its own schema |

---

## 15. Milestones (MVP build order)

1. **Skeleton**: monorepo, shared types, socket echo, `/team` + `/admin` shells.
2. **Teams**: create/join/takeover/reconnect, roster in admin.
3. **Config system**: schemas, editor, template loader.
4. **Quiz**: lifecycle, timers, scoring, admin control.
5. **Market**: portfolio, rounds, decisions, effects, scoring.
6. **Leaderboards + projection**: admin-only boards, winner reveal.
7. **Reliability pass + deploy**: reconnect polish, restart recovery, Vercel/Railway.
