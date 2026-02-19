// index.js
// Entry point — starts the Express API server.
// Run this with: npm start
//
// This process ONLY handles incoming events (POST /events).
// The actual webhook delivery happens in worker.js (a separate process).

import express, { json } from "express";
import dotenv from "dotenv";
import { initDB, closeDB, isDbReady } from "./db.js";
import eventsRoute from "./eventsRoute.js";
import { getRedisConnection } from "./queue.js";
import { recoverPendingJobs } from "./recovery.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(json());
app.use("/", eventsRoute);

app.get("/health", async (req, res) => {
  let redisAlive = false;

  try {
    const redis = getRedisConnection();
    await redis.ping();
    redisAlive = true;
  } catch {
    redisAlive = false;
  }

  const healthy = isDbReady() && redisAlive;

  return res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    db: isDbReady() ? "up" : "down",
    redis: redisAlive ? "up" : "down",
    timestamp: new Date().toISOString(),
  });
});

async function start() {
  await initDB();
  await recoverPendingJobs();

  const server = app.listen(PORT, () => {
    console.log(`🌐 Ingestion API running on http://localhost:${PORT}`);
  });

  async function shutdown(signal) {
    console.log(`\n ${signal} received — shutting down API gracefully...`);

    server.close(async () => {
      console.log("🔒 HTTP server closed — no new requests accepted");

      try {
        await closeDB();
        try {
          const redis = getRedisConnection();
          await redis.quit();
        } catch {
          // ignore Redis close errors on shutdown
        }
        console.log("✅ Shutdown complete");
        process.exit(0);
      } catch (err) {
        console.error(" Error during shutdown:", err?.message ?? err);
        process.exit(1);
      }
    });

    setTimeout(() => {
      console.error("⏰ Graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, 10000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Failed to start server:", err?.message ?? err);
  process.exit(1);
});