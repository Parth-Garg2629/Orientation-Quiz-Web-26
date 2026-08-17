import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { socket } from "../socket.js";
import { Radio, ShieldAlert } from "lucide-react";

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [teamName, setTeamName] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createdSession, setCreatedSession] = useState<{ name: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const savedCode = localStorage.getItem("orientquiz_team_code");
    if (savedCode) {
      navigate("/team");
    }
  }, [navigate]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
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

    socket.emit("team:create", { name: teamName.trim() }, (res) => {
      responded = true;
      clearTimeout(timeout);
      setLoading(false);
      if (res.ok && res.session) {
        localStorage.setItem("orientquiz_team_code", res.session.code);
        localStorage.setItem("orientquiz_team_id", res.session.id);
        localStorage.setItem("orientquiz_team_name", res.session.name);
        setCreatedSession({ name: res.session.name, code: res.session.code });
      } else {
        setError(res.error || "Failed to create team. Try another name.");
      }
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = teamCode.trim().toUpperCase();
    if (!code) return;

    // RBAC: "ADMIN1" is the secret trigger to access the admin panel
    if (code === "ADMIN1") {
      // Set a sessionStorage flag so the admin page knows access was granted
      sessionStorage.setItem("orientquiz_admin_access", "1");
      navigate("/admin");
      return;
    }

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

    socket.emit("team:join", { code }, (res) => {
      responded = true;
      clearTimeout(timeout);
      setLoading(false);
      if (res.ok && res.session) {
        localStorage.setItem("orientquiz_team_code", res.session.code);
        localStorage.setItem("orientquiz_team_id", res.session.id);
        localStorage.setItem("orientquiz_team_name", res.session.name);
        navigate("/team");
      } else {
        setError(res.error || "Code not found — check with your organizer.");
      }
    });
  };

  const copyCode = () => {
    if (createdSession) {
      navigator.clipboard.writeText(createdSession.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 max-w-md mx-auto">
      {/* Header */}
      <div className="w-full text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface border border-border rounded-full text-xs font-medium text-muted mb-3">
          <Radio className="w-3.5 h-3.5 text-accent animate-pulse" />
          <span>Live Competition</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">OrientQuiz</h1>
        <p className="text-sm text-muted mt-1">Join the Techknow Orientation 2026 quiz.</p>
      </div>

      {/* ⚠ Single Device Notice — shown always */}
      <div className="w-full mb-5 px-4 py-3.5 rounded-xl bg-amber-50 border-2 border-amber-400 flex items-start gap-3">
        <span className="text-amber-500 text-xl flex-shrink-0 mt-0.5">⚠</span>
        <div>
          <p className="text-sm font-extrabold text-amber-900 uppercase tracking-wide leading-snug">
            ONE DEVICE ALLOWED ONLY
          </p>
          <p className="text-xs text-amber-800 mt-1 leading-relaxed">
            Only <strong>one device</strong> may be logged in per team at a time. Attempting to log in on a second device will be <strong>blocked</strong>. Save your team code to reconnect if you get disconnected.
          </p>
        </div>
      </div>

      {createdSession ? (
        /* Badge Show-Once Screen */
        <div className="w-full bg-surface border border-border rounded-card p-6 text-center shadow-none">
          <span className="text-xs uppercase tracking-wider font-semibold text-muted">Team Credential</span>
          <h2 className="text-lg font-bold text-ink mt-1 mb-4">{createdSession.name}</h2>

          <div className="badge-credential py-4 px-6 my-4">
            <span className="text-xs text-muted block mb-1">TEAM ACCESS CODE</span>
            <div className="font-mono text-3xl font-bold tracking-widest text-ink">
              {createdSession.code}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 text-left my-4">
            <strong>Save this code!</strong> If your phone disconnects or battery dies, use this code to reconnect instantly on any device.
          </div>

          <div className="flex gap-2">
            <button
              onClick={copyCode}
              type="button"
              className="flex-1 py-3 px-4 rounded-lg border border-border bg-surface text-ink text-sm font-medium hover:bg-bg transition-colors"
            >
              {copied ? "Copied!" : "Copy Code"}
            </button>
            <button
              onClick={() => navigate("/team")}
              type="button"
              className="flex-1 py-3 px-4 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              Enter Lobby
            </button>
          </div>
        </div>
      ) : mode === "choose" ? (
        /* Choice View */
        <div className="w-full bg-surface border border-border rounded-card p-6 space-y-3">
          <button
            onClick={() => { setError(null); setMode("create"); }}
            className="w-full py-3.5 px-4 rounded-lg bg-accent text-white font-medium text-base hover:bg-accent-hover transition-colors flex items-center justify-center min-h-[48px]"
          >
            Create Team
          </button>
          <button
            onClick={() => { setError(null); setMode("join"); }}
            className="w-full py-3.5 px-4 rounded-lg border border-border bg-surface text-ink font-medium text-base hover:bg-bg transition-colors flex items-center justify-center min-h-[48px]"
          >
            Join with Code
          </button>
        </div>
      ) : mode === "create" ? (
        /* Create Form */
        <form onSubmit={handleCreate} className="w-full bg-surface border border-border rounded-card p-6 space-y-4">
          <h2 className="text-base font-semibold text-ink">Create a Team</h2>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">TEAM NAME (MAX 20 CHARACTERS)</label>
            <input
              type="text"
              value={teamName}
              maxLength={20}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Alpha Squad"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg text-ink text-base focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-danger-soft text-danger text-xs font-medium">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="flex-1 py-3 rounded-lg border border-border bg-surface text-ink text-sm font-medium hover:bg-bg min-h-[44px]"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || !teamName.trim()}
              className="flex-1 py-3 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 min-h-[44px]"
            >
              {loading ? "Creating…" : "Continue"}
            </button>
          </div>
        </form>
      ) : (
        /* Join Form */
        <form onSubmit={handleJoin} className="w-full bg-surface border border-border rounded-card p-6 space-y-4">
          <h2 className="text-base font-semibold text-ink">Join Existing Team</h2>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">6-CHARACTER TEAM CODE</label>
            <input
              type="text"
              value={teamCode}
              maxLength={6}
              onChange={(e) => setTeamCode(e.target.value.toUpperCase())}
              placeholder="e.g. K7MX92"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-bg font-mono text-center text-lg tracking-widest uppercase focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-danger-soft text-danger text-xs font-medium">
              <ShieldAlert className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="flex-1 py-3 rounded-lg border border-border bg-surface text-ink text-sm font-medium hover:bg-bg min-h-[44px]"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading || teamCode.trim().length !== 6}
              className="flex-1 py-3 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 min-h-[44px]"
            >
              {loading ? "Joining…" : "Join Team"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
