const dns = require("dns");
const mongoose = require("mongoose");
const env = require("../config/env");

// Node takes its DNS servers from the OS. If that list is unusable, the
// "mongodb+srv://" lookup fails with "querySrv ECONNREFUSED" before any
// connection is attempted. DNS_SERVERS points Node at a resolver that works.
if (env.dnsServers.length) {
  dns.setServers(env.dnsServers);
}

// Serverless (Vercel, Lambda) never runs server.js - it just imports the
// express app. So the connection has to be made lazily, on the first request,
// and then cached: a warm container serves many requests and must not open a
// new connection for each one. globalThis survives module re-evaluation
// inside the same container; a plain module variable does not always.
const cache =
  globalThis.__adiCheckProMongoose ||
  (globalThis.__adiCheckProMongoose = { conn: null, promise: null });

// Registered once per container, not per call, or the listeners pile up.
if (!globalThis.__adiCheckProMongooseListeners) {
  globalThis.__adiCheckProMongooseListeners = true;

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    // Drop the cache so the next request reconnects instead of using a
    // handle that is no longer live.
    cache.conn = null;
    cache.promise = null;
  });
}

async function connectDatabase() {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.mongoUri, {
        // Without this, a query issued before the connection is ready waits
        // in a buffer and eventually fails with "buffering timed out after
        // 10000ms" - an error that says nothing about the real cause. With it
        // off, the failure is immediate and names the actual problem.
        bufferCommands: false,
        serverSelectionTimeoutMS: 10000,
        // Serverless containers are many and short-lived; a large pool per
        // container exhausts the cluster's connection limit.
        maxPoolSize: 10,
      })
      .then((instance) => {
        console.log(`MongoDB connected: ${instance.connection.name}`);
        return instance;
      })
      .catch((err) => {
        // Do not cache a failure - let the next request try again.
        cache.promise = null;
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

async function disconnectDatabase() {
  cache.conn = null;
  cache.promise = null;
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}

module.exports = { connectDatabase, disconnectDatabase };
