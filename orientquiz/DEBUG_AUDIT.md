# OrientQuiz — Full Codebase Debug Audit

Conducted: 2026-08-17  
Scope: All server, client, and shared source files

---

## SEVERITY KEY
- 🔴 HIGH — Will break the event or cause data loss
- 🟡 MEDIUM — Will cause confusion or bad UX
- 🟢 LOW — Minor quality issue / improvement

---

## 🔴 HIGH — Issues That Need Fixing

### 1. `sessionStorage` stores the raw passcode in plain text
**File:** [`client/src/pages/Admin.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Admin.tsx) — Line 114

```ts
sessionStorage.setItem("orientquiz_admin_authed", passcode.trim());
```

The raw passcode (`ORIENT2026`) is stored in `sessionStorage` and re-sent to the server on every page refresh. Any browser dev tools inspection exposes the passcode. Replace with a **session token** (UUID) issued by the server after a successful `admin:auth`, store that instead.

---

### 2. Team join succeeds even if quiz is already `scored`/`completed` — new joiners land on "Quiz Complete" immediately
**File:** [`server/src/socket/index.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/server/src/socket/index.ts) — `team:create` (line 114) and `team:join` (line 174)

No guard: when the quiz is in `scored` state, a brand-new team can still be created and will immediately receive a `quiz:state` with `status: 'scored'`, showing "Quiz Complete" before they ever answered anything. Should either block team creation/joining once quiz is running, or at minimum show a "Quiz has already ended" message instead of "Quiz Complete".

---

### 3. `admin:reset_quiz` clears ALL team scores but does NOT clear team records — teams accumulate across resets
**File:** [`server/src/quiz/engine.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/server/src/quiz/engine.ts) — `reset()` Line 229

`reset()` zeroes scores and wipes submissions/overrides, but **keeps all team rows**. If you run 3 dry runs before the event, you accumulate ghost teams in the roster. There's no way to wipe teams from the admin UI — only individually via the "Remove" button per team. Need either a "Remove All Teams" option or make the reset dialog offer two modes clearly.

---

### 4. `SubmitAnswerSchema` does not validate that `selectedOption` is within bounds
**File:** [`shared/src/schema.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/shared/src/schema.ts) — Line 49

```ts
selectedOption: z.number().int().min(0),
```

No upper-bound check. A malicious client could submit `selectedOption: 9999`. The engine does look up `q.correct` for comparison but never validates `selectedOption < q.options.length`. If someone sends a bad index, the submission writes `selected_option = 9999` to the DB — it won't match `correct` so they get 0 pts, but the stored data is corrupt.

---

## 🟡 MEDIUM — UX / Logic Issues

### 5. TimerDial does not receive `isPaused` correctly when quiz is paused
**File:** [`client/src/pages/Team.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Team.tsx) — Line 206

```tsx
<TimerDial
  deadline={quizState.currentQuestion.deadline}
  totalSeconds={quizState.currentQuestion.timerSeconds}
  isPaused={false}    // ← hardcoded false
/>
```

`isPaused` is hardcoded to `false`. When the admin pauses, the team client jumps to the "Quiz Paused" screen (status === "paused") so the dial isn't rendered — but if there's any intermediate render during the state transition, the dial ticks down for a moment while actually paused. Should be `isPaused={quizState.status === "paused"}`.

---

### 6. After admin `reset_quiz`, teams that were NOT connected at the time of reset stay on "Quiz Complete" until they refresh
**File:** [`server/src/socket/index.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/server/src/socket/index.ts) — `admin:reset_quiz` handler

The broadcast on reset only loops over `teamSocketMap` (currently active sockets). Teams that lost connection and haven't reconnected yet won't get the reset. When they reconnect, `doJoin()` in `Team.tsx` calls `team:join` which sends current `quiz:state` — so they **will** self-heal on reconnect. This is acceptable but worth noting.

---

