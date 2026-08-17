import React, { useEffect, useState } from "react";
import { socket } from "../socket.js";
import { LeaderboardEntry, ProjectorDisplayPayload } from "@orientquiz/shared";
import { Crown, Trophy } from "lucide-react";

export const Projector: React.FC = () => {
  const [display, setDisplay] = useState<ProjectorDisplayPayload>({ mode: "blank" });
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const subscribe = () => {
      socket.emit("projector:subscribe", (res) => {
        if (res?.current) {
          setDisplay(res.current);
        }
      });
    };

    const onConnect = () => {
      setConnected(true);
      subscribe();
    };

    const onDisconnect = () => setConnected(false);

    const onProjectorDisplay = (payload: ProjectorDisplayPayload) => {
      setDisplay(payload);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("projector:display", onProjectorDisplay);

    if (socket.connected) {
      subscribe();
    } else {
      socket.connect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("projector:display", onProjectorDisplay);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#06091A] text-white flex flex-col select-none overflow-hidden">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-10 py-5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Trophy className="w-4.5 h-4.5 text-indigo-400" />
          </div>
          <div>
            <div className="text-[10px] font-mono tracking-[0.2em] text-indigo-400 uppercase font-semibold">
              TECHKNOW · ORIENTQUIZ
            </div>
            <h1 className="text-lg font-extrabold tracking-tight text-white leading-none mt-0.5">
              Orientation Quiz 2026
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-emerald-400" : "bg-red-500 animate-ping"
            }`}
          />
          <span className="text-[11px] font-mono text-white/30 tracking-widest uppercase">
            {connected ? "LIVE" : "RECONNECTING…"}
          </span>
        </div>
      </header>

      {/* Main Display Area */}
      <main className="flex-1 flex flex-col items-center justify-center px-10 py-8">
        {display.mode === "blank" && <BlankScreen />}
        {display.mode === "leaderboard" && (
          <LeaderboardDisplay leaderboard={display.leaderboard || []} />
        )}
        {display.mode === "winners" && (
          <WinnersDisplay winners={display.winners || []} />
        )}
      </main>

      {/* Footer */}
      <footer className="flex justify-between items-center px-10 py-4 border-t border-white/5 text-[10px] font-mono text-white/20 tracking-widest uppercase">
        <span>PROJECTOR DISPLAY — NOT FOR PARTICIPANTS</span>
        <span>TECHKNOW · 2026</span>
      </footer>
    </div>
  );
};

// ---------------------------------------------------------
// Blank / Standby Screen
// ---------------------------------------------------------
const BlankScreen: React.FC = () => (
  <div className="text-center">
    <div className="w-24 h-24 rounded-full bg-indigo-900/30 border border-indigo-700/30 flex items-center justify-center mx-auto mb-8">
      <Trophy className="w-12 h-12 text-indigo-600/60" />
    </div>
    <h2 className="text-6xl font-black text-white/80 tracking-tight leading-tight">Results!!??</h2>
    <p className="text-2xl font-bold text-white/40 mt-4 tracking-wide uppercase">
      YOU'LL FIND OUT SOON ENOUGH.
    </p>
  </div>
);

// ---------------------------------------------------------
// Leaderboard Display — full-screen, large + clear
// ---------------------------------------------------------
const LeaderboardDisplay: React.FC<{ leaderboard: LeaderboardEntry[] }> = ({ leaderboard }) => {
  const rows = leaderboard.slice(0, 10);

  const rankColors: Record<number, string> = {
    0: "text-yellow-400",
    1: "text-slate-300",
    2: "text-amber-500",
  };

  const rowBg: Record<number, string> = {
    0: "bg-yellow-500/5 border-yellow-500/20",
    1: "bg-white/[0.04] border-white/10",
    2: "bg-amber-600/5 border-amber-600/15",
  };

  return (
    <div className="w-full max-w-3xl">
      {/* Title */}
      <div className="text-center mb-10">
        <span className="text-xs font-mono tracking-[0.25em] text-indigo-400 uppercase font-semibold">
          Live Rankings
        </span>
        <h2 className="text-5xl font-black text-white mt-2 tracking-tight">Leaderboard</h2>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-white/30 font-mono text-lg">No teams on the board yet…</p>
      ) : (
        <div className="space-y-3">
          {rows.map((entry, idx) => (
            <div
              key={entry.teamId}
              className={`flex items-center justify-between px-7 py-5 rounded-2xl border transition-all ${
                rowBg[idx] ?? "bg-white/[0.025] border-white/[0.06]"
              }`}
            >
              <div className="flex items-center gap-6">
                <span
                  className={`font-mono text-3xl font-black w-12 text-center tabular-nums ${
                    rankColors[idx] ?? "text-white/30"
                  }`}
                >
                  {idx + 1}
                </span>
                <span className={`text-2xl font-bold tracking-wide ${idx < 3 ? "text-white" : "text-white/70"}`}>
                  {entry.name}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className={`font-mono text-3xl font-black tabular-nums ${
                  idx === 0 ? "text-yellow-400" : idx === 1 ? "text-slate-300" : idx === 2 ? "text-amber-500" : "text-emerald-400/80"
                }`}>
                  {entry.score}
                </span>
                <span className="text-xs font-mono text-white/25 uppercase tracking-wider">PTS</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------
// Winners Podium Display — top 3 with name + points
// ---------------------------------------------------------
const WinnersDisplay: React.FC<{ winners: LeaderboardEntry[] }> = ({ winners }) => {
  const first = winners[0];
  const second = winners[1];
  const third = winners[2];

  return (
    <div className="w-full max-w-5xl text-center">
      {/* Headline badge */}
      <div className="inline-flex items-center gap-3 px-6 py-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-12">
        <Crown className="w-5 h-5 text-yellow-400" />
        <span className="text-yellow-300 text-sm font-mono font-bold tracking-[0.15em] uppercase">
          Official Champions · Techknow Orientation 2026
        </span>
        <Crown className="w-5 h-5 text-yellow-400" />
      </div>

      {/* Podium — order: 2nd | 1st | 3rd */}
      <div className="grid grid-cols-3 gap-5 items-end">
        {/* 2nd Place */}
        <div className="flex flex-col items-center">
          <PodiumCard
            rank={2}
            entry={second}
            accentClass="bg-slate-800/60 border-slate-500/50"
            rankColor="text-slate-300"
            badgeClass="bg-slate-700/80 border-slate-500 text-slate-200"
            scoreClass="text-slate-200"
            cardHeight="h-44"
          />
          <div className="w-full h-20 mt-3 bg-slate-800/50 border border-slate-700/50 border-b-0 rounded-t-xl flex items-center justify-center">
            <span className="font-mono text-5xl font-black text-slate-500">2</span>
          </div>
        </div>

        {/* 1st Place — tallest, centre */}
        <div className="flex flex-col items-center -mb-6">
          <PodiumCard
            rank={1}
            entry={first}
            accentClass="bg-indigo-950/80 border-yellow-500/60 shadow-2xl shadow-yellow-500/10"
            rankColor="text-yellow-400"
            badgeClass="bg-yellow-500/15 border-yellow-400/60 text-yellow-300"
            scoreClass="text-emerald-400"
            cardHeight="h-56"
            showCrown
          />
          <div className="w-full h-32 mt-3 bg-indigo-900/40 border border-indigo-700/40 border-b-0 rounded-t-xl flex items-center justify-center">
            <span className="font-mono text-6xl font-black text-indigo-400/80">1</span>
          </div>
        </div>

        {/* 3rd Place */}
        <div className="flex flex-col items-center">
          <PodiumCard
            rank={3}
            entry={third}
            accentClass="bg-slate-800/50 border-amber-700/40"
            rankColor="text-amber-500"
            badgeClass="bg-amber-900/30 border-amber-700/60 text-amber-400"
            scoreClass="text-amber-400"
            cardHeight="h-36"
          />
          <div className="w-full h-12 mt-3 bg-slate-800/40 border border-slate-700/40 border-b-0 rounded-t-xl flex items-center justify-center">
            <span className="font-mono text-4xl font-black text-amber-800/70">3</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PodiumCardProps {
  rank: number;
  entry?: LeaderboardEntry;
  accentClass: string;
  rankColor: string;
  badgeClass: string;
  scoreClass: string;
  cardHeight: string;
  showCrown?: boolean;
}

const PodiumCard: React.FC<PodiumCardProps> = ({
  rank,
  entry,
  accentClass,
  rankColor,
  badgeClass,
  scoreClass,
  cardHeight,
  showCrown,
}) => {
  if (!entry) {
    return (
      <div
        className={`${cardHeight} w-full rounded-2xl border border-dashed border-white/10 flex items-center justify-center`}
      >
        <span className="text-white/20 font-mono text-sm">#{rank} —</span>
      </div>
    );
  }

  return (
    <div
      className={`${cardHeight} w-full p-5 rounded-2xl border-2 flex flex-col items-center justify-center gap-2.5 ${accentClass}`}
    >
      {showCrown && <Crown className="w-9 h-9 text-yellow-400 mb-1" />}

      {/* Rank badge */}
      <div className={`px-3 py-1 rounded-full border text-[11px] font-mono font-bold uppercase tracking-[0.15em] ${badgeClass}`}>
        #{rank} PLACE
      </div>

      {/* Team name */}
      <h3 className="text-2xl font-black text-white text-center leading-tight px-2 mt-1">
        {entry.name}
      </h3>

      {/* Points */}
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`font-mono text-3xl font-black tabular-nums ${scoreClass}`}>
          {entry.score}
        </span>
        <span className="text-xs font-mono text-white/30 uppercase tracking-wider">PTS</span>
      </div>
    </div>
  );
};
