# RecruitQuest — Application Flow

**Version:** MVP 1.0 · **Status:** Draft for discussion · **Last updated:** 2026-08-05

This document describes how the application flows for both user types — the flow through the
whole event, screen-by-screen, plus the key journeys and edge cases. It pairs with
[PRD.md](./PRD.md), [ui-ux.md](./ui-ux.md), and [architecture.md](./architecture.md).

---

## 1. Global structure

```
RecruitQuest
├── /                  Team landing (create / join)
├── /team/*            Team interface (auto-entered via saved Team Code)
├── /admin             Admin dashboard (passcode-protected)
└── socket events      All realtime state (see architecture.md)
```

Rules that apply everywhere:

- The **server owns all state**. Pages render from server state delivered over the socket.
- The client stores **only the Team Code** in localStorage.
- **One primary action per screen.** Nothing on a team screen is decorative.

---

## 2. Event flow (organizer's timeline)

The organizer runs the event top-to-bottom from the admin dashboard:

```
 1  OPEN EVENT           Load or create an event config (template / new / edit JSON)
 2  WAIT FOR TEAMS       Roster fills as teams join the lobby
 3  START EVENT          Kicks all teams into the lobby ("welcome" + next-up preview)
 4  ACTIVITY 1           Start → Running → (pause/resume) → End → auto-scored
 5  INTERSTITIAL         Teams see lobby / "next up"; organizer switches to Activity 2
 6  ACTIVITY 2           Start → Running → (pause/resume) → End → auto-scored
 7  FINAL RESULTS        Organizer reveals overall leaderboard + winners
```

Steps 4–5 repeat for however many activities the event config declares. The sequence is
**not hardcoded**.

---

## 3. Team flow (participant's timeline)

```
LANDING ──► CREATE/JOIN ──► LOBBY ──► ACTIVITY SCREENS ──► LOBBY ──► … ──► RESULTS
             (one-time)      │                                    │
                             └──────── refresh / new phone ────────┘
                                       (auto-reconnect via code)
```

### 3.1 Landing → Create/Join

Two buttons: **Create Team** and **Join Team**.

- **Create Team**: enter Team Name → validated → server creates team → **Team Code shown
  once** with "save this code" callout + copy button → auto-saved to localStorage → enter
  the lobby.
- **Join Team**: enter a Team Code → validated → joins → enter the lobby.

If a Team Code already exists in localStorage on page load, the app **skips the landing
screen** and reconnects directly to the lobby.

---

## 4. Screen-by-screen flow

### 4.1 Lobby (team)

```
┌──────────────────────────┐
│  RecruitQuest            │
│                          │
│  Team: Alpha             │   ← team name (the only persistent identity)
│  Code: K7MX92            │   ← small, muted (tap to copy)
│  ───────────────         │
│                          │
│  Waiting for the         │
│  organizer to begin…     │   ← large, calm
│                          │
│  Next up: Quiz           │   ← "next up" preview chip
│  ⏱ 15 minutes           │
│                          │
└──────────────────────────┘
```

- The lobby is the default resting state. It shows: current activity status, a "next up"
  preview, and a short **countdown interstitial** when the organizer is about to start the
  next activity.
- No leaderboard, no other teams. Ever.

### 4.2 Activity screens

Every activity shares a shell:

```
┌──────────────────────────┐
│  Activity name     Q 3/15│   ← top bar: name + progress
│  ───────────────         │
│   ⏱ 0:24                │   ← LARGE timer, the biggest element on screen
│                          │
│  (activity body)         │   ← the only interactive area
│                          │
│  [ ONE PRIMARY ACTION ]  │   ← bottom, thumb-height
└──────────────────────────┘
```

### 4.3 Quiz — question screen

```
┌──────────────────────────┐
│  Quiz Challenge    Q 3/15│
│  ⏱ 0:24                 │
│                          │
│  Which company makes     │
│  the most popular EV     │
│  battery in 2026?        │   ← question, one line per ~4 words
│                          │
│  ◯ Tesla                 │
│  ◯ Panasonic             │
│  ◯ CATL                  │
│  ◯ Samsung               │
└──────────────────────────┘
```

- One question at a time. Selecting an option **locks it immediately** (no change, no back).
- When the per-question timer expires: answer locked, next question auto-advances.
- Between questions a brief interstitial (1–2s) shows "Next question…" so teams can refocus.
- After the last question, teams return to a "Quiz complete — awaiting results" state.

### 4.4 Market Simulation — decision screen

```
┌──────────────────────────┐
│  Market Simulation  Round 4/12 │
│  Scenario:               │
│  "Tesla announces a      │
│   breakthrough battery"  │
│  ⏱ 0:38                 │
│                          │
│  Apple    ₹100   ◯B ◯S ◯H│   ← Buy / Sell / Hold per company
│  Tesla    ₹120   ◯B ◯S ◯H│
│  Nvidia    ₹90   ◯B ◯S ◯H│
│  …                       │
│                          │
│  Cash ₹10,000 │ Value ₹… │   ← always visible bottom strip
└──────────────────────────┘
```

- Admin starts the simulation → scenario appears → teams choose **Buy / Sell / Hold** per
  company within the decision window (default 45–60s).
- When the window closes: prices update, portfolio revalues, next scenario begins.
- Bottom strip always shows **Cash / Portfolio value**.
- Teams see their live portfolio during the simulation (cash, holdings, current value).
- After the last round: "Simulation complete — awaiting results."
- At the end, teams receive only the **final portfolio value**.

---

## 5. Final results (team)

```
┌──────────────────────────┐
│  🏆 Results              │
│                          │
│  Final standings revealed│
│  by the organizer        │
│                          │
│  You can close this tab  │
└──────────────────────────┘
```

