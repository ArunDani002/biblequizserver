import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyToken } from "./auth";
import {
  closeAnswersIfExpired,
  getOnlineTeams,
  serializeState,
  setTeamOnline,
} from "./store";
import { logger } from "../lib/logger";

let io: Server | undefined;
let broadcastStateChange: (() => void) | undefined;

export function setupRealtime(server: HttpServer) {
  io = new Server(server, {
    path: "/socket.io",
    cors: {
      origin: process.env.CLIENT_URL?.split(",").map((origin) => origin.trim()) ?? true,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token
      : undefined;
    if (!token) {
      next(new Error("Authentication required"));
      return;
    }
    try {
      socket.data.auth = verifyToken(token);
      next();
    } catch {
      next(new Error("Invalid session"));
    }
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth as { role: "admin" | "team"; id: string };
    if (auth.role === "team") {
      setTeamOnline(auth.id, true);
      socket.join(`team:${auth.id}`);
      socket.emit("quiz_state", serializeState("team", auth.id));
      io?.to("admins").emit("team_status_changed", { teamId: auth.id, online: true });
    } else {
      socket.join("admins");
      socket.emit("quiz_state", serializeState("admin"));
    }

    socket.on("disconnect", () => {
      if (auth.role === "team") {
        setTeamOnline(auth.id, false);
        io?.to("admins").emit("team_status_changed", { teamId: auth.id, online: false });
      }
    });
  });

  broadcastStateChange = () => {
    void closeAnswersIfExpired();
    io?.to("admins").emit("quiz_state", serializeState("admin"));
    for (const teamId of getOnlineTeams()) {
      io?.to(`team:${teamId}`).emit("quiz_state", serializeState("team", teamId));
    }
  };

  return io;
}

export function broadcastQuizState() {
  broadcastStateChange?.();
}

export function emitTeamAnswered(teamId: string) {
  io?.to("admins").emit("team_answered", { teamId });
  broadcastStateChange?.();
}

export function emitAnswersClosed() {
  io?.emit("answers_closed");
  broadcastStateChange?.();
}

export function emitAnswerRevealed() {
  io?.emit("answer_revealed");
  broadcastStateChange?.();
}

export function emitLeaderboardShown() {
  io?.emit("leaderboard_shown");
  broadcastStateChange?.();
}

export function emitQuizStarted() {
  io?.emit("quiz_started");
  broadcastStateChange?.();
}

export function emitQuestionChanged() {
  io?.emit("question_changed");
  broadcastStateChange?.();
}

export function emitQuizFinished() {
  io?.emit("quiz_finished");
  broadcastStateChange?.();
}

export function reportRealtimeError(error: unknown) {
  logger.error({ err: error }, "Socket.IO error");
}