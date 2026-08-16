# RecruitQuest — UI/UX Design

**Version:** MVP 1.0 · **Status:** Draft for discussion · **Last updated:** 2026-08-05

Pairs with [PRD.md](./PRD.md), [app-flow.md](./app-flow.md), and [architecture.md](./architecture.md).

---

## 1. Design principles

Derived from the product goals:

1. **One primary action per screen.** Every screen has exactly one thing a participant
   should do. If a screen needs two, split it.
2. **Mobile-first for teams, desktop-first for admin.** Team screens are built for one hand
   on a phone; the admin dashboard is built for a laptop and a projector.
3. **The timer is the hero.** Time pressure is the game. On every active team screen the
   countdown is the largest, most legible element.
4. **Calm until it matters.** Default state is quiet and neutral. Visual intensity (color,
   scale) is reserved for moments that need attention: an active timer, a revealed scenario,
   a correct/incorrect lock, "next up".
5. **No decorative motion.** Animation only explains state change (interstitial transitions,
   question advance). No loops, no confetti unless it's the winner reveal.
6. **Readable at distance.** Both the team phone (held in a hand, maybe across a table) and
   the admin leaderboard (on a projector) need high contrast and large type.
7. **Nothing on a team screen is a dead end.** Refresh, new device, lost connection — the
   UI always lands the team back in the right place (§ app-flow 7).
8. **Light, clean, professional.** Bright surfaces, generous whitespace, one vivid accent.

---

## 2. Visual language

### 2.1 Color

Light theme with a **single accent color** for live/attention states.

| Token | Role | Notes |
|---|---|---|
| `bg` | App background | Near-white `#FAFAFA`; team screens slightly brighter |
| `surface` | Cards, panels | White `#FFFFFF` with a hairline border `#E5E7EB` |
| `ink` | Primary text | Near-black `#111827` — high contrast |
| `muted` | Secondary text | `#6B7280` — labels, hints, team code |
| `accent` | **The** live color | Reserved for: active timer, active activity, selected option, primary CTA. One hue (e.g. indigo `#4F46E5`) — never used decoratively |
| `accent-soft` | Tinted surfaces | Accent at 8–12% opacity for selected/highlighted states |
| `danger` | Destructive / wrong | `#DC2626` — error text, wrong-answer lock |
| `success` | Correct / on-time | `#16A34A` — correct-answer lock, saved states |

**Rule of one accent:** if more than the accent + semantic colors appears on a team screen,
the design is wrong.

### 2.2 Typography

| Token | Size | Usage |
|---|---|---|
| Timer (hero) | 56–72px / 700 weight | The countdown; largest element on active screens |
| Title | 24px / 600 | Screen title (question, scenario, lobby) |
| Body | 17–19px | Questions, scenario descriptions, instructions |
| Control | 16px | Buttons, options |
| Meta | 13–14px / `muted` | Progress "Q 3/15", team code, hints |

