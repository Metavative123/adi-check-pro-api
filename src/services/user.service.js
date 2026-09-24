// Profile logic: the ADI badge number and test centres are set here,
// after the instructor has signed up and logged in.
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");

async function getProfile(userId) {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");
  return user;
}

// Only these fields can be changed. Anything else in the body is ignored,
// so nobody can send { role: "admin" } and promote themselves.
async function updateProfile(userId, body) {
  const user = await getProfile(userId);

  if (body.name !== undefined) {
    if (!body.name.trim()) throw new ApiError(400, "Name cannot be empty");
    user.name = body.name;
  }

  if (body.adiBadgeNumber !== undefined) {
    // Sending "" or null clears it, rather than storing an empty string
    // (which would clash with other users on the unique index).
    const badge = (body.adiBadgeNumber || "").trim();
    user.adiBadgeNumber = badge || undefined;
  }

  if (body.testCenters !== undefined) {
    if (!Array.isArray(body.testCenters)) {
      throw new ApiError(400, "testCenters must be an array");
    }
    user.testCenters = body.testCenters;
  }

  await user.save();
  return user;
}

async function addTestCenter(userId, { name, code }) {
  if (!name || !name.trim()) throw new ApiError(400, "Test centre name is required");

  const user = await getProfile(userId);

  const exists = user.testCenters.some(
    (c) => c.name.toLowerCase() === name.trim().toLowerCase()
  );
  if (exists) throw new ApiError(409, "That test centre is already on your list");

  user.testCenters.push({ name, code });
  await user.save();
  return user;
}

async function updateTestCenter(userId, centerId, { name, code }) {
  const user = await getProfile(userId);

  const center = user.testCenters.id(centerId);
  if (!center) throw new ApiError(404, "Test centre not found on your list");

  if (name !== undefined) {
    if (!name.trim()) throw new ApiError(400, "Test centre name is required");

    // Another centre on the list must not already have that name.
    const clash = user.testCenters.some(
      (c) => c._id.toString() !== centerId && c.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (clash) throw new ApiError(409, "That test centre is already on your list");

    center.name = name;
  }

  if (code !== undefined) center.code = code || undefined;

  await user.save();
  return user;
}

async function removeTestCenter(userId, centerId) {
  const user = await getProfile(userId);

  const center = user.testCenters.id(centerId);
  if (!center) throw new ApiError(404, "Test centre not found on your list");

  center.deleteOne();
  await user.save();
  return user;
}

module.exports = {
  getProfile,
  updateProfile,
  addTestCenter,
  updateTestCenter,
  removeTestCenter,
};
