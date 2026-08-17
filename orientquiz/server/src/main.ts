import dotenv from "dotenv";
import http from "node:http";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import { ClientToServerEvents, ServerToClientEvents } from "@orientquiz/shared";
import { QuizEngine } from "./quiz/engine.js";
import { setupSocketHandlers } from "./socket/index.js";

// Load .env
dotenv.config();

const port = Number(process.env.PORT) || 3001;
const rawPasscode = process.env.ADMIN_PASSCODE;
const corsOrigin = process.env.CORS_ORIGIN || "*";

if (!rawPasscode) {
  console.error("❌ [Server] FATAL: ADMIN_PASSCODE environment variable is not set!");
  console.error("Please provide ADMIN_PASSCODE in .env or environment.");
  process.exit(1);
}

// Hash passcode with bcrypt (salted + key-stretched, 10 rounds) at startup
const adminPasscodeHash = bcrypt.hashSync(rawPasscode.trim(), 10);
console.log("[Server] Admin passcode hashed with bcrypt and verified.");

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// HTTP rate limiting — 300 req/min per IP for general endpoints
const httpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});
app.use(httpLimiter);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "orientquiz-server",
    timestamp: new Date().toISOString(),
  });
});

const server = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
  // Tuned for 300-400 concurrent connections
  pingInterval: 25000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6, // 1MB max message size
  transports: ["websocket", "polling"],
  // Allow connection upgrade from polling to websocket
  allowUpgrades: true,
  // Compression for large payloads
  perMessageDeflate: {
    threshold: 1024,
  },
});

// Initialize Quiz Engine and Socket Handlers
const quizEngine = new QuizEngine();
setupSocketHandlers(io, quizEngine, adminPasscodeHash);

server.listen(port, () => {
  console.log(`🚀 [OrientQuiz Server] Running on http://localhost:${port}`);
  console.log(`📊 Current Quiz Status: ${quizEngine.getStatus().toUpperCase()}`);
  console.log(`🔒 Rate limiting: 300 req/min per IP | 20 socket events/sec per socket`);
});


