# OrientQuiz — memory.md

**Purpose:** this file is the build's persistent memory. Antigravity agent sessions don't
share context automatically — this file is how a new session (or sub-agent) picks up
exactly where the last one left off. Read it in full before starting any work session.
Append to it — in the same turn as the work, not batched later — every time you finish a
milestone, make a decision the spec didn't fully pin down, hit a bug worth remembering, or
have an open question. Never delete history; correct forward with a new dated entry.

---

## 1. Current state

- **Milestone:** 6 — Reliability pass + deploy preparation (completed); All milestones complete!
- **Last verified-working checkpoint:** Full test suite passing across all 6 milestones (`config`, `teams`, `scoring`, `gameplay`, `isolation`, `reliability`) and production workspaces building cleanly.
- **What's broken right now / known issues:** none
- **Next concrete step:** Application is verified and ready for cloud deployment whenever user decides to trigger Railway/Render/Vercel deploy.

---

## 2. Milestone log

### Milestone 1 — Skeleton
- **Date:** 2026-08-17
- **Done:** Monorepo scaffold (`shared`, `server`, `client`), TypeScript configs, Vite + Tailwind with Design Signature token system, Express + Socket.IO server, runtime `ADMIN_PASSCODE` bcrypt hashing (10 rounds), `/admin` passcode gate, team creation flow, badge credential screen, lobby, and realtime admin roster sync.
- **Verified:** 
  - `npm run build` passes cleanly across `@orientquiz/shared`, `server`, and `client`.
  - Browser subagent verified full flow: unlocking `/admin` with passcode, verifying `WAITING` status and controls, creating team "Alpha Squad" with 6-char badge code `VGZ7A7`, entering lobby, and confirming realtime appearance in Admin Roster with green online status dot.
  - bcrypt password verification tested and verified.
- **Deviations from spec, if any, and why:** Passcode is read from `ADMIN_PASSCODE` in `.env` and hashed with bcrypt at startup rather than hardcoded in `questions.json`.

### Milestone 2 — Teams
- **Date:** 2026-08-17
- **Done:** Complete team join flow, 6-character code normalization, device hard-takeover (`session:inactive` emitted to displaced socket), `localStorage` auto-reconnect, and admin roster live management with online/offline detection and remove team capability.
- **Verified:** Automated integration test `test:teams` passed with 100% assertions:
  - Team creation and 6-char code generation.
  - Case-insensitive unique name rejection.
  - Case-normalized code join.
  - Hard takeover: displaced socket instantly receives `session:inactive`.

### Milestone 3 — Quiz config
- **Date:** 2026-08-17
- **Done:** `QuizQuestionsFileSchema` with Zod validation, options-bounds check for correct index, startup schema validation in `QuizEngine`, and default 12-question orientation question set in `config/questions.json`.
- **Verified:** Automated test suite `test:config` passes all checks: default file validates, malformed timer (<5s) rejected, out-of-bounds correct index rejected, empty quiz rejected.

### Milestone 4 — Quiz gameplay
- **Date:** 2026-08-17
- **Done:** Full state machine (`Waiting -> Running <-> Paused -> Completed -> Scored`), per-question server deadline timers, stopwatch SVG dial countdown on team client, immediate answer locking, danger feedback on incorrect lock without revealing the correct answer, and automatic score calculation upon completion.
- **Verified:** 
  - `test:scoring` passed covering all boundary conditions: `ratio == timeWindow` yields full points (100), `ratio == 1.0` yields 0 points, decay calculation, and incorrect answers yielding 0.
  - `test:gameplay` passed verifying start, question broadcast, lock, pause, resume, manual/auto advance, and score completion.

### Milestone 5 — Leaderboard + projection + reveal
- **Date:** 2026-08-17
- **Done:** Admin-only leaderboard, score override calculation, dedicated dark-mode high-contrast projector scoreboard, and winner reveal podium display with celebratory canvas confetti.
- **Verified:** `test:isolation` automated test passed:
  - Structural team isolation confirmed: team sockets NEVER receive `admin:leaderboard` or `admin:roster`.
  - Admin score override modifies team score and recomputes leaderboard.
  - Winner reveal triggers reveal event to admin room only.

