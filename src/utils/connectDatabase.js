const dns = require("dns");
const mongoose = require("mongoose");
const env = require("../config/env");

// Node takes its DNS servers from the OS. If that list is unusable, the
// "mongodb+srv://" lookup fails with "querySrv ECONNREFUSED" before any
// connection is attempted. DNS_SERVERS points Node at a resolver that works.
if (env.dnsServers.length) {
  dns.setServers(env.dnsServers);
}

// Opens the MongoDB connection. Called once, from server.js.
async function connectDatabase() {
  await mongoose.connect(env.mongoUri);
  console.log(`MongoDB connected: ${mongoose.connection.name}`);

  mongoose.connection.on("error", (err) => {
    console.error("MongoDB error:", err.message);
  });
}

async function disconnectDatabase() {
  await mongoose.disconnect();
  console.log("MongoDB disconnected");
}

module.exports = { connectDatabase, disconnectDatabase };
