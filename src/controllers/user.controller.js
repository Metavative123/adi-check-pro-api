const userService = require("../services/user.service");

// req.user is set by the `protect` middleware, so these all act
// on whoever is signed in.
async function getProfile(req, res) {
  const user = await userService.getProfile(req.user.id);
  res.json({ success: true, data: { user } });
}

async function updateProfile(req, res) {
  const user = await userService.updateProfile(req.user.id, req.body);
  res.json({ success: true, data: { user } });
}

async function addTestCenter(req, res) {
  const { name, code } = req.body;
  const user = await userService.addTestCenter(req.user.id, { name, code });
  res.status(201).json({ success: true, data: { user } });
}

async function updateTestCenter(req, res) {
  const { name, code } = req.body;
  const user = await userService.updateTestCenter(req.user.id, req.params.centerId, { name, code });
  res.json({ success: true, data: { user } });
}

async function removeTestCenter(req, res) {
  const user = await userService.removeTestCenter(req.user.id, req.params.centerId);
  res.json({ success: true, data: { user } });
}

module.exports = {
  getProfile,
  updateProfile,
  addTestCenter,
  updateTestCenter,
  removeTestCenter,
};
