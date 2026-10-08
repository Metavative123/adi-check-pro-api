// Checks the two rules the client asked to have confirmed:
//   1. faults and examiner action are never counted twice
//   2. the 12-month window revolves, and a test drops off exactly 12 months
//      after its test date
//
//   npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const scoring = require("../src/services/scoring");

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date) => date.toISOString().slice(0, 10);

function aTest(overrides = {}) {
  return {
    result: "pass",
    faults: { driving: 0, serious: 0, dangerous: 0 },
    physicalIntervention: false,
    verbalIntervention: false,
    ...overrides,
  };
}

// --- 1. No double counting ---------------------------------------------------

test("examiner action plus a dangerous fault is one intervention and one dangerous fault", () => {
  const totals = scoring.totalsFrom([
    aTest({
      result: "fail",
      faults: { driving: 3, serious: 0, dangerous: 1 },
      physicalIntervention: true,
    }),
  ]);

  assert.equal(totals.interventions, 1);
  assert.equal(totals.dangerous, 1);
  assert.equal(totals.serious, 0, "the dangerous fault must not also count as serious");
  assert.equal(totals.driving, 3, "no fault is added to driving faults");
});

test("examiner action never adds faults of its own", () => {
  const withAction = scoring.totalsFrom([
    aTest({ faults: { driving: 2, serious: 1, dangerous: 0 }, physicalIntervention: true }),
  ]);
  const withoutAction = scoring.totalsFrom([
    aTest({ faults: { driving: 2, serious: 1, dangerous: 0 } }),
  ]);

  for (const key of ["driving", "serious", "dangerous"]) {
    assert.equal(withAction[key], withoutAction[key], `${key} faults changed`);
  }
});

test("each fault category feeds only its own figure", () => {
  const tests = [
    aTest({ faults: { driving: 4, serious: 1, dangerous: 0 } }),
    aTest({ result: "fail", faults: { driving: 6, serious: 0, dangerous: 1 }, physicalIntervention: true }),
    aTest({ faults: { driving: 2, serious: 0, dangerous: 0 }, verbalIntervention: true }),
    aTest({ result: "fail", faults: { driving: 8, serious: 2, dangerous: 0 } }),
  ];
  const totals = scoring.totalsFrom(tests);
  const metrics = scoring.metricsFrom(totals);

  assert.deepEqual(
    { driving: totals.driving, serious: totals.serious, dangerous: totals.dangerous },
    { driving: 20, serious: 3, dangerous: 1 }
  );
  assert.equal(metrics.drivingFaultAverage, 5); // 20 / 4
  assert.equal(metrics.seriousFaultAverage, 0.75); // 3 / 4 - dangerous not included
  assert.equal(metrics.dangerousFaultAverage, 0.25); // 1 / 4 - serious not included
  assert.equal(metrics.seriousDangerousFaultAverage, 1); // (3 + 1) / 4, each fault once
  assert.equal(metrics.physicalInterventionRate, 25); // 1 of 4 tests
  assert.equal(metrics.passRate, 50); // 2 of 4
});

test("several examiner actions on one test count as one test with intervention", () => {
  // The rate is a share of tests, so one test can only count once.
  const totals = scoring.totalsFrom([
    aTest({ result: "fail", faults: { driving: 0, serious: 0, dangerous: 2 }, physicalIntervention: true }),
    aTest(),
  ]);
  assert.equal(totals.interventions, 1);
  assert.equal(scoring.metricsFrom(totals).physicalInterventionRate, 50);
});

test("the dangerous fault average is information only", () => {
  const clean = scoring.metricsFrom(scoring.totalsFrom([aTest(), aTest()]));
  const withDangerous = scoring.metricsFrom(
    scoring.totalsFrom([aTest({ faults: { driving: 0, serious: 0, dangerous: 3 } }), aTest()])
  );

  assert.equal(withDangerous.dangerousFaultAverage, 1.5);
  assert.equal(withDangerous.seriousFaultAverage, 0);
  assert.equal(withDangerous.seriousDangerousFaultAverage, 1.5);
  assert.deepEqual(scoring.triggersFrom(withDangerous), scoring.triggersFrom(clean));
  assert.equal(
    scoring.scoreBreakdown(withDangerous).total,
    scoring.scoreBreakdown(clean).total,
    "dangerous faults must not change the score"
  );
});

