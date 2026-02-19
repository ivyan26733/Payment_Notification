// eventsRoute.js
// The Ingestion API — accepts payment events and queues them for delivery.
//
// Design decision: We do two things atomically on every incoming event:
//   1. Save the job to PostgreSQL (durable, survives crashes)
//   2. Push the job to BullMQ (fast dispatch)
//
// If our process dies after step 1 but before step 2,
// a recovery mechanism can re-enqueue from PostgreSQL on startup.
// The DB is always the source of truth.

import express from "express";
import { db, isDbReady } from "./db.js";
import { getWebhookQueue } from "./queue.js";

const router = express.Router();

router.post("/events", async (req, res) => {
  if (!isDbReady()) {
    return res.status(503).json({
      error: "Service warming up — database not ready yet. Retry in a moment.",
    });
  }

  const { merchantId, amount, currency, transactionId } = req.body;

  if (!merchantId || !amount || !currency || !transactionId) {
    return res.status(400).json({
      error: "Missing required fields: merchantId, amount, currency, transactionId",
    });
  }

  const payload = { merchantId, amount, currency, transactionId };
  const targetUrl = process.env.TARGET_URL;
  const idempotencyKey = `txn-${transactionId}`;

  try {
    const { rows } = await db.query(
      `INSERT INTO webhook_jobs (merchant_id, payload, target_url, status, idempotency_key)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [merchantId, JSON.stringify(payload), targetUrl, idempotencyKey]
    );

    if (rows.length === 0) {
      console.log(`⚠️  Duplicate event rejected | transactionId: ${transactionId}`);
      return res.status(409).json({
        error: "Duplicate event — this transactionId has already been received.",
        transactionId,
      });
    }

    const jobId = rows[0].id;

    try {
      const webhookQueue = getWebhookQueue();
      await webhookQueue.add("send-webhook", { jobId, payload, targetUrl });
    } catch (enqueueErr) {
      console.warn(
        `⚠️  Redis/BullMQ unavailable; saved DB job #${jobId} but could not enqueue: ${
          enqueueErr?.message ?? enqueueErr
        }`
      );
    }

    console.log(
      `📥 Event received | DB job #${jobId} | merchant: ${merchantId} | txn: ${transactionId}`
    );

    return res.status(202).json({
      message: "Event accepted. Webhook delivery in progress.",
      jobId,
    });
  } catch (err) {
    console.error("❌ Failed to ingest event:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});



router.get("/status/:jobId", async (req, res) => {
  const { jobId } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT id, merchant_id, status, attempt_count, last_error, idempotency_key, created_at, updated_at
       FROM webhook_jobs WHERE id = $1`,
      [jobId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/status/all", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        status,
        COUNT(*)           AS count,
        AVG(attempt_count) AS avg_attempts,
        MAX(attempt_count) AS max_attempts
      FROM webhook_jobs
      GROUP BY status
    `);

    return res.json({
      summary: rows,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});


export default router;
