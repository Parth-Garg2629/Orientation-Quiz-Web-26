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
    <div className="min-h-screen bg-[#0A0F1E] text-white flex flex-col select-none overflow-hidden">
      {/* Top Bar */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-slate-800">
        <div>
          <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase">
            ORIENTQUIZ · LIVE
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight text-white mt-0.5">
            Orientation Quiz 2026
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500 animate-ping"}`}
          />
          <span className="text-xs font-mono text-slate-500">
            {connected ? "LIVE" : "RECONNECTING…"}
          </span>
        </div>
      </header>

      {/* Main Display Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        {display.mode === "blank" && <BlankScreen />}
        {display.mode === "leaderboard" && (
          <LeaderboardDisplay leaderboard={display.leaderboard || []} />
        )}
        {display.mode === "winners" && (
          <WinnersDisplay winners={display.winners || []} />
        )}
      </main>

      {/* Footer */}
      <footer className="flex justify-between items-center px-8 py-3 border-t border-slate-800 text-xs font-mono text-slate-600">
        <span>PROJECTOR DISPLAY — DO NOT SHARE THIS SCREEN</span>
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
    <div className="w-20 h-20 rounded-full bg-indigo-900/40 border border-indigo-700/50 flex items-center justify-center mx-auto mb-6">
      <Trophy className="w-10 h-10 text-indigo-500" />
    </div>
    <h2 className="text-4xl font-extrabold text-slate-400 tracking-tight">STANDBY</h2>
    <p className="text-slate-600 text-sm font-mono mt-3 tracking-widest uppercase">
      Waiting for organizer…
    </p>
  </div>
);

