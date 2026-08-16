# OrientQuiz — Runbook

Everything you need to start, run, reset, and deploy OrientQuiz.

---

## 1. First-Time Setup

```powershell
cd "C:\Users\Ayush Srivastava\Orientation-Quiz-Web-26\orientquiz"
npm install
```

Create your `.env` file inside the `server/` folder:

```powershell
copy server\.env.example server\.env
```

Then open `server\.env` and set a real passcode:

```
PORT=3001
ADMIN_PASSCODE=YourSecretPasscodeHere
DATABASE_PATH=./quiz.db
CORS_ORIGIN=http://localhost:5173
```

---

## 2. Running Locally

Open **two separate PowerShell terminals**, both inside `orientquiz/`:

**Terminal 1 — Backend server (port 3001):**
```powershell
npm run dev:server
```

**Terminal 2 — Frontend client (port 5173):**
```powershell
npm run dev:client
```

Then open in browser:

| Who | URL |
|---|---|
| Team players (phone/laptop) | http://localhost:5173/ |
| Admin / organizer | http://localhost:5173/admin |

---

## 3. Running the Quiz — Step by Step

1. Open `http://localhost:5173/admin` → enter your passcode → you land on the **Control Desk**
2. Teams open `http://localhost:5173/` on their phones → enter a team name → get a **6-character badge code**
3. Each team sees the code on screen — their device is now registered
4. Admin sees all teams appear in the **Team Roster** panel with a green dot (online)
5. Admin clicks **Start Quiz** → all team screens show Question 1 with the countdown timer
6. Teams tap an answer to lock in — they can only submit once per question
7. Timer auto-advances to the next question when it expires — or admin can click **Next Question** manually
8. After all 12 questions, quiz moves to `SCORED` state automatically
9. Admin can click **Override** next to any team name to apply a score delta (+ or -)
10. Admin clicks **Reveal Winners on Projector** → projector view shows the podium + confetti

---

## 4. Resetting for a New Run (No File Deletion Needed)

In the Admin Control Desk, click the **Reset Quiz** button (top-right corner).

- Confirm with **OK**
- This wipes all scores and submissions, keeps teams, and sends all connected team screens back to the **WAITING lobby** instantly — no page refresh needed on their devices

Use this between a **dry run and the real event**.

---

## 5. Full Fresh Wipe (New Event, New Teams)

If you want to start completely fresh (new teams, new scores):

```powershell
# Stop the server first (Ctrl+C in Terminal 1), then:
cd "C:\Users\Ayush Srivastava\Orientation-Quiz-Web-26\orientquiz"
Remove-Item server\quiz.db -Force
# Start the server again
npm run dev:server
```

---

## 6. Running All Automated Tests

With the server **running** on port 3001:

```powershell
cd "C:\Users\Ayush Srivastava\Orientation-Quiz-Web-26\orientquiz"
npm test --workspace=server
```

Individual test suites:
```powershell
npm run test:config      --workspace=server   # Zod schema & questions.json
npm run test:teams       --workspace=server   # Join, takeover, uniqueness
npm run test:scoring     --workspace=server   # Time-decay formula & boundaries
npm run test:gameplay    --workspace=server   # Full state machine lifecycle
npm run test:isolation   --workspace=server   # Team socket isolation & leaderboard
npm run test:reliability --workspace=server   # 4 real failure/recovery scenarios
```

---

## 7. Production Build

```powershell
cd "C:\Users\Ayush Srivastava\Orientation-Quiz-Web-26\orientquiz"
npm run build
```

Outputs:
- `server/dist/` — compiled server JS (Node 22)
- `client/dist/` — static Vite bundle for deployment

---

## 8. Deploying to Production

### Frontend → Vercel

```powershell
vercel login                  # opens browser, sign in once
vercel deploy client --prod   # deploys client/dist/
```

In Vercel dashboard → Project Settings → Environment Variables:
- Add `VITE_SERVER_URL` = `https://your-railway-server-url`

### Backend → Railway

```powershell
npx -y @railway/cli login     # opens browser
npx @railway/cli up           # deploys using Dockerfile
```

In Railway dashboard:
- Add env var `ADMIN_PASSCODE` = your real passcode (NOT the example one)
- Add env var `DATABASE_PATH` = `/data/quiz.db`
- Add a **Volume** mounted at `/data` (keeps the database across restarts)

### Backend → Render (alternative)

Push the repo to GitHub, connect on [render.com](https://render.com).  
The `render.yaml` blueprint configures everything including the 1 GB persistent disk automatically.

> **Node version requirement:** Deployment target must be **Node 22+**.  
> The Dockerfile uses `node:22-alpine`. `node:sqlite` (the database driver) is experimental  
> in Node 20 and stable from Node 22.5 onwards.

---

## 9. Smoke Test Checklist (Run Before the Event)

Do this on your actual phone on the actual venue Wi-Fi:

- [ ] Admin opens `/admin`, enters passcode → sees WAITING console
- [ ] Phone 1: creates team, gets badge code, lands on lobby
- [ ] Phone 2: joins same code → Phone 1 immediately shows "session inactive"
- [ ] Admin starts quiz → both phones receive Question 1 + countdown timer
- [ ] Answer from Phone 2 → admin sees submission count increment
- [ ] Quiz completes → admin leaderboard shows scores
- [ ] Admin hits Reveal Winners → projector view shows podium + confetti
- [ ] Admin hits Reset Quiz → Phone 2 goes back to lobby instantly

---

## 10. Key Files Reference

| File | Purpose |
|---|---|
| `server/.env` | Runtime secrets (ADMIN_PASSCODE, PORT, DATABASE_PATH) — not committed |
| `server/.env.example` | Template with placeholder values only |
| `server/config/questions.json` | Quiz questions — edit this to change the question set |
| `server/quiz.db` | SQLite database — auto-created on first run, excluded from git |
| `Dockerfile` | Production container (Node 22 Alpine) |
| `vercel.json` | Vercel SPA rewrite config for client |
| `railway.json` | Railway deployment blueprint |
| `render.yaml` | Render blueprint with persistent disk |
| `memory.md` (project root) | Build decisions register and DoD tracker |