// --- 2. Rolling 12-month window ----------------------------------------------

test("a test counts for 12 months and drops off on its anniversary", () => {
  // Taken 7 Oct 2025.
  const taken = day("2025-10-07");
  const counts = (todayIso) => taken >= scoring.ratingWindowStart(new Date(`${todayIso}T12:00:00Z`), 12);

  assert.equal(counts("2025-10-07"), true, "counts on the day it was taken");
  assert.equal(counts("2026-10-06"), true, "still counts the day before the anniversary");
  assert.equal(counts("2026-10-07"), false, "gone on the anniversary");
  assert.equal(counts("2027-01-01"), false);
});

test("the window moves forward every day", () => {
  const starts = ["2026-10-05", "2026-10-06", "2026-10-07"].map((d) =>
    iso(scoring.ratingWindowStart(new Date(`${d}T12:00:00Z`), 12))
  );
  assert.deepEqual(starts, ["2025-10-06", "2025-10-07", "2025-10-08"]);
});

test("the day turns over at UK midnight, including British Summer Time", () => {
  // 23:30 UTC on 6 Oct 2026 is already 7 Oct in the UK (BST, UTC+1).
  assert.equal(iso(scoring.ratingWindowStart(new Date("2026-10-06T23:30:00Z"), 12)), "2025-10-08");
  // 23:30 UTC on 6 Jan 2027 is still 6 Jan in the UK (GMT).
  assert.equal(iso(scoring.ratingWindowStart(new Date("2027-01-06T23:30:00Z"), 12)), "2026-01-07");
});

test("month ends and leap days are handled", () => {
  // 29 Feb 2028 looks back to Feb 2027, which ends on the 28th.
  assert.equal(iso(scoring.ratingWindowStart(new Date("2028-02-29T12:00:00Z"), 12)), "2027-03-01");
  // A test on 29 Feb 2028 has dropped off by 28 Feb 2029's next day.
  assert.equal(iso(scoring.ratingWindowStart(new Date("2029-03-01T12:00:00Z"), 12)), "2028-03-02");
  // 31 Mar looking back 1 month lands on the last day of February.
  assert.equal(iso(scoring.ratingWindowStart(new Date("2027-03-31T12:00:00Z"), 1)), "2027-03-01");
});

// --- 3. Result must agree with the faults ------------------------------------

const { resultProblem } = require("../src/services/testRules");

test("a fail needs a serious or dangerous fault, or 16+ driving faults", () => {
  const f = (driving, serious, dangerous) => ({ driving, serious, dangerous });
  assert.ok(resultProblem({ result: "fail", faults: f(0, 0, 0) }), "Amy Drysdale's case");
  assert.ok(resultProblem({ result: "fail", faults: f(1, 0, 0) }), "Harry Kane's case");
  assert.ok(resultProblem({ result: "fail", faults: f(15, 0, 0) }));
  assert.equal(resultProblem({ result: "fail", faults: f(16, 0, 0) }), null);
  assert.equal(resultProblem({ result: "fail", faults: f(2, 1, 0) }), null);
  assert.equal(resultProblem({ result: "fail", faults: f(0, 0, 1) }), null);
});

test("a pass has no serious or dangerous faults and at most 15 driving faults", () => {
  const f = (driving, serious, dangerous) => ({ driving, serious, dangerous });
  assert.equal(resultProblem({ result: "pass", faults: f(15, 0, 0) }), null);
  assert.ok(resultProblem({ result: "pass", faults: f(16, 0, 0) }));
  assert.ok(resultProblem({ result: "pass", faults: f(3, 1, 0) }));
  assert.ok(resultProblem({ result: "pass", faults: f(3, 0, 1) }));
});

test("a report period of exactly 12 months is the standard window", () => {
  // 12 months ending 7 Oct 2026 starts 8 Oct 2025 - the dashboard's window.
  assert.equal(iso(scoring.ratingWindowStart(new Date("2026-10-07T12:00:00Z"), 12)), "2025-10-08");
});
