import { Router, type IRouter } from "express";
import { AdminLoginBody, TeamLoginBody } from "../validation";
import {
  findTeamByUsername,
  verifyPassword,
  findTeam,
} from "../quiz/store";
import { requireAuth, signToken, type AuthenticatedRequest } from "../quiz/auth";

const router: IRouter = Router();

router.post("/auth/admin/login", async (req, res) => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your admin username and password." });
    return;
  }
  const configuredUsername = process.env.ADMIN_USERNAME ?? "admin";
  const configuredPassword = process.env.ADMIN_PASSWORD ?? "admin123";
  if (
    parsed.data.username !== configuredUsername ||
    parsed.data.password !== configuredPassword
  ) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }
  const user = {
    id: "admin",
    role: "admin" as const,
    username: configuredUsername,
    teamName: null,
    teamId: null,
  };
  res.json({ token: signToken(user), user });
});

router.post("/auth/team/login", async (req, res) => {
  const parsed = TeamLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your team username and password." });
    return;
  }
  const team = findTeamByUsername(parsed.data.username);
  if (!team || !team.active || !(await verifyPassword(team, parsed.data.password))) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }
  const user = {
    id: team.id,
    role: "team" as const,
    username: team.username,
    teamName: team.teamName,
    teamId: team.id,
  };
  res.json({ token: signToken(user), user });
});

router.get("/auth/me", requireAuth, (req: AuthenticatedRequest, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ error: "Your session has expired." });
    return;
  }
  if (auth.role === "team" && !findTeam(auth.id)?.active) {
    res.status(401).json({ error: "This team is no longer active." });
    return;
  }
  res.json({
    id: auth.id,
    role: auth.role,
    username: auth.username,
    teamName: auth.teamName ?? null,
    teamId: auth.teamId ?? null,
  });
});

export default router;