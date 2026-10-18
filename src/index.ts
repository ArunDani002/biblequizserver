import dotenv from "dotenv";

// Load environment variables before accessing process.env
dotenv.config();

import app from "./app";
import { logger } from "./lib/logger";
import { createServer } from "node:http";
import { connectStore } from "./quiz/store";
import { setupRealtime } from "./quiz/realtime";

const port = Number(process.env.PORT ?? 5000);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${process.env.PORT}"`);
}

const server = createServer(app);

setupRealtime(server);

await connectStore();

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});