// Builds the Express app. It does not start listening - server.js does that.
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const env = require("./config/env");
const routes = require("./routes");
const billingController = require("./controllers/billing.controller");
const { notFound, errorHandler } = require("./middlewares/error.middleware");

const app = express();

app.use(cors({ origin: env.clientUrl, credentials: true }));
// Stripe signs the raw bytes, so this route must see the body before any
// JSON parsing touches it. It is mounted ahead of express.json on purpose.
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  billingController.webhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
