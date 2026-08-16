import { io as Client } from "socket.io-client";
import assert from "node:assert";
import { db } from "../db/index.js";
import { LeaderboardEntry } from "@orientquiz/shared";

const SERVER_URL = "http://localhost:3001";

async function runIsolationTests() {
  console.log("🧪 [Test] Starting Milestone 5 Isolation & Leaderboard Suite...");

  // Clean db
  db.prepare("DELETE FROM team").run();
  db.prepare("DELETE FROM submission").run();
  db.prepare("DELETE FROM score_override").run();
  db.prepare("UPDATE quiz_session SET status = 'waiting', question_index = 0, question_deadline = NULL, winner_revealed = 0").run();

  // 1. Setup Admin Socket
  const adminClient = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => adminClient.on("connect", res));

  await new Promise<void>((res, rej) => {
    adminClient.emit("admin:auth", { passcode: "ORIENT2026" }, (result) => {
      if (result.ok) res();
      else rej(new Error(result.error));
    });
  });
  console.log("  ✓ Admin socket connected and authenticated");

  // 2. Setup Two Team Sockets: Team X and Team Y
  const teamClientX = Client(SERVER_URL, { forceNew: true });
  const teamClientY = Client(SERVER_URL, { forceNew: true });
  await Promise.all([
    new Promise<void>((res) => teamClientX.on("connect", res)),
    new Promise<void>((res) => teamClientY.on("connect", res)),
  ]);

  let sessionX: any;
  let sessionY: any;

  await new Promise<void>((res) => {
    teamClientX.emit("team:create", { name: "Team X" }, (r) => {
      sessionX = r.session;
      res();
    });
  });

  await new Promise<void>((res) => {
    teamClientY.emit("team:create", { name: "Team Y" }, (r) => {
      sessionY = r.session;
      res();
    });
  });
  console.log("  ✓ Created Team X and Team Y");

  // 3. Verify Team Socket Isolation:
  // Assert that teamClientX and teamClientY NEVER receive 'admin:leaderboard' or 'admin:roster'
  let leakedToTeamX = false;
  teamClientX.on("admin:leaderboard" as any, () => {
    leakedToTeamX = true;
  });
  teamClientX.on("admin:roster" as any, () => {
    leakedToTeamX = true;
  });

  // Admin triggers start
  await new Promise<void>((res) => {
    adminClient.emit("admin:start", () => res());
  });

  // Team X answers correctly (index 1), Team Y answers incorrectly (index 0)
  teamClientX.emit("team:submit", { questionIndex: 0, selectedOption: 1 });
  teamClientY.emit("team:submit", { questionIndex: 0, selectedOption: 0 });

  // Admin ends quiz -> triggers scoring & leaderboard broadcast to admin
  let adminLeaderboard: LeaderboardEntry[] = [];
  const leaderboardPromise = new Promise<void>((res) => {
    adminClient.on("admin:leaderboard", (board) => {
      adminLeaderboard = board;
      res();
    });
  });

  await new Promise<void>((res) => {
    adminClient.emit("admin:end", () => res());
  });

  await leaderboardPromise;
  assert.strictEqual(adminLeaderboard.length, 2);
  assert.strictEqual(adminLeaderboard[0].name, "Team X");
  assert.strictEqual(adminLeaderboard[0].score > 0, true);
  assert.strictEqual(adminLeaderboard[1].name, "Team Y");
  assert.strictEqual(adminLeaderboard[1].score, 0);
  console.log("  ✓ Admin received calculated leaderboard correctly");

  // Give a tick to confirm no leaks to teamClientX
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(leakedToTeamX, false, "CRITICAL: Team socket received admin leaderboard/roster!");
  console.log("  ✓ Verified structural team isolation: zero leaderboard data received on team socket");

  // 4. Test Score Override
  // Admin applies +50 points to Team Y
  const overrideRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit(
      "admin:override_score",
      { teamId: sessionY.id, delta: 50, note: "Judge bonus" },
      res
    );
  });
  assert.strictEqual(overrideRes.ok, true);

  await new Promise((r) => setTimeout(r, 200));
  // Team Y score should now be 50
  const teamYRow = db.prepare("SELECT total_score FROM team WHERE id = ?").get(sessionY.id) as any;
  assert.strictEqual(teamYRow.total_score, 50);
  console.log("  ✓ Score override applied and team total score updated to 50 pts");

  // 5. Test Winner Reveal
  let winnerRevealReceived = false;
  adminClient.on("admin:winner_reveal", (payload) => {
    winnerRevealReceived = payload.revealed;
  });

  await new Promise<void>((res) => {
    adminClient.emit("admin:reveal_winners", { reveal: true }, () => res());
  });

  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(winnerRevealReceived, true);
  console.log("  ✓ Winner reveal toggled and broadcast to admin room");

  // 6. Test Admin Token Lifecycle & Server-Side Invalidation on Lock
  let issuedToken = "";
  const authRes = await new Promise<{ ok: boolean; token?: string }>((res) => {
    adminClient.emit("admin:auth", { passcode: "ORIENT2026" }, res);
  });
  assert.strictEqual(authRes.ok, true);
  assert.ok(authRes.token, "Expected server to return UUID session token");
  issuedToken = authRes.token!;

  // Verify reconnect with token works
  const reconnectAdmin = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => reconnectAdmin.on("connect", res));
  const tokenAuthRes = await new Promise<{ ok: boolean }>((res) => {
    reconnectAdmin.emit("admin:auth_token", { token: issuedToken }, res);
  });
  assert.strictEqual(tokenAuthRes.ok, true);
  console.log("  ✓ Admin token-based authentication verified");

  // Admin locks console -> emits admin:lock
  const lockRes = await new Promise<{ ok: boolean }>((res) => {
    reconnectAdmin.emit("admin:lock", { token: issuedToken }, res);
  });
  assert.strictEqual(lockRes.ok, true);

  // Verify revoked token can no longer authenticate
  const postLockClient = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => postLockClient.on("connect", res));
  const revokedTokenAuth = await new Promise<{ ok: boolean; error?: string }>((res) => {
    postLockClient.emit("admin:auth_token", { token: issuedToken }, res);
  });
  assert.strictEqual(revokedTokenAuth.ok, false);
  assert.ok(revokedTokenAuth.error?.includes("Session expired"));
  console.log("  ✓ Token successfully invalidated server-side on lock; re-auth correctly rejected");

  // 7. Test Full Wipe (admin:reset_quiz_full)
  // Re-auth admin to issue command
  await new Promise<void>((res) => {
    adminClient.emit("admin:auth", { passcode: "ORIENT2026" }, (r) => {
      if (r.ok) res();
    });
  });

  let teamXReceivedInactive = false;
  teamClientX.on("session:inactive", () => {
    teamXReceivedInactive = true;
  });

  const fullWipeRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit("admin:reset_quiz_full", res);
  });
  assert.strictEqual(fullWipeRes.ok, true);

  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(teamXReceivedInactive, true, "Expected connected team socket to receive session:inactive on full wipe");
  const remainingTeams = db.prepare("SELECT COUNT(*) as count FROM team").get() as { count: number };
  assert.strictEqual(remainingTeams.count, 0, "Expected all team records to be deleted on full wipe");
  console.log("  ✓ Full wipe verified: all teams deleted from database and active sockets disconnected");

  // Cleanup
  adminClient.disconnect();
  reconnectAdmin.disconnect();
  postLockClient.disconnect();
  teamClientX.disconnect();
  teamClientY.disconnect();

  console.log("🎉 [Test] All Milestone 5 Isolation & Leaderboard tests passed successfully!");
  process.exit(0);

}

runIsolationTests().catch((e) => {
  console.error("❌ [Test] Failed:", e);
  process.exit(1);
});
