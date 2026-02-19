# Webhook Dispatcher

A fault-tolerant webhook delivery engine for fintech platforms. When a payment happens, it guarantees the merchant gets notified — even if their server is down for hours.

Built with **Node.js, PostgreSQL, Redis, and BullMQ**.

---

## Run It

Only requirement: **Docker Desktop**

```bash
git clone https://github.com/your-username/webhook-dispatcher.git
cd webhook-dispatcher
docker-compose up --build
```

This starts everything — Postgres, Redis, the API, the Worker, and the Mock Receiver. No other setup needed.

---

## Test It

Open a new terminal and send a payment event:

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "merchant_123",
    "amount": 4999,
    "currency": "INR",
    "transactionId": "txn_001"
  }'
```

Watch the Docker logs — you'll see the worker retry failed deliveries with backoff until the mock receiver finally accepts it.

---

## Endpoints

| Method | URL | What it does |
|--------|-----|--------------|
| POST | /events | Submit a payment event for delivery |
| GET | /health | Check if API, DB, and Redis are up |
| GET | /status/:jobId | Track delivery status of a specific job |
| GET | /status/all | Summary of all jobs (delivered, pending, failed) |
| GET | localhost:4000/stats | Mock receiver success/failure counts |

---

## How It Works

```
POST /events
     ↓
Save job to PostgreSQL  ←  source of truth, survives crashes
     ↓
Push to BullMQ (Redis)  ←  fast dispatch queue
     ↓
Worker picks up job
     ↓
Signs payload with HMAC-SHA256
     ↓
POST to merchant server
     ↓
Success → mark delivered
Failure → retry with exponential backoff (2s → 4s → 8s → ...)
          up to 8 attempts before marking failed
```

---

## Why These Choices

**PostgreSQL over in-memory queue** — Jobs survive process crashes. On restart, any job that never made it to the queue gets recovered automatically.

**BullMQ over Kafka** — Kafka is great for streaming but awkward for delayed retries. BullMQ handles exponential backoff, concurrency, and job state out of the box.

**Two separate processes (API + Worker)** — The API stays fast regardless of how busy the worker is. Both can be restarted independently.

---

## What the Mock Receiver Does

Simulates a bad merchant server — fails 70% of the time on purpose:
- **40%** → returns 500 error immediately
- **30%** → hangs for 15 seconds (forces a timeout)
- **30%** → accepts the webhook successfully

Every request also verifies the HMAC signature to prove it came from our dispatcher.

---

## Future Improvements

- **Rate limiting** — cap requests per merchant to prevent flooding
- **Per-merchant URLs** — store each merchant's endpoint in the DB instead of one env variable
- **Circuit breaker** — stop retrying a merchant that has been down for a long time, try again after a cooldown
- **Dead letter queue** — admin endpoint to review and manually retry permanently failed jobs
- **Event types** — support `payment.success`, `refund.issued` etc. with per-merchant subscriptions
- **Structured logging** — JSON logs with a correlation ID per job, ready for Datadog or CloudWatch
- **Failure alerts** — notify on-call via Slack or PagerDuty when a merchant has too many consecutive failures