// log-dump.js
// Runs a single test webhook event and captures the full delivery journey
// (all retries, backoff timing, final success/failure) into a log file.
//
// Usage:
//   node log-dump.js
//
// Output:
//   webhook-log-dump.txt  ← full delivery log with timestamps

import { exec, spawn } from "child_process";
import { writeFileSync } from "fs";
import { get, request } from "http";

const LOG_FILE = "webhook-log-dump.txt";
const API_URL = "http://localhost:3000";
const WORKER_SERVICE = "webhook_worker";
const API_SERVICE = "webhook_api";

// Unique transaction ID so every run produces a fresh job
const transactionId = `txn_demo_${Date.now()}`;

const lines = [];

// ── Helpers ───────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString();
}

function write(line) {
  const entry = `[${timestamp()}] ${line}`;
  console.log(entry);
  lines.push(entry);
}

function save() {
  writeFileSync(LOG_FILE, lines.join("\n") + "\n");
  console.log(`\n📄 Log saved to: ${LOG_FILE}`);
}

// ── Step 1: Check the API is reachable ───────────────────────────────────

function checkHealth() {
  return new Promise((resolve, reject) => {
    write("Checking API health...");
    get(`${API_URL}/health`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const parsed = JSON.parse(data);
        write(`Health: ${JSON.stringify(parsed)}`);
        if (parsed.status !== "healthy") {
          reject(new Error("API is not healthy — is docker-compose up?"));
        } else {
          resolve();
        }
      });
    }).on("error", () => {
      reject(new Error("Cannot reach API at http://localhost:3000 — is docker-compose up?"));
    });
  });
}

// ── Step 2: Fire the test event ───────────────────────────────────────────

function sendEvent() {
  return new Promise((resolve, reject) => {
    write(`Sending test event | transactionId: ${transactionId}`);

    const payload = JSON.stringify({
      merchantId: "merchant_demo",
      amount: 4999,
      currency: "INR",
      transactionId,
    });

    const options = {
      hostname: "localhost",
      port: 3000,
      path: "/events",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const parsed = JSON.parse(data);
        write(`Event accepted | jobId: ${parsed.jobId} | status: ${res.statusCode}`);
        resolve(parsed.jobId);
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ── Step 3: Stream docker logs for the worker and API ─────────────────────

function streamDockerLogs(jobId) {
  return new Promise((resolve) => {
    write(`\nStreaming live logs for job #${jobId} — waiting for delivery...\n`);

    // Follow logs from both the worker and API containers
    const logger = spawn("docker", [
      "logs", "--follow", "--timestamps", WORKER_SERVICE
    ]);

    logger.stdout.on("data", (data) => {
      const text = data.toString().trim();
      if (!text) return;

      text.split("\n").forEach((line) => {
        lines.push(line); // raw docker log line with its own timestamp
        console.log(line);

        // Stop streaming once we see final delivery outcome for this job
        const isDelivered = line.includes(`job:${jobId}`) && line.includes("Delivered");
        const isFailed    = line.includes(`job:${jobId}`) && line.includes("Permanently failed");

        if (isDelivered || isFailed) {
          write(`\n--- Delivery complete for job #${jobId} ---`);
          logger.kill();
          resolve();
        }
      });
    });

    logger.stderr.on("data", (data) => {
      // Docker sends its own log lines to stderr — capture those too
      const text = data.toString().trim();
      if (text) {
        text.split("\n").forEach((line) => {
          lines.push(line);
          console.log(line);

          const isDelivered = line.includes(`job:${jobId}`) && line.includes("Delivered");
          const isFailed    = line.includes(`job:${jobId}`) && line.includes("Permanently failed");

          if (isDelivered || isFailed) {
            write(`\n--- Delivery complete for job #${jobId} ---`);
            logger.kill();
            resolve();
          }
        });
      }
    });

    // Safety timeout — if delivery takes more than 5 minutes, stop and save what we have
    setTimeout(() => {
      write("\n⚠️  Timeout reached — saving partial log");
      logger.kill();
      resolve();
    }, 5 * 60 * 1000);
  });
}

// ── Step 4: Fetch final job status from the DB ────────────────────────────

function fetchFinalStatus(jobId) {
  return new Promise((resolve) => {
    get(`${API_URL}/status/${jobId}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const job = JSON.parse(data);
        write(`\n=== Final Job Status ===`);
        write(`Job ID       : ${job.id}`);
        write(`Merchant     : ${job.merchant_id}`);
        write(`Status       : ${job.status}`);
        write(`Attempts     : ${job.attempt_count}`);
        write(`Last Error   : ${job.last_error || "none"}`);
        write(`Created At   : ${job.created_at}`);
        write(`Updated At   : ${job.updated_at}`);
        resolve();
      });
    }).on("error", () => {
      write("Could not fetch final status");
      resolve();
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  write("====== Webhook Dispatcher — Log Dump ======");
  write(`Log file: ${LOG_FILE}`);
  write("===========================================\n");

  try {
    await checkHealth();
    const jobId = await sendEvent();
    await streamDockerLogs(jobId);
    await fetchFinalStatus(jobId);
    write("\n====== Log Dump Complete ======");
  } catch (err) {
    write(`\n❌ Error: ${err.message}`);
  } finally {
    save();
  }
}

main();
