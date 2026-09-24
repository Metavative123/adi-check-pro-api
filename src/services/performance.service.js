// Works out an instructor's performance over the last 12 months.
// Recalculated on every request, so it is always current after a new test.
const Test = require("../models/test.model");
const config = require("../config/performance");

// Thresholds, the window and the band rules are all configuration.
// See src/config/performance.js to change them.
const { windowMonths, minTests, thresholds, scoring, bands } = config;

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// How far along the scale a metric sits: 0 = spotless, 1 = exactly on its
// trigger, 2 = twice as bad as the trigger. Capped at 2.
function severity(value, threshold) {
  if (threshold <= 0) return 0;
  return Math.min(Math.max(value / threshold, 0), 2);
}

// Pass rate runs the other way: full marks at the target, on the trigger at
// the threshold, and it keeps falling below that.
function passRateSeverity(passRate) {
  const span = scoring.passRateTarget - thresholds.passRate;
  if (span <= 0) return passRate <= thresholds.passRate ? 1 : 0;
  return Math.min(Math.max((scoring.passRateTarget - passRate) / span, 0), 2);
}

// Each metric is worth 25 points, so the score runs 0-100. A metric sitting
// exactly on its trigger scores half marks, which puts the trigger line at 50:
// above 50 the metrics have headroom, below it they are past their thresholds.
function scoreFor(metrics) {
  const severities = [
    severity(metrics.drivingFaultAverage, thresholds.drivingFaultAverage),
    severity(metrics.seriousFaultAverage, thresholds.seriousFaultAverage),
    severity(metrics.physicalInterventionRate, thresholds.physicalInterventionRate),
    passRateSeverity(metrics.passRate),
  ];

  const points = severities.reduce((sum, s) => sum + 25 * (1 - s / 2), 0);
  return Math.round(points);
}

// The colour comes from how many metrics triggered - nothing else.
// An instructor who is inside every threshold is green, by definition.
function bandFor(triggerCount) {
  if (triggerCount >= bands.redTriggers) return "red";
  if (triggerCount >= bands.amberTriggers) return "amber";
  return "green";
}

async function getPerformance(instructorId) {
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - windowMonths);

  const tests = await Test.find({
    instructor: instructorId,
    testDate: { $gte: windowStart },
  }).select("result faults physicalIntervention");

  const total = tests.length;

  if (total === 0) {
    return {
      windowMonths,
      total: 0,
      passed: 0,
      minTests,
      hasEnoughData: false,
      metrics: {
        drivingFaultAverage: 0,
        seriousFaultAverage: 0,
        physicalInterventionRate: 0,
        passRate: 0,
      },
      thresholds,
      triggers: [],
      score: 0,
      band: "green",
    };
  }

  const totals = tests.reduce(
    (acc, t) => ({
      driving: acc.driving + (t.faults?.driving || 0),
      serious: acc.serious + (t.faults?.serious || 0),
      interventions: acc.interventions + (t.physicalIntervention ? 1 : 0),
      passed: acc.passed + (t.result === "pass" ? 1 : 0),
    }),
    { driving: 0, serious: 0, interventions: 0, passed: 0 }
  );

  const metrics = {
    drivingFaultAverage: round(totals.driving / total),
    seriousFaultAverage: round(totals.serious / total),
    physicalInterventionRate: round((totals.interventions / total) * 100, 1),
    passRate: round((totals.passed / total) * 100, 1),
  };

  const triggers = [];
  if (metrics.drivingFaultAverage >= thresholds.drivingFaultAverage)
    triggers.push("drivingFaultAverage");
  if (metrics.seriousFaultAverage >= thresholds.seriousFaultAverage)
    triggers.push("seriousFaultAverage");
  if (metrics.physicalInterventionRate >= thresholds.physicalInterventionRate)
    triggers.push("physicalInterventionRate");
  if (metrics.passRate <= thresholds.passRate) triggers.push("passRate");

  const score = scoreFor(metrics);

  return {
    windowMonths,
    total,
    passed: totals.passed,
    minTests,
    // The instructor only sees the colour once there is enough to judge.
    hasEnoughData: total >= minTests,
    metrics,
    thresholds,
    triggers,
    score,
    band: bandFor(triggers.length),
  };
}

module.exports = { getPerformance };
