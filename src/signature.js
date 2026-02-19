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
