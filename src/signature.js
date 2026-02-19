// signature.js
// Handles HMAC-SHA256 signing for outgoing webhooks.
// This solves Constraint C — the merchant can verify the request is genuinely from us.
//
// How it works:
//   1. We take the raw JSON body as a string
//   2. We run HMAC-SHA256 on it using our shared secret key
//   3. We attach the result as a header: X-Webhook-Signature
//   4. The merchant runs the same process on their end and compares signatures
//   If they match → request is genuine. If not → reject it.

import { createHmac, timingSafeEqual } from "crypto";
import dotenv from "dotenv";

dotenv.config();

const SECRET = process.env.WEBHOOK_SECRET;

// Generates the HMAC signature for a given payload string
export function generateSignature(payloadString) {
  return createHmac("sha256", SECRET)
    .update(payloadString)
    .digest("hex");
}

// Verifies an incoming signature matches what we'd generate for the same payload.
// The mock receiver uses this to prove our signing works.
export function verifySignature(payloadString, receivedSignature) {
  const expected = generateSignature(payloadString);
  // Use timingSafeEqual to prevent timing attacks
  return timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(receivedSignature)
  );
}

export default { generateSignature, verifySignature };
