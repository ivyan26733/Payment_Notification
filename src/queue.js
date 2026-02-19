// queue.js
// Defines the BullMQ queue and Redis connection.
// Both the API (to add jobs) and the worker (to process jobs) import from here.
// This keeps queue config in one place — no duplication.

import { Queue } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

let redisConnection;
let webhookQueue;

export function getRedisConnection() {
  if (!redisConnection) {
    redisConnection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableOfflineQueue: false, // Fail fast if Redis is down
      lazyConnect: true, // Don't connect at import time
    });
  }
  return redisConnection;
}

export function getWebhookQueue() {
  if (!webhookQueue) {
    webhookQueue = new Queue("webhook-delivery", {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 8,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }
  return webhookQueue;
}
