import React, { useState, useEffect, useRef } from "react";
import { socket } from "../socket.js";
import { AdminQuizState, LeaderboardEntry, TeamRosterItem } from "@orientquiz/shared";
import {
  Lock,
  Play,
  Pause,
  Square,
  SkipForward,
  Trophy,
  Monitor,
  AlertCircle,
  Award,
  Crown,
  Sparkles,
  RefreshCw,
  Loader2,
  List,
  EyeOff,
} from "lucide-react";
import confetti from "canvas-confetti";

export const Admin: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [adminState, setAdminState] = useState<AdminQuizState | null>(null);
  const [overrideModal, setOverrideModal] = useState<{ teamId: string; teamName: string; currentScore: number } | null>(null);
  const [overrideDelta, setOverrideDelta] = useState<number>(0);
  const [overrideNote, setOverrideNote] = useState<string>("");
  const [fullWipeConfirm, setFullWipeConfirm] = useState(false);

  // Projector control state (local — tracks what we last pushed to projector)
  const [projectorMode, setProjectorMode] = useState<"blank" | "leaderboard" | "winners">("blank");
  const [projectorPushing, setProjectorPushing] = useState(false);

  const confettiTriggered = useRef(false);

  useEffect(() => {
    const onAdminState = (state: AdminQuizState) => {
      setAdminState(state);
      setIsAuthenticated(true);

      if (state.winnerRevealed && !confettiTriggered.current) {
        confettiTriggered.current = true;
        triggerWinnerConfetti();
      } else if (!state.winnerRevealed) {
        confettiTriggered.current = false;
      }
    };

    const onRoster = (roster: TeamRosterItem[]) => {
      setAdminState((prev) => (prev ? { ...prev, teams: roster, totalTeams: roster.length } : null));
    };

    const onLeaderboard = (leaderboard: LeaderboardEntry[]) => {
      setAdminState((prev) => (prev ? { ...prev, leaderboard } : null));
    };

    const onWinnerReveal = (payload: { revealed: boolean; winners: LeaderboardEntry[] }) => {
      setAdminState((prev) => (prev ? { ...prev, winnerRevealed: payload.revealed } : null));
      if (payload.revealed) {
        triggerWinnerConfetti();
      }
    };

    const onAdminError = (payload: { message: string }) => {
      setError(payload.message);
    };

    socket.on("admin:state", onAdminState);
    socket.on("admin:roster", onRoster);
    socket.on("admin:leaderboard", onLeaderboard);
    socket.on("admin:winner_reveal", onWinnerReveal);
    socket.on("admin:error", onAdminError);

    const savedAdminToken = sessionStorage.getItem("orientquiz_admin_token");
    if (savedAdminToken) {
      socket.emit("admin:auth_token", { token: savedAdminToken }, (res) => {
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          sessionStorage.removeItem("orientquiz_admin_token");
          setIsAuthenticated(false);
        }
      });
    }

    return () => {
      socket.off("admin:state", onAdminState);
      socket.off("admin:roster", onRoster);
      socket.off("admin:leaderboard", onLeaderboard);
      socket.off("admin:winner_reveal", onWinnerReveal);
      socket.off("admin:error", onAdminError);
    };
  }, []);

  const triggerWinnerConfetti = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#4F46E5", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"],
    });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;
    setError(null);
    setLoading(true);

    if (!socket.connected) {
      socket.connect();
    }

    let responded = false;
    const timeout = setTimeout(() => {
      if (!responded) {
        setLoading(false);
        setError("Connection timeout — server did not respond. Please try again.");
      }
    }, 5000);

    socket.emit("admin:auth", { passcode: passcode.trim() }, (res) => {
      responded = true;
      clearTimeout(timeout);
      setLoading(false);
      if (res.ok) {
        setIsAuthenticated(true);
        if (res.token) {
          sessionStorage.setItem("orientquiz_admin_token", res.token);
        }
      } else {
        setError(res.error || "Incorrect passcode — please try again.");
      }
    });
  };

  const handleStart = () => socket.emit("admin:start");
  const handlePause = () => socket.emit("admin:pause");
  const handleResume = () => socket.emit("admin:resume");
  const handleEnd = () => socket.emit("admin:end");
  const handleNext = () => socket.emit("admin:next_question");

  const handleLock = () => {
    const token = sessionStorage.getItem("orientquiz_admin_token");
    if (token) {
      socket.emit("admin:lock", { token });
    }
    sessionStorage.removeItem("orientquiz_admin_token");
    sessionStorage.removeItem("orientquiz_admin_access");
    setIsAuthenticated(false);
    setAdminState(null);
    setFullWipeConfirm(false);
  };

  const handleReset = () => {
    if (window.confirm(
      "SOFT RESET — OK to confirm.\n\n✓ Keeps existing teams in roster\n✓ Wipes all scores and submissions\n✓ Returns quiz to WAITING state\n✓ All connected team screens go back to lobby"
    )) {
      socket.emit("admin:reset_quiz");
    }
  };

  const handleHardReset = () => {
    if (!fullWipeConfirm) {
      setFullWipeConfirm(true);
      setTimeout(() => setFullWipeConfirm(false), 6000);
      return;
    }
    socket.emit("admin:reset_quiz_full");
    setFullWipeConfirm(false);
  };

  const handleRevealWinners = (reveal: boolean) => {
    socket.emit("admin:reveal_winners", { reveal });
  };

  const handleApplyOverride = (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideModal) return;
    socket.emit("admin:override_score", {
      teamId: overrideModal.teamId,
      delta: Number(overrideDelta),
      note: overrideNote.trim(),
    });
    setOverrideModal(null);
    setOverrideDelta(0);
    setOverrideNote("");
  };

  const handleProjectorPush = (mode: "blank" | "leaderboard" | "winners") => {
    setProjectorPushing(true);
    socket.emit("admin:projector_display", { mode }, () => {
      setProjectorMode(mode);
      setProjectorPushing(false);
    });
  };

  const openProjector = () => {
    window.open("/projector", "_blank", "noopener,noreferrer");
  };

  // -------------------------------------------------------
  // Passcode Gate
  // -------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-sm bg-surface border border-border rounded-card p-6 shadow-none">
          <div className="w-10 h-10 rounded-full bg-accent-soft text-accent flex items-center justify-center mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-ink">Organizer Control Desk</h1>
          <p className="text-xs text-muted mt-1 mb-4">Passcode protected. No public accounts.</p>

          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-xs font-mono text-muted mb-1 uppercase tracking-wider">EVENT PASSCODE</label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-ink text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-danger-soft text-danger text-xs font-medium">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !passcode.trim()}
              className="w-full py-2.5 px-4 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 min-h-[44px]"
            >
              {loading ? "Authenticating…" : "Unlock Control Desk"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <a href="/" className="text-xs text-muted hover:text-ink underline">Back to Team Entrance</a>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------
  // Admin Control Desk
  // -------------------------------------------------------
  return (
    <div className="min-h-screen bg-bg text-ink flex flex-col">
      {/* Header */}
      <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="font-mono font-bold text-sm tracking-tight text-ink flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            CONTROL DESK
          </div>
          <span className="text-border">|</span>
          <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-bg border border-border font-bold uppercase tracking-wider text-ink">
            {adminState?.status || "WAITING"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openProjector}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-ink hover:bg-bg"
          >
            <Monitor className="w-3.5 h-3.5 text-accent" />
            <span>Open Projector ↗</span>
          </button>
          <button
            onClick={handleReset}
            title="Soft reset: keep teams, wipe scores"
            className="px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-amber-600 hover:border-amber-400"
          >
            Reset Quiz
          </button>
          {fullWipeConfirm ? (
            <div className="inline-flex items-center gap-1">
              <button
                onClick={handleHardReset}
                className="px-3 py-1.5 rounded-lg bg-danger text-white border border-danger text-xs font-bold animate-pulse"
              >
                ⚠ Confirm Wipe All
              </button>
              <button
                onClick={() => setFullWipeConfirm(false)}
                className="px-2 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={handleHardReset}
              title="Full wipe: delete all teams and scores (requires 2 taps)"
              className="px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-danger hover:border-danger"
            >
              Full Wipe
            </button>
          )}
          <button
            onClick={handleLock}
            title="Lock console and revoke session token"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted hover:text-ink hover:border-ink"
          >
            <Lock className="w-3 h-3" />
            Lock
          </button>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 p-6 max-w-6xl w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left 2 Cols */}
        <div className="md:col-span-2 space-y-6">

          {/* Lifecycle Controls */}
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            <span className="text-xs font-mono uppercase font-semibold text-muted tracking-wider block mb-3">
              LIFECYCLE CONTROLS
            </span>
            <div className="flex flex-wrap gap-2">
              {adminState?.status === "waiting" && (
                <button
                  onClick={handleStart}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover min-h-[44px]"
                >
                  <Play className="w-4 h-4" /> Start Quiz
                </button>
              )}

              {adminState?.status === "starting" && (
                <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent-soft border border-accent text-accent text-sm font-medium min-h-[44px]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  GET READY countdown running (5s)…
                </div>
              )}

              {adminState?.status === "running" && (
                <>
                  <button
                    onClick={handlePause}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface text-ink text-sm font-medium hover:bg-bg min-h-[44px]"
                  >
                    <Pause className="w-4 h-4 text-muted" /> Pause
                  </button>
                  <button
                    onClick={handleNext}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover min-h-[44px]"
                  >
                    <SkipForward className="w-4 h-4" /> Next Question
                  </button>
                  <button
                    onClick={handleEnd}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-danger bg-danger-soft text-danger text-sm font-medium hover:bg-danger/10 min-h-[44px]"
                  >
                    <Square className="w-4 h-4" /> End Quiz
                  </button>
                </>
              )}

              {adminState?.status === "paused" && (
                <>
                  <button
                    onClick={handleResume}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover min-h-[44px]"
                  >
                    <Play className="w-4 h-4" /> Resume
                  </button>
                  <button
                    onClick={handleEnd}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-danger bg-danger-soft text-danger text-sm font-medium min-h-[44px]"
                  >
                    <Square className="w-4 h-4" /> End Quiz
                  </button>
                </>
              )}

              {(adminState?.status === "completed" || adminState?.status === "scored") && (
                <div className="flex flex-wrap gap-2 items-center">
                  <button
                    onClick={() => handleRevealWinners(!adminState.winnerRevealed)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-success text-white text-sm font-medium min-h-[44px]"
                  >
                    <Trophy className="w-4 h-4" />
                    {adminState.winnerRevealed ? "Hide Winner Reveal" : "Reveal Winners (Admin View)"}
                  </button>
                  <button
                    onClick={handleReset}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-surface text-ink text-sm font-medium hover:bg-bg min-h-[44px]"
                  >
                    <RefreshCw className="w-4 h-4 text-accent" /> Restart Quiz (Keep Teams)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Projector Controls */}
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono uppercase font-semibold text-muted tracking-wider">
                PROJECTOR CONTROLS
              </span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${projectorMode === "blank" ? "bg-muted" : "bg-success"}`} />
                <span className="text-xs font-mono text-muted">
                  NOW SHOWING: <span className="text-ink font-bold uppercase">{projectorMode}</span>
                </span>
              </div>
            </div>
            <p className="text-xs text-muted mb-3">
              Push what the projector screen at <code className="bg-bg px-1 rounded">/projector</code> displays — independently from this panel.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleProjectorPush("leaderboard")}
                disabled={projectorPushing}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-surface text-ink text-xs font-medium hover:bg-bg min-h-[40px] disabled:opacity-50"
              >
                <List className="w-3.5 h-3.5 text-accent" />
                Show Leaderboard
              </button>
              <button
                onClick={() => handleProjectorPush("winners")}
                disabled={projectorPushing}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-surface text-ink text-xs font-medium hover:bg-bg min-h-[40px] disabled:opacity-50"
              >
                <Crown className="w-3.5 h-3.5 text-yellow-500" />
                Show Top 3 Winners
              </button>
              <button
                onClick={() => handleProjectorPush("blank")}
                disabled={projectorPushing || projectorMode === "blank"}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-surface text-muted text-xs font-medium hover:bg-bg min-h-[40px] disabled:opacity-50"
              >
                <EyeOff className="w-3.5 h-3.5" />
                Clear Projector
              </button>
              <button
                onClick={openProjector}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover min-h-[40px]"
              >
                <Monitor className="w-3.5 h-3.5" />
                Open Projector Tab ↗
              </button>
            </div>
          </div>

          {/* Current Question Live Monitor */}
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <span className="text-xs font-mono uppercase font-semibold text-muted tracking-wider">
                ACTIVE QUESTION MONITOR
              </span>
              {adminState?.currentQuestion && (
                <span className="font-mono text-xs text-accent font-bold">
                  Q {adminState.currentQuestion.index + 1} / {adminState.currentQuestion.total}
                </span>
              )}
            </div>

            {adminState?.currentQuestion ? (
              <div>
                <h3 className="text-base font-bold text-ink mb-3">{adminState.currentQuestion.text}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                  {adminState.currentQuestion.options.map((opt, i) => (
                    <div key={i} className="p-2.5 rounded-lg border border-border bg-bg text-xs font-mono">
                      {i + 1}. {opt}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-bg border border-border text-xs font-mono">
                  <span>Submissions: {adminState.submissionCount} / {adminState.totalTeams}</span>
                  <span>Timer: {adminState.currentQuestion.timerSeconds}s</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Quiz is not currently running a question.</p>
            )}
          </div>

          {/* Team Roster */}
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <span className="text-xs font-mono uppercase font-semibold text-muted tracking-wider">
                TEAM ROSTER ({adminState?.teams?.length || 0})
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted font-mono uppercase">
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Team</th>
                    <th className="pb-2">Code</th>
                    <th className="pb-2">Score</th>
                    <th className="pb-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {adminState?.teams?.map((team) => (
                    <tr key={team.id} className="hover:bg-bg">
                      <td className="py-2.5">
                        <span
                          className={`inline-block w-2 h-2 rounded-full ${
                            team.online ? "bg-success" : "bg-muted opacity-40"
                          }`}
                        />
                      </td>
                      <td className="py-2.5 font-medium text-ink">{team.name}</td>
                      <td className="py-2.5 font-mono text-muted">{team.code}</td>
                      <td className="py-2.5 font-mono font-bold text-ink">{team.score}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => {
                            setOverrideModal({
                              teamId: team.id,
                              teamName: team.name,
                              currentScore: team.score,
                            });
                            setOverrideDelta(0);
                            setOverrideNote("");
                          }}
                          className="px-2 py-1 rounded border border-border text-xs hover:bg-bg mr-1 text-ink"
                        >
                          Override
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Remove team "${team.name}"?`)) {
                              socket.emit("admin:remove_team", { teamId: team.id });
                            }
                          }}
                          className="px-2 py-1 rounded text-danger hover:bg-danger-soft text-xs"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Col: Leaderboard */}
        <div className="space-y-6">
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <span className="text-xs font-mono uppercase font-semibold text-muted tracking-wider">
                ADMIN LEADERBOARD (PRIVATE)
              </span>
              <Trophy className="w-4 h-4 text-accent" />
            </div>

            <div className="space-y-2">
              {adminState?.leaderboard?.map((item) => (
                <div
                  key={item.teamId}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-bg text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-muted w-5 text-center">#{item.rank}</span>
                    <span className="font-medium text-ink">{item.name}</span>
                  </div>
                  <span className="font-mono font-bold text-accent">{item.score} pts</span>
                </div>
              ))}
              {(!adminState?.leaderboard || adminState.leaderboard.length === 0) && (
                <p className="text-xs text-muted">Leaderboard will compute when quiz completes or answers arrive.</p>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Override Score Modal */}
      {overrideModal && (
        <div className="fixed inset-0 bg-ink/30 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-surface border border-border rounded-card p-6 max-w-sm w-full shadow-lg">
            <h3 className="text-base font-bold text-ink mb-1">Score Adjustment: {overrideModal.teamName}</h3>
            <p className="text-xs text-muted mb-4 font-mono">Current Score: {overrideModal.currentScore} PTS</p>

            <form onSubmit={handleApplyOverride} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-muted mb-1">SCORE ADJUSTMENT DELTA (+ / -)</label>
                <input
                  type="number"
                  value={overrideDelta}
                  onChange={(e) => setOverrideDelta(Number(e.target.value))}
                  placeholder="e.g. +10 or -5"
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-mono focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-muted mb-1">ORGANIZER NOTE (OPTIONAL)</label>
                <input
                  type="text"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  placeholder="e.g. Tiebreaker bonus"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOverrideModal(null)}
                  className="flex-1 py-2.5 rounded-lg border border-border text-sm text-ink hover:bg-bg min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover min-h-[44px]"
                >
                  Apply Delta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
