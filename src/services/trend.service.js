// Monthly buckets for the dashboard charts.
// One payload feeds the pass-rate trend, the test breakdown and the
// fault-category chart, so the dashboard makes a single request per range.
const Test = require("../models/test.model");

const RANGES = { "6": 6, "12": 12, all: null };

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date) {
  return date.toLocaleString("en-GB", { month: "short", year: "2-digit" });
}

// Every month from `start` to now, so gaps in testing show as gaps.
function monthsBetween(start, end) {
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= last) {
    months.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

async function getTrend(instructorId, range = "12") {
  const months = RANGES[String(range)] === undefined ? 12 : RANGES[String(range)];
  const now = new Date();

  const query = { instructor: instructorId };
  if (months) {
    const start = new Date();
    start.setMonth(start.getMonth() - (months - 1));
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    query.testDate = { $gte: start };
  }

  const tests = await Test.find(query)
    .select("testDate result faults")
    .sort({ testDate: 1 });

  // Nothing logged yet - return an empty series rather than a fake one.
  if (tests.length === 0) {
    return { range: String(range), months: [], totals: emptyTotals() };
  }

  const start = months
    ? new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
    : new Date(tests[0].testDate);

  const buckets = new Map();
  for (const date of monthsBetween(start, now)) {
    buckets.set(monthKey(date), {
      month: monthKey(date),
      label: monthLabel(date),
      total: 0,
      passed: 0,
      failed: 0,
      passRate: null, // null, not 0 - a month with no tests is a gap
      driving: 0,
      serious: 0,
      dangerous: 0,
    });
  }

  for (const test of tests) {
    const bucket = buckets.get(monthKey(new Date(test.testDate)));
    if (!bucket) continue; // outside the window

    bucket.total += 1;
    if (test.result === "pass") bucket.passed += 1;
    else bucket.failed += 1;
    bucket.driving += test.faults?.driving || 0;
    bucket.serious += test.faults?.serious || 0;
    bucket.dangerous += test.faults?.dangerous || 0;
  }

  const monthsOut = [...buckets.values()].map((b) => ({
    ...b,
    passRate: b.total ? Math.round((b.passed / b.total) * 1000) / 10 : null,
  }));

  return {
    range: String(range),
    months: monthsOut,
    totals: monthsOut.reduce(
      (acc, m) => ({
        tests: acc.tests + m.total,
        passed: acc.passed + m.passed,
        failed: acc.failed + m.failed,
        driving: acc.driving + m.driving,
        serious: acc.serious + m.serious,
        dangerous: acc.dangerous + m.dangerous,
      }),
      emptyTotals()
    ),
  };
}

function emptyTotals() {
  return { tests: 0, passed: 0, failed: 0, driving: 0, serious: 0, dangerous: 0 };
}

module.exports = { getTrend };
