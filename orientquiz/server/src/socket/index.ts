import { Server, Socket } from "socket.io";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import {
  AdminAuthSchema,
  AdminScoreOverrideSchema,
  ClientToServerEvents,
  ServerToClientEvents,
  SOCKET_ROOMS,
  SubmitAnswerSchema,
  TeamCreateSchema,
  TeamJoinSchema,
  TeamSession,
} from "@orientquiz/shared";
import { db } from "../db/index.js";
import { QuizEngine } from "../quiz/engine.js";

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
  // teamId -> active socketId
  const teamSocketMap = new Map<string, string>();
  // Admin socket IDs
  const adminSockets = new Set<string>();
  // Session tokens issued to authenticated admin sockets with creation timestamps
  // Token TTL is 12 hours. Explicit "admin:lock" immediately invalidates the token server-side.
  const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
  const adminTokens = new Map<string, number>();

  const isSocketAdmin = (socketId: string) => adminSockets.has(socketId);

  const broadcastAdminState = () => {
    const onlineSocketIds = new Set(io.sockets.sockets.keys());
    const adminState = quizEngine.getAdminQuizState(onlineSocketIds, teamSocketMap);
    io.to(SOCKET_ROOMS.ADMIN).emit("admin:state", adminState);
    io.to(SOCKET_ROOMS.ADMIN).emit("admin:roster", adminState.teams);
    io.to(SOCKET_ROOMS.ADMIN).emit("admin:leaderboard", adminState.leaderboard);
  };

  const broadcastTeamStates = () => {
    for (const [teamId, socketId] of teamSocketMap.entries()) {
      const state = quizEngine.getTeamQuizState(teamId);
      io.to(socketId).emit("quiz:state", state);
    }
  };

  // Wire up QuizEngine callbacks
  quizEngine.setCallbacks({
    onStateChange: () => {
      broadcastAdminState();
      broadcastTeamStates();
    },
    onQuestionAdvance: (nextIndex) => {
      const q = quizEngine.getCurrentQuestion();
      if (q) {
        io.to(SOCKET_ROOMS.BROADCAST).emit("quiz:question", q);
      }
    },
  });

  // Periodic timer sync broadcast every 10s
  setInterval(() => {
    const session = quizEngine.getSessionRow();
    if (session.status === "running" && session.question_deadline) {
      const now = Date.now();
      const remainingMs = Math.max(0, session.question_deadline - now);
      io.to(SOCKET_ROOMS.BROADCAST).emit("timer:sync", {
        serverNow: now,
        deadline: session.question_deadline,
        remainingMs,
      });
    }
  }, 10000);

  io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    // ----------------------------------------------------
    // Admin Authentication
    // ----------------------------------------------------
    socket.on("admin:auth", (data, callback) => {
      const parsed = AdminAuthSchema.safeParse(data);
      if (!parsed.success) {
        return callback({ ok: false, error: "Passcode is required." });
      }

      const isValid = bcrypt.compareSync(parsed.data.passcode.trim(), adminPasscodeHash);
      if (isValid) {
        socket.join(SOCKET_ROOMS.ADMIN);
        adminSockets.add(socket.id);

        // Issue a cryptographically secure random session token with timestamp
        const token = crypto.randomUUID();
        adminTokens.set(token, Date.now());

        const onlineSocketIds = new Set(io.sockets.sockets.keys());
        const adminState = quizEngine.getAdminQuizState(onlineSocketIds, teamSocketMap);
        socket.emit("admin:state", adminState);

        return callback({ ok: true, token });
      } else {
        return callback({ ok: false, error: "Incorrect passcode — please try again." });
      }
    });

    // Admin token-based reconnect with TTL check
    socket.on("admin:auth_token", (data, callback) => {
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

      const onlineSocketIds = new Set(io.sockets.sockets.keys());
      const adminState = quizEngine.getAdminQuizState(onlineSocketIds, teamSocketMap);
      socket.emit("admin:state", adminState);

      return callback({ ok: true });
    });

    // Admin explicit lock — revokes token and removes admin privileges server-side
    socket.on("admin:lock", (data, callback) => {
      if (data?.token) {
        adminTokens.delete(data.token);
      }
      adminSockets.delete(socket.id);
      socket.leave(SOCKET_ROOMS.ADMIN);
      callback?.({ ok: true });
    });



    // ----------------------------------------------------
    // Team Creation
    // ----------------------------------------------------
    socket.on("team:create", (data, callback) => {
      const parsed = TeamCreateSchema.safeParse(data);
      if (!parsed.success) {
        return callback({
          ok: false,
          error: parsed.error.issues[0]?.message || "Invalid team name.",
        });
      }

      // FIX #2: Block new team creation once quiz is no longer in waiting state
      const sessionStatus = quizEngine.getStatus();
      if (sessionStatus !== "waiting") {
        return callback({
          ok: false,
          error: "The quiz has already started. New teams cannot be created at this time.",
        });
      }

      const teamName = parsed.data.name;
      const nameLower = teamName.toLowerCase();

      // Check uniqueness
      const existing = db.prepare("SELECT * FROM team WHERE name_lower = ?").get(nameLower);
      if (existing) {
        return callback({
          ok: false,
          error: `Team "${teamName}" already exists — try a different name.`,
        });
      }

      // Generate unique 6-char code
      let code = generateTeamCode();
      while (db.prepare("SELECT * FROM team WHERE code = ?").get(code)) {
        code = generateTeamCode();
      }

      const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.prepare(`
        INSERT INTO team (id, name, name_lower, code, total_score, created_at)
        VALUES (?, ?, ?, ?, 0, ?)
      `).run(teamId, teamName, nameLower, code, new Date().toISOString());

      // Bind socket
      socketTeamMap.set(socket.id, teamId);
      teamSocketMap.set(teamId, socket.id);

      socket.join(SOCKET_ROOMS.team(teamId));
      socket.join(SOCKET_ROOMS.BROADCAST);

      const session: TeamSession = {
        id: teamId,
        name: teamName,
        code,
        score: 0,
      };

      callback({ ok: true, session });

      // Send initial quiz state to this team
      const teamState = quizEngine.getTeamQuizState(teamId);
      socket.emit("quiz:state", teamState);

      // Notify admin
      broadcastAdminState();
    });

    // ----------------------------------------------------
    // Team Join / Reconnect / Takeover
    // ----------------------------------------------------
    socket.on("team:join", (data, callback) => {
      const parsed = TeamJoinSchema.safeParse(data);
      if (!parsed.success) {
        return callback({ ok: false, error: "6-character team code is required." });
      }

      const code = parsed.data.code;
      const team = db.prepare("SELECT * FROM team WHERE code = ?").get(code) as any;

      if (!team) {
        return callback({
          ok: false,
          error: "Code not found — check with your organizer.",
        });
      }

      const teamId = team.id;
      const oldSocketId = teamSocketMap.get(teamId);

      // Device Hard-Takeover
      if (oldSocketId && oldSocketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) {
          oldSocket.emit("session:inactive", {
            reason: "Session moved to another device with this team code.",
          });
          oldSocket.leave(SOCKET_ROOMS.team(teamId));
        }
      }

      socketTeamMap.set(socket.id, teamId);
      teamSocketMap.set(teamId, socket.id);

      socket.join(SOCKET_ROOMS.team(teamId));
      socket.join(SOCKET_ROOMS.BROADCAST);

      const session: TeamSession = {
        id: team.id,
        name: team.name,
        code: team.code,
        score: team.total_score,
      };

      callback({ ok: true, session });

      // Send current state
      const teamState = quizEngine.getTeamQuizState(teamId);
      socket.emit("quiz:state", teamState);

      broadcastAdminState();
    });

    // ----------------------------------------------------
    // Team Submission
    // ----------------------------------------------------
    socket.on("team:submit", (data, callback) => {
      const teamId = socketTeamMap.get(socket.id);
      if (!teamId) {
        return callback?.({ ok: false, error: "Not authenticated as a team." });
      }

      const parsed = SubmitAnswerSchema.safeParse(data);
      if (!parsed.success) {
        return callback?.({ ok: false, error: "Invalid submission format." });
      }

      // FIX #4: Bounds-check selectedOption against the actual question options
      const currentQ = quizEngine.getCurrentQuestion();
      if (currentQ && parsed.data.selectedOption >= currentQ.options.length) {
        return callback?.({ ok: false, error: "Invalid option selection." });
      }

      const res = quizEngine.submitAnswer(
        teamId,
        parsed.data.questionIndex,
        parsed.data.selectedOption
      );

      if (res.ok) {
        socket.emit("quiz:locked", {
          questionIndex: parsed.data.questionIndex,
          optionIndex: parsed.data.selectedOption,
          isWrong: !!res.isWrong,
        });

        // Sync team state
        const teamState = quizEngine.getTeamQuizState(teamId);
        socket.emit("quiz:state", teamState);

        callback?.({ ok: true });
      } else {
        callback?.({ ok: false, error: res.error });
      }
    });

    // ----------------------------------------------------
    // Team Sync
    // ----------------------------------------------------
    socket.on("team:sync", () => {
      const teamId = socketTeamMap.get(socket.id);
      if (teamId) {
        const teamState = quizEngine.getTeamQuizState(teamId);
        socket.emit("quiz:state", teamState);
      }
    });

    // ----------------------------------------------------
    // Admin Controls (Admin Room Protected)
    // ----------------------------------------------------
    socket.on("admin:start", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const res = quizEngine.start();
      callback?.(res);
    });

    socket.on("admin:pause", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const res = quizEngine.pause();
      callback?.(res);
    });

    socket.on("admin:resume", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const res = quizEngine.resume();
      callback?.(res);
    });

    socket.on("admin:end", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const res = quizEngine.end();
      callback?.(res);
    });

    socket.on("admin:next_question", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      quizEngine.advanceQuestion();
      callback?.({ ok: true });
    });

    socket.on("admin:remove_team", (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const teamId = data.teamId;

      const activeSock = teamSocketMap.get(teamId);
      if (activeSock) {
        const sock = io.sockets.sockets.get(activeSock);
        sock?.emit("session:inactive", { reason: "Your team was removed by the organizer." });
      }

      db.prepare("DELETE FROM team WHERE id = ?").run(teamId);
      teamSocketMap.delete(teamId);

      broadcastAdminState();
      callback?.({ ok: true });
    });

    socket.on("admin:override_score", (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const parsed = AdminScoreOverrideSchema.safeParse(data);
      if (!parsed.success) return callback?.({ ok: false, error: "Invalid override payload." });

      const res = quizEngine.overrideScore(parsed.data.teamId, parsed.data.delta, parsed.data.note);
      callback?.(res);
    });

    socket.on("admin:reveal_winners", (data, callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      quizEngine.setWinnerRevealed(data.reveal);
      io.to(SOCKET_ROOMS.ADMIN).emit("admin:winner_reveal", {
        revealed: data.reveal,
        winners: quizEngine.getLeaderboard().slice(0, 3),
      });
      callback?.({ ok: true });
    });

    socket.on("admin:reset_quiz", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const res = quizEngine.reset();
      if (res.ok) {
        // Push WAITING state to all connected team sockets so they immediately go back to lobby
        for (const [teamId, socketId] of teamSocketMap.entries()) {
          const teamState = quizEngine.getTeamQuizState(teamId);
          io.to(socketId).emit("quiz:state", teamState);
        }
        broadcastAdminState();
      }
      callback?.(res);
    });

    socket.on("admin:reset_quiz_full", (callback) => {
      if (!isSocketAdmin(socket.id)) return callback?.({ ok: false, error: "Unauthorized" });
      const res = quizEngine.hardReset();
      if (res.ok) {
        // All teams wiped — eject all active team sockets to landing
        for (const [teamId, socketId] of teamSocketMap.entries()) {
          io.to(socketId).emit("session:inactive", { reason: "Quiz has been fully reset by the organizer." });
        }
        teamSocketMap.clear();
        for (const [socketId, teamId] of socketTeamMap.entries()) {
          socketTeamMap.delete(socketId);
        }
        broadcastAdminState();
      }
      callback?.(res);
    });


    // ----------------------------------------------------
    // Disconnect
    // ----------------------------------------------------
    socket.on("disconnect", () => {
      const teamId = socketTeamMap.get(socket.id);
      if (teamId) {
        socketTeamMap.delete(socket.id);
        if (teamSocketMap.get(teamId) === socket.id) {
          teamSocketMap.delete(teamId);
        }
        broadcastAdminState();
      }

      if (adminSockets.has(socket.id)) {
        adminSockets.delete(socket.id);
      }
    });
  });
}
