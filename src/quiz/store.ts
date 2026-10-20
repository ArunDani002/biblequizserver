import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { logger } from "../lib/logger";
import {
  QuestionModel,
  QuizSessionModel,
  TeamAnswerModel,
  TeamModel,
} from "./models";
import { questions as seedQuestionBank, type SeedQuestion } from "./questions";

export type QuizStatus =
  | "WAITING"
  | "QUESTION_LIVE"
  | "ANSWERS_CLOSED"
  | "ANSWER_REVEALED"
  | "LEADERBOARD"
  | "FINISHED";
export type QuestionStatus = "WAITING" | "ACCEPTING" | "CLOSED" | "REVEALED";

type TeamRecord = {
  id: string;
  teamName: string;
  username: string;
  password: string;
  active: boolean;
  score: number;
  createdAt: Date;
};

type QuestionRecord = SeedQuestion & { id: string };
type AnswerRecord = {
  teamId: string;
  questionId: string;
  selectedAnswer: string;
  isCorrect: boolean;
  pointsAwarded: number;
  answeredAt: Date;
};

const configuredTime = Number(process.env.QUESTION_TIME_SECONDS ?? 30);
export const questionTimeSeconds =
  Number.isFinite(configuredTime) && configuredTime > 0 ? configuredTime : 30;

let mongoReady = false;
let timer: NodeJS.Timeout | undefined;
let teams: TeamRecord[] = [];
let quizQuestions: QuestionRecord[] = [];
let answers: AnswerRecord[] = [];
let onlineTeams = new Set<string>();
let state = {
  id: "",
  name: "1 Timothy Youth Quiz",
  status: "WAITING" as QuizStatus,
  questionStatus: "WAITING" as QuestionStatus,
  currentQuestionIndex: -1,
  questionStartedAt: null as Date | null,
  answerDeadline: null as Date | null,
};

function objectId() {
  return new mongoose.Types.ObjectId().toString();
}

function publicQuestion(question: QuestionRecord | undefined) {
  if (!question) return null;
  return {
    id: question.id,
    questionNumber: question.questionNumber,
    chapter: question.chapter,
    question: question.question,
    options: question.options,
    points: question.points,
  };
}

function adminQuestion(question: QuestionRecord | undefined) {
  if (!question) return null;
  return { ...publicQuestion(question), correctAnswer: question.correctAnswer };
}

function currentQuestion() {
  return quizQuestions[state.currentQuestionIndex];
}

function leaderboard() {
  return [...teams]
    .filter((team) => team.active)
    .sort((a, b) => b.score - a.score || a.teamName.localeCompare(b.teamName))
    .map((team, index) => ({
      teamId: team.id,
      teamName: team.teamName,
      score: team.score,
      rank: index + 1,
    }));
}

function answerFor(teamId: string) {
  return answers.find(
    (answer) =>
      answer.teamId === teamId &&
      answer.questionId === quizQuestions[state.currentQuestionIndex]?.id,
  );
}

export function serializeState(role: "admin" | "team", teamId?: string) {
  const question = currentQuestion();
  const ownAnswer = teamId ? answerFor(teamId) : undefined;
  return {
    id: state.id,
    name: state.name,
    status: state.status,
    questionStatus: state.questionStatus,
    currentQuestionIndex: Math.max(state.currentQuestionIndex, 0),
    totalQuestions: quizQuestions.length,
    currentQuestion:
      role === "admin" ? adminQuestion(question) : publicQuestion(question),
    questionStartedAt: state.questionStartedAt?.toISOString() ?? null,
    answerDeadline: state.answerDeadline?.toISOString() ?? null,
    correctAnswer:
      role === "admin" || state.status === "ANSWER_REVEALED"
        ? question?.correctAnswer ?? null
        : null,
    teams:
      role === "admin"
        ? teams.filter((team) => team.active).map((team) => {
          const answer = answerFor(team.id);
          return {
            teamId: team.id,
            teamName: team.teamName,
            answered: Boolean(answer),
            selectedAnswer: answer?.selectedAnswer ?? null,
            isCorrect: answer?.isCorrect ?? null,
            pointsAwarded: answer?.pointsAwarded ?? 0,
            online: onlineTeams.has(team.id),
            score: team.score,
          };
        })
        : ownAnswer && teamId
          ? [
            {
              teamId,
              teamName: teams.find((team) => team.id === teamId)?.teamName ?? "",
              answered: true,
              selectedAnswer:
                state.status === "ANSWER_REVEALED"
                  ? ownAnswer.selectedAnswer
                  : null,
              isCorrect:
                state.status === "ANSWER_REVEALED" ? ownAnswer.isCorrect : null,
              pointsAwarded:
                state.status === "ANSWER_REVEALED"
                  ? ownAnswer.pointsAwarded
                  : 0,
              online: onlineTeams.has(teamId),
              score: teams.find((team) => team.id === teamId)?.score ?? 0,
            },
          ]
          : [],
    leaderboard: state.status === "LEADERBOARD" || state.status === "FINISHED"
      ? leaderboard()
      : [],
  };
}

