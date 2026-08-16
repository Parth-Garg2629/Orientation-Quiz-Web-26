import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket.js";
import { PublicQuestion, TeamQuizState, TeamSession } from "@orientquiz/shared";
import { Radio, AlertCircle, Copy, Check, Lock, Loader2 } from "lucide-react";
import { TimerDial } from "../components/TimerDial.js";

// Answer reveal color constants (only use colors defined in tailwind.config.js)
const OPTION_CORRECT = "bg-success-soft border-success text-success font-semibold";
const OPTION_WRONG = "bg-danger-soft border-danger text-danger font-semibold";
const OPTION_CORRECT_HIGHLIGHT = "bg-accent-soft border-accent text-accent font-semibold"; // correct option, shown when user chose wrong
const OPTION_LOCKED_NEUTRAL = "bg-accent-soft border-accent text-accent font-semibold";
const OPTION_DIMMED = "bg-bg border-border text-muted opacity-60 cursor-not-allowed";
const OPTION_DEFAULT = "bg-surface border-border text-ink hover:bg-bg active:bg-accent-soft active:border-accent";

export const Team: React.FC = () => {
  const navigate = useNavigate();
  const [teamSession, setTeamSession] = useState<TeamSession | null>(null);
  const [quizState, setQuizState] = useState<TeamQuizState | null>(null);
  const [isInactive, setIsInactive] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState(socket.connected);
  const [submitting, setSubmitting] = useState(false);

  // Fix 2: Delayed answer reveal
  const [revealResult, setRevealResult] = useState(false);
  const [correctOption, setCorrectOption] = useState<number | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fix 5: GET READY countdown
  const [startingCountdown, setStartingCountdown] = useState<number | null>(null);
  const startingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fix 6: Sticky timer when scrolled out of view
  const timerDialRef = useRef<HTMLDivElement | null>(null);
  const [timerVisible, setTimerVisible] = useState(true);

  // Track remaining ms for compact sticky timer — use ref to avoid re-rendering on every 50ms tick
  const compactRemainingMsRef = useRef<number>(0);
  const [compactRemainingDisplay, setCompactRemainingDisplay] = useState<number>(0);

  // Memoized callback passed to TimerDial — updates ref every 50ms, but only triggers state update
  // once per second to avoid re-rendering the whole Team page 20 times/second
  const handleRemainingMs = useCallback((ms: number) => {
    const prevSec = Math.ceil(compactRemainingMsRef.current / 1000);
    const newSec = Math.ceil(ms / 1000);
    compactRemainingMsRef.current = ms;
    if (newSec !== prevSec) {
      setCompactRemainingDisplay(newSec);
    }
  }, []);

  const resetReveal = useCallback(() => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    setRevealResult(false);
    setCorrectOption(null);
  }, []);

  // Fix 6: IntersectionObserver for sticky timer
  useEffect(() => {
    const el = timerDialRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setTimerVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [quizState?.status]); // re-observe when status changes (question appears)

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
      resetReveal();
      setSubmitting(false);
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

    // Fix 2: Answer reveal from server (fires after timer ends)
    const onAnswerReveal = (payload: { questionIndex: number; correctOption: number }) => {
      setCorrectOption(payload.correctOption);
      // Show reveal after 1.5s
      revealTimerRef.current = setTimeout(() => {
        setRevealResult(true);
      }, 1500);
    };

    // Fix 5: GET READY countdown
    const onStarting = (payload: { startsInMs: number; serverNow: number }) => {
      let remaining = Math.ceil(payload.startsInMs / 1000);
      setStartingCountdown(remaining);
      if (startingTimerRef.current) clearInterval(startingTimerRef.current);
      startingTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(startingTimerRef.current!);
          startingTimerRef.current = null;
          setStartingCountdown(null);
        } else {
          setStartingCountdown(remaining);
        }
      }, 1000);
    };

    const onInactive = (data: { reason: string }) => {
      setIsInactive(data.reason || "Session moved to another device");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("quiz:state", onQuizState);
    socket.on("quiz:question", onQuestion);
    socket.on("quiz:locked", onQuizLocked);
    socket.on("quiz:answer_reveal", onAnswerReveal);
    socket.on("quiz:starting", onStarting);
    socket.on("session:inactive", onInactive);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("quiz:state", onQuizState);
      socket.off("quiz:question", onQuestion);
      socket.off("quiz:locked", onQuizLocked);
      socket.off("quiz:answer_reveal", onAnswerReveal);
      socket.off("quiz:starting", onStarting);
      socket.off("session:inactive", onInactive);
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      if (startingTimerRef.current) clearInterval(startingTimerRef.current);
    };
  }, [navigate, resetReveal]);

  const handleSelectOption = (optionIndex: number) => {
    if (!quizState?.currentQuestion || quizState.isLocked || submitting) return;
    // Fix 1: Block selection when paused
    if (quizState.status === "paused") return;

    setSubmitting(true);
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

  // Fix 2: Compute option styles post-reveal
  const getOptionStyle = (i: number): string => {
    const isSelected = quizState?.lockedOption === i;
    const isLocked = quizState?.isLocked ?? false;
    const isWrong = quizState?.isWrongLock ?? false;

    if (revealResult && correctOption !== null) {
      if (i === correctOption) {
        // The correct answer — always highlight green
        return OPTION_CORRECT;
      }
      if (isSelected && isWrong) {
        // User's wrong pick — highlight red
        return OPTION_WRONG;
      }
      return OPTION_DIMMED;
    }

    // Pre-reveal
    if (isSelected) return OPTION_LOCKED_NEUTRAL; // neutral locked (no color hint)
    if (isLocked) return OPTION_DIMMED;
    return OPTION_DEFAULT;
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

  const isQuizActive =
    quizState?.status === "running" ||
    quizState?.status === "paused" ||
    quizState?.status === "starting" ||
    quizState?.status === "completed" ||
    quizState?.status === "scored";

  return (
    <div className="min-h-screen flex flex-col p-4 max-w-md mx-auto">
      {/* Top Header */}
      <header className="flex items-center justify-between py-2 border-b border-border mb-4">
        <div>
          <span className="text-[11px] text-muted font-mono uppercase tracking-wider block">TEAM</span>
          <span className="text-base font-bold text-ink">{teamSession?.name || "Connecting…"}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Fix 6: Compact sticky timer in header when dial is off-screen */}
          {!timerVisible &&
            quizState?.status === "running" &&
            quizState.currentQuestion && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent text-white text-xs font-mono font-bold animate-pulse">
                <span>⏱</span>
                <span>{compactRemainingDisplay}s</span>
              </div>
            )}
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
        {/* Fix 5: GET READY screen */}
        {(quizState?.status === "starting" || startingCountdown !== null) ? (
          <div className="bg-surface border border-border rounded-card p-10 text-center">
            <div className="w-16 h-16 rounded-full bg-accent text-white flex items-center justify-center mx-auto mb-4">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <h2 className="text-2xl font-extrabold text-ink mb-2 tracking-tight">GET READY!</h2>
            <p className="text-sm text-muted mb-6">The quiz is about to begin</p>
            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-4 border-accent bg-accent-soft mx-auto">
              <span className="font-mono text-5xl font-bold text-accent">
                {startingCountdown ?? 5}
              </span>
            </div>
            <p className="text-xs text-muted font-mono mt-4 uppercase tracking-widest">
              Quiz starts in {startingCountdown ?? 5} second{(startingCountdown ?? 5) !== 1 ? "s" : ""}
            </p>
          </div>
        ) : (quizState?.status === "running" || quizState?.status === "paused") &&
          quizState.currentQuestion ? (
          <div className="bg-surface border border-border rounded-card p-5 shadow-none">
            {/* Fix 1: Pause banner */}
            {quizState.status === "paused" && (
              <div className="flex items-center gap-2 justify-center mb-3 px-3 py-2 rounded-lg bg-slate-100 border border-slate-200">
                <span className="text-base">⏸</span>
                <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Paused by organizer — please wait
                </span>
              </div>
            )}

            {/* Question Progress Header */}
            <div className="flex items-center justify-between text-xs font-mono font-semibold mb-2">
              <span className="text-accent uppercase">
                QUESTION {quizState.currentQuestion.index + 1} OF {quizState.currentQuestion.total}
              </span>
              <span className="text-muted">{quizState.currentQuestion.points} PTS</span>
            </div>

            {/* Signature Stopwatch Dial Timer */}
            <div ref={timerDialRef}>
              <TimerDial
                deadline={quizState.currentQuestion.deadline}
                totalSeconds={quizState.currentQuestion.timerSeconds}
                isPaused={quizState.status === "paused"}
                onRemainingMs={handleRemainingMs}
              />
            </div>

            {/* Question Text */}
            <h2 className="text-[18px] font-bold text-ink leading-snug my-4 text-center">
              {quizState.currentQuestion.text}
            </h2>

            {/* Options List */}
            <div className="space-y-2.5 mt-2">
              {quizState.currentQuestion.options.map((opt, i) => {
                const isSelected = quizState.lockedOption === i;
                // Fix 1 + 2: disabled when paused OR locked
                const isDisabled = quizState.isLocked || submitting || quizState.status === "paused";

                return (
                  <button
                    key={i}
                    onClick={() => handleSelectOption(i)}
                    disabled={isDisabled}
                    className={`w-full p-4 rounded-lg text-left text-base font-medium border transition-colors flex items-center justify-between min-h-[52px] ${getOptionStyle(i)}`}
                  >
                    <span className="flex-1 pr-2">{opt}</span>
                    {isSelected && !revealResult && (
                      <span className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider flex-shrink-0">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Locked</span>
                      </span>
                    )}
                    {revealResult && correctOption !== null && i === correctOption && (
                      <span className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider flex-shrink-0">
                        ✓ Correct
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Lock notification text */}
            {quizState.isLocked && !revealResult && (
              <p className="text-xs text-muted text-center mt-4 font-mono">
                ✓ Answer locked in. Waiting for question timer to complete…
              </p>
            )}
            {revealResult && (
              <p className={`text-xs text-center mt-4 font-mono font-semibold ${
                quizState.lockedOption === correctOption ? "text-success" : "text-danger"
              }`}>
                {quizState.lockedOption === correctOption
                  ? "✓ Correct! Well done."
                  : quizState.lockedOption !== null
                  ? "✗ Incorrect. Better luck next time!"
                  : "⏰ Time's up! No answer submitted."}
              </p>
            )}
          </div>
        ) : quizState?.status === "completed" || quizState?.status === "scored" ? (
          /* Results state */
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

      {/* Fix 3: Only show Leave Team when quiz hasn't started */}
      {!isQuizActive && (
        <footer className="py-4 text-center">
          <button onClick={handleLeave} className="text-xs text-muted hover:text-ink">
            Leave team
          </button>
        </footer>
      )}
    </div>
  );
};
