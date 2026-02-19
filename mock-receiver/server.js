// mock-receiver/server.js
// Simulates a terrible merchant server to prove our dispatcher works.
//
// Behavior:
//   - 70% of requests → fail (mix of 500 errors and timeouts)
//   - 30% of requests → succeed with 200 OK
//   - Every request logs whether the HMAC signature is valid
//
// Run with: npm run mock-receiver

import express, { json } from "express";
import { createHmac, timingSafeEqual } from "crypto";

const app = express();
const PORT = 4000;
const SECRET = process.env.WEBHOOK_SECRET;

// We need the raw body as a string to verify the signature correctly.
// If we parse JSON first, the string representation may differ and break verification.
app.use(json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString(); // Save raw string before JSON parsing
  },
}));

// Tracks stats so we can see how our dispatcher performed over time
const stats = { received: 0, succeeded: 0, failed: 0 };

app.post("/receive", async (req, res) => {
  stats.received++;

  // ── Signature Verification (Constraint C) ──────────────────────────────
  const receivedSignature = req.headers["x-webhook-signature"];
  const attemptNumber = req.headers["x-attempt-number"];

  let signatureValid = false;
  if (receivedSignature && SECRET) {
    const expectedSignature = createHmac("sha256", SECRET)
      .update(req.rawBody)
      .digest("hex");

    // Use timingSafeEqual to prevent timing attacks
    try {
      signatureValid = timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(receivedSignature)
      );
    } catch {
      signatureValid = false;
    }
  }

  const sigStatus = signatureValid ? "✅ VALID" : "❌ INVALID";
  console.log(`\n📩 Received webhook | Attempt #${attemptNumber} | Signature: ${sigStatus}`);
  console.log(`   Payload:`, req.body);


  // ── Chaotic Behavior — fails 70% of the time ───────────────────────────
  const random = Math.random();

  
  if (random < 0.40) {
    // 40% — immediate 500 error (server error)
    stats.failed++;
    console.log(`  Simulating 500 error`);
    return res.status(500).json({ error: "Internal server error" });
  }


  if (random < 0.70) {
    // 30% — timeout (we just hang and never respond, forcing axios to timeout)
    stats.failed++;
    console.log(`   ⏳ Simulating timeout — hanging for 15 seconds...`);
    await new Promise((resolve) => setTimeout(resolve, 15000));
    return res.status(504).json({ error: "Timeout" });
  }

  // 30% — success!
  stats.succeeded++;
  console.log(`   ✅ Success! Accepting this webhook.`);
  console.log(`Stats so far — Total: ${stats.received} | Success: ${stats.succeeded} | Failed: ${stats.failed}`);

  return res.status(200).json({ received: true });
});

// Stats endpoint — hit this to see overall delivery performance
app.get("/stats", (req, res) => {
  const successRate = stats.received
    ? ((stats.succeeded / stats.received) * 100).toFixed(1)
    : 0;

  res.json({
    ...stats,
    successRate: `${successRate}%`,
  });
});

app.listen(PORT, () => {
  console.log(`🎭 Mock Receiver running on http://localhost:${PORT}`);
  console.log(`   POST http://localhost:${PORT}/receive  — webhook target`);
  console.log(`   GET  http://localhost:${PORT}/stats    — delivery stats`);
  console.log(`\n   Behavior: 40% → 500 error | 30% → timeout | 30% → success`);
});
