import { io as Client } from "socket.io-client";
import assert from "node:assert";
import { db } from "../db/index.js";

const SERVER_URL = "http://localhost:3001";

async function runTeamsTests() {
  console.log("🧪 [Test] Starting Milestone 2 Teams Verification Suite...");

  // Clean test db and reset session to WAITING state (fix #2 blocks team:create when not waiting)
  db.prepare("DELETE FROM team").run();
  db.prepare("DELETE FROM submission").run();
  db.prepare("DELETE FROM score_override").run();
  db.prepare(
    "UPDATE quiz_session SET status = 'waiting', question_index = 0, question_deadline = NULL, paused_at = NULL, remaining_ms = NULL, winner_revealed = 0 WHERE id = 'default'"
  ).run();

  // Test 1: Team Creation & Unique Name validation (case-insensitive)
  const clientA = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((resolve) => clientA.on("connect", resolve));

  let teamSessionA: any;
  await new Promise<void>((resolve, reject) => {
    clientA.emit("team:create", { name: "Gamma Team" }, (res) => {
      if (res.ok && res.session) {
        teamSessionA = res.session;
        assert.strictEqual(res.session.name, "Gamma Team");
        assert.strictEqual(res.session.code.length, 6);
        console.log("  ✓ Team creation succeeded with code:", res.session.code);
        resolve();
      } else {
        reject(new Error(res.error));
      }
    });
  });

  // Duplicate name (case-insensitive) must be rejected
  const clientB = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((resolve) => clientB.on("connect", resolve));

  await new Promise<void>((resolve, reject) => {
    clientB.emit("team:create", { name: "gamma team" }, (res) => {
      if (!res.ok) {
        console.log("  ✓ Duplicate case-insensitive team name properly rejected:", res.error);
        resolve();
      } else {
        reject(new Error("Expected duplicate team creation to fail!"));
      }
    });
  });

  // Test 2: Team Join with valid 6-char code
  let teamSessionB: any;
  await new Promise<void>((resolve, reject) => {
    clientB.emit("team:join", { code: teamSessionA.code.toLowerCase() }, (res) => {
      if (res.ok && res.session) {
        teamSessionB = res.session;
        assert.strictEqual(res.session.id, teamSessionA.id);
        console.log("  ✓ Team join with lowercase code succeeded (case normalized)");
        resolve();
      } else {
        reject(new Error(res.error));
      }
    });
  });

  // Test 3: Device Hard-Takeover (clientA must receive session:inactive)
  let inactiveReceived = false;
  clientA.on("session:inactive", (payload) => {
    inactiveReceived = true;
    console.log("  ✓ Device A received session:inactive message:", payload.reason);
  });

  // Device C joins with the same code -> triggers takeover from Device B
  const clientC = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((resolve) => clientC.on("connect", resolve));

  let deviceBInactive = false;
  clientB.on("session:inactive", (payload) => {
    deviceBInactive = true;
    console.log("  ✓ Device B received session:inactive message upon Device C takeover");
  });

  await new Promise<void>((resolve, reject) => {
    clientC.emit("team:join", { code: teamSessionA.code }, (res) => {
      if (res.ok) {
        setTimeout(() => {
          assert.strictEqual(deviceBInactive, true, "Device B should have received session:inactive");
          resolve();
        }, 100);
      } else {
        reject(new Error(res.error));
      }
    });
  });

  // Test 4: Regression for fix #2 — team:create blocked when quiz is not in waiting state
  db.prepare("UPDATE quiz_session SET status = 'running' WHERE id = 'default'").run();
  const clientD = Client(SERVER_URL, { forceNew: true });
  await new Promise<void>((resolve) => clientD.on("connect", resolve));
  await new Promise<void>((resolve, reject) => {
    clientD.emit("team:create", { name: "Late Joiners" }, (res) => {
      if (!res.ok && res.error?.includes("already started")) {
        console.log("  ✓ Team creation correctly blocked when quiz is running:", res.error);
        resolve();
      } else {
        reject(new Error("Expected team:create to be blocked during running quiz"));
      }
    });
  });
  clientD.disconnect();
  // Reset back to waiting for next test suites
  db.prepare("UPDATE quiz_session SET status = 'waiting', question_deadline = NULL WHERE id = 'default'").run();

  // Clean up sockets
  clientA.disconnect();
  clientB.disconnect();
  clientC.disconnect();

  console.log("🎉 [Test] All Milestone 2 Teams tests passed successfully!");
  process.exit(0);

}

runTeamsTests().catch((err) => {
  console.error("❌ [Test] Failed:", err);
  process.exit(1);
});
