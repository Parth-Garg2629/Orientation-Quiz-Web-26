import assert from "node:assert";
import { calculateQuestionScore } from "../quiz/scoring.js";

function runScoringTests() {
  console.log("🧪 [Test] Starting Milestone 4 Scoring Verification Suite...");

  const points = 100;
  const timerMs = 30000; // 30s
  const timeWindow = 0.25; // First 25% (7500ms)

  // 1. Boundary Case 1: ratio == timeWindow (must return full points)
  const exactWindowElapsed = timerMs * timeWindow; // 7500ms
  const scoreAtBoundary = calculateQuestionScore({
    correct: true,
    elapsedMs: exactWindowElapsed,
    timerMs,
    points,
    timeWindow,
    fullPointsWindow: true,
  });
  assert.strictEqual(scoreAtBoundary, 100, `Expected full points (${points}) at ratio == timeWindow, got ${scoreAtBoundary}`);
  console.log(`  ✓ Boundary ratio == timeWindow (${exactWindowElapsed}ms / ${timerMs}ms) returned full points: ${scoreAtBoundary}`);

  // 2. Boundary Case 2: ratio == 1.0 (must return 0 points)
  const scoreAtExpiry = calculateQuestionScore({
    correct: true,
    elapsedMs: timerMs, // 30000ms
    timerMs,
    points,
    timeWindow,
    fullPointsWindow: true,
  });
  assert.strictEqual(scoreAtExpiry, 0, `Expected 0 points at ratio == 1.0, got ${scoreAtExpiry}`);
  console.log(`  ✓ Boundary ratio == 1.0 (${timerMs}ms / ${timerMs}ms) returned 0 points: ${scoreAtExpiry}`);

  // 3. Beyond expiry (> 1.0) must return 0
  const scoreBeyondExpiry = calculateQuestionScore({
    correct: true,
    elapsedMs: timerMs + 2000,
    timerMs,
    points,
    timeWindow,
    fullPointsWindow: true,
  });
  assert.strictEqual(scoreBeyondExpiry, 0, `Expected 0 points beyond expiry, got ${scoreBeyondExpiry}`);
  console.log(`  ✓ Beyond expiry (${timerMs + 2000}ms) returned 0 points`);

  // 4. Incorrect answer must return 0
  const scoreIncorrect = calculateQuestionScore({
    correct: false,
    elapsedMs: 2000,
    timerMs,
    points,
    timeWindow,
    fullPointsWindow: true,
  });
  assert.strictEqual(scoreIncorrect, 0, `Expected 0 for incorrect answer, got ${scoreIncorrect}`);
  console.log(`  ✓ Incorrect answer returned 0 points`);

  // 5. Fast answer (ratio < timeWindow) must return full points
  const scoreFast = calculateQuestionScore({
    correct: true,
    elapsedMs: 3000, // 10%
    timerMs,
    points,
    timeWindow,
    fullPointsWindow: true,
  });
  assert.strictEqual(scoreFast, 100, `Expected full points for fast response, got ${scoreFast}`);
  console.log(`  ✓ Fast response (10% elapsed) returned full points: ${scoreFast}`);

  // 6. Mid-decay answer (ratio = 0.625, halfway between 0.25 and 1.0 -> 50% points)
  const midElapsed = 7500 + (30000 - 7500) / 2; // 18750ms
  const scoreMid = calculateQuestionScore({
    correct: true,
    elapsedMs: midElapsed,
    timerMs,
    points,
    timeWindow,
    fullPointsWindow: true,
  });
  assert.strictEqual(scoreMid, 50, `Expected 50 points at halfway decay, got ${scoreMid}`);
  console.log(`  ✓ Mid-decay response returned exactly 50% points: ${scoreMid}`);

  console.log("🎉 [Test] All Milestone 4 Scoring tests passed successfully!");
}

try {
  runScoringTests();
} catch (e) {
  console.error("❌ [Test] Failed:", e);
  process.exit(1);
}
