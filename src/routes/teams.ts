import { Router, type IRouter } from "express";
import { CreateTeamBody, UpdateTeamBody, UpdateTeamParams, DeactivateTeamParams } from "../validation";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../quiz/auth";
import { createTeam, deactivateTeam, listTeams, updateTeam } from "../quiz/store";

const router: IRouter = Router();
router.use("/teams", requireAuth, requireRole("admin"));

router.get("/teams", async (_req, res) => {
  res.json(await listTeams());
});

router.post("/teams", async (req, res) => {
  const parsed = CreateTeamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Team name, username, and a password of at least four characters are required." });
    return;
  }
  try {
    const team = await createTeam(parsed.data);
    res.status(201).json({
      id: team.id,
      teamName: team.teamName,
      username: team.username,
      active: team.active,
      score: team.score,
      online: false,
      answered: false,
      createdAt: team.createdAt.toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create team." });
  }
});

router.put("/teams/:teamId", async (req, res) => {
  const params = UpdateTeamParams.safeParse(req.params);
  const body = UpdateTeamBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid team details." });
    return;
  }
  try {
    const team = await updateTeam(params.data.teamId, body.data);
    res.json({
      id: team.id,
      teamName: team.teamName,
      username: team.username,
      active: team.active,
      score: team.score,
      online: false,
      answered: false,
      createdAt: team.createdAt.toISOString(),
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update team." });
  }
});

router.delete("/teams/:teamId", async (req, res) => {
  const params = DeactivateTeamParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid team." });
    return;
  }
  try {
    await deactivateTeam(params.data.teamId);
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Team not found." });
  }
});

export default router;