### 7. `Landing.tsx` redirects to `/team` if `localStorage` has a code — even if that team was removed by admin
**File:** [`client/src/pages/Landing.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Landing.tsx) — Line 18–21

```ts
const savedCode = localStorage.getItem("orientquiz_team_code");
if (savedCode) {
  navigate("/team");
}
```

If the admin removed a team, the device still has the code in `localStorage` and immediately redirects to `/team`. `Team.tsx` handles this correctly (join fails → clears localStorage → redirects back), so it self-heals in one redirect hop. Not broken, but creates a confusing flash for the user.

---

### 8. No visual score display on team screen during or after quiz
**File:** [`client/src/pages/Team.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Team.tsx)

`quizState.totalScore` is available in the state but never shown to the team player. After the quiz ends, teams see "Quiz Complete — watch the projector" but have no indication of their own performance. Even a simple "Your score: X pts" on the completed screen would reduce confusion (some team members may not see the projector).

---

### 9. Admin console passcode stored in `sessionStorage` — survives accidental tab close, security gap
**File:** [`client/src/pages/Admin.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Admin.tsx) — Line 74

`sessionStorage` persists for the tab session. If the organizer leaves the laptop unattended with the admin tab open and it doesn't reload, anyone who opens that tab again can silently reauthenticate. Should add a visible **"Lock Console"** button that clears `sessionStorage` and resets `isAuthenticated` state.

---

### 10. `cors: origin: "*"` on both Express and Socket.IO in production
**File:** [`server/src/main.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/server/src/main.ts) — Lines 29, 45

Wildcard CORS is fine for localhost dev but should use `CORS_ORIGIN` env var (already defined in `.env`) for production. The env var is set but never read — `origin: "*"` is hardcoded in both places.

---

## 🟢 LOW — Minor Issues

### 11. `quiz:interstitial`, `quiz:status`, `quiz:completed`, `team:session` events defined in `events.ts` but never emitted
**File:** [`shared/src/events.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/shared/src/events.ts) — Lines 29–32

Dead event type definitions. They're never emitted by the server and never listened to by the client. Harmless but adds confusion for anyone reading the event contract.

---

### 12. Team name max length enforced client-side (maxLength=20) but schema allows trim to bring it under — no mismatch risk but inconsistent
**File:** [`client/src/pages/Landing.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Landing.tsx) — Line 141 vs [`shared/src/schema.ts`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/shared/src/schema.ts) — Line 37

Both say 20. Consistent. No bug. ✓

---

### 13. `handleLeave` on Team.tsx does not emit any server event — server doesn't know the team left intentionally vs disconnected
**File:** [`client/src/pages/Team.tsx`](file:///c:/Users/Ayush%20Srivastava/Orientation-Quiz-Web-26/orientquiz/client/src/pages/Team.tsx) — Line 137

When a user clicks "Leave team", localStorage is cleared and they navigate away. The socket disconnects, which the server handles identically to a network drop. The team stays in the DB and roster (offline). This is acceptable — teams shouldn't be able to self-delete during an event. Not a bug.

---

## Summary Table

| # | Severity | Issue | File |
|---|---|---|---|
| 1 | 🔴 HIGH | Raw passcode stored in sessionStorage | Admin.tsx:114 |
| 2 | 🔴 HIGH | New teams can join on a scored/completed quiz | socket/index.ts |
| 3 | 🔴 HIGH | Reset keeps all ghost teams across dry runs | engine.ts:reset() |
| 4 | 🔴 HIGH | selectedOption not bounds-checked in schema | schema.ts:50 |
| 5 | 🟡 MED | isPaused hardcoded false in TimerDial | Team.tsx:206 |
| 6 | 🟡 MED | Reset doesn't reach disconnected team sockets | socket/index.ts |
| 7 | 🟡 MED | localStorage redirect flash after team removed | Landing.tsx:18 |
| 8 | 🟡 MED | No team score shown on "Quiz Complete" screen | Team.tsx |
| 9 | 🟡 MED | No "Lock Console" button on admin panel | Admin.tsx |
| 10 | 🟡 MED | CORS wildcard not using CORS_ORIGIN env var | main.ts:29,45 |
| 11 | 🟢 LOW | Dead event types in events.ts | events.ts:29-32 |
| 12 | 🟢 LOW | (Not a bug) Name length consistent | Landing.tsx, schema.ts |
| 13 | 🟢 LOW | (Not a bug) Leave team has no server signal | Team.tsx:137 |
