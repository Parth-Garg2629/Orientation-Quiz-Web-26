import fs from "node:fs";
import path from "node:path";
import {
  AdminQuizState,
  LeaderboardEntry,
  PublicQuestion,
  QuizQuestionsFile,
  QuizQuestionsFileSchema,
  QuizStatus,
  TeamQuizState,
  TeamRosterItem,
} from "@orientquiz/shared";
import { queryOne, query, execute } from "../db/index.js";
import { calculateQuestionScore } from "./scoring.js";

// Delay between question timer expiring and the next question appearing.
// During this window the client shows the answer reveal animation.
const ANSWER_REVEAL_DELAY_MS = 2000;

// Duration of the GET READY countdown before first question.
const STARTING_COUNTDOWN_MS = 5000;

// ---------------------------------------------------------------------------
// Internal row type returned by PostgreSQL for quiz_session
// ---------------------------------------------------------------------------
interface SessionRow {
  id: string;
  status: QuizStatus;
  question_index: number;
  question_deadline: number | null; // stored as BIGINT → parsed to number by pg type parser
  paused_at: number | null;
  remaining_ms: number | null;
  winner_revealed: boolean; // stored as BOOLEAN in Postgres
  updated_at: string;
}

export class QuizEngine {
  private questionsData!: QuizQuestionsFile;
  private timerTimeout: NodeJS.Timeout | null = null;
  private advanceDelayTimeout: NodeJS.Timeout | null = null;
  private onStateChangeCallback?: () => void;
  private onQuestionAdvanceCallback?: (nextIndex: number) => void;
  private onAnswerRevealCallback?: (questionIndex: number, correctOption: number) => void;
  private onStartingCallback?: () => void;

  constructor() {
    this.loadQuestions();
    // initSession() is now called externally from main.ts after await initDb()
  }

  public setCallbacks(callbacks: {
    onStateChange?: () => void;
    onQuestionAdvance?: (nextIndex: number) => void;
    onAnswerReveal?: (questionIndex: number, correctOption: number) => void;
    onStarting?: () => void;
  }) {
    this.onStateChangeCallback = callbacks.onStateChange;
    this.onQuestionAdvanceCallback = callbacks.onQuestionAdvance;
    this.onAnswerRevealCallback = callbacks.onAnswerReveal;
    this.onStartingCallback = callbacks.onStarting;
  }

  private loadQuestions() {
    const configPath = path.resolve(process.cwd(), "config/questions.json");
    if (!fs.existsSync(configPath)) {
      throw new Error(`[QuizEngine] Configuration file missing at ${configPath}`);
    }

    const raw = fs.readFileSync(configPath, "utf-8");
    const json = JSON.parse(raw);
    const parsed = QuizQuestionsFileSchema.safeParse(json);

    if (!parsed.success) {
      console.error("[QuizEngine] Zod validation failed for questions.json:", parsed.error.format());
      throw new Error(`[QuizEngine] Invalid questions.json: ${parsed.error.message}`);
    }

    this.questionsData = parsed.data;
    console.log(`[QuizEngine] Loaded ${this.questionsData.questions.length} questions successfully.`);
  }

