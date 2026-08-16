import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { QuizQuestionsFileSchema } from "@orientquiz/shared";

function runConfigTests() {
  console.log("🧪 [Test] Starting Milestone 3 Quiz Config Verification Suite...");

  // Test 1: Validate default config/questions.json
  const defaultPath = path.resolve(process.cwd(), "config/questions.json");
  const rawDefault = fs.readFileSync(defaultPath, "utf-8");
  const jsonDefault = JSON.parse(rawDefault);

  const defaultResult = QuizQuestionsFileSchema.safeParse(jsonDefault);
  assert.strictEqual(defaultResult.success, true, "Default questions.json must pass schema");
  if (defaultResult.success) {
    assert.strictEqual(defaultResult.data.questions.length >= 10, true, "Should have at least 10 sample questions");
    console.log(`  ✓ Default questions.json valid with ${defaultResult.data.questions.length} questions`);
  }

  // Test 2: Reject question with out-of-bounds correct answer index
  const invalidCorrectIndex = {
    title: "Bad Quiz",
    questions: [
      {
        text: "What is 2 + 2?",
        options: ["3", "4"],
        correct: 5, // Out of bounds!
        timerSeconds: 20,
        points: 100,
      },
    ],
  };

  const badIndexResult = QuizQuestionsFileSchema.safeParse(invalidCorrectIndex);
  assert.strictEqual(badIndexResult.success, false, "Should reject out-of-bounds correct index");
  console.log("  ✓ Correctly rejected out-of-bounds answer index");

  // Test 3: Reject question with timer under 5 seconds
  const invalidTimer = {
    title: "Bad Quiz",
    questions: [
      {
        text: "Quick Question",
        options: ["A", "B"],
        correct: 0,
        timerSeconds: 2, // Less than minimum 5 seconds
        points: 100,
      },
    ],
  };

  const badTimerResult = QuizQuestionsFileSchema.safeParse(invalidTimer);
  assert.strictEqual(badTimerResult.success, false, "Should reject timer under 5s");
  console.log("  ✓ Correctly rejected invalid timer");

  // Test 4: Reject quiz with empty questions array
  const emptyQuiz = {
    title: "Empty Quiz",
    questions: [],
  };

  const emptyResult = QuizQuestionsFileSchema.safeParse(emptyQuiz);
  assert.strictEqual(emptyResult.success, false, "Should reject empty questions list");
  console.log("  ✓ Correctly rejected empty questions array");

  console.log("🎉 [Test] All Milestone 3 Quiz Config tests passed successfully!");
}

try {
  runConfigTests();
} catch (e) {
  console.error("❌ [Test] Failed:", e);
  process.exit(1);
}
