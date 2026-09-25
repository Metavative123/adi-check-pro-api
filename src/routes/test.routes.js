const express = require("express");
const testController = require("../controllers/test.controller");
const { protect } = require("../middlewares/auth.middleware");
const { requireSubscription } = require("../middlewares/subscription.middleware");

const router = express.Router();

router.use(protect);

router.get("/performance", testController.getPerformance);
router.get("/trend", testController.getTrend);
router.get("/report", testController.getReport);
router.get("/pupils", testController.listPupils);
router.get("/pupils/summary", testController.getPupilSummary);
// Logging a test is the paid feature; reading stays open so an expired
// account can still see and export its own history.
router.post("/", requireSubscription, testController.createTest);
router.get("/", testController.listTests);
router.patch("/:testId", testController.updateTest);
router.delete("/:testId", testController.deleteTest);

module.exports = router;
