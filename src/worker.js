// worker.js
// The Dispatcher — picks up jobs from BullMQ and delivers them to the merchant.

import { Worker } from "bullmq";
import axios from "axios";
import dotenv from "dotenv";
import { db, initDB, closeDB } from "./db.js";
import { getRedisConnection } from "./queue.js";
import { generateSignature } from "./signature.js";
import { recoverPendingJobs } from "./recovery.js";

dotenv.config();

async function checkRedisAOF(redis) {
  try {
    const info = await redis.info("persistence");
    const aofEnabled = info.includes("aof_enabled:1");

    if (aofEnabled) {
      console.log("✅ Redis AOF persistence is ON — queue survives Redis restarts");
    } else {
      console.warn("WARNING: Redis AOF persistence is OFF.");
      console.warn(
        "   Jobs only in the queue (not yet in Postgres) may be lost if Redis restarts."
      );
      console.warn("   Start Redis with: redis-server --appendonly yes");
    }
  } catch (err) {
    console.warn(" Could not check Redis persistence config:", err?.message ?? err);
  }
}

async function startWorker() {
  const redis = getRedisConnection();
  redis.on("error", () => {});

  try {
    await redis.connect();
  } catch (err) {
    console.error(
      ` Redis is not reachable at ${process.env.REDIS_URL}. Start Redis, then re-run: pnpm run worker\n` +
        `   Error: ${err?.message ?? err}`
    );
    process.exit(1);
  }

  await initDB();
  await checkRedisAOF(redis);
  await recoverPendingJobs();

  const worker = new Worker(
    "webhook-delivery",
    async (job) => {
      const { jobId, payload, targetUrl } = job.data;
      const attemptNumber = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts;

      const log = (msg) => console.log(`[job:${jobId}] ${msg}`);

      log(
        `Attempt ${attemptNumber}/${maxAttempts} | merchant: ${payload.merchantId} | txn: ${payload.transactionId}`
      );

      const payloadString = JSON.stringify(payload);
      const signature = generateSignature(payloadString);

      const response = await axios.post(targetUrl, payload, {
        timeout: 12000,
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Attempt-Number": String(attemptNumber),
          "X-Idempotency-Key": `job-${jobId}`,
        },
      });

      log(`Delivered ✅ | status: ${response.status} | attempt: ${attemptNumber}`);

      await db.query(
        `UPDATE webhook_jobs
         SET status = 'delivered', attempt_count = $1, updated_at = NOW()
         WHERE id = $2`,
        [attemptNumber, jobId]
      );
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on("failed", async (job, err) => {
    const { jobId } = job.data;

    console.error(
      `[job:${jobId}] Permanently failed after ${job.attemptsMade} attempts | error: ${err.message}`
    );

    await db.query(
      `UPDATE webhook_jobs
       SET status = 'failed', attempt_count = $1, last_error = $2, updated_at = NOW()
       WHERE id = $3`,
      [job.attemptsMade, err.message, jobId]
    );
  });

  worker.on("error", (err) => {
    console.error("  Worker error:", err?.message ?? err);
  });

  async function shutdown(signal) {
    console.log(`\n ${signal} received — shutting down worker gracefully...`);

    try {
      await worker.pause();
      console.log("  Worker paused — waiting for active jobs to finish...");

      await worker.close();
      console.log("✅ All active jobs finished");

      await closeDB();
      await redis.quit();

      console.log("✅ Worker shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error(" Error during worker shutdown:", err?.message ?? err);
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log("  Dispatcher worker started — listening for webhook jobs...");
}

startWorker().catch((err) => {
  console.error("Worker failed to start:", err?.message ?? err);
  process.exit(1);
});
