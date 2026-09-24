const express = require("express");
const userController = require("../controllers/user.controller");
const { protect } = require("../middlewares/auth.middleware");

const router = express.Router();

// Everything below needs a valid token.
router.use(protect);

router.get("/me", userController.getProfile);
router.patch("/me", userController.updateProfile);
router.post("/me/test-centers", userController.addTestCenter);
router.patch("/me/test-centers/:centerId", userController.updateTestCenter);
router.delete("/me/test-centers/:centerId", userController.removeTestCenter);

module.exports = router;
