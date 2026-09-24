const express = require("express");
const billingController = require("../controllers/billing.controller");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();

// The webhook is mounted separately in app.js - it needs the raw body and
// must not require a signed-in user.
router.use(protect);

router.get("/", billingController.getBilling);
router.post("/checkout", billingController.createCheckoutSession);
router.post("/portal", billingController.createPortalSession);

module.exports = router;
