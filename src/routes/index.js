// Every route group gets mounted here. Add new ones to the list.
const express = require("express");
const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const testRoutes = require("./test.routes");
const billingRoutes = require("./billing.routes");

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ success: true, message: "API is running" });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/tests", testRoutes);
router.use("/billing", billingRoutes);

module.exports = router;
