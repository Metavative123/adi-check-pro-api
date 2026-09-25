// Pupils are not a collection of their own - a pupil is a name that appears on
// one or more tests. These functions treat the distinct names as if they were,
// so two of them can be looked up and compared.
//
// Every query is filtered by instructor first: one instructor can never see,
// search or compare another's pupils.
const mongoose = require("mongoose");
const Test = require("../models/test.model");
const ApiError = require("../utils/ApiError");
const scoring = require("./scoring");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Distinct pupil names, newest first, for the comparison pickers.
// Searching runs over every test the instructor has, not just a page of them,
// and matches either the pupil's name or a test reference such as T-9F3A21.
async function listPupils(instructorId, { search, limit = 10 } = {}) {
  const owner = new mongoose.Types.ObjectId(instructorId);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const term = search ? String(search).trim() : "";
  const pattern = term ? new RegExp(escapeRegex(term), "i") : null;

  // Step one: which pupils match. A reference matches exactly one test, so
  // this stage only identifies the pupil - it cannot be used for counts.
  const matchStage = { instructor: owner };
  if (pattern) {
    matchStage.$or = [{ pupilName: pattern }, { reference: pattern }];
  }

  const matched = await Test.aggregate([
    { $match: matchStage },
    {
      $group: {
        // Group case-insensitively so "sara khan" and "Sara Khan" are one
        // pupil, however the name was typed on the day.
        _id: { $toLower: "$pupilName" },
        lastTestDate: { $max: "$testDate" },
        references: { $addToSet: "$reference" },
      },
    },
    { $sort: { lastTestDate: -1 } },
    { $limit: safeLimit },
  ]);

  if (matched.length === 0) return [];

  // Step two: count every test for those pupils. Counting the matched
  // documents instead would report "1 test" for a search by reference.
  const nameFilters = matched.map((row) => ({
    pupilName: new RegExp(`^${escapeRegex(row._id)}$`, "i"),
  }));

  const rows = await Test.aggregate([
    { $match: { instructor: owner, $or: nameFilters } },
    {
      $group: {
        _id: { $toLower: "$pupilName" },
        name: { $last: "$pupilName" }, // the most recent spelling
        tests: { $sum: 1 },
        lastTestDate: { $max: "$testDate" },
      },
    },
    { $sort: { lastTestDate: -1 } },
  ]);

  const matchedByKey = new Map(matched.map((row) => [row._id, row]));

  return rows.map((row) => {
    const hit = matchedByKey.get(row._id);
    // When the search was a test reference, show which test it found.
    const matchedReference =
      pattern && hit ? hit.references.find((ref) => ref && pattern.test(ref)) : undefined;

    return {
      name: row.name,
      tests: row.tests,
      lastTestDate: row.lastTestDate,
      ...(matchedReference ? { matchedReference } : {}),
    };
  });
}

// Everything one pupil's record adds up to, plus the tests behind it.
async function getPupilSummary(instructorId, name) {
  if (!name || !String(name).trim()) throw new ApiError(400, "A pupil name is required");

  const exact = new RegExp(`^${escapeRegex(String(name).trim())}$`, "i");

  const tests = await Test.find({ instructor: instructorId, pupilName: exact }).sort({
    testDate: -1,
  });

  // Also a 404 when the pupil belongs to a different instructor, so the
  // response never reveals that the name exists elsewhere.
  if (tests.length === 0) throw new ApiError(404, "No tests found for that pupil");

  const totals = scoring.totalsFrom(tests);
  const metrics = scoring.metricsFrom(totals);

  return {
    // The spelling as recorded, rather than whatever was typed in the search.
    name: tests[0].pupilName,
    totals,
    metrics,
    firstTestDate: tests[tests.length - 1].testDate,
    lastTestDate: tests[0].testDate,
    // Centres this pupil was tested at, in case the comparison needs context.
    testCenters: [...new Set(tests.map((t) => t.testCenter?.name).filter(Boolean))],
    tests: tests.map((t) => ({
      _id: t._id,
      reference: t.reference,
      testDate: t.testDate,
      testCenter: t.testCenter,
      result: t.result,
      faults: t.faults,
      physicalIntervention: t.physicalIntervention,
      verbalIntervention: t.verbalIntervention,
    })),
  };
}

module.exports = { listPupils, getPupilSummary };
