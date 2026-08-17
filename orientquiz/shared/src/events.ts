import {
  AdminAuthInput,
  AdminScoreOverrideInput,
  SubmitAnswerInput,
  TeamCreateInput,
  TeamJoinInput,
} from "./schema.js";
import {
  AdminQuizState,
  LeaderboardEntry,
  PublicQuestion,
  QuizStatus,
  TeamQuizState,
  TeamRosterItem,
  TeamSession,
} from "./types.js";

export const SOCKET_ROOMS = {
  ADMIN: "room:admin",
  BROADCAST: "room:broadcast",
  PROJECTOR: "room:projector",
  team: (teamId: string) => `team:${teamId}`,
};

export type ProjectorMode = "blank" | "leaderboard" | "winners";

export interface ProjectorDisplayPayload {
  mode: ProjectorMode;
  leaderboard?: LeaderboardEntry[];
  winners?: LeaderboardEntry[]; // top 3
}

export interface ServerToClientEvents {
  // Team Private & Broadcast Events
  "quiz:state": (state: TeamQuizState) => void;
  "quiz:question": (question: PublicQuestion) => void;
  "quiz:locked": (payload: { questionIndex: number; optionIndex: number; isWrong: boolean }) => void;
  "quiz:interstitial": (payload: { nextIndex: number; durationMs: number }) => void;
  "quiz:status": (payload: { status: QuizStatus; serverNow: number; deadline?: number }) => void;
  "quiz:completed": (payload: { message: string }) => void;
  "quiz:starting": (payload: { startsInMs: number; serverNow: number }) => void;
  "quiz:answer_reveal": (payload: { questionIndex: number; correctOption: number }) => void;
  "team:session": (session: TeamSession) => void;
  "session:inactive": (payload: { reason: string }) => void;
  "timer:sync": (payload: { serverNow: number; deadline: number; remainingMs: number }) => void;

  // Projector Events (emitted to projector room)
  "projector:display": (payload: ProjectorDisplayPayload) => void;

  // Admin Events (ONLY emitted to admin room)
  "admin:state": (state: AdminQuizState) => void;
  "admin:roster": (roster: TeamRosterItem[]) => void;
  "admin:submission_count": (payload: { questionIndex: number; count: number; totalTeams: number }) => void;
  "admin:leaderboard": (leaderboard: LeaderboardEntry[]) => void;
  "admin:winner_reveal": (payload: { revealed: boolean; winners: LeaderboardEntry[] }) => void;
  "admin:error": (payload: { message: string }) => void;

  // Generic errors
  error: (payload: { message: string; code?: string }) => void;
}

export interface ClientToServerEvents {
  // Team Actions
  "team:create": (data: TeamCreateInput, callback: (res: { ok: boolean; session?: TeamSession; error?: string }) => void) => void;
  "team:join": (data: TeamJoinInput, callback: (res: { ok: boolean; session?: TeamSession; error?: string }) => void) => void;
  "team:submit": (data: SubmitAnswerInput, callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "team:sync": () => void;

  // Projector Actions
  "projector:subscribe": (callback?: (res: { ok: boolean; current?: ProjectorDisplayPayload }) => void) => void;

  // Admin Actions
  "admin:auth": (data: AdminAuthInput, callback: (res: { ok: boolean; error?: string; token?: string }) => void) => void;
  "admin:auth_token": (data: { token: string }, callback: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:start": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:pause": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:resume": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:end": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:next_question": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:prev_question": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:remove_team": (data: { teamId: string }, callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:override_score": (data: AdminScoreOverrideInput, callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:reveal_winners": (data: { reveal: boolean }, callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:reset_quiz": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:reset_quiz_full": (callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:lock": (data: { token: string }, callback?: (res: { ok: boolean; error?: string }) => void) => void;
  "admin:projector_display": (data: { mode: ProjectorMode }, callback?: (res: { ok: boolean; error?: string }) => void) => void;
}
