import { Server, Socket } from "socket.io";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  AdminAuthSchema,
  AdminScoreOverrideSchema,
  ClientToServerEvents,
  ProjectorDisplayPayload,
  ProjectorMode,
  ServerToClientEvents,
  SOCKET_ROOMS,
  SubmitAnswerSchema,
  TeamCreateSchema,
  TeamJoinSchema,
  TeamSession,
} from "@orientquiz/shared";
import { queryOne, execute } from "../db/index.js";
import { QuizEngine } from "../quiz/engine.js";

// Only one device per team allowed
const MAX_DEVICES_PER_TEAM = 1;

// Generate unambiguous 6-char team code (no 0/O, 1/I)
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function generateTeamCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  quizEngine: QuizEngine,
  adminPasscodeHash: string
) {
  // Socket -> teamId
  const socketTeamMap = new Map<string, string>();
  // teamId -> Set of active socketIds (up to MAX_DEVICES_PER_TEAM)
  const teamSocketMap = new Map<string, Set<string>>();
  // Admin socket IDs
  const adminSockets = new Set<string>();
  // Current projector display state (persists until admin changes it)
  let projectorState: ProjectorDisplayPayload = { mode: "blank" };
  // Session tokens for admin reconnect (TTL 12h)
  const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
  const adminTokens = new Map<string, number>();

  // Per-socket event rate limiting (events per second)
  const socketEventCounts = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_MAX = 20; // max events per second per socket
  const RATE_LIMIT_WINDOW_MS = 1000;

  function checkRateLimit(socketId: string): boolean {
    const now = Date.now();
    const entry = socketEventCounts.get(socketId);
    if (!entry || now > entry.resetAt) {
      socketEventCounts.set(socketId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      return false; // rate limited
    }
    return true;
  }

  const isSocketAdmin = (socketId: string) => adminSockets.has(socketId);

  // Debounced admin broadcast to avoid flooding on rapid state changes
  let adminBroadcastTimer: NodeJS.Timeout | null = null;
  const broadcastAdminState = () => {
    if (adminBroadcastTimer) return;
    adminBroadcastTimer = setTimeout(async () => {
      adminBroadcastTimer = null;
      try {
        const onlineSocketIds = new Set(io.sockets.sockets.keys());
        const adminState = await quizEngine.getAdminQuizState(onlineSocketIds, teamSocketMap);
        io.to(SOCKET_ROOMS.ADMIN).emit("admin:state", adminState);
        io.to(SOCKET_ROOMS.ADMIN).emit("admin:roster", adminState.teams);
        io.to(SOCKET_ROOMS.ADMIN).emit("admin:leaderboard", adminState.leaderboard);
      } catch (err) {
        console.error("[Socket] Error broadcasting admin state:", err);
      }
    }, 50);
  };

  // Emit quiz state to all sockets belonging to a team
  function emitToTeam(teamId: string, event: string, data: any) {
    const sockets = teamSocketMap.get(teamId);
    if (!sockets) return;
    for (const sid of sockets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (io.to(sid) as any).emit(event, data);
    }
  }

  const broadcastTeamStates = () => {
    for (const [teamId] of teamSocketMap.entries()) {
      quizEngine
        .getTeamQuizState(teamId)
        .then((state) => emitToTeam(teamId, "quiz:state", state))
        .catch((err) => console.error("[Socket] Error broadcasting team state:", err));
    }
  };

  // Wire up QuizEngine callbacks
  quizEngine.setCallbacks({
    onStateChange: () => {
      broadcastAdminState();
      broadcastTeamStates();
    },
    onQuestionAdvance: async (nextIndex) => {
      try {
        const q = await quizEngine.getCurrentQuestion();
        if (q) {
          io.to(SOCKET_ROOMS.BROADCAST).emit("quiz:question", q);
        }
      } catch (err) {
        console.error("[Socket] Error on question advance:", err);
      }
    },
    onAnswerReveal: (questionIndex, correctOption) => {
      io.to(SOCKET_ROOMS.BROADCAST).emit("quiz:answer_reveal", { questionIndex, correctOption });
    },
    onStarting: () => {
      io.to(SOCKET_ROOMS.BROADCAST).emit("quiz:starting", {
        startsInMs: 5000,
        serverNow: Date.now(),
      });
    },
  });

  // Periodic timer sync broadcast every 10s
  setInterval(async () => {
    try {
      const session = await quizEngine.getSessionRow();
      if (session.status === "running" && session.question_deadline) {
        const now = Date.now();
        const remainingMs = Math.max(0, session.question_deadline - now);
        io.to(SOCKET_ROOMS.BROADCAST).emit("timer:sync", {
          serverNow: now,
          deadline: session.question_deadline,
          remainingMs,
        });
      }
    } catch (err) {
      console.error("[Socket] Error in timer sync:", err);
    }
  }, 10000);

  io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    // Middleware: rate limit all incoming events
    socket.use(([event], next) => {
      if (!checkRateLimit(socket.id)) {
        socket.emit("error", { message: "Too many requests. Slow down.", code: "RATE_LIMIT" });
        return; // drop event, don't call next
      }
      next();
    });

    // ----------------------------------------------------
    // Admin Authentication
    // ----------------------------------------------------
    socket.on("admin:auth", async (data, callback) => {
      const parsed = AdminAuthSchema.safeParse(data);
      if (!parsed.success) {
        return callback({ ok: false, error: "Passcode is required." });
      }

      const isValid = bcrypt.compareSync(parsed.data.passcode.trim(), adminPasscodeHash);
      if (isValid) {
        socket.join(SOCKET_ROOMS.ADMIN);
        adminSockets.add(socket.id);

        const token = crypto.randomUUID();
        adminTokens.set(token, Date.now());

        try {
          const onlineSocketIds = new Set(io.sockets.sockets.keys());
          const adminState = await quizEngine.getAdminQuizState(onlineSocketIds, teamSocketMap);
          socket.emit("admin:state", adminState);
        } catch (err) {
          console.error("[Socket] Error fetching admin state on auth:", err);
        }

        return callback({ ok: true, token });
      } else {
        return callback({ ok: false, error: "Incorrect passcode — please try again." });
      }
    });

    // Admin token-based reconnect with TTL check
    socket.on("admin:auth_token", async (data, callback) => {
      if (!data?.token) {
        return callback({ ok: false, error: "Token is required." });
      }

      const createdAt = adminTokens.get(data.token);
      if (!createdAt || Date.now() - createdAt > ADMIN_TOKEN_TTL_MS) {
        if (createdAt) adminTokens.delete(data.token);
        return callback({ ok: false, error: "Session expired. Please re-enter your passcode." });
      }

      socket.join(SOCKET_ROOMS.ADMIN);
      adminSockets.add(socket.id);

      try {
        const onlineSocketIds = new Set(io.sockets.sockets.keys());
        const adminState = await quizEngine.getAdminQuizState(onlineSocketIds, teamSocketMap);
        socket.emit("admin:state", adminState);
      } catch (err) {
        console.error("[Socket] Error fetching admin state on token auth:", err);
      }

      return callback({ ok: true });
    });

    // Admin explicit lock — revokes token
    socket.on("admin:lock", (data, callback) => {
      if (data?.token) {
        adminTokens.delete(data.token);
      }
      adminSockets.delete(socket.id);
      socket.leave(SOCKET_ROOMS.ADMIN);
      callback?.({ ok: true });
    });

    // ----------------------------------------------------
    // Projector Subscribe (read-only, no auth required)
    // ----------------------------------------------------
    socket.on("projector:subscribe", (callback) => {
      socket.join(SOCKET_ROOMS.PROJECTOR);
      // Send current projector state immediately on subscribe
      callback?.({ ok: true, current: projectorState });
      socket.emit("projector:display", projectorState);
    });

    // Admin push to projector
    socket.on("admin:projector_display", async (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });

      const mode: ProjectorMode = data.mode;
      try {
        const leaderboard = await quizEngine.getLeaderboard();
        const winners = leaderboard.slice(0, 3);

        projectorState = {
          mode,
          leaderboard: mode === "leaderboard" ? leaderboard : undefined,
          winners: mode === "winners" ? winners : undefined,
        };

        io.to(SOCKET_ROOMS.PROJECTOR).emit("projector:display", projectorState);
        callback?.({ ok: true });
      } catch (err) {
        console.error("[Socket] Error updating projector:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    // ----------------------------------------------------
    // Team Creation
    // ----------------------------------------------------
    socket.on("team:create", async (data, callback) => {
      const parsed = TeamCreateSchema.safeParse(data);
      if (!parsed.success) {
        return callback({
          ok: false,
          error: parsed.error.issues[0]?.message || "Invalid team name.",
        });
      }

      try {
        const sessionStatus = await quizEngine.getStatus();
        if (sessionStatus !== "waiting") {
          return callback({
            ok: false,
            error: "The quiz has already started. New teams cannot be created at this time.",
          });
        }

        const teamName = parsed.data.name;
        const nameLower = teamName.toLowerCase();

        const existing = await queryOne<{ id: string }>(
          "SELECT id FROM team WHERE name_lower = $1",
          [nameLower]
        );
        if (existing) {
          return callback({
            ok: false,
            error: `Team "${teamName}" already exists — try a different name.`,
          });
        }

        // Generate a unique code
        let code = generateTeamCode();
        while (
          await queryOne<{ id: string }>("SELECT id FROM team WHERE code = $1", [code])
        ) {
          code = generateTeamCode();
        }

        const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await execute(
          "INSERT INTO team (id, name, name_lower, code, total_score, created_at) VALUES ($1, $2, $3, $4, 0, $5)",
          [teamId, teamName, nameLower, code, new Date().toISOString()]
        );

        // Register socket for this team
        socketTeamMap.set(socket.id, teamId);
        const sockets = new Set<string>([socket.id]);
        teamSocketMap.set(teamId, sockets);

        socket.join(SOCKET_ROOMS.team(teamId));
        socket.join(SOCKET_ROOMS.BROADCAST);

        const session: TeamSession = {
          id: teamId,
          name: teamName,
          code,
          score: 0,
        };

        callback({ ok: true, session });

        const teamState = await quizEngine.getTeamQuizState(teamId);
        socket.emit("quiz:state", teamState);

        broadcastAdminState();
      } catch (err) {
        console.error("[Socket] Error creating team:", err);
        callback({ ok: false, error: "Internal server error. Please try again." });
      }
    });

    // ----------------------------------------------------
    // Team Join / Reconnect / Duo Device
    // ----------------------------------------------------
    socket.on("team:join", async (data, callback) => {
      const parsed = TeamJoinSchema.safeParse(data);
      if (!parsed.success) {
        return callback({ ok: false, error: "6-character team code is required." });
      }

      try {
        const code = parsed.data.code;
        const team = await queryOne<{
          id: string;
          name: string;
          code: string;
          total_score: number;
        }>("SELECT id, name, code, total_score FROM team WHERE code = $1", [code]);

        if (!team) {
          return callback({
            ok: false,
            error: "Code not found — check with your organizer.",
          });
        }

        const teamId = team.id;
        let sockets = teamSocketMap.get(teamId);

        if (!sockets) {
          sockets = new Set<string>();
          teamSocketMap.set(teamId, sockets);
        }

        // Remove stale disconnected sockets from the set
        for (const sid of sockets) {
          if (!io.sockets.sockets.has(sid)) {
            sockets.delete(sid);
          }
        }

        // Enforce single-device limit: only 1 active device per team
        if (sockets.size >= MAX_DEVICES_PER_TEAM && !sockets.has(socket.id)) {
          return callback({
            ok: false,
            error: "Another device is already logged in for this team. Only one device per team is allowed.",
          });
        }

        sockets.add(socket.id);
        socketTeamMap.set(socket.id, teamId);

        socket.join(SOCKET_ROOMS.team(teamId));
        socket.join(SOCKET_ROOMS.BROADCAST);

        const session: TeamSession = {
          id: team.id,
          name: team.name,
          code: team.code,
          score: team.total_score,
        };

        callback({ ok: true, session });

        const teamState = await quizEngine.getTeamQuizState(teamId);
        socket.emit("quiz:state", teamState);

        broadcastAdminState();
      } catch (err) {
        console.error("[Socket] Error joining team:", err);
        callback({ ok: false, error: "Internal server error. Please try again." });
      }
    });

    // ----------------------------------------------------
    // Team Submission
    // ----------------------------------------------------
    socket.on("team:submit", async (data, callback) => {
      const teamId = socketTeamMap.get(socket.id);
      if (!teamId) {
        return callback?.({ ok: false, error: "Not authenticated as a team." });
      }

      const parsed = SubmitAnswerSchema.safeParse(data);
      if (!parsed.success) {
        return callback?.({ ok: false, error: "Invalid submission format." });
      }

      try {
        const currentQ = await quizEngine.getCurrentQuestion();
        if (currentQ && parsed.data.selectedOption >= currentQ.options.length) {
          return callback?.({ ok: false, error: "Invalid option selection." });
        }

        const res = await quizEngine.submitAnswer(
          teamId,
          parsed.data.questionIndex,
          parsed.data.selectedOption
        );

        if (res.ok) {
          // Emit quiz:locked to ALL sockets of this team (both devices)
          const teamSockets = teamSocketMap.get(teamId);
          if (teamSockets) {
            for (const sid of teamSockets) {
              io.to(sid).emit("quiz:locked", {
                questionIndex: parsed.data.questionIndex,
                optionIndex: parsed.data.selectedOption,
                isWrong: !!res.isWrong,
              });
              // Sync state to each device
              const teamState = await quizEngine.getTeamQuizState(teamId);
              io.to(sid).emit("quiz:state", teamState);
            }
          }

          callback?.({ ok: true });
        } else {
          callback?.({ ok: false, error: res.error });
        }
      } catch (err) {
        console.error("[Socket] Error submitting answer:", err);
        callback?.({ ok: false, error: "Internal server error." });
      }
    });

    // ----------------------------------------------------
    // Team Sync
    // ----------------------------------------------------
    socket.on("team:sync", async () => {
      const teamId = socketTeamMap.get(socket.id);
      if (teamId) {
        try {
          const teamState = await quizEngine.getTeamQuizState(teamId);
          socket.emit("quiz:state", teamState);
        } catch (err) {
          console.error("[Socket] Error syncing team state:", err);
        }
      }
    });

    // ----------------------------------------------------
    // Admin Controls (Admin Room Protected)
    // ----------------------------------------------------
    socket.on("admin:start", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        const res = await quizEngine.start();
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error starting quiz:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:pause", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        const res = await quizEngine.pause();
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error pausing quiz:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:resume", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        const res = await quizEngine.resume();
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error resuming quiz:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:end", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        const res = await quizEngine.end();
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error ending quiz:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:next_question", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        await quizEngine.manualAdvanceQuestion();
        callback?.({ ok: true });
      } catch (err) {
        console.error("[Socket] Error advancing question:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:prev_question", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        await quizEngine.prevQuestion();
        callback?.({ ok: true });
      } catch (err) {
        console.error("[Socket] Error going to previous question:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:remove_team", async (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const teamId = data.teamId;

      try {
        const teamSockets = teamSocketMap.get(teamId);
        if (teamSockets) {
          for (const sid of teamSockets) {
            const sock = io.sockets.sockets.get(sid);
            sock?.emit("session:inactive", { reason: "Your team was removed by the organizer." });
          }
        }

        await execute("DELETE FROM team WHERE id = $1", [teamId]);
        teamSocketMap.delete(teamId);

        broadcastAdminState();
        callback?.({ ok: true });
      } catch (err) {
        console.error("[Socket] Error removing team:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:override_score", async (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const parsed = AdminScoreOverrideSchema.safeParse(data);
      if (!parsed.success) return callback?.({ ok: false, error: "Invalid override payload." });

      try {
        const res = await quizEngine.overrideScore(parsed.data.teamId, parsed.data.delta, parsed.data.note);
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error overriding score:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:reveal_winners", async (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        await quizEngine.setWinnerRevealed(data.reveal);
        const leaderboard = await quizEngine.getLeaderboard();
        io.to(SOCKET_ROOMS.ADMIN).emit("admin:winner_reveal", {
          revealed: data.reveal,
          winners: leaderboard.slice(0, 3),
        });
        callback?.({ ok: true });
      } catch (err) {
        console.error("[Socket] Error revealing winners:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:reset_quiz", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        const res = await quizEngine.reset();
        if (res.ok) {
          for (const [teamId] of teamSocketMap.entries()) {
            const teamState = await quizEngine.getTeamQuizState(teamId);
            emitToTeam(teamId, "quiz:state", teamState);
          }
          broadcastAdminState();
        }
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error resetting quiz:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    socket.on("admin:reset_quiz_full", async (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      try {
        const res = await quizEngine.hardReset();
        if (res.ok) {
          for (const [teamId, sockets] of teamSocketMap.entries()) {
            for (const sid of sockets) {
              io.to(sid).emit("session:inactive", {
                reason: "Quiz has been fully reset by the organizer.",
              });
            }
          }
          teamSocketMap.clear();
          socketTeamMap.clear();
          broadcastAdminState();
        }
        callback?.(res);
      } catch (err) {
        console.error("[Socket] Error doing full reset:", err);
        callback?.({ ok: false, error: "Internal error" });
      }
    });

    // ----------------------------------------------------
    // Disconnect
    // ----------------------------------------------------
    socket.on("disconnect", () => {
      socketEventCounts.delete(socket.id);

      const teamId = socketTeamMap.get(socket.id);
      if (teamId) {
        socketTeamMap.delete(socket.id);
        const sockets = teamSocketMap.get(teamId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            teamSocketMap.delete(teamId);
          }
        }
        broadcastAdminState();
      }

      if (adminSockets.has(socket.id)) {
        adminSockets.delete(socket.id);
      }
    });
  });
}
