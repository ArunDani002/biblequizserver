import { Router, type IRouter } from "express";
import {
  SubmitAnswerBody,
} from "../validation";
import {
  closeAnswers,
  finishQuiz,
  listQuestionAdmin,
  nextQuestion,
  revealAnswer,
  resetQuiz,
  serializeState,
  showLeaderboard,
  startQuiz,
  submitAnswer,
} from "../quiz/store";
import { requireAuth, requireRole, type AuthenticatedRequest } from "../quiz/auth";
import {
  broadcastQuizState,
  emitAnswerRevealed,
  emitAnswersClosed,
  emitLeaderboardShown,
  emitQuestionChanged,
  emitQuizFinished,
  emitQuizStarted,
  emitTeamAnswered,
} from "../quiz/realtime";

const router: IRouter = Router();

router.get("/questions", requireAuth, requireRole("admin"), async (_req, res) => {
  res.json(await listQuestionAdmin());
});

router.get("/quiz/current", requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.auth?.role === "admin") {
    res.json(serializeState("admin"));
  } else {
    res.json(serializeState("team", req.auth?.teamId ?? undefined));
  }
});

router.post("/quiz/start", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await startQuiz(broadcastQuizState);
    emitQuizStarted();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to start quiz." });
  }
});

router.post("/quiz/close", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await closeAnswers();
    emitAnswersClosed();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to close answers." });
  }
});

router.post("/quiz/reveal", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await revealAnswer();
    emitAnswerRevealed();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reveal the answer." });
  }
});

router.post("/quiz/leaderboard", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await showLeaderboard();
    emitLeaderboardShown();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to show the leaderboard." });
  }
});

router.post("/quiz/next", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await nextQuestion(broadcastQuizState);
    emitQuestionChanged();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to move to the next question." });
  }
});

router.post("/quiz/finish", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await finishQuiz();
    emitQuizFinished();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to finish the quiz." });
  }
});

router.post("/quiz/reset", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    await resetQuiz();
    broadcastQuizState();
    res.json(serializeState("admin"));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to reset the quiz." });
  }
});

router.post("/quiz/answer", requireAuth, requireRole("team"), async (req: AuthenticatedRequest, res) => {
  const parsed = SubmitAnswerBody.safeParse(req.body);
  if (!parsed.success || !req.auth?.teamId) {
    res.status(400).json({ error: "Choose one of the available answers." });
    return;
  }
  try {
    const result = await submitAnswer(
      req.auth.teamId,
      parsed.data.questionId,
      parsed.data.selectedAnswer,
    );
    emitTeamAnswered(req.auth.teamId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Unable to submit answer." });
  }
});

export default router;