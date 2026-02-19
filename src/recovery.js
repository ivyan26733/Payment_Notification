import { db } from "./db.js";
import { getWebhookQueue } from "./queue.js";

export async function recoverPendingJobs() {
  console.log("🔍 Scanning for pending jobs that were never enqueued...");

  const { rows: pendingJobs } = await db.query(`
    SELECT id, payload, target_url
    FROM webhook_jobs
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `);

  if (pendingJobs.length === 0) {
    console.log("✅ No orphaned jobs found — queue is clean");
    return;
  }

  console.log(`⚠️  Found ${pendingJobs.length} orphaned job(s) — re-enqueuing...`);

  const webhookQueue = getWebhookQueue();

  for (const job of pendingJobs) {
    await webhookQueue.add(
      "send-webhook",
      { jobId: job.id, payload: job.payload, targetUrl: job.target_url },
      { jobId: `recovery-${job.id}` }
    );
    console.log(`   ♻️  Re-enqueued DB job #${job.id}`);
  }

  console.log(`✅ Recovery complete — ${pendingJobs.length} job(s) re-enqueued`);
}

