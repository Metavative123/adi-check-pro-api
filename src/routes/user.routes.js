const express = require("express");
const userController = require("../controllers/user.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  requireAccess,
  requireProfileAccess,
} = require("../middlewares/subscription.middleware");

const router = express.Router();

// Everything below needs a valid token.
router.use(protect);
router.use(requireAccess);

router.get("/me", userController.getProfile);
router.patch("/me", requireProfileAccess, userController.updateProfile);
router.post("/me/test-centers", requireProfileAccess, userController.addTestCenter);
router.patch("/me/test-centers/:centerId", requireProfileAccess, userController.updateTestCenter);
router.delete("/me/test-centers/:centerId", requireProfileAccess, userController.removeTestCenter);

module.exports = router;