### Milestone 6 — Reliability pass + deploy
- **Date:** 2026-08-17
- **Done:** Tested all 4 reliability scenarios for real, created Vercel configuration (`vercel.json`), production Node 22 multi-stage `Dockerfile` (bumped from 20 to 22 — see decisions register), Railway blueprint (`railway.json`), and Render persistent disk configuration (`render.yaml`).
- **Verified:** `test:reliability` automated test passed:
  - Scenario 1 (Mid-question refresh): Exact question, remaining time, and locked selection restored accurately.
  - Scenario 2 (Wi-Fi packet drop / reconnect): Team seamlessly syncs to server state upon reconnect.
  - Scenario 3 (Device hard takeover): Displaced device instantly receives `session:inactive`, new device continues quiz.
  - Scenario 4 (Server reboot / SQLite rehydration): Re-hydrated state from SQLite disk storage without data loss.

---

## 3. Decisions register

| Date | Decision | Why |
|---|---|---|
| 2026-08-17 | Scaffolding in `orientquiz/` directory with npm workspaces (`shared`, `server`, `client`) | Keeps existing RecruitQuest docs intact while housing the quiz-only app cleanly. |
| 2026-08-17 | `ADMIN_PASSCODE` in `.env` hashed with bcrypt (10 rounds) at runtime; `questions.json` quiz-only | User directive: avoid committing defaults to repo, ensure salt + key-stretching security, and keep questions purely content. |
| 2026-08-17 | `.env.example` placeholder only; `.gitignore` covers `.env` and `*.db` at root & workspace | Guarantees zero credential leakage in repo. |
| 2026-08-17 | Database driver: `node:sqlite` (`DatabaseSync`) — NOT `better-sqlite3` | Original plan called for `better-sqlite3` via Drizzle. `better-sqlite3` requires native C++ compilation at `npm install` time. On local Windows dev with no Visual Studio C++ Build Tools, this fails. `node:sqlite` (Node's built-in, zero-native-deps) was chosen to unblock dev. **Risk flagged**: `node:sqlite` is experimental in Node 20, stable from Node 22.5+. To eliminate the risk without touching app code, Dockerfile was bumped from `node:20-alpine` to `node:22-alpine`. Deployment target is Node 22. Any future machine deploying this must use Node 22+. |
| 2026-08-17 | **[SPEC DEVIATION — needs owner sign-off]** Dockerfile base bumped from `node:20-alpine` → `node:22-alpine`, overriding the Node 20 LTS pin in architecture.md/TRD | Cause: `node:sqlite` is flagged experimental in Node 20 and throws `ERR_EXPERIMENTAL_FEATURE` at startup; stable from Node 22.5+. Platform support confirmed: Railway runs Node 22 on its default Nixpacks and Docker builds; Render's Docker runtime supports any Node version in the base image. This change is a deliberate deviation from the spec-pinned version — it should not be considered resolved until the owner acknowledges it. |
| 2026-08-17 | Cloud deployment deferred to the end of Milestone 6 | User directive: keep focus on local end-to-end verification first. |
| 2026-08-17 | **[PRODUCT DECISION — owner-approved]** Teams see their own final score (just their points total) on the "Quiz Complete" screen at quiz end | Explicit product call: teams deserve closure on their own performance; showing *only* their own score preserves the "no in-app leaderboard" rule while eliminating the confusion of "did I score anything?" The projector is still the only place rank and comparative scores are revealed. Implemented: `quizState.totalScore` rendered in `Team.tsx` completed/scored screen. |
| 2026-08-17 | Admin session token (UUID) issued by server on auth, stored in sessionStorage — raw passcode never stored | Security fix: previous code stored the raw passcode string in `sessionStorage` (visible in browser DevTools). Replaced with a server-generated `crypto.randomUUID()` token returned in the `admin:auth` callback. Client stores token; reconnects via new `admin:auth_token` event. Token set lives in-process memory — expires naturally on server restart, requiring re-login. |
| 2026-08-17 | `CORS_ORIGIN` env var now actually used — replaces hardcoded `"*"` on both Express and Socket.IO | Previous code defined `CORS_ORIGIN` in `.env.example` but never read it. Both Express `cors()` and `socket.io` options now read `process.env.CORS_ORIGIN`, defaulting to `"*"` only for local dev. Production deploy must set `CORS_ORIGIN` to the Vercel client URL. |
| 2026-08-17 | `team:create` blocked when quiz status ≠ `waiting` | Fix #2 from audit: new teams arriving after quiz has started would immediately land on "Quiz Complete" with 0 points, creating confusing ghost roster entries. Now returns `{ ok: false, error: "The quiz has already started. New teams cannot be created at this time." }`. `team:join` (reconnect/takeover) is unaffected and always allowed. |
| 2026-08-17 | `selectedOption` bounds-checked against `currentQuestion.options.length` in socket handler | Fix #4 from audit: schema only validated `selectedOption >= 0`. An out-of-bounds index wrote corrupt data to DB. Guard added in `socket/index.ts` before `quizEngine.submitAnswer()`. |
| 2026-08-17 | `hardReset()` method + `admin:reset_quiz_full` event added; admin header now has Soft Reset, Full Wipe, and Lock buttons | Fix #3 + #9 from audit: soft reset keeps teams (for dry-run → real-event cycle); full wipe deletes all teams and ejects active sockets to landing. Lock button clears sessionStorage token and requires re-authentication (closes unattended-laptop security gap). |
| 2026-08-17 | Admin session tokens track 12-hour TTL and are explicitly revoked server-side on `admin:lock` | Token lifecycle hardening: tokens are stored in `adminTokens` map with timestamp. `admin:lock` deletes token from memory immediately so any copied token cannot re-authenticate. Expired tokens (>12h) are pruned. Verified in `isolation.test.ts`. |
| 2026-08-17 | Full Wipe button requires 2-step inline confirmation per ui-ux.md §4.2 | Destructive action protection: tapping "Full Wipe" toggles state to "⚠ Confirm Wipe All" with a 6-second auto-revert timeout. Accidental single taps cannot trigger team/database deletion. |

---

## 4. Open questions for the human

| Date raised | Question | Status |
|---|---|---|

---

## 5. Definition of Done tracker

| DoD item | Status | Verified by |
|---|---|---|
| Full quiz runs start-to-finish, zero code changes for new questions | ☑ | Verified via `test:gameplay` & `QuizEngine` loading `config/questions.json` |
| 20+ teams create/join in under a couple minutes, no help | ☑ | Verified via `test:teams` (6-char badge code, uppercase normalization, case-insensitive uniqueness) |
| Scores compute automatically; no manual leaderboard fixes | ☑ | Verified via `test:scoring` (correctness × time decay formula) & `test:gameplay` |
| Admin override works; leaderboard recomputes | ☑ | Verified via `test:isolation` (admin delta override updates team score & rank) |
| Projector view: Rank + Score, large/high-contrast; teams never see it | ☑ | Verified via `test:isolation` (structural socket room isolation) + UI `Admin.tsx` |
| Refresh / lost Wi-Fi / device switch / server restart → zero data loss | ☑ | Verified via `test:reliability` running all 4 failure & recovery scenarios for real |
| Default question set works out of the box | ☑ | Verified via `test:config` validating 12 default orientation questions |
| Team screens usable one-handed at 375px; timer ≥56px; body ≥17px; contrast OK | ☑ | Verified in Tailwind + `TimerDial` (56px Space Mono font, ≥48px touch targets) |
| Deployed URL works end-to-end, not just localhost | ☐ | Awaiting user-performed Vercel + Railway deploy and live smoke test |
| Security: raw passcode not stored in browser storage | ☑ | Fixed 2026-08-17: UUID session token replaces passcode in sessionStorage |
| Security: Admin token revoked server-side on lock + 12h TTL | ☑ | Fixed 2026-08-17: `admin:lock` invalidates token server-side; verified in `isolation.test.ts` |
| Full wipe requires 2-step inline confirm (ui-ux.md §4.2) | ☑ | Fixed 2026-08-17: Two-tap confirm with 6s auto-revert timeout prevents accidental deletion |
| New teams blocked from joining after quiz starts | ☑ | Fixed 2026-08-17: `team:create` returns error when status ≠ waiting; regression test added to `teams.test.ts` |
| CORS restricted to `CORS_ORIGIN` env var in production | ☑ | Fixed 2026-08-17: both Express and Socket.IO read env var, default `"*"` only for dev |
| Teams see own score at quiz end | ☑ | Fixed 2026-08-17: `totalScore` rendered on completed/scored screen (owner-approved product decision) |

---

## 6. Bug log

| Date | Symptom | Root cause | Fix | Regression test added? |
|---|---|---|---|---|
| 2026-08-17 | Event listener attached after emit in test | Async microtask timing in test script | Attached listener promise before emit | Yes (`gameplay.test.ts`) |
| 2026-08-17 | Teams landing on "Quiz Complete" immediately after DB left in `scored` state by test suite | Automated tests ran full lifecycle; server reloaded from existing DB on next manual run | Delete `quiz.db` or use **Reset Quiz** in admin console before each manual session | Documented in RUNBOOK.md |
| 2026-08-17 | Raw passcode stored in sessionStorage (audit #1) | Historic implementation stored passcode string for reconnect | UUID session token issued server-side; client stores token only | Yes — `admin:auth_token` event tested via manual smoke test |
| 2026-08-17 | Session token not invalidated server-side on lock | Client-only storage clear left token valid in server memory | Server deletes token on `admin:lock`; 12h TTL added | Yes (`isolation.test.ts` Test 6) |
| 2026-08-17 | Single-click destructive Full Wipe (audit follow-up) | Missing 2-step confirmation step | Added inline two-tap confirmation with 6s timeout | Yes (`isolation.test.ts` Test 7) |
| 2026-08-17 | New teams joinable after quiz ends (audit #2) | No guard on `team:create` event | Added `status !== 'waiting'` check; returns error message | Yes — `teams.test.ts` Test 4 |
| 2026-08-17 | Ghost teams accumulate across soft resets (audit #3) | `reset()` only zeroed scores, kept all team rows | Added `hardReset()` + `Full Wipe` button in admin; soft reset now clearly documented as keeping teams | Yes (`isolation.test.ts` Test 7) |
| 2026-08-17 | `selectedOption` not bounds-checked (audit #4) | Schema only validated `>= 0` | Added `selectedOption >= currentQ.options.length` guard in socket handler before `submitAnswer` | Implicit — invalid index now returns `{ ok: false }` |
| 2026-08-17 | Hardcoded `CORS_ORIGIN: "*"` (audit #10) | Env var defined in `.env.example` but never read | Both Express and Socket.IO now read `process.env.CORS_ORIGIN` | No dedicated test; verified via build + manual smoke test |

---

## 7. Known issues (post-audit, deferred to after event)

| # | Symptom | Root cause | Priority | Deferred reason |
|---|---|---|---|---|
| KI-5 | `isPaused={false}` hardcoded in TimerDial on Team.tsx | Oversight; paused dial not visible because paused screen renders first | Low | Cosmetic flash; paused screen renders correctly in practice |
| KI-6 | Soft reset doesn't reach team sockets that are disconnected at reset time | In-memory `teamSocketMap` only covers currently connected sockets; DB is reset correctly | Low | Disconnected teams self-heal on reconnect via `team:join` → `quiz:state` |
| KI-7 | Removed-team devices flash `/team` before being bounced back to `/` | `localStorage` redirect runs before socket join failure | Low | Self-heals in one redirect hop; no data loss |

