import { io as Client } from "socket.io-client";
import assert from "node:assert";
import { db } from "../db/index.js";
import { PublicQuestion, TeamQuizState } from "@orientquiz/shared";

const SERVER_URL = "http://localhost:3001";

async function runGameplayTests() {
  console.log("🧪 [Test] Starting Milestone 4 Gameplay Lifecycle Suite...");

  // Clean db
  db.prepare("DELETE FROM team").run();
  db.prepare("DELETE FROM submission").run();
  db.prepare("UPDATE quiz_session SET status = 'waiting', question_index = 0, question_deadline = NULL, winner_revealed = 0").run();

  // 1. Setup Admin Socket
  const adminClient = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => adminClient.on("connect", res));

  const authRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit("admin:auth", { passcode: "ORIENT2026" }, res);
  });
  assert.strictEqual(authRes.ok, true, "Admin auth must succeed");
  console.log("  ✓ Admin authenticated successfully");

  // 2. Setup Team Socket
  const teamClient = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((res) => teamClient.on("connect", res));

  let teamSession: any;
  await new Promise<void>((res, rej) => {
    teamClient.emit("team:create", { name: "Delta Hawks" }, (result) => {
      if (result.ok && result.session) {
        teamSession = result.session;
        res();
      } else {
        rej(new Error(result.error));
      }
    });
  });
  console.log("  ✓ Team Delta Hawks registered with code:", teamSession.code);

  // 3. Admin starts quiz -> transition Waiting -> Running
  let questionReceived: PublicQuestion | null = null;
  teamClient.on("quiz:question", (q) => {
    questionReceived = q;
  });

  const startRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit("admin:start", res);
  });
  assert.strictEqual(startRes.ok, true, "Admin start must succeed");
  console.log("  ✓ Admin started quiz");

  // Wait for state to reach team client
  await new Promise((r) => setTimeout(r, 200));
  const teamStateRunning = await new Promise<TeamQuizState>((res) => {
    teamClient.once("quiz:state", res);
    teamClient.emit("team:sync");
  });
  assert.strictEqual(teamStateRunning.status, "running");
  assert.strictEqual(teamStateRunning.currentQuestion !== null, true);
  console.log("  ✓ Team received Running quiz state with Question 1:", teamStateRunning.currentQuestion?.text);

  // 4. Team Submits Answer -> Locks immediately and receives danger state if wrong
  // Option 0 (Queue is wrong, Stack is correct index 1 for question 1)
  const lockedPromise = new Promise<{ questionIndex: number; optionIndex: number; isWrong: boolean }>((res) => {
    teamClient.once("quiz:locked", res);
  });

  const submitRes = await new Promise<{ ok: boolean }>((res) => {
    teamClient.emit("team:submit", { questionIndex: 0, selectedOption: 0 }, res);
  });
  assert.strictEqual(submitRes.ok, true, "Submission accepted");

  const lockedState = await lockedPromise;
  assert.strictEqual(lockedState.isWrong, true, "Option 0 should be marked wrong");
  assert.strictEqual(lockedState.optionIndex, 0);
  console.log("  ✓ Team locked in answer. isWrong=true, correct answer NOT revealed to team");

  // 5. Admin Pauses Quiz -> transition Running -> Paused
  const pauseRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit("admin:pause", res);
  });
  assert.strictEqual(pauseRes.ok, true, "Admin pause must succeed");

  await new Promise((r) => setTimeout(r, 200));
  const pausedState = await new Promise<TeamQuizState>((res) => {
    teamClient.once("quiz:state", res);
    teamClient.emit("team:sync");
  });
  assert.strictEqual(pausedState.status, "paused");
  console.log("  ✓ Quiz paused by organizer, state reflected on team client");

  // 6. Admin Resumes Quiz -> transition Paused -> Running
  const resumeRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit("admin:resume", res);
  });
  assert.strictEqual(resumeRes.ok, true, "Admin resume must succeed");

  await new Promise((r) => setTimeout(r, 200));
  const resumedState = await new Promise<TeamQuizState>((res) => {
    teamClient.once("quiz:state", res);
    teamClient.emit("team:sync");
  });
  assert.strictEqual(resumedState.status, "running");
  console.log("  ✓ Quiz resumed, countdown continues");

  // 7. Admin Advances Question
  adminClient.emit("admin:next_question");
  await new Promise((r) => setTimeout(r, 300));
  const q2State = await new Promise<TeamQuizState>((res) => {
    teamClient.once("quiz:state", res);
    teamClient.emit("team:sync");
  });
  assert.strictEqual(q2State.currentQuestion?.index, 1);
  assert.strictEqual(q2State.isLocked, false, "New question should start unlocked");
  console.log("  ✓ Advanced to Question 2, unlocked for new answer");

  // 8. Admin Ends Quiz -> transition Running -> Completed -> Scored
  const endRes = await new Promise<{ ok: boolean }>((res) => {
    adminClient.emit("admin:end", res);
  });
  assert.strictEqual(endRes.ok, true, "Admin end must succeed");

  await new Promise((r) => setTimeout(r, 200));
  const endState = await new Promise<TeamQuizState>((res) => {
    teamClient.once("quiz:state", res);
    teamClient.emit("team:sync");
  });
  assert.strictEqual(endState.status, "scored");
  console.log("  ✓ Quiz completed and scored automatically");

  // Cleanup
  adminClient.disconnect();
  teamClient.disconnect();

  console.log("🎉 [Test] All Milestone 4 Gameplay tests passed successfully!");
  process.exit(0);
}

runGameplayTests().catch((e) => {
  console.error("❌ [Test] Failed:", e);
  process.exit(1);
});