  // -------------------------------------------------------------------------
  // Session bootstrap — called once from main.ts after initDb()
  // -------------------------------------------------------------------------
  public async initSession(): Promise<void> {
    const row = await queryOne<SessionRow>(
      "SELECT * FROM quiz_session WHERE id = 'default'"
    );

    if (!row) {
      // First-ever boot: seed the session row
      await execute(
        `INSERT INTO quiz_session
           (id, status, question_index, question_deadline, paused_at, remaining_ms, winner_revealed, updated_at)
         VALUES ('default', 'waiting', 0, NULL, NULL, NULL, FALSE, $1)`,
        [new Date().toISOString()]
      );
    } else {
      // Rehydrate in-memory timer if the server was restarted mid-quiz
      const now = Date.now();
      if (row.status === "running" && row.question_deadline) {
        const remaining = row.question_deadline - now;
        if (remaining > 0) {
          this.scheduleQuestionExpiry(row.question_index, remaining);
        } else {
          // Deadline already passed — advance immediately
          this.advanceQuestion().catch(console.error);
        }
      } else if (row.status === "starting") {
        // Server restarted during GET READY countdown — reset to waiting
        await execute(
          "UPDATE quiz_session SET status = 'waiting', updated_at = $1 WHERE id = 'default'",
          [new Date().toISOString()]
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Session / state reads
  // -------------------------------------------------------------------------
  public async getSessionRow(): Promise<SessionRow> {
    const row = await queryOne<SessionRow>(
      "SELECT * FROM quiz_session WHERE id = 'default'"
    );
    if (!row) throw new Error("[QuizEngine] Quiz session row not found in database.");
    return row;
  }

  public async getStatus(): Promise<QuizStatus> {
    return (await this.getSessionRow()).status;
  }

  public getQuestions() {
    return this.questionsData.questions;
  }

  public getTotalQuestions(): number {
    return this.questionsData.questions.length;
  }

  public async getCurrentQuestion(): Promise<PublicQuestion | null> {
    const session = await this.getSessionRow();
    if (session.status !== "running" && session.status !== "paused") {
      return null;
    }

    const q = this.questionsData.questions[session.question_index];
    if (!q) return null;

    return {
      index: session.question_index,
      total: this.getTotalQuestions(),
      text: q.text,
      options: q.options,
      timerSeconds: q.timerSeconds,
      deadline: session.question_deadline || Date.now(),
      points: q.points,
    };
  }

  // -------------------------------------------------------------------------
  // Admin controls
  // -------------------------------------------------------------------------
  public async start(): Promise<{ ok: boolean; error?: string }> {
    const session = await this.getSessionRow();
    if (
      session.status !== "waiting" &&
      session.status !== "completed" &&
      session.status !== "scored"
    ) {
      return { ok: false, error: `Cannot start quiz from status '${session.status}'` };
    }

    // Set to 'starting' for GET READY countdown
    await execute(
      `UPDATE quiz_session
       SET status = 'starting',
           question_index = 0,
           question_deadline = NULL,
           paused_at = NULL,
           remaining_ms = NULL,
           winner_revealed = FALSE,
           updated_at = $1
       WHERE id = 'default'`,
      [new Date().toISOString()]
    );

    this.notifyChange();

    // Fire the onStarting callback so socket layer can broadcast quiz:starting
    if (this.onStartingCallback) {
      this.onStartingCallback();
    }

    // After 5 seconds, begin first question
    this.timerTimeout = setTimeout(() => {
      this.beginFirstQuestion().catch(console.error);
    }, STARTING_COUNTDOWN_MS);

    return { ok: true };
  }

  private async beginFirstQuestion(): Promise<void> {
    const firstQ = this.questionsData.questions[0];
    const durationMs = firstQ.timerSeconds * 1000;
    const deadline = Date.now() + durationMs;

    await execute(
      `UPDATE quiz_session
       SET status = 'running',
           question_index = 0,
           question_deadline = $1,
           paused_at = NULL,
           remaining_ms = $2,
           updated_at = $3
       WHERE id = 'default'`,
      [deadline, durationMs, new Date().toISOString()]
    );

    this.scheduleQuestionExpiry(0, durationMs);
    this.notifyChange();

    if (this.onQuestionAdvanceCallback) {
      this.onQuestionAdvanceCallback(0);
    }
  }

  public async pause(): Promise<{ ok: boolean; error?: string }> {
    const session = await this.getSessionRow();
    if (session.status !== "running") {
      return { ok: false, error: `Cannot pause quiz when status is '${session.status}'` };
    }

    this.clearTimer();
    const now = Date.now();
    const remainingMs = Math.max(0, (session.question_deadline || now) - now);

    await execute(
      `UPDATE quiz_session
       SET status = 'paused',
           paused_at = $1,
           remaining_ms = $2,
           updated_at = $3
       WHERE id = 'default'`,
      [now, remainingMs, new Date().toISOString()]
    );

    this.notifyChange();
    return { ok: true };
  }

  public async resume(): Promise<{ ok: boolean; error?: string }> {
    const session = await this.getSessionRow();
    if (session.status !== "paused") {
      return { ok: false, error: `Cannot resume quiz when status is '${session.status}'` };
    }

    const remainingMs = session.remaining_ms || 10000;
    const newDeadline = Date.now() + remainingMs;

    await execute(
      `UPDATE quiz_session
       SET status = 'running',
           question_deadline = $1,
           paused_at = NULL,
           remaining_ms = $2,
           updated_at = $3
       WHERE id = 'default'`,
      [newDeadline, remainingMs, new Date().toISOString()]
    );

    this.scheduleQuestionExpiry(session.question_index, remainingMs);
    this.notifyChange();
    return { ok: true };
  }

  public async end(): Promise<{ ok: boolean; error?: string }> {
    const session = await this.getSessionRow();
    if (session.status === "completed" || session.status === "scored") {
      return { ok: true };
    }

    this.clearTimer();
    this.clearAdvanceDelay();

    await execute(
      `UPDATE quiz_session
       SET status = 'completed',
           question_deadline = NULL,
           paused_at = NULL,
           remaining_ms = NULL,
           updated_at = $1
       WHERE id = 'default'`,
      [new Date().toISOString()]
    );

    // Calculate final scores
    await this.computeFinalScores();

    await execute(
      "UPDATE quiz_session SET status = 'scored', updated_at = $1 WHERE id = 'default'",
      [new Date().toISOString()]
    );

    this.notifyChange();
    return { ok: true };
  }

  public async reset(): Promise<{ ok: boolean; error?: string }> {
    this.clearTimer();
    this.clearAdvanceDelay();

    await execute(
      `UPDATE quiz_session
       SET status = 'waiting',
           question_index = 0,
           question_deadline = NULL,
           paused_at = NULL,
           remaining_ms = NULL,
           winner_revealed = FALSE,
           updated_at = $1
       WHERE id = 'default'`,
      [new Date().toISOString()]
    );

    // Wipe submissions & scores; keep teams in roster
    await execute("DELETE FROM submission");
    await execute("DELETE FROM score_override");
    await execute("UPDATE team SET total_score = 0");

    this.notifyChange();
    return { ok: true };
  }

  public async hardReset(): Promise<{ ok: boolean; error?: string }> {
    this.clearTimer();
    this.clearAdvanceDelay();

    await execute(
      `UPDATE quiz_session
       SET status = 'waiting',
           question_index = 0,
           question_deadline = NULL,
           paused_at = NULL,
           remaining_ms = NULL,
           winner_revealed = FALSE,
           updated_at = $1
       WHERE id = 'default'`,
      [new Date().toISOString()]
    );

    // Full wipe: teams, submissions, and overrides
    await execute("DELETE FROM submission");
    await execute("DELETE FROM score_override");
    await execute("DELETE FROM team");

    this.notifyChange();
    return { ok: true };
  }

  public async advanceQuestion(): Promise<void> {
    this.clearTimer();
    const session = await this.getSessionRow();
    const currentIndex = session.question_index;
    const nextIndex = currentIndex + 1;

    // Fire answer reveal for the question that just ended
    const currentQ = this.questionsData.questions[currentIndex];
    if (currentQ && this.onAnswerRevealCallback) {
      this.onAnswerRevealCallback(currentIndex, currentQ.correct);
    }

    // Delay actual advance so clients can display the reveal animation.
    // Store in advanceDelayTimeout so it can be cancelled if quiz is ended/reset.
    this.advanceDelayTimeout = setTimeout(async () => {
      this.advanceDelayTimeout = null;
      try {
        if (nextIndex >= this.getTotalQuestions()) {
          await this.end();
          return;
        }

        const nextQ = this.questionsData.questions[nextIndex];
        const durationMs = nextQ.timerSeconds * 1000;
        const deadline = Date.now() + durationMs;

        await execute(
          `UPDATE quiz_session
           SET question_index = $1,
               question_deadline = $2,
               paused_at = NULL,
               remaining_ms = $3,
               updated_at = $4
           WHERE id = 'default'`,
          [nextIndex, deadline, durationMs, new Date().toISOString()]
        );

        this.scheduleQuestionExpiry(nextIndex, durationMs);
        this.notifyChange();

        if (this.onQuestionAdvanceCallback) {
          this.onQuestionAdvanceCallback(nextIndex);
        }
      } catch (err) {
        console.error("[QuizEngine] Error advancing question:", err);
      }
    }, ANSWER_REVEAL_DELAY_MS);
  }

  /**
   * Manual admin advance — skips the reveal delay so question changes immediately.
   * Used when the admin presses "Next Question" button.
   */
  public async manualAdvanceQuestion(): Promise<void> {
    this.clearTimer();
    this.clearAdvanceDelay();
    const session = await this.getSessionRow();
    const nextIndex = session.question_index + 1;

    if (nextIndex >= this.getTotalQuestions()) {
      await this.end();
      return;
    }

    const nextQ = this.questionsData.questions[nextIndex];
    const durationMs = nextQ.timerSeconds * 1000;
    const deadline = Date.now() + durationMs;

    await execute(
      `UPDATE quiz_session
       SET question_index = $1,
           question_deadline = $2,
           paused_at = NULL,
           remaining_ms = $3,
           updated_at = $4
       WHERE id = 'default'`,
      [nextIndex, deadline, durationMs, new Date().toISOString()]
    );

    this.scheduleQuestionExpiry(nextIndex, durationMs);
    this.notifyChange();

    if (this.onQuestionAdvanceCallback) {
      this.onQuestionAdvanceCallback(nextIndex);
    }
  }

  /**
   * Go back to the previous question. Resets the timer for that question.
   * Admin-only action.
   */
  public async prevQuestion(): Promise<void> {
    this.clearTimer();
    this.clearAdvanceDelay();
    const session = await this.getSessionRow();
    const prevIndex = session.question_index - 1;

    if (prevIndex < 0) return; // already at first question

    const prevQ = this.questionsData.questions[prevIndex];
    const durationMs = prevQ.timerSeconds * 1000;
    const deadline = Date.now() + durationMs;

    await execute(
      `UPDATE quiz_session
       SET question_index = $1,
           question_deadline = $2,
           status = 'running',
           paused_at = NULL,
           remaining_ms = $3,
           updated_at = $4
       WHERE id = 'default'`,
      [prevIndex, deadline, durationMs, new Date().toISOString()]
    );

    this.scheduleQuestionExpiry(prevIndex, durationMs);
    this.notifyChange();

    if (this.onQuestionAdvanceCallback) {
      this.onQuestionAdvanceCallback(prevIndex);
    }
  }

  private scheduleQuestionExpiry(questionIndex: number, durationMs: number) {
    this.clearTimer();
    this.timerTimeout = setTimeout(() => {
      this.advanceQuestion().catch(console.error);
    }, durationMs);
  }

  private clearTimer() {
    if (this.timerTimeout) {
      clearTimeout(this.timerTimeout);
      this.timerTimeout = null;
    }
  }

  private clearAdvanceDelay() {
    if (this.advanceDelayTimeout) {
      clearTimeout(this.advanceDelayTimeout);
      this.advanceDelayTimeout = null;
    }
  }

  // -------------------------------------------------------------------------
  // Answer submission
  // -------------------------------------------------------------------------
  public async submitAnswer(
    teamId: string,
    questionIndex: number,
    selectedOption: number
  ): Promise<{ ok: boolean; isWrong?: boolean; error?: string }> {
    const session = await this.getSessionRow();
    if (session.status !== "running") {
      return { ok: false, error: "Quiz is not currently running" };
    }

    if (session.question_index !== questionIndex) {
      return { ok: false, error: "Question is no longer active" };
    }

    const q = this.questionsData.questions[questionIndex];
    if (!q) {
      return { ok: false, error: "Question not found" };
    }

    // Check if team already submitted (idempotent)
    const existing = await queryOne<{ is_correct: boolean }>(
      "SELECT is_correct FROM submission WHERE team_id = $1 AND question_index = $2",
      [teamId, questionIndex]
    );

    if (existing) {
      return { ok: true, isWrong: !existing.is_correct };
    }

    const now = Date.now();
    const durationMs = q.timerSeconds * 1000;
    const deadline = session.question_deadline || now;
    const elapsedMs = Math.max(0, durationMs - (deadline - now));
    const isCorrect = selectedOption === q.correct;

    const pointsAwarded = calculateQuestionScore({
      correct: isCorrect,
      elapsedMs,
      timerMs: durationMs,
      points: q.points,
      timeWindow: q.scoring.timeWindow,
      fullPointsWindow: q.scoring.fullPointsWindow,
    });

    const subId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await execute(
      `INSERT INTO submission (id, team_id, question_index, selected_option, is_correct, points_awarded, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [subId, teamId, questionIndex, selectedOption, isCorrect, pointsAwarded, new Date().toISOString()]
    );

    // Update team score live using a single correlated subquery
    await execute(
      `UPDATE team
       SET total_score = (
         SELECT COALESCE(SUM(points_awarded), 0) FROM submission WHERE team_id = $1
       ) + (
         SELECT COALESCE(SUM(delta), 0) FROM score_override WHERE team_id = $1
       )
       WHERE id = $1`,
      [teamId]
    );

    this.notifyChange();
    return { ok: true, isWrong: !isCorrect };
  }

  public async computeFinalScores(): Promise<void> {
    // Single UPDATE using correlated subqueries — no N+1 loop needed
    await execute(`
      UPDATE team
      SET total_score = (
        SELECT COALESCE(SUM(points_awarded), 0) FROM submission WHERE team_id = team.id
      ) + (
        SELECT COALESCE(SUM(delta), 0) FROM score_override WHERE team_id = team.id
      )
    `);
  }

  public async overrideScore(
    teamId: string,
    delta: number,
    note?: string
  ): Promise<{ ok: boolean; error?: string }> {
    const team = await queryOne<{ id: string }>(
      "SELECT id FROM team WHERE id = $1",
      [teamId]
    );
    if (!team) {
      return { ok: false, error: "Team not found" };
    }

    const overrideId = `ov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await execute(
      "INSERT INTO score_override (id, team_id, delta, note, applied_at) VALUES ($1, $2, $3, $4, $5)",
      [overrideId, teamId, delta, note || null, new Date().toISOString()]
    );

    // Update team score incrementally
    await execute(
      "UPDATE team SET total_score = total_score + $1 WHERE id = $2",
      [delta, teamId]
    );

    this.notifyChange();
    return { ok: true };
  }

  public async setWinnerRevealed(revealed: boolean): Promise<void> {
    await execute(
      "UPDATE quiz_session SET winner_revealed = $1, updated_at = $2 WHERE id = 'default'",
      [revealed, new Date().toISOString()]
    );
    this.notifyChange();
  }

  // -------------------------------------------------------------------------
  // State projections
  // -------------------------------------------------------------------------
  public async getSubmissionCountForQuestion(questionIndex: number): Promise<number> {
    const row = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::int as count FROM submission WHERE question_index = $1",
      [questionIndex]
    );
    return row ? Number(row.count) : 0;
  }

  public async getTeamQuizState(teamId: string): Promise<TeamQuizState> {
    const session = await this.getSessionRow();
    const now = Date.now();
    const currentQ = await this.getCurrentQuestion();

    let lockedOption: number | null = null;
    let isLocked = false;
    let isWrongLock = false;

    if (currentQ) {
      const sub = await queryOne<{ selected_option: number; is_correct: boolean }>(
        "SELECT selected_option, is_correct FROM submission WHERE team_id = $1 AND question_index = $2",
        [teamId, currentQ.index]
      );

      if (sub) {
        lockedOption = sub.selected_option;
        isLocked = true;
        isWrongLock = !sub.is_correct;
      }
    }

    const remainingMs =
      session.status === "running" && session.question_deadline
        ? Math.max(0, session.question_deadline - now)
        : session.remaining_ms || 0;

    const team = await queryOne<{ total_score: number }>(
      "SELECT total_score FROM team WHERE id = $1",
      [teamId]
    );

    return {
      status: session.status,
      currentQuestion: currentQ,
      lockedOption,
      isLocked,
      isWrongLock,
      remainingMs,
      serverNow: now,
      isInterstitial: false,
      totalScore: team?.total_score || 0,
    };
  }

  public async getAdminQuizState(
    onlineSocketIds: Set<string>,
    teamSocketMap: Map<string, Set<string>>
  ): Promise<AdminQuizState> {
    const session = await this.getSessionRow();
    const now = Date.now();
    const currentQ = await this.getCurrentQuestion();

    const totalTeamsRow = await queryOne<{ count: string }>(
      "SELECT COUNT(*)::int as count FROM team"
    );
    const totalTeams = totalTeamsRow ? Number(totalTeamsRow.count) : 0;

    const submissionCount = currentQ
      ? await this.getSubmissionCountForQuestion(currentQ.index)
      : 0;

    const teams = await query<{
      id: string;
      name: string;
      name_lower: string;
      code: string;
      total_score: number;
    }>("SELECT * FROM team ORDER BY name_lower ASC");

    const roster: TeamRosterItem[] = teams.map((t) => {
      const activeSocks = teamSocketMap.get(t.id);
      const isOnline =
        !!activeSocks &&
        activeSocks.size > 0 &&
        [...activeSocks].some((sid) => onlineSocketIds.has(sid));
      return {
        id: t.id,
        name: t.name,
        code: t.code,
        score: t.total_score,
        online: isOnline,
        activeSocketId: activeSocks ? [...activeSocks][0] || null : null,
      };
    });

    const leaderboard = await this.getLeaderboard();

    const remainingMs =
      session.status === "running" && session.question_deadline
        ? Math.max(0, session.question_deadline - now)
        : session.remaining_ms || 0;

    return {
      status: session.status,
      currentQuestionIndex: session.question_index,
      totalQuestions: this.getTotalQuestions(),
      currentQuestion: currentQ,
      remainingMs,
      serverNow: now,
      isInterstitial: false,
      submissionCount,
      totalTeams,
      teams: roster,
      leaderboard,
      winnerRevealed: !!session.winner_revealed,
    };
  }

  public async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const teams = await query<{
      id: string;
      name: string;
      code: string;
      total_score: number;
    }>(
      "SELECT id, name, code, total_score FROM team ORDER BY total_score DESC, name_lower ASC"
    );

    return teams.map((t, idx) => ({
      rank: idx + 1,
      teamId: t.id,
      name: t.name,
      code: t.code,
      score: t.total_score,
    }));
  }

  private notifyChange() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback();
    }
  }
}
