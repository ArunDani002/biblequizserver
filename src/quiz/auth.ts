import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export type AuthPayload = {
  id: string;
  role: "admin" | "team";
  username: string;
  teamName?: string | null;
  teamId?: string | null;
};

const jwtSecret =
  process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "temporary-development-secret";

export function signToken(payload: AuthPayload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: "12h" });
}

export function verifyToken(token: string) {
  return jwt.verify(token, jwtSecret) as AuthPayload;
}

export type AuthenticatedRequest = Request & { auth?: AuthPayload };

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Your session has expired." });
    return;
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Your session has expired." });
  }
}

export function requireRole(role: "admin" | "team") {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.auth?.role !== role) {
      res.status(403).json({ error: "You do not have permission for this action." });
      return;
    }
    next();
  };
}