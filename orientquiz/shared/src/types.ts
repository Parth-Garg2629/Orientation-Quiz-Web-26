export type QuizStatus = "waiting" | "running" | "paused" | "completed" | "scored";

export interface PublicQuestion {
  index: number;
  total: number;
  text: string;
  options: string[];
  timerSeconds: number;
  deadline: number; // Server timestamp in ms
  points: number;
}

export interface TeamSession {
  id: string;
  name: string;
  code: string;
  score: number;
}

export interface TeamRosterItem {
  id: string;
  name: string;
  code: string;
  score: number;
  online: boolean;
  activeSocketId?: string | null;
  lastSubmission?: {
    questionIndex: number;
    optionIndex: number;
    submittedAt: string;
  } | null;
}

export interface LeaderboardEntry {
  rank: number;
  teamId: string;
  name: string;
  code: string;
  score: number;
}

export interface TeamQuizState {
  status: QuizStatus;
  currentQuestion: PublicQuestion | null;
  lockedOption: number | null; // Option index chosen by this team for current question
  isLocked: boolean;
  isWrongLock?: boolean; // For danger state on wrong lock
  remainingMs: number;
  serverNow: number;
  isInterstitial: boolean;
  totalScore?: number;
}

export interface AdminQuizState {
  status: QuizStatus;
  currentQuestionIndex: number;
  totalQuestions: number;
  currentQuestion: PublicQuestion | null;
  remainingMs: number;
  serverNow: number;
  isInterstitial: boolean;
  submissionCount: number;
  totalTeams: number;
  teams: TeamRosterItem[];
  leaderboard: LeaderboardEntry[];
  winnerRevealed: boolean;
}
