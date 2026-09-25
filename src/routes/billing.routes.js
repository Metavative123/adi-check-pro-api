const express = require("express");
const billingController = require("../controllers/billing.controller");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();

// The webhook is mounted separately in app.js - it needs the raw body and
// must not require a signed-in user.
router.use(protect);

router.get("/", billingController.getBilling);
router.get("/plans", billingController.getPlans);
router.post("/trial", billingController.chooseTrial);
router.post("/checkout", billingController.createCheckoutSession);
router.post("/checkout/confirm", billingController.confirmCheckout);
router.get("/payments", billingController.listPayments);
router.post("/cancel", billingController.cancelSubscription);
router.post("/portal", billingController.createPortalSession);

module.exports = router;
