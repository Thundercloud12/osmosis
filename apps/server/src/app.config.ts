import { defineRoom, defineServer, matchMaker } from "colyseus";
import express, { type NextFunction, type Request, type Response } from "express";
import { AccessToken } from "livekit-server-sdk";

import { activeArenaRooms, ArenaRoom } from "./rooms/ArenaRoom";

const allowedOrigins = new Set(
  (process.env.CLIENT_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

matchMaker.controller.getCorsHeaders = (headers) => {
  const origin = headers.get("origin");
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
};

export const server = defineServer({
  rooms: {
    arena: defineRoom(ArenaRoom),
  },
  express: (app) => {
    app.use(express.json({ limit: "4kb" }));
    app.use((request: Request, response: Response, next: NextFunction) => {
      const origin = request.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      }

      if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
    });
    app.get("/health", (_request: Request, response: Response) => {
      response.json({ status: "ok", voiceConfigured: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) });
    });
    app.post("/voice/token", async (request: Request, response: Response) => {
      const body = request.body as { roomCode?: unknown; credential?: unknown } | undefined;
      const validBody = Boolean(body && typeof body.roomCode === "string" && /^[A-Z2-9]{6}$/i.test(body.roomCode)
        && typeof body.credential === "string" && body.credential.length >= 20 && body.credential.length <= 2_048);
      if (!validBody) { response.status(400).json({ error: "Invalid voice request." }); return; }
      if (!body || typeof body.roomCode !== "string" || typeof body.credential !== "string") return;
      const room = activeArenaRooms.get(body.roomCode.toUpperCase());
      const identity = room?.authorizeVoiceCredential(body.credential);
      if (!room || !identity) { response.status(403).json({ error: "Voice access could not be authorized for this player." }); return; }
      const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
      if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        response.status(503).json({ error: "Team voice is not configured on this server yet." }); return;
      }
      try {
        const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
          identity: identity.playerId,
          name: identity.nickname,
          ttl: "10m",
        });
        token.addGrant({ roomJoin: true, room: identity.roomName, canPublish: true, canSubscribe: true, canPublishData: false });
        response.json({ serverUrl: LIVEKIT_URL, token: await token.toJwt(), roomName: identity.roomName });
      } catch {
        response.status(503).json({ error: "Team voice is temporarily unavailable." });
      }
    });
  },
});
