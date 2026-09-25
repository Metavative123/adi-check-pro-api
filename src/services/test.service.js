const Test = require("../models/test.model");
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const config = require("../config/performance");

// Counts come from the wizard as strings sometimes - make them safe numbers.
function toCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, "Fault counts must be 0 or more");
  return Math.floor(n);
}

async function createTest(instructorId, body) {
  const { pupilName, testDate, centerId, result, faults = {} } = body;

  if (!pupilName || !pupilName.trim()) throw new ApiError(400, "Pupil name is required");
  if (!testDate) throw new ApiError(400, "Test date is required");
  if (!centerId) throw new ApiError(400, "Test centre is required");
  if (!["pass", "fail"].includes(result)) throw new ApiError(400, "Result must be pass or fail");

  // The centre must be one of this instructor's own centres.
  const user = await User.findById(instructorId);
  const center = user.testCenters.id(centerId);
  if (!center) throw new ApiError(400, "That test centre is not on your list");

  const test = await Test.create({
    instructor: instructorId,
    pupilName,
    testDate,
    testCenter: { centerId: center._id, name: center.name, code: center.code },
    result,
    faults: {
      driving: toCount(faults.driving),
      serious: toCount(faults.serious),
      dangerous: toCount(faults.dangerous),
    },
    physicalIntervention: Boolean(body.physicalIntervention),
    verbalIntervention: Boolean(body.verbalIntervention),
  });

  return test;
}

// A user's search text goes into a regex, so escape anything meaningful in it.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "true"/"false" from the query string. Anything else means "no filter".
function toBool(value) {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
}

// Dates arrive as YYYY-MM-DD. Read them as whole UTC days so the last day of
// a range is included rather than cut off at midnight.
function startOfDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
}

function endOfDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}

// Turns the query string into a mongo filter. Every filter is optional and
// they all combine, so a search can be narrowed by date and intervention.
function buildFilter(instructorId, { search, from, to, physicalIntervention, verbalIntervention }) {
  const filter = { instructor: instructorId };

  if (search && String(search).trim()) {
    const pattern = new RegExp(escapeRegex(String(search).trim()), "i");
    // Matches a pupil name or a test reference.
    filter.$or = [{ pupilName: pattern }, { reference: pattern }];
  }

  if (from || to) {
    filter.testDate = {};
    if (from) filter.testDate.$gte = startOfDay(String(from));
    if (to) filter.testDate.$lte = endOfDay(String(to));
  }

  const physical = toBool(physicalIntervention);
  if (physical !== undefined) filter.physicalIntervention = physical;

  const verbal = toBool(verbalIntervention);
  if (verbal !== undefined) filter.verbalIntervention = verbal;

  return filter;
}

// Server-side pagination and filtering: the client asks for one page at a time.
async function listTests(instructorId, { page = 1, limit = 10, ...filters } = {}) {
  // Anything that is not a sensible positive number falls back to the default,
  // so "?limit=-5" gives a normal page rather than one row per page.
  const requestedLimit = Number(limit);
  const safeLimit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), 100)
      : 10;

  const requestedPage = Number(page);
  const safePage =
    Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const filter = buildFilter(instructorId, filters);

  const [tests, total] = await Promise.all([
    Test.find(filter)
      .sort({ testDate: -1, createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    Test.countDocuments(filter),
  ]);

  const totalPages = Math.max(Math.ceil(total / safeLimit), 1);

  return {
    tests,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
    },
  };
}

// Only these change the performance rating. Editing a pupil name, date or
// centre is record-keeping, so the score is left alone.
const RATING_PATHS = [
  "result",
  "faults.driving",
  "faults.serious",
  "faults.dangerous",
  "physicalIntervention",
  "verbalIntervention",
];

async function updateTest(instructorId, testId, body) {
  const test = await Test.findOne({ _id: testId, instructor: instructorId });
  if (!test) throw new ApiError(404, "Test not found");

  if (body.pupilName !== undefined) {
    if (!String(body.pupilName).trim()) throw new ApiError(400, "Pupil name is required");
    test.pupilName = body.pupilName;
  }

  if (body.testDate !== undefined) {
    if (!body.testDate) throw new ApiError(400, "Test date is required");
    test.testDate = body.testDate;
  }

  if (body.centerId !== undefined) {
    const user = await User.findById(instructorId);
    const center = user.testCenters.id(body.centerId);
    if (!center) throw new ApiError(400, "That test centre is not on your list");
    // Re-snapshot, same as when the test was created.
    test.testCenter = { centerId: center._id, name: center.name, code: center.code };
  }

  if (body.result !== undefined) {
    if (!["pass", "fail"].includes(body.result)) {
      throw new ApiError(400, "Result must be pass or fail");
    }
    test.result = body.result;
  }

  if (body.faults !== undefined) {
    test.faults.driving = toCount(body.faults.driving);
    test.faults.serious = toCount(body.faults.serious);
    test.faults.dangerous = toCount(body.faults.dangerous);
  }

  if (body.physicalIntervention !== undefined) {
    test.physicalIntervention = Boolean(body.physicalIntervention);
  }

  if (body.verbalIntervention !== undefined) {
    test.verbalIntervention = Boolean(body.verbalIntervention);
  }

  // Mongoose only flags a path as modified when the value actually changed,
  // so re-saving the same numbers does not trigger a recalculation.
  const affectsRating = RATING_PATHS.some((path) => test.isModified(path));

  await test.save();

  return { test, affectsRating };
}

async function deleteTest(instructorId, testId) {
  const test = await Test.findOneAndDelete({ _id: testId, instructor: instructorId });
  if (!test) throw new ApiError(404, "Test not found");

  // Deleting a test usually moves the figures - but not if it was already
  // outside the rating window, where it was not being counted anyway.
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - config.windowMonths);

  return { test, affectsRating: test.testDate >= windowStart };
}

module.exports = { createTest, listTests, updateTest, deleteTest };