Because leaderboards are **admin-only in-app** (§PRD 10), teams do **not** receive a
leaderboard here. The organizer projects the admin's leaderboard/winner screen on the
room's display. The team screen simply confirms the event is over.

---

## 6. Admin flow

### 6.1 Enter dashboard

```
/admin  →  enter passcode  →  dashboard
```

- Passcode is set in the event config. Wrong passcode → retry; no accounts, no recovery
  (organizer knows it).

### 6.2 Dashboard layout (desktop-first)

```
┌──────────────────────────────────────────────┐
│  RecruitQuest — Admin            [Event: X]  │
├──────────┬───────────────────────────────────┤
│          │  EVENT CONTROL                    │
│  Nav     │   [▶ Start Event] [⏸ Pause] [End]│
│          │  ACTIVITY: Quiz — Running — 0:24  │
│  Overview│   [▶ Start] [⏸ Pause] [Resume]   │
│  Activity│   [⏹ End Activity]               │
│  Teams   │                                   │
│  Scoring │  TEAMS (12)   online ● 10         │
│  Boards  │   Team   Code    Status  Score    │
│  Config  │   Alpha  K7MX92  ●       120      │
│          │   Beta   9QF4T   ○        98      │
│          │                                   │
│  LEADS   │  Per-activity / Overall  [Project]│
└──────────┴───────────────────────────────────┘
```

### 6.3 Key admin journeys

**Run the quiz**

1. Open dashboard → select Activity 1 (Quiz).
2. Press **Start** → activity `Waiting → Running`, timer starts, all teams transition to the
   quiz shell in sync.
3. Pause/Resume the global activity timer as needed (server-authoritative).
4. Press **End** → submissions locked → scoring engine runs → per-activity leaderboard
   populated (admin-only).
5. Review scores → apply overrides if needed → show "next up".

**Run the market simulation**

1. Select Activity 2 (Market Simulation) → **Start**.
2. Press **Advance to Next Scenario** (or auto-advance via config) → scenario pushed to all
   teams, decision window starts.
3. When the window closes, prices update automatically and the next scenario is staged.
4. Press **End** → final portfolio values computed → leaderboard (admin-only).

**Show the room scores**

1. Open the leaderboard view → press **Project** → the admin screen switches to a large,
   high-contrast projection layout (big rows, live-ish) for the external display.
2. Everything stays on the admin's machine; teams still see nothing.

**Adjust a score**

1. Scoring → pick a team → edit activity or total score → reason note (optional) → the
   leaderboard recomputes rank.

---

## 7. Key journeys in detail

### 7.1 Team creates a team (primary onboarding)

1. Team lands on `/` with no stored code.
2. Taps **Create Team**.
3. Enters name → server validates uniqueness (case-insensitive), ≤ 20 chars, allowed charset.
4. **Reject**: inline error ("Team 'Alpha' already exists — try a different name") or
   charset/length error. No partial team created.
5. **Success**: server creates Team + code `K7MX92`; response stores code in localStorage;
   team enters lobby; `Team Joined` toast on admin dashboard.

### 7.2 Team refreshes mid-quiz

1. Browser refreshes on question 3.
2. On load, localStorage has a Team Code → auto-reconnect.
3. Server replays current activity state → the app renders **question 3 (or whatever the
   server says is current) with its remaining time**. No progress is lost.
4. If the team already answered question 3, the app re-renders it in its **locked** state;
   the server ignores any duplicate submission.

### 7.3 Device takeover

1. Device A is active on team Alpha.
2. Team picks up a new phone, opens the app, enters `K7MX92`.
3. Server marks the new socket as the active device for Alpha; device A receives
   "session moved to another device" and becomes read-only.
4. Device B resumes exactly where the server says the team is.

### 7.4 Admin pauses the quiz

1. Mid-question, admin presses Pause.
2. Server freezes the countdown and broadcasts `activity:paused`.
3. All team screens show a paused state ("⏸ Paused by organizer") with the frozen time.
4. Resume → countdown continues from the frozen value; everyone stays in sync.

### 7.5 Market scenario timing

1. Admin starts the simulation → round 1 scenario shown, decision window counts down.
2. Window expires (server-side) → any unsubmitted decisions are **treated as Hold** →
   prices update → round 2.
3. If the admin is behind, they can **Advance** early or **Pause** the window.

---

## 8. Edge cases & rules

| Case | Behavior |
|---|---|
| Duplicate team name | Rejected; case-insensitive; message shown inline |
| Empty / whitespace name | Rejected |
| Unknown team code (join) | "Code not found — check with your organizer" |
| Event not yet open | Team creation disabled; lobby shows "event hasn't started" |
| Answer after lock | Ignored by server (idempotent) |
| No market decision by deadline | Treated as **Hold** |
| Admin ends activity mid-question | Current question expires, that submission locked, scoring runs on what exists |
| Admin ends market early | Final values computed from current prices; score on those |
| Server restart | State restored from SQLite; sockets reconnect; no data loss |
| Two devices join same code | Hard takeover (see 7.3) |
| Passcode wrong | Retry; no lockout timer needed (venue, not a hostile network) |

---

## 9. Realtime event surface (summary)

| Topic | Example events |
|---|---|
| Event state | `event:started`, `event:ended` |
| Activity state | `activity:started`, `activity:paused`, `activity:resumed`, `activity:ended`, `activity:next` |
| Quiz | `quiz:question`, `quiz:lock`, `quiz:result-synced` |
| Market | `market:scenario`, `market:decision-closed`, `market:round-advance`, `market:finished` |
| Team | `team:joined`, `team:left`, `team:takeover` |
| Admin | `admin:leaderboard-update`, `admin:score-override` |

Full wire protocol lives in [architecture.md](./architecture.md#realtime-design).
