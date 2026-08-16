import { io, Socket } from "socket.io-client";
import { ClientToServerEvents, ServerToClientEvents } from "@orientquiz/shared";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || (
  window.location.hostname === "localhost" ? "http://localhost:3001" : window.location.origin
);

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
});