export function findTeam(id: string) {
  return teams.find((team) => team.id === id);
}

export function findTeamByUsername(username: string) {
  return teams.find(
    (team) => team.username.toLowerCase() === username.toLowerCase(),
  );
}

async function persistSession() {
  if (!mongoReady) return;
  await QuizSessionModel.findByIdAndUpdate(
    state.id,
    {
      name: state.name,
      status: state.status,
      currentQuestionIndex: state.currentQuestionIndex,
      currentQuestionId: currentQuestion()?.id ?? null,
      questionStatus: state.questionStatus,
      questionStartedAt: state.questionStartedAt,
      answerDeadline: state.answerDeadline,
    },
    { upsert: true },
  );
}

async function persistTeam(team: TeamRecord) {
  if (!mongoReady) return;
  await TeamModel.findByIdAndUpdate(
    team.id,
    {
      teamName: team.teamName,
      username: team.username,
      password: team.password,
      active: team.active,
      score: team.score,
    },
    { upsert: true },
  );
}

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export async function closeAnswersIfExpired() {
  if (
    state.status === "QUESTION_LIVE" &&
    state.answerDeadline &&
    state.answerDeadline.getTime() <= Date.now()
  ) {
    state.status = "ANSWERS_CLOSED";
    state.questionStatus = "CLOSED";
    await persistSession();
    return true;
  }
  return false;
}

function armTimer(onChange?: () => void) {
  clearTimer();
  if (!state.answerDeadline) return;
  timer = setTimeout(async () => {
    if (await closeAnswersIfExpired()) onChange?.();
  }, Math.max(0, state.answerDeadline.getTime() - Date.now()));
}

export async function connectStore() {
  if (!process.env.MONGODB_URI) {
    logger.error(
      "MONGODB_URI is missing. Add it to .env for persistent storage. Running in temporary demo memory until it is provided.",
    );
    await seedMemory();
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    mongoReady = true;
    const storedTeams = await TeamModel.find().lean();
    teams = storedTeams.map((team: any) => ({
      id: String(team._id),
      teamName: team.teamName,
      username: team.username,
      password: team.password,
      active: team.active,
      score: team.score,
      createdAt: team.createdAt ?? new Date(),
    }));
    const storedQuestions = await QuestionModel.find()
      .sort({ questionNumber: 1 })
      .lean();
    quizQuestions = storedQuestions.map((question: any) => ({
      id: String(question._id),
      questionNumber: question.questionNumber,
      chapter: question.chapter,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      points: question.points,
      reference: question.reference,
    }));
    const session = await QuizSessionModel.findOne()
      .sort({ updatedAt: -1 })
      .lean();

    if (session) {
      state = {
        id: String(session._id),
        name: session.name,
        status: session.status,
        questionStatus: session.questionStatus,
        currentQuestionIndex: session.currentQuestionIndex,
        questionStartedAt: session.questionStartedAt,
        answerDeadline: session.answerDeadline,
      };
    } else {
      // Create a real MongoDB session before querying answers.
      const newSession = await QuizSessionModel.create({
        name: "1 Timothy Youth Quiz",
        status: "WAITING",
        questionStatus: "WAITING",
        currentQuestionIndex: -1,
        currentQuestionId: null,
        questionStartedAt: null,
        answerDeadline: null,
      });

      state = {
        id: String(newSession._id),
        name: newSession.name,
        status: newSession.status,
        questionStatus: newSession.questionStatus,
        currentQuestionIndex: newSession.currentQuestionIndex,
        questionStartedAt: newSession.questionStartedAt,
        answerDeadline: newSession.answerDeadline,
      };
    }

    const storedAnswers = await TeamAnswerModel.find({
      quizSessionId: new mongoose.Types.ObjectId(state.id),
    }).lean();

    answers = storedAnswers.map((answer: any) => ({
      teamId: String(answer.teamId),
      questionId: String(answer.questionId),
      selectedAnswer: answer.selectedAnswer,
      isCorrect: answer.isCorrect,
      pointsAwarded: answer.pointsAwarded,
      answeredAt: answer.answeredAt ?? new Date(),
    }));
    if (!quizQuestions.length) await seedQuestions();
    if (!state.id || state.id === "local-quiz-session") {
      state.id = objectId();
      await persistSession();
    }
    logger.info(
      { teams: teams.length, questions: quizQuestions.length },
      "Quiz store connected to MongoDB",
    );
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection failed; using temporary demo memory");
    mongoReady = false;
    await seedMemory();
  }
}

