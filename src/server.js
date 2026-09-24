// Entry point: connect to the database, then start listening.
const app = require("./app");
const env = require("./config/env");
const { connectDatabase, disconnectDatabase } = require("./utils/connectDatabase");

async function start() {
  try {
    await connectDatabase();

    const server = app.listen(env.port, () => {
      console.log(`API running on http://localhost:${env.port} (${env.nodeEnv})`);
    });

    // Close things down cleanly on Ctrl+C.
    const shutdown = async () => {
      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
}

start();
