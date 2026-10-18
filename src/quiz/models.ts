import mongoose, { Schema } from "mongoose";

const teamSchema = new Schema(
  {
    teamName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    active: { type: Boolean, default: true },
    score: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const questionSchema = new Schema(
  {
    questionNumber: { type: Number, required: true, unique: true },
    chapter: { type: Number, required: true },
    question: { type: String, required: true },
    options: { type: [String], required: true },
    correctAnswer: { type: String, required: true },
    points: { type: Number, default: 10 },
  },
  { timestamps: true },
);

const quizSessionSchema = new Schema(
  {
    name: { type: String, default: "1 Timothy Youth Quiz" },
    status: { type: String, default: "WAITING" },
    currentQuestionIndex: { type: Number, default: -1 },
    currentQuestionId: { type: Schema.Types.ObjectId, default: null },
    questionStatus: { type: String, default: "WAITING" },
    questionStartedAt: { type: Date, default: null },
    answerDeadline: { type: Date, default: null },
  },
  { timestamps: true },
);

const teamAnswerSchema = new Schema(
  {
    quizSessionId: { type: Schema.Types.ObjectId, required: true, index: true },
    teamId: { type: Schema.Types.ObjectId, required: true, index: true },
    questionId: { type: Schema.Types.ObjectId, required: true, index: true },
    selectedAnswer: { type: String, required: true },
    isCorrect: { type: Boolean, required: true },
    pointsAwarded: { type: Number, default: 0 },
    answeredAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const TeamModel = mongoose.models.Team ?? mongoose.model("Team", teamSchema);
export const QuestionModel =
  mongoose.models.Question ?? mongoose.model("Question", questionSchema);
export const QuizSessionModel =
  mongoose.models.QuizSession ??
  mongoose.model("QuizSession", quizSessionSchema);
export const TeamAnswerModel =
  mongoose.models.TeamAnswer ??
  mongoose.model("TeamAnswer", teamAnswerSchema);