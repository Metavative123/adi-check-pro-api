const express = require("express");
const userController = require("../controllers/user.controller");
const { protect } = require("../middlewares/auth.middleware");
const {
  requireAccess,
  requireWriteAccess,
} = require("../middlewares/subscription.middleware");

const router = express.Router();

// Everything below needs a valid token.
router.use(protect);
router.use(requireAccess);

router.get("/me", userController.getProfile);
router.patch("/me", requireWriteAccess, userController.updateProfile);
router.post("/me/test-centers", requireWriteAccess, userController.addTestCenter);
router.patch("/me/test-centers/:centerId", requireWriteAccess, userController.updateTestCenter);
router.delete("/me/test-centers/:centerId", requireWriteAccess, userController.removeTestCenter);

module.exports = router;