- Questions and scenarios read in **short lines**: one clause per line, never a long blob.
- Team screens use a slightly larger base size than typical web (arm's-length + projector).

### 2.3 Spacing & shape

- Consistent 4px scale; cards use 16px padding, 12px radius.
- One focus per viewport: no more than ~4 interactive elements on a team screen at once.
- Touch targets ≥ 44px on team screens; option rows are full-width thumb-height.

### 2.4 Motion

- **Interstitial transitions**: 150–250ms fade/slide between questions or rounds.
- **Scenario reveal**: subtle entrance so eyes land on the scenario title.
- **Nothing else.** No parallax, no marquee, no background animation.

---

## 3. Team interface

### 3.1 Global shell

```
┌────────────────────────┐
│  Activity name   3/15  │   top bar: 15px, muted meta
├────────────────────────┤
│                        │
│   ⏱ 0:24   ← HERO      │   centered, hero type, accent while running
│                        │
│   (body)               │   the single interactive region
│                        │
│  [ PRIMARY ACTION ]    │   bottom, full-width, thumb-height
└────────────────────────┘
```

- Connection state: a tiny dot in the top bar (green = live, amber = reconnecting,
  red = offline). Never a modal that blocks the timer.
- The team code is visible on the lobby only (tap to copy), not on activity screens.

### 3.2 Screens

#### Landing
- Logo/wordmark, two large CTAs: **Create Team** (primary) and **Join Team** (secondary).
- Nothing else. No marketing copy beyond one line.

#### Create Team
- One field: **Team Name** (max 20 chars, counter shown).
- Primary button **Generate Team**.
- Live inline validation: uniqueness + charset. Errors under the field in `danger`,
  validated server-side on submit (case-insensitive).

#### Join Team
- One field: **Team Code** (uppercase, 6 chars, auto-formatting).
- Primary button **Join**.

#### Team Code success (show-once)
```
┌────────────────────────┐
│  Team created!         │
│  Save this code:       │
│  ┌──────────────────┐  │
│  │   K7MX92         │  │   hero, letter-spaced, tap-to-copy
│  └──────────────────┘  │
│  [ ✅ Copied ]          │
│  You'll need it if you │
│  refresh or switch     │
│  phones. It's also     │
│  saved on this device. │
│  [ Let's go → ]         │
└────────────────────────┘
```
- The code is **shown once**; after `Let's go` it is not shown again on activity screens.

#### Lobby
- Calm, centered: "Waiting for the organizer to begin…"
- "Next up: Quiz · 15 min" chip.
- Countdown interstitial variant when a transition is imminent ("Starting in 0:05").
- No scores, no leaderboard, no other teams. Ever.

#### Quiz — question
- Question in short lines; options as full-width radio rows.
- Selecting **locks instantly** (row fills accent-soft, checkmark appears). No change, no back.
- On wrong lock: the row shows `danger`; the correct answer is not revealed (no spoilers —
  teams discuss their own result later, or the organizer narrates).
- When the per-question timer hits 0: the answer locks (or records blank) and the app
  auto-advances after a 1s interstitial ("Next question…").
- Last question → "Quiz complete — awaiting results."

#### Market — decision
- Scenario title + description at top; the decision window timer under it.
- One row per company: name, current price, and **Buy / Sell / Hold** segmented control.
- Default selection is **Hold** (never force an accidental trade).
- Bottom strip, always visible: `Cash ₹10,000 · Value ₹…`
- After the last round: "Simulation complete — awaiting results."
- Teams see their live portfolio during the simulation (cash, holdings, current value).
- At the end, teams receive only the **final portfolio value**.

#### Results (team)
- One message: results are revealed by the organizer on the room display. Close-tab guidance.
- No leaderboard in-app (§ PRD 10).

### 3.3 Empty / error / offline states

| State | UI |
|---|---|
| Reconnecting | Amber dot; body stays on last known state |
| Offline | Red dot; banner "Trying to reconnect…" — no data loss |
| Event ended | "Event over — thanks for playing!" |
| Paused by organizer | Timer freezes, shows ⏸, body stays frozen |
| Activity error | Calm inline message; organizer is the recovery path |

---

## 4. Admin dashboard

Desktop-first, three-part layout: left **nav**, center **workspace**, persistent **status
strip** (event + activity + timer).

### 4.1 Sections

| Section | Contents |
|---|---|
| **Overview** | Event status card, next action suggestion, live team count |
| **Activity** | Current activity, its state machine status, Start/Pause/Resume/End controls, timer |
| **Teams** | Roster table: name, code, status (online dot), current activity state, score. Row actions: remove |
| **Scoring** | Per-activity + total scores, override editor (value + optional note), recalc |
| **Boards** | Per-activity + overall leaderboards; **Project** toggle → fullscreen projection layout |
| **Config** | Event + activity JSON editor, schema validation, template picker, reload |

### 4.2 Controls

- One control is always emphasized (the **next legal action** given the state machine):
  e.g. while `Waiting` → "Start Activity" is primary; while `Running` → "End Activity".
- Pause/Resume appear only in the states where they're legal.
- Every destructive control (End Activity, Remove Team, End Event) requires a second tap /
  confirm inline — never a modal chain, but a confirm.

### 4.3 Projection mode

- Toggled from **Boards**. Renders the chosen leaderboard fullscreen with:
  - Large rows (rank, team, score), high contrast, no chrome.
  - Live updates as scores land (activity end) or overrides apply.
- This is the room-facing screen. Teams' phones show nothing.

### 4.4 Config editor

- A JSON editor with **schema validation** on the right (errors inline, red underlines).
- Template dropdown ("Load: Default Quiz / Default Market…"), duplicate-as-edit.
- **Reload** applies config changes to the running event where safe; disruptive changes
  (mid-activity edits) warn the organizer.

---

## 5. Accessibility

- Touch targets ≥ 44px; large readable type (§ 2.2).
- Color is never the only signal: locked/correct/wrong states include icons/checkmarks,
  not just color.
- Focus-visible states on all controls (admin uses keyboard).
- High contrast between text and surface (§ 2.1 ratios).
- Motion reduced: respect `prefers-reduced-motion` (skip interstitials' slide).

---

## 6. Micro-copy style

- **Organizer voice, not product voice.** Short, direct, imperative where it's an action.
- Timers are never ambiguous: "0:24" on team screens; "Question locks in 0:24" only in the
  market decision window when it matters.
- Error messages say what to do: "Name taken — try 'Alpha2'." not "Invalid name."
- Success is quiet: a checkmark, not a fanfare. Fanfare is reserved for the winner reveal.

---

## 7. Component inventory (build once)

**Team set**
- Timer (hero), OptionRow, SegmentedControl (Buy/Sell/Hold), Button (primary/secondary),
  CodeField, CodeCard (show-once), Chip ("Next up"), StatusDot, Banner, Interstitial.

**Admin set**
- StatusCard, ControlButton (state-aware), StateMachineBadge, TeamsTable, ScoreEditor,
  LeaderboardTable, ProjectionView, JsonEditor, TemplatePicker, ConfirmInline.

**Shared**
- Toast, EmptyState, ErrorState.

Most admin components come from **shadcn/ui** (table, button, dialog, form) restyled to the
token set; team components are **hand-rolled** for exactness and speed.
