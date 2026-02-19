# Webhook Dispatcher

Guaranteed at-least-once webhook delivery engine built with Node.js, PostgreSQL, Redis, and BullMQ.

---

## Running Locally (Without Docker)

You need **3 terminal windows** — one for each process.

### Terminal 1 — Mock Receiver (fake merchant server)
```bash
npm run mock-receiver
# Runs on http://localhost:4000
```

### Terminal 2 — API Server (ingestion)
```bash
npm start
# Runs on http://localhost:3000
```

### Terminal 3 — Dispatcher Worker
```bash
npm run worker
# Listens for jobs on BullMQ and delivers webhooks
```

---

## Sending a Test Event

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "merchant_123",
    "amount": 4999,
    "currency": "INR",
    "transactionId": "txn_abc_001"
  }'
```

You'll see:
- **API terminal** → job accepted, saved to DB
- **Worker terminal** → delivery attempts with backoff retries
- **Mock receiver terminal** → some fail, some succeed, signature validation on each

---

## Operational APIs

### Health

```bash
curl http://localhost:3000/health
```

Returns overall status plus DB/Redis health:

```json
{
  "status": "healthy" | "degraded",
  "db": "up" | "down",
  "redis": "up" | "down",
  "timestamp": "..."
}
```

### Job status

```bash
# Single job
curl http://localhost:3000/status/1

# Summary across all jobs
curl http://localhost:3000/status/all
```

`/status/all` aggregates per status with counts and retry statistics.

---

## Check Delivery Stats

```bash
# See how many webhooks succeeded vs failed on the mock receiver
curl http://localhost:4000/stats
```

---

## Check DB State

```sql
SELECT id, merchant_id, status, attempt_count, last_error, created_at
FROM webhook_jobs
ORDER BY created_at DESC;
```
