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
import { db } from "../db/index.js";
import { calculateQuestionScore } from "./scoring.js";

// Delay between question timer expiring and the next question appearing.
// During this window the client shows the answer reveal animation.
const ANSWER_REVEAL_DELAY_MS = 2000;

// Duration of the GET READY countdown before first question.
const STARTING_COUNTDOWN_MS = 5000;

export class QuizEngine {
  private questionsData!: QuizQuestionsFile;
  private timerTimeout: NodeJS.Timeout | null = null;
  private advanceDelayTimeout: NodeJS.Timeout | null = null; // cancellable reveal delay
  private onStateChangeCallback?: () => void;
  private onQuestionAdvanceCallback?: (nextIndex: number) => void;
  private onAnswerRevealCallback?: (questionIndex: number, correctOption: number) => void;
  private onStartingCallback?: () => void;

  constructor() {
    this.loadQuestions();
    this.initSession();
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

  private initSession() {
    const row = db.prepare("SELECT * FROM quiz_session WHERE id = 'default'").get() as any;

    if (!row) {
      db.prepare(`
        INSERT INTO quiz_session (id, status, question_index, question_deadline, paused_at, remaining_ms, winner_revealed, updated_at)
        VALUES ('default', 'waiting', 0, NULL, NULL, NULL, 0, ?)
      `).run(new Date().toISOString());
    } else {
      // Rehydrate in-memory timer if running
      const now = Date.now();
      if (row.status === "running" && row.question_deadline) {
        const remaining = row.question_deadline - now;
        if (remaining > 0) {
          this.scheduleQuestionExpiry(row.question_index, remaining);
        } else {
          this.advanceQuestion();
        }
      } else if (row.status === "starting") {
        // Server restarted during countdown — just reset to waiting
        db.prepare(`
          UPDATE quiz_session SET status = 'waiting', updated_at = ? WHERE id = 'default'
        `).run(new Date().toISOString());
      }
    }
  }

  public getSessionRow() {
    return db.prepare("SELECT * FROM quiz_session WHERE id = 'default'").get() as {
      id: string;
      status: QuizStatus;
      question_index: number;
      question_deadline: number | null;
      paused_at: number | null;
      remaining_ms: number | null;
      winner_revealed: number;
      updated_at: string;
    };
  }

  public getStatus(): QuizStatus {
    return this.getSessionRow().status;
  }

  public getQuestions() {
    return this.questionsData.questions;
  }

  public getTotalQuestions(): number {
    return this.questionsData.questions.length;
  }

  public getCurrentQuestion(): PublicQuestion | null {
    const session = this.getSessionRow();
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

  public start(): { ok: boolean; error?: string } {
    const session = this.getSessionRow();
    if (
      session.status !== "waiting" &&
      session.status !== "completed" &&
      session.status !== "scored"
    ) {
      return { ok: false, error: `Cannot start quiz from status '${session.status}'` };
    }

    // Set to 'starting' for GET READY countdown
    db.prepare(`
      UPDATE quiz_session
      SET status = 'starting',
          question_index = 0,
          question_deadline = NULL,
          paused_at = NULL,
          remaining_ms = NULL,
          winner_revealed = 0,
          updated_at = ?
      WHERE id = 'default'
    `).run(new Date().toISOString());

    this.notifyChange();

    // Fire the onStarting callback so socket layer can broadcast quiz:starting
    if (this.onStartingCallback) {
      this.onStartingCallback();
    }

    // After 5 seconds, begin first question
    this.timerTimeout = setTimeout(() => {
      this.beginFirstQuestion();
    }, STARTING_COUNTDOWN_MS);

    return { ok: true };
  }

  private beginFirstQuestion() {
    const firstQ = this.questionsData.questions[0];
    const durationMs = firstQ.timerSeconds * 1000;
    const deadline = Date.now() + durationMs;

    db.prepare(`
      UPDATE quiz_session
      SET status = 'running',
          question_index = 0,
          question_deadline = ?,
          paused_at = NULL,
          remaining_ms = ?,
          updated_at = ?
      WHERE id = 'default'
    `).run(deadline, durationMs, new Date().toISOString());

    this.scheduleQuestionExpiry(0, durationMs);
    this.notifyChange();

    if (this.onQuestionAdvanceCallback) {
      this.onQuestionAdvanceCallback(0);
    }
  }

  public pause(): { ok: boolean; error?: string } {
    const session = this.getSessionRow();
    if (session.status !== "running") {
      return { ok: false, error: `Cannot pause quiz when status is '${session.status}'` };
    }

    this.clearTimer();
    const now = Date.now();
    const remainingMs = Math.max(0, (session.question_deadline || now) - now);

    db.prepare(`
      UPDATE quiz_session
      SET status = 'paused',
          paused_at = ?,
          remaining_ms = ?,
          updated_at = ?
      WHERE id = 'default'
    `).run(now, remainingMs, new Date().toISOString());

    this.notifyChange();
    return { ok: true };
  }

  public resume(): { ok: boolean; error?: string } {
    const session = this.getSessionRow();
    if (session.status !== "paused") {
      return { ok: false, error: `Cannot resume quiz when status is '${session.status}'` };
    }

    const remainingMs = session.remaining_ms || 10000;
    const newDeadline = Date.now() + remainingMs;

    db.prepare(`
      UPDATE quiz_session
      SET status = 'running',
          question_deadline = ?,
          paused_at = NULL,
          remaining_ms = ?,
          updated_at = ?
      WHERE id = 'default'
    `).run(newDeadline, remainingMs, new Date().toISOString());

    this.scheduleQuestionExpiry(session.question_index, remainingMs);
    this.notifyChange();
    return { ok: true };
  }

  public end(): { ok: boolean; error?: string } {
    const session = this.getSessionRow();
    if (session.status === "completed" || session.status === "scored") {
      return { ok: true };
    }

    this.clearTimer();
    this.clearAdvanceDelay(); // cancel any pending question advance

    db.prepare(`
      UPDATE quiz_session
      SET status = 'completed',
          question_deadline = NULL,
          paused_at = NULL,
          remaining_ms = NULL,
          updated_at = ?
      WHERE id = 'default'
    `).run(new Date().toISOString());

    // Calculate final scores
    this.computeFinalScores();

    db.prepare(`
      UPDATE quiz_session
      SET status = 'scored',
          updated_at = ?
      WHERE id = 'default'
    `).run(new Date().toISOString());

    this.notifyChange();
    return { ok: true };
  }

  public reset(): { ok: boolean; error?: string } {
    this.clearTimer();
    this.clearAdvanceDelay(); // cancel any pending question advance
    db.prepare(`
      UPDATE quiz_session
      SET status = 'waiting',
          question_index = 0,
          question_deadline = NULL,
          paused_at = NULL,
          remaining_ms = NULL,
          winner_revealed = 0,
          updated_at = ?
      WHERE id = 'default'
    `).run(new Date().toISOString());

    // Wipe submissions & scores; keep teams in roster
    db.prepare("DELETE FROM submission").run();
    db.prepare("DELETE FROM score_override").run();
    db.prepare("UPDATE team SET total_score = 0").run();

    this.notifyChange();
    return { ok: true };
  }

  public hardReset(): { ok: boolean; error?: string } {
    this.clearTimer();
    this.clearAdvanceDelay(); // cancel any pending question advance
    db.prepare(`
      UPDATE quiz_session
      SET status = 'waiting',
          question_index = 0,
          question_deadline = NULL,
          paused_at = NULL,
          remaining_ms = NULL,
          winner_revealed = 0,
          updated_at = ?
      WHERE id = 'default'
    `).run(new Date().toISOString());

    // Full wipe: teams, submissions, and overrides
    db.prepare("DELETE FROM submission").run();
    db.prepare("DELETE FROM score_override").run();
    db.prepare("DELETE FROM team").run();

    this.notifyChange();
    return { ok: true };
  }

  public advanceQuestion() {
    this.clearTimer();
    const session = this.getSessionRow();
    const currentIndex = session.question_index;
    const nextIndex = currentIndex + 1;

    // Fire answer reveal for the question that just ended
    const currentQ = this.questionsData.questions[currentIndex];
    if (currentQ && this.onAnswerRevealCallback) {
      this.onAnswerRevealCallback(currentIndex, currentQ.correct);
    }

    // Delay actual advance so clients can display the reveal animation
    // Store in advanceDelayTimeout so it can be cancelled if quiz is ended/reset
    this.advanceDelayTimeout = setTimeout(() => {
      this.advanceDelayTimeout = null;
      if (nextIndex >= this.getTotalQuestions()) {
        this.end();
        return;
      }

      const nextQ = this.questionsData.questions[nextIndex];
      const durationMs = nextQ.timerSeconds * 1000;
      const deadline = Date.now() + durationMs;

      db.prepare(`
        UPDATE quiz_session
        SET question_index = ?,
            question_deadline = ?,
            paused_at = NULL,
            remaining_ms = ?,
            updated_at = ?
        WHERE id = 'default'
      `).run(nextIndex, deadline, durationMs, new Date().toISOString());

      this.scheduleQuestionExpiry(nextIndex, durationMs);
      this.notifyChange();

      if (this.onQuestionAdvanceCallback) {
        this.onQuestionAdvanceCallback(nextIndex);
      }
    }, ANSWER_REVEAL_DELAY_MS);
  }

  /**
   * Manual admin advance — skips the reveal delay so question changes immediately.
   * Used when the admin presses "Next Question" button.
   */
  public manualAdvanceQuestion() {
    this.clearTimer();
    this.clearAdvanceDelay();
    const session = this.getSessionRow();
    const nextIndex = session.question_index + 1;

    if (nextIndex >= this.getTotalQuestions()) {
      this.end();
      return;
    }

    const nextQ = this.questionsData.questions[nextIndex];
    const durationMs = nextQ.timerSeconds * 1000;
    const deadline = Date.now() + durationMs;

    db.prepare(`
      UPDATE quiz_session
      SET question_index = ?,
          question_deadline = ?,
          paused_at = NULL,
          remaining_ms = ?,
          updated_at = ?
      WHERE id = 'default'
    `).run(nextIndex, deadline, durationMs, new Date().toISOString());

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
  public prevQuestion() {
    this.clearTimer();
    this.clearAdvanceDelay();
    const session = this.getSessionRow();
    const prevIndex = session.question_index - 1;

    if (prevIndex < 0) return; // already at first question

    const prevQ = this.questionsData.questions[prevIndex];
    const durationMs = prevQ.timerSeconds * 1000;
    const deadline = Date.now() + durationMs;

    db.prepare(`
      UPDATE quiz_session
      SET question_index = ?,
          question_deadline = ?,
          status = 'running',
          paused_at = NULL,
          remaining_ms = ?,
          updated_at = ?
      WHERE id = 'default'
    `).run(prevIndex, deadline, durationMs, new Date().toISOString());

    this.scheduleQuestionExpiry(prevIndex, durationMs);
    this.notifyChange();

    if (this.onQuestionAdvanceCallback) {
      this.onQuestionAdvanceCallback(prevIndex);
    }
  }

  private scheduleQuestionExpiry(questionIndex: number, durationMs: number) {
    this.clearTimer();
    this.timerTimeout = setTimeout(() => {
      this.advanceQuestion();
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

  public submitAnswer(
    teamId: string,
    questionIndex: number,
    selectedOption: number
  ): { ok: boolean; isWrong?: boolean; error?: string } {
    const session = this.getSessionRow();
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

    // Check if team already submitted
    const existing = db
      .prepare("SELECT * FROM submission WHERE team_id = ? AND question_index = ?")
      .get(teamId, questionIndex) as any;

    if (existing) {
      // Idempotent: return existing lock state
      return {
        ok: true,
        isWrong: existing.is_correct === 0,
      };
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
    db.prepare(`
      INSERT INTO submission (id, team_id, question_index, selected_option, is_correct, points_awarded, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      subId,
      teamId,
      questionIndex,
      selectedOption,
      isCorrect ? 1 : 0,
      pointsAwarded,
      new Date().toISOString()
    );

    // Update team score live
    db.prepare(`
      UPDATE team
      SET total_score = (
        SELECT COALESCE(SUM(points_awarded), 0) FROM submission WHERE team_id = ?
      ) + (
        SELECT COALESCE(SUM(delta), 0) FROM score_override WHERE team_id = ?
      )
      WHERE id = ?
    `).run(teamId, teamId, teamId);

    this.notifyChange();
    return { ok: true, isWrong: !isCorrect };
  }

  public computeFinalScores() {
    const teams = db.prepare("SELECT id FROM team").all() as { id: string }[];
    for (const t of teams) {
      db.prepare(`
        UPDATE team
        SET total_score = (
          SELECT COALESCE(SUM(points_awarded), 0) FROM submission WHERE team_id = ?
        ) + (
          SELECT COALESCE(SUM(delta), 0) FROM score_override WHERE team_id = ?
        )
        WHERE id = ?
      `).run(t.id, t.id, t.id);
    }
  }

  public overrideScore(teamId: string, delta: number, note?: string): { ok: boolean; error?: string } {
    const team = db.prepare("SELECT * FROM team WHERE id = ?").get(teamId) as any;
    if (!team) {
      return { ok: false, error: "Team not found" };
    }

    const overrideId = `ov_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.prepare(`
      INSERT INTO score_override (id, team_id, delta, note, applied_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(overrideId, teamId, delta, note || null, new Date().toISOString());

    // Update team score
    db.prepare(`
      UPDATE team
      SET total_score = total_score + ?
      WHERE id = ?
    `).run(delta, teamId);

    this.notifyChange();
    return { ok: true };
  }

  public setWinnerRevealed(revealed: boolean) {
    db.prepare(`
      UPDATE quiz_session
      SET winner_revealed = ?,
          updated_at = ?
      WHERE id = 'default'
    `).run(revealed ? 1 : 0, new Date().toISOString());

    this.notifyChange();
  }

  public getSubmissionCountForQuestion(questionIndex: number): number {
    const row = db
      .prepare("SELECT COUNT(*) as count FROM submission WHERE question_index = ?")
      .get(questionIndex) as { count: number };
    return row?.count || 0;
  }

  public getTeamQuizState(teamId: string): TeamQuizState {
    const session = this.getSessionRow();
    const now = Date.now();
    const currentQ = this.getCurrentQuestion();

    let lockedOption: number | null = null;
    let isLocked = false;
    let isWrongLock = false;

    if (currentQ) {
      const sub = db
        .prepare("SELECT * FROM submission WHERE team_id = ? AND question_index = ?")
        .get(teamId, currentQ.index) as any;

      if (sub) {
        lockedOption = sub.selected_option;
        isLocked = true;
        isWrongLock = sub.is_correct === 0;
      }
    }

    const remainingMs =
      session.status === "running" && session.question_deadline
        ? Math.max(0, session.question_deadline - now)
        : session.remaining_ms || 0;

    const team = db.prepare("SELECT total_score FROM team WHERE id = ?").get(teamId) as any;

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

  public getAdminQuizState(onlineSocketIds: Set<string>, teamSocketMap: Map<string, Set<string>>): AdminQuizState {
    const session = this.getSessionRow();
    const now = Date.now();
    const currentQ = this.getCurrentQuestion();
    const totalTeamsRow = db.prepare("SELECT COUNT(*) as count FROM team").get() as { count: number };
    const totalTeams = totalTeamsRow?.count || 0;

    const submissionCount = currentQ
      ? this.getSubmissionCountForQuestion(currentQ.index)
      : 0;

    const teams = db.prepare("SELECT * FROM team ORDER BY name_lower ASC").all() as any[];
    const roster: TeamRosterItem[] = teams.map((t) => {
      const activeSocks = teamSocketMap.get(t.id);
      const isOnline = !!activeSocks && activeSocks.size > 0 && [...activeSocks].some((sid) => onlineSocketIds.has(sid));
      return {
        id: t.id,
        name: t.name,
        code: t.code,
        score: t.total_score,
        online: isOnline,
        activeSocketId: activeSocks ? [...activeSocks][0] || null : null,
      };
    });

    const leaderboard = this.getLeaderboard();

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
      winnerRevealed: session.winner_revealed === 1,
    };
  }

  public getLeaderboard(): LeaderboardEntry[] {
    const teams = db
      .prepare("SELECT id, name, code, total_score FROM team ORDER BY total_score DESC, name_lower ASC")
      .all() as any[];

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
