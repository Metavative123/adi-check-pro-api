// Pupils are not a collection of their own - a pupil is a name that appears on
// one or more tests. These functions treat the distinct names as if they were,
// so two of them can be looked up and compared.
//
// Every query is filtered by instructor first: one instructor can never see,
// search or compare another's pupils.
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
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const term = search ? String(search).trim() : "";
  const pattern = term ? new RegExp(escapeRegex(term), "i") : null;

  // Step one: which pupils match. A reference matches exactly one test, so
  // this stage only identifies the pupil - it cannot be used for counts.
  const matched = await Test.matchPupils(instructorId, term, safeLimit);

  if (matched.length === 0) return [];

  // Step two: count every test for those pupils. Counting the matched
  // documents instead would report "1 test" for a search by reference.
  // The name returned is the most recent spelling.
  const rows = await Test.summarisePupils(
    instructorId,
    matched.map((row) => row.key)
  );

  const matchedByKey = new Map(matched.map((row) => [row.key, row]));

  return rows.map((row) => {
    const hit = matchedByKey.get(row.key);
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

  const tests = await Test.findAll(instructorId, { pupilName: String(name).trim() });

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
