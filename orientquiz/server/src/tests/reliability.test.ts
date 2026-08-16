import { io as Client } from "socket.io-client";
import assert from "node:assert";
import { db } from "../db/index.js";
import { TeamQuizState } from "@orientquiz/shared";
import { QuizEngine } from "../quiz/engine.js";

const SERVER_URL = "http://localhost:3001";

async function runReliabilityTests() {
  console.log("🧪 [Test] Starting Milestone 6 Reliability Suite...");

  // Reset db
  db.prepare("DELETE FROM team").run();
  db.prepare("DELETE FROM submission").run();
  db.prepare("DELETE FROM score_override").run();
  db.prepare("UPDATE quiz_session SET status = 'waiting', question_index = 0, question_deadline = NULL, winner_revealed = 0").run();

  // Setup Admin
  const adminClient = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => adminClient.on("connect", res));
  await new Promise<void>((res) => adminClient.emit("admin:auth", { passcode: "ORIENT2026" }, () => res()));

  // Setup Team Alpha
  const teamClient1 = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => teamClient1.on("connect", res));

  let teamCode: string = "";
  let teamId: string = "";
  await new Promise<void>((res) => {
    teamClient1.emit("team:create", { name: "Phoenix Squadron" }, (r) => {
      teamCode = r.session!.code;
      teamId = r.session!.id;
      res();
    });
  });
  console.log("  ✓ Team created with code:", teamCode);

  // Admin starts quiz -> Q1 active
  await new Promise<void>((res) => adminClient.emit("admin:start", () => res()));
  await new Promise((r) => setTimeout(r, 200));

  // Team answers Q1 (selectedOption: 1)
  await new Promise<void>((res) => {
    teamClient1.emit("team:submit", { questionIndex: 0, selectedOption: 1 }, () => res());
  });

  // ----------------------------------------------------
  // Scenario 1: Refresh Mid-Question
  // ----------------------------------------------------
  console.log("\n  [Scenario 1] Refreshing team socket mid-question...");
  teamClient1.disconnect();

  const refreshedClient = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => refreshedClient.on("connect", res));

  let reconnectedState: TeamQuizState | null = null;
  await new Promise<void>((res) => {
    refreshedClient.emit("team:join", { code: teamCode }, (r) => {
      assert.strictEqual(r.ok, true);
      res();
    });
  });

  reconnectedState = await new Promise<TeamQuizState>((res) => {
    refreshedClient.once("quiz:state", res);
    refreshedClient.emit("team:sync");
  });

  assert.strictEqual(reconnectedState.status, "running");
  assert.strictEqual(reconnectedState.currentQuestion?.index, 0);
  assert.strictEqual(reconnectedState.isLocked, true);
  assert.strictEqual(reconnectedState.lockedOption, 1);
  console.log("  ✓ SCENARIO 1 PASSED: State and locked answer restored accurately upon refresh!");

  // ----------------------------------------------------
  // Scenario 2: Wi-Fi Disconnect & Restore
  // ----------------------------------------------------
  console.log("\n  [Scenario 2] Simulating Wi-Fi packet drop and recovery...");
  refreshedClient.disconnect();
  await new Promise((r) => setTimeout(r, 500)); // Disconnected for half second

  refreshedClient.connect();
  await new Promise<void>((res) => refreshedClient.on("connect", res));

  await new Promise<void>((res) => {
    refreshedClient.emit("team:join", { code: teamCode }, () => res());
  });

  const wifiSyncState = await new Promise<TeamQuizState>((res) => {
    refreshedClient.once("quiz:state", res);
    refreshedClient.emit("team:sync");
  });
  assert.strictEqual(wifiSyncState.status, "running");
  assert.strictEqual(wifiSyncState.lockedOption, 1);
  console.log("  ✓ SCENARIO 2 PASSED: Reconnected after simulated network drop without data loss!");

  // ----------------------------------------------------
  // Scenario 3: Device Takeover
  // ----------------------------------------------------
  console.log("\n  [Scenario 3] Second device joining same team code (Hard Takeover)...");
  const device2 = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => device2.on("connect", res));

  let device1Displaced = false;
  refreshedClient.on("session:inactive", (payload) => {
    device1Displaced = true;
    console.log("  ✓ Device 1 successfully displaced with reason:", payload.reason);
  });

  await new Promise<void>((res) => {
    device2.emit("team:join", { code: teamCode }, () => res());
  });

  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(device1Displaced, true);

  const device2State = await new Promise<TeamQuizState>((res) => {
    device2.once("quiz:state", res);
    device2.emit("team:sync");
  });
  assert.strictEqual(device2State.lockedOption, 1);
  console.log("  ✓ SCENARIO 3 PASSED: Device takeover seamless, displaced device locked out!");

  // ----------------------------------------------------
  // Scenario 4: Server Restart Simulation (SQLite Rehydration)
  // ----------------------------------------------------
  console.log("\n  [Scenario 4] Testing SQLite Rehydration after server restart...");
  // Instantiate fresh QuizEngine from disk DB to simulate reboot
  const rehydratedEngine = new QuizEngine();
  const restoredSession = rehydratedEngine.getSessionRow();
  assert.strictEqual(restoredSession.status, "running");
  assert.strictEqual(restoredSession.question_index, 0);

  const teamStateFromReboot = rehydratedEngine.getTeamQuizState(teamId);
  assert.strictEqual(teamStateFromReboot.lockedOption, 1);
  assert.strictEqual(teamStateFromReboot.isLocked, true);
  console.log("  ✓ SCENARIO 4 PASSED: Rehydrated from SQLite disk storage with exact session state!");

  // Cleanup
  adminClient.disconnect();
  refreshedClient.disconnect();
  device2.disconnect();

  console.log("\n🎉 [Test] ALL 4 RELIABILITY SCENARIOS PASSED WITH ZERO DATA LOSS!");
  process.exit(0);
}

runReliabilityTests().catch((e) => {
  console.error("❌ [Test] Reliability test failed:", e);
  process.exit(1);
});
