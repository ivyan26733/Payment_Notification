import { Client, Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

let dbReady = false;

export function isDbReady() {
  return dbReady;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const dbUrl = new URL(connectionString);

const baseConfig = {
  host: dbUrl.hostname,
  port: dbUrl.port ? Number(dbUrl.port) : 5432,
  user: decodeURIComponent(dbUrl.username),
  password: decodeURIComponent(dbUrl.password || ""),
};

const databaseName = dbUrl.pathname.replace(/^\//, "");

const pool = new Pool({
  ...baseConfig,
  database: databaseName,
});

async function ensureDatabaseExists() {
  const adminClient = new Client({
    ...baseConfig,
    database: "postgres",
  });

  await adminClient.connect();
  try {
    const result = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [databaseName]
    );

    if (result.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${databaseName}"`);
      console.log(`✅ Created database ${databaseName}`);
    }
  } finally {
    await adminClient.end();
  }
}

export async function initDB(retries = 10, delayMs = 3000) {
  await ensureDatabaseExists();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS webhook_jobs (
          id              SERIAL PRIMARY KEY,
          merchant_id     TEXT NOT NULL,
          payload         JSONB NOT NULL,
          target_url      TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'pending',
          idempotency_key TEXT UNIQUE,
          attempt_count   INT NOT NULL DEFAULT 0,
          last_error      TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      dbReady = true;
      console.log("✅ Database ready — webhook_jobs table exists");
      return;
    } catch (err) {
      console.log(`⏳ DB init attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) {
        throw new Error(`Database unavailable after ${retries} attempts: ${err.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function closeDB() {
  await pool.end();
  console.log("🔌 Database connection pool closed");
}

export const db = {
  query: (text, params) => pool.query(text, params),
};