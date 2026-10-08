// The instructor's rolling rating, over the last 12 months.
// Recalculated on every request, so it is always current after a new test.
//
// All the arithmetic lives in scoring.js, shared with the PDF report, so the
// dashboard and the report can never disagree.
const Test = require("../models/test.model");
const config = require("../config/performance");
const scoring = require("./scoring");

const { windowMonths, minTests, thresholds } = config;

async function getPerformance(instructorId) {
  const windowStart = scoring.ratingWindowStart();

  const tests = await Test.findAll(instructorId, { from: windowStart });

  const totals = scoring.totalsFrom(tests);
  const metrics = scoring.metricsFrom(totals);

  if (totals.tests === 0) {
    return {
      windowMonths,
      windowStart,
      passRateTarget: config.scoring.passRateTarget,
    standardsCheckAt: config.bands.redTriggers,
      total: 0,
      passed: 0,
      minTests,
      hasEnoughData: false,
      metrics,
      thresholds,
      triggers: [],
      score: 0,
      band: "green",
    };
  }

  const triggers = scoring.triggersFrom(metrics);

  return {
    windowMonths,
    // The oldest test date still counted, so the UI can say "since ...".
    windowStart,
    // Where the pass rate earns full marks; the gauge turns green from here.
    passRateTarget: config.scoring.passRateTarget,
    standardsCheckAt: config.bands.redTriggers,
    total: totals.tests,
    passed: totals.passed,
    minTests,
    // The instructor only sees the colour once there is enough to judge.
    hasEnoughData: totals.tests >= minTests,
    metrics,
    thresholds,
    triggers,
    score: scoring.scoreBreakdown(metrics).total,
    band: scoring.bandFor(triggers.length),
  };
}

module.exports = { getPerformance };