async function seedMemory() {
  if (!quizQuestions.length) {
    quizQuestions = seedQuestionBank.map((question) => ({
      ...question,
      id: objectId(),
    }));
  }
  if (!teams.length) {
    teams = [
      { id: objectId(), teamName: "Team David", username: "David", password: await bcrypt.hash("1234", 10), active: true, score: 0, createdAt: new Date() },
      { id: objectId(), teamName: "Team Joseph", username: "Joseph", password: await bcrypt.hash("1234", 10), active: true, score: 0, createdAt: new Date() },
      { id: objectId(), teamName: "Team Daniel", username: "Daniel", password: await bcrypt.hash("1234", 10), active: true, score: 0, createdAt: new Date() },
      { id: objectId(), teamName: "Team Abraham", username: "Abram", password: await bcrypt.hash("123", 10), active: true, score: 0, createdAt: new Date() },

    ];
  }
}

async function seedQuestions() {
  if (mongoReady) {
    const created = await QuestionModel.insertMany(seedQuestionBank);
    quizQuestions = created.map((question: any) => ({
      id: String(question._id),
      questionNumber: question.questionNumber,
      chapter: question.chapter,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      points: question.points,
      reference: question.reference,
    }));
  } else {
    quizQuestions = seedQuestionBank.map((question) => ({
      ...question,
      id: objectId(),
    }));
  }
}

export async function listTeams() {
  return teams.filter((team) => team.active).map((team) => ({
    id: team.id,
    teamName: team.teamName,
    username: team.username,
    active: team.active,
    score: team.score,
    online: onlineTeams.has(team.id),
    answered: Boolean(answerFor(team.id)),
    createdAt: team.createdAt.toISOString(),
  }));
}

export async function createTeam(input: {
  teamName: string;
  username: string;
  password: string;
  active?: boolean;
}) {
  if (teams.length >= 4) throw new Error("The MVP supports four active teams.");
  if (findTeamByUsername(input.username)) throw new Error("Username is already in use.");
  const team: TeamRecord = {
    id: objectId(),
    teamName: input.teamName,
    username: input.username,
    password: await bcrypt.hash(input.password, 10),
    active: input.active ?? true,
    score: 0,
    createdAt: new Date(),
  };
  teams.push(team);
  await persistTeam(team);
  return team;
}

export async function updateTeam(id: string, input: Partial<{
  teamName: string;
  username: string;
  password: string | null;
  active: boolean;
}>) {
  const team = findTeam(id);
  if (!team) throw new Error("Team not found.");
  if (input.teamName) team.teamName = input.teamName;
  if (input.username) team.username = input.username;
  if (input.password) team.password = await bcrypt.hash(input.password, 10);
  if (typeof input.active === "boolean") team.active = input.active;
  await persistTeam(team);
  return team;
}

export async function deactivateTeam(id: string) {
  const team = findTeam(id);
  if (!team) throw new Error("Team not found.");
  team.active = false;
  await persistTeam(team);
}

export async function verifyPassword(team: TeamRecord, password: string) {
  return bcrypt.compare(password, team.password);
}

export function setTeamOnline(teamId: string, online: boolean) {
  if (online) onlineTeams.add(teamId);
  else onlineTeams.delete(teamId);
}

export function getOnlineTeams() {
  return onlineTeams;
}

export async function startQuiz(onChange?: () => void) {
  if (!quizQuestions.length) throw new Error("No quiz questions are loaded.");
  if (state.status !== "WAITING" && state.status !== "FINISHED") {
    throw new Error("A quiz is already in progress.");
  }
  teams.forEach((team) => { team.score = 0; });
  answers = [];
  state.currentQuestionIndex = 0;
  state.status = "QUESTION_LIVE";
  state.questionStatus = "ACCEPTING";
  state.questionStartedAt = new Date();
  state.answerDeadline = new Date(Date.now() + questionTimeSeconds * 1000);
  await Promise.all(teams.map(persistTeam));
  await persistSession();
  armTimer(onChange);
}

