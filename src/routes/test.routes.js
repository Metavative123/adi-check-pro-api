const express = require("express");
const testController = require("../controllers/test.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  requireAccess,
  requireWriteAccess,
} = require("../middlewares/subscription.middleware");

const router = express.Router();

router.use(protect);
// A refunded account cannot even read; everything below is behind this.
router.use(requireAccess);

router.get("/performance", testController.getPerformance);
router.get("/trend", testController.getTrend);
router.get("/report", testController.getReport);
router.get("/pupils", testController.listPupils);
router.get("/pupils/summary", testController.getPupilSummary);
// Changing anything needs a live plan. Reading and exporting stay open to a
// lapsed account, so nobody is locked out of their own records.
router.post("/", requireWriteAccess, testController.createTest);
router.get("/", testController.listTests);
router.patch("/:testId", requireWriteAccess, testController.updateTest);
router.delete("/:testId", requireWriteAccess, testController.deleteTest);

module.exports = router;