// ---------------------------------------------------------
// Leaderboard Display
// ---------------------------------------------------------
const LeaderboardDisplay: React.FC<{ leaderboard: LeaderboardEntry[] }> = ({ leaderboard }) => {
  const rows = leaderboard.slice(0, 10);
  return (
    <div className="w-full max-w-4xl">
      <div className="text-center mb-8">
        <span className="text-xs font-mono tracking-widest text-indigo-400 uppercase font-semibold">
          Live Rankings
        </span>
        <h2 className="text-4xl font-extrabold text-white mt-1 tracking-tight">Leaderboard</h2>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-slate-500 font-mono">No teams on the board yet…</p>
      ) : (
        <div className="space-y-3">
          {rows.map((entry, idx) => (
            <div
              key={entry.teamId}
              className={`flex items-center justify-between px-6 py-4 rounded-xl border transition-all ${
                idx === 0
                  ? "bg-indigo-950/60 border-indigo-500/60 scale-[1.01]"
                  : idx === 1
                  ? "bg-slate-900/80 border-slate-600"
                  : idx === 2
                  ? "bg-slate-900/60 border-slate-700"
                  : "bg-slate-950/40 border-slate-800/60"
              }`}
            >
              <div className="flex items-center gap-6">
                <span
                  className={`font-mono text-3xl font-bold w-12 text-center ${
                    idx === 0 ? "text-yellow-400" : idx === 1 ? "text-slate-300" : idx === 2 ? "text-amber-600" : "text-slate-500"
                  }`}
                >
                  #{entry.rank}
                </span>
                <span className="text-2xl font-bold tracking-wide text-white">{entry.name}</span>
              </div>
              <div className="font-mono text-3xl font-bold tracking-wider text-right text-emerald-400">
                {entry.score}{" "}
                <span className="text-sm font-normal text-slate-500">PTS</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------
// Winners Podium Display (top 3)
// ---------------------------------------------------------
const WinnersDisplay: React.FC<{ winners: LeaderboardEntry[] }> = ({ winners }) => {
  const first = winners[0];
  const second = winners[1];
  const third = winners[2];

  return (
    <div className="w-full max-w-5xl text-center">
      {/* Headline */}
      <div className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-900/50 border border-indigo-500/40 rounded-full text-indigo-300 text-sm font-mono font-semibold mb-10 animate-bounce">
        <Crown className="w-4 h-4 text-yellow-400" />
        <span>OFFICIAL CHAMPIONS — TECHKNOW ORIENTATION 2026</span>
        <Crown className="w-4 h-4 text-yellow-400" />
      </div>

      {/* Podium Row — order: 2nd | 1st | 3rd */}
      <div className="grid grid-cols-3 gap-6 items-end">
        {/* 2nd Place */}
        <div className="pb-0">
          {second ? (
            <PodiumCard
              rank={2}
              name={second.name}
              score={second.score}
              accentClass="border-slate-500 bg-slate-800/70"
              badgeClass="bg-slate-700 border-slate-500 text-slate-200"
              scoreClass="text-slate-200"
              height="h-36"
            />
          ) : (
            <EmptyPodiumCard rank={2} height="h-36" />
          )}
          {/* Podium step */}
          <div className="mt-3 h-20 bg-slate-700/70 border border-slate-600 rounded-t-xl flex items-center justify-center">
            <span className="font-mono text-4xl font-extrabold text-slate-400">2</span>
          </div>
        </div>

        {/* 1st Place — tallest, centre */}
        <div className="pb-0 -mb-6">
          {first ? (
            <PodiumCard
              rank={1}
              name={first.name}
              score={first.score}
              accentClass="border-yellow-500/80 bg-indigo-950/90 shadow-2xl shadow-yellow-500/10"
              badgeClass="bg-yellow-500/20 border-yellow-400 text-yellow-300"
              scoreClass="text-emerald-400"
              height="h-44"
              crownIcon
            />
          ) : (
            <EmptyPodiumCard rank={1} height="h-44" />
          )}
          <div className="mt-3 h-32 bg-indigo-900/70 border border-indigo-700/60 rounded-t-xl flex items-center justify-center">
            <span className="font-mono text-5xl font-extrabold text-indigo-400">1</span>
          </div>
        </div>

        {/* 3rd Place */}
        <div className="pb-0">
          {third ? (
            <PodiumCard
              rank={3}
              name={third.name}
              score={third.score}
              accentClass="border-amber-700/50 bg-slate-800/60"
              badgeClass="bg-amber-900/40 border-amber-700 text-amber-500"
              scoreClass="text-amber-400"
              height="h-28"
            />
          ) : (
            <EmptyPodiumCard rank={3} height="h-28" />
          )}
          <div className="mt-3 h-12 bg-slate-800/60 border border-slate-700 rounded-t-xl flex items-center justify-center">
            <span className="font-mono text-3xl font-extrabold text-amber-700">3</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface PodiumCardProps {
  rank: number;
  name: string;
  score: number;
  accentClass: string;
  badgeClass: string;
  scoreClass: string;
  height: string;
  crownIcon?: boolean;
}

const PodiumCard: React.FC<PodiumCardProps> = ({
  rank,
  name,
  score,
  accentClass,
  badgeClass,
  scoreClass,
  height,
  crownIcon,
}) => (
  <div
    className={`${height} p-5 rounded-2xl border-2 flex flex-col items-center justify-center gap-3 ${accentClass}`}
  >
    {crownIcon && (
      <Crown className="w-8 h-8 text-yellow-400 mb-1" />
    )}
    <div
      className={`px-3 py-1 rounded-full border text-xs font-mono font-bold uppercase tracking-wider ${badgeClass}`}
    >
      #{rank} PLACE
    </div>
    <h3 className="text-2xl font-extrabold text-white text-center leading-tight">{name}</h3>
    <div className={`font-mono text-3xl font-extrabold ${scoreClass}`}>
      {score}{" "}
      <span className="text-sm font-normal text-slate-500">PTS</span>
    </div>
  </div>
);

const EmptyPodiumCard: React.FC<{ rank: number; height: string }> = ({ rank, height }) => (
  <div
    className={`${height} p-5 rounded-2xl border border-dashed border-slate-700 flex items-center justify-center text-slate-700 font-mono text-sm`}
  >
    #{rank} —
  </div>
);