export async function closeAnswers() {
  if (state.status !== "QUESTION_LIVE") throw new Error("Answers are not currently open.");
  state.status = "ANSWERS_CLOSED";
  state.questionStatus = "CLOSED";
  await persistSession();
  clearTimer();
}

export async function revealAnswer() {
  if (state.status !== "ANSWERS_CLOSED") throw new Error("Close answers before revealing.");
  state.status = "ANSWER_REVEALED";
  state.questionStatus = "REVEALED";
  await persistSession();
}

export async function showLeaderboard() {
  if (state.status !== "ANSWER_REVEALED") throw new Error("Reveal the answer before showing the leaderboard.");
  state.status = "LEADERBOARD";
  await persistSession();
}

export async function nextQuestion(onChange?: () => void) {
  if (state.status !== "LEADERBOARD" && state.status !== "ANSWER_REVEALED") {
    throw new Error("Show the leaderboard before moving to the next question.");
  }
  const nextIndex = state.currentQuestionIndex + 1;
  if (nextIndex >= quizQuestions.length) {
    state.status = "FINISHED";
    state.questionStatus = "REVEALED";
    state.answerDeadline = null;
    await persistSession();
    return;
  }
  answers = answers.filter((answer) => answer.questionId !== quizQuestions[state.currentQuestionIndex]?.id);
  state.currentQuestionIndex = nextIndex;
  state.status = "QUESTION_LIVE";
  state.questionStatus = "ACCEPTING";
  state.questionStartedAt = new Date();
  state.answerDeadline = new Date(Date.now() + questionTimeSeconds * 1000);
  await persistSession();
  armTimer(onChange);
}

export async function finishQuiz() {
  if (!["LEADERBOARD", "ANSWER_REVEALED", "QUESTION_LIVE", "ANSWERS_CLOSED"].includes(state.status)) {
    throw new Error("The quiz has not started.");
  }
  state.status = "FINISHED";
  state.questionStatus = "REVEALED";
  state.answerDeadline = null;
  await persistSession();
  clearTimer();
}

export async function resetQuiz() {
  clearTimer();
  answers = [];
  teams.forEach((team) => { team.score = 0; });
  state.currentQuestionIndex = -1;
  state.status = "WAITING";
  state.questionStatus = "WAITING";
  state.questionStartedAt = null;
  state.answerDeadline = null;
  await Promise.all(teams.map(persistTeam));
  if (mongoReady) {
    await TeamAnswerModel.deleteMany({ quizSessionId: state.id });
  }
  await persistSession();
}

export async function submitAnswer(teamId: string, questionId: string, selectedAnswer: string) {
  await closeAnswersIfExpired();
  const team = findTeam(teamId);
  const question = currentQuestion();
  if (!team || !team.active) throw new Error("Team is not active.");
  if (state.status !== "QUESTION_LIVE" || state.questionStatus !== "ACCEPTING") {
    throw new Error(state.answerDeadline && state.answerDeadline.getTime() <= Date.now() ? "Time is up." : "Answers are currently closed.");
  }
  if (!question || question.id !== questionId) throw new Error("That question is no longer active.");
  if (answerFor(teamId)) throw new Error("You have already submitted your answer.");
  const isCorrect = selectedAnswer === question.correctAnswer;
  const pointsAwarded = isCorrect ? question.points : 0;
  const answer: AnswerRecord = {
    teamId,
    questionId,
    selectedAnswer,
    isCorrect,
    pointsAwarded,
    answeredAt: new Date(),
  };
  answers.push(answer);
  team.score += pointsAwarded;
  await persistTeam(team);
  if (mongoReady) {
    await TeamAnswerModel.create({
      quizSessionId: state.id,
      teamId,
      questionId,
      selectedAnswer,
      isCorrect,
      pointsAwarded,
      answeredAt: answer.answeredAt,
    });
  }
  return { accepted: true, answeredAt: answer.answeredAt.toISOString(), score: team.score };
}

export async function listQuestionAdmin() {
  return quizQuestions.map((question) => adminQuestion(question));
}

export function getState() {
  return state;
}
