import "../env";
import mongoose from "mongoose";
import { logger } from "../lib/logger";
import { QuestionModel } from "../quiz/models";
import { questions } from "../quiz/questions";

if (!process.env.MONGODB_URI) {
  logger.error(
    "MONGODB_URI is missing. Add it to the local .env file before running the question seed.",
  );
  process.exit(1);
}

try {
  await mongoose.connect(process.env.MONGODB_URI);
  await QuestionModel.deleteMany({});
  await QuestionModel.insertMany(questions);
  logger.info({ count: questions.length }, "Seeded Bible quiz questions");
  await mongoose.disconnect();
} catch (error) {
  logger.error({ err: error }, "Unable to seed Bible quiz questions");
  process.exitCode = 1;
}