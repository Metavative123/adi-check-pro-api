const { Pool } = require("pg");
const env = require("../config/env");

// Serverless (Vercel, Lambda) never runs server.js - it just imports the
// express app. So the pool is created lazily and cached on globalThis, which
// survives module re-evaluation inside the same warm container.
const cache =
  globalThis.__adiCheckProPg || (globalThis.__adiCheckProPg = { pool: null, ready: null });

// A Postgres on this machine (for local testing) usually has no SSL.
function isLocal(url) {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Connection strings copied from Supabase or Vercel often end in
// "?sslmode=require". The pg driver reads that as "verify the certificate
// chain", which Supabase's pooler fails, and it overrides the ssl option below.
// Encryption is set by that option instead, so the parameter is dropped.
function withoutSslParams(url) {
  try {
    const parsed = new URL(url);
    ["sslmode", "sslrootcert", "sslcert", "sslkey", "supa"].forEach((key) =>
      parsed.searchParams.delete(key)
    );
    return parsed.toString();
  } catch {
    return url;
  }
}

function getPool() {
  if (!cache.pool) {
    cache.pool = new Pool({
      connectionString: withoutSslParams(env.databaseUrl),
      // Supabase only accepts encrypted connections.
      ssl: isLocal(env.databaseUrl) ? false : { rejectUnauthorized: false },
      // Serverless containers are many and short-lived; a large pool per
      // container exhausts the database's connection limit.
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });

    // An idle client dropping must not crash the process.
    cache.pool.on("error", (err) => {
      console.error("Database error:", err.message);
    });
  }
  return cache.pool;
}

// Opens the pool and checks it works, once per container.
async function connectDatabase() {
  if (!cache.ready) {
    cache.ready = getPool()
      .query("select current_database() as name")
      .then(({ rows }) => {
        console.log(`Database connected: ${rows[0].name}`);
      })
      .catch((err) => {
        // Do not cache a failure - let the next request try again.
        cache.ready = null;
        throw err;
      });
  }
  return cache.ready;
}

function query(text, params) {
  return getPool().query(text, params);
}

async function disconnectDatabase() {
  const { pool } = cache;
  cache.pool = null;
  cache.ready = null;
  if (pool) await pool.end();
  console.log("Database disconnected");
}

module.exports = { connectDatabase, disconnectDatabase, query };
