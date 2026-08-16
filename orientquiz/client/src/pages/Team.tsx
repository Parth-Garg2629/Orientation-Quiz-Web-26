import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket.js";
import { PublicQuestion, TeamQuizState, TeamSession } from "@orientquiz/shared";
import { Radio, AlertCircle, Copy, Check, Lock, Loader2 } from "lucide-react";
import { TimerDial } from "../components/TimerDial.js";

export const Team: React.FC = () => {
  const navigate = useNavigate();
  const [teamSession, setTeamSession] = useState<TeamSession | null>(null);
  const [quizState, setQuizState] = useState<TeamQuizState | null>(null);
  const [isInactive, setIsInactive] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const savedCode = localStorage.getItem("orientquiz_team_code");
    if (!savedCode) {
      navigate("/");
      return;
    }

    const doJoin = () => {
      socket.emit("team:join", { code: savedCode }, (res) => {
        if (res.ok && res.session) {
          setTeamSession(res.session);
          setIsInactive(null);
        } else {
          localStorage.removeItem("orientquiz_team_code");
          navigate("/");
        }
      });
    };

    if (socket.connected) {
      doJoin();
    }

    const onConnect = () => {
      setConnected(true);
      doJoin();
    };

    const onDisconnect = () => {
      setConnected(false);
    };

    const onQuizState = (state: TeamQuizState) => {
      setQuizState(state);
    };

    const onQuestion = (question: PublicQuestion) => {
      setQuizState((prev) =>
        prev
          ? {
              ...prev,
              status: "running",
              currentQuestion: question,
              lockedOption: null,
              isLocked: false,
              isWrongLock: false,
              isInterstitial: false,
            }
          : null
      );
    };

    const onQuizLocked = (payload: { questionIndex: number; optionIndex: number; isWrong: boolean }) => {
      setQuizState((prev) =>
        prev
          ? {
              ...prev,
              lockedOption: payload.optionIndex,
              isLocked: true,
              isWrongLock: payload.isWrong,
            }
          : null
      );
      setSubmitting(false);
    };

    const onInactive = (data: { reason: string }) => {
      setIsInactive(data.reason || "Session moved to another device");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("quiz:state", onQuizState);
    socket.on("quiz:question", onQuestion);
    socket.on("quiz:locked", onQuizLocked);
    socket.on("session:inactive", onInactive);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("quiz:state", onQuizState);
      socket.off("quiz:question", onQuestion);
      socket.off("quiz:locked", onQuizLocked);
      socket.off("session:inactive", onInactive);
    };
  }, [navigate]);

  const handleSelectOption = (optionIndex: number) => {
    if (!quizState?.currentQuestion || quizState.isLocked || submitting) return;

    setSubmitting(true);
    // Immediately lock on selection
    setQuizState((prev) =>
      prev ? { ...prev, lockedOption: optionIndex, isLocked: true } : null
    );

    socket.emit(
      "team:submit",
      {
        questionIndex: quizState.currentQuestion.index,
        selectedOption: optionIndex,
      },
      (res) => {
        setSubmitting(false);
        if (res && !res.ok) {
          // If error from server, request state sync
          socket.emit("team:sync");
        }
      }
    );
  };

  const handleCopyCode = () => {
    if (teamSession?.code) {
      navigator.clipboard.writeText(teamSession.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLeave = () => {
    localStorage.removeItem("orientquiz_team_code");
    localStorage.removeItem("orientquiz_team_id");
    localStorage.removeItem("orientquiz_team_name");
    navigate("/");
  };

  if (isInactive) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 max-w-md mx-auto text-center">
        <div className="bg-surface border border-border rounded-card p-6 w-full shadow-none">
          <div className="w-12 h-12 rounded-full bg-danger-soft text-danger flex items-center justify-center mx-auto mb-3">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-ink mb-1">Session Inactive</h2>
          <p className="text-sm text-muted mb-4">{isInactive}</p>
          <button
            onClick={handleLeave}
            className="w-full py-3 rounded-lg border border-border bg-surface text-ink text-sm font-medium hover:bg-bg min-h-[44px]"
          >
            Return to Landing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {/* Top Header */}
      <header className="flex items-center justify-between py-2 border-b border-border mb-4">
        <div>
          <span className="text-[11px] text-muted font-mono uppercase tracking-wider block">TEAM</span>
          <span className="text-base font-bold text-ink">{teamSession?.name || "Connecting…"}</span>
        </div>
        <div className="flex items-center gap-2">
          {teamSession && (
            <button
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface border border-border font-mono text-xs font-semibold text-ink hover:bg-bg"
              title="Click to copy team code"
            >
              <span>{teamSession.code}</span>
              {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted" />}
            </button>
          )}
          <div
            className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-success" : "bg-danger animate-ping"}`}
            title={connected ? "Connected" : "Reconnecting…"}
          />
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 flex flex-col justify-center my-auto">
        {quizState?.status === "running" && quizState.currentQuestion ? (
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            {/* Question Progress Header */}
            <div className="flex items-center justify-between text-xs font-mono font-semibold mb-2">
              <span className="text-accent uppercase">
                QUESTION {quizState.currentQuestion.index + 1} OF {quizState.currentQuestion.total}
              </span>
              <span className="text-muted">{quizState.currentQuestion.points} PTS</span>
            </div>

            {/* Signature Stopwatch Dial Timer */}
            <TimerDial
              deadline={quizState.currentQuestion.deadline}
              totalSeconds={quizState.currentQuestion.timerSeconds}
              isPaused={false}
            />

            {/* Question Text (Body text >= 17px) */}
            <h2 className="text-[18px] font-bold text-ink leading-snug my-4 text-center">
              {quizState.currentQuestion.text}
            </h2>

            {/* Options List (touch targets >= 48px) */}
            <div className="space-y-2.5 mt-2">
              {quizState.currentQuestion.options.map((opt, i) => {
                const isSelected = quizState.lockedOption === i;
                const isWrong = isSelected && quizState.isWrongLock;

                return (
                  <button
                    key={i}
                    onClick={() => handleSelectOption(i)}
                    disabled={quizState.isLocked || submitting}
                    className={`w-full p-4 rounded-lg text-left text-base font-medium border transition-colors flex items-center justify-between min-h-[52px] ${
                      isSelected
                        ? isWrong
                          ? "bg-danger-soft border-danger text-danger font-semibold"
                          : "bg-accent-soft border-accent text-accent font-semibold"
                        : quizState.isLocked
                        ? "bg-bg border-border text-muted opacity-60 cursor-not-allowed"
                        : "bg-surface border-border text-ink hover:bg-bg active:bg-accent-soft active:border-accent"
                    }`}
                  >
                    <span className="flex-1 pr-2">{opt}</span>
                    {isSelected && (
                      <span className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider flex-shrink-0">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Locked</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Lock notification text */}
            {quizState.isLocked && (
              <p className="text-xs text-muted text-center mt-4 font-mono">
                ✓ Answer locked in. Waiting for question timer to complete…
              </p>
            )}
          </div>
        ) : quizState?.status === "paused" && quizState.currentQuestion ? (
          <div className="bg-surface border border-border rounded-card p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-ink flex items-center justify-center mx-auto mb-3 font-mono font-bold">
              ⏸
            </div>
            <h2 className="text-lg font-bold text-ink mb-1">Quiz Paused by Organizer</h2>
            <p className="text-sm text-muted">
              Countdown is frozen. The question will resume shortly.
            </p>
          </div>
        ) : quizState?.status === "completed" || quizState?.status === "scored" ? (
          /* Results state: shows own score ONLY — no rank, no other teams */
          <div className="bg-surface border border-border rounded-card p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-accent-soft text-accent flex items-center justify-center mx-auto mb-4 font-mono font-bold text-xl">
              ✓
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Quiz Complete</h2>
            {quizState.totalScore !== undefined && (
              <div className="my-4 px-6 py-4 bg-bg border border-border rounded-xl">
                <span className="text-xs font-mono uppercase tracking-widest text-muted block mb-1">Your Final Score</span>
                <span className="font-mono text-4xl font-extrabold text-accent">{quizState.totalScore}</span>
                <span className="text-sm text-muted font-mono ml-1">pts</span>
              </div>
            )}
            <p className="text-sm text-muted mb-4">
              Final standings and winners are revealed by the organizer on the room projector.
            </p>
            <div className="p-3 bg-bg border border-border rounded-lg text-xs text-muted font-mono">
              Thank you for playing OrientQuiz!
            </div>
          </div>

        ) : (
          /* Waiting / Lobby State */
          <div className="bg-surface border border-border rounded-card p-8 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-bg border border-border rounded-full text-xs font-medium text-muted mb-4">
              <Radio className="w-3.5 h-3.5 text-accent animate-pulse" />
              <span>Room Ready</span>
            </div>
            <h2 className="text-xl font-bold text-ink mb-2">Waiting for organizer to begin…</h2>
            <p className="text-sm text-muted">
              Keep this screen open. When the quiz starts, your team's questions will appear automatically.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-4 text-center">
        <button onClick={handleLeave} className="text-xs text-muted hover:text-ink">
          Leave team
        </button>
      </footer>
    </div>
  );
};
