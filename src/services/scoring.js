// The scoring maths, in one place.
//
// Both the dashboard rating and the PDF report use these functions, so the two
// can never disagree. Every threshold comes from src/config/performance.js.
//
// This module is pure: give it a list of tests, it gives back the numbers and
// the working behind them. It does not touch the database.
const config = require("../config/performance");

const { thresholds, scoring, bands } = config;

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// The four metrics, described once. `kind` says which direction is bad:
// "lower" metrics trigger at or ABOVE their threshold, "higher" at or BELOW.
const METRICS = [
  {
    key: "drivingFaultAverage",
    label: "Driving fault average",
    kind: "lower",
    unit: "",
    decimals: 2,
    meaning: "Total driving faults divided by the number of tests.",
    formula: (t, n) => `${t.driving} driving faults / ${n} tests`,
    compute: (t, n) => round(t.driving / n, 2),
  },
  {
    key: "seriousFaultAverage",
    label: "Serious fault average",
    kind: "lower",
    unit: "",
    decimals: 2,
    meaning: "Total serious faults divided by the number of tests.",
    formula: (t, n) => `${t.serious} serious faults / ${n} tests`,
    compute: (t, n) => round(t.serious / n, 2),
  },
  {
    key: "physicalInterventionRate",
    label: "Physical intervention rate",
    kind: "lower",
    unit: "%",
    decimals: 1,
    meaning:
      "Tests where the examiner physically intervened, as a percentage of all tests.",
    formula: (t, n) => `(${t.interventions} tests with intervention / ${n} tests) x 100`,
    compute: (t, n) => round((t.interventions / n) * 100, 1),
  },
  {
    key: "passRate",
    label: "Pass rate",
    kind: "higher",
    unit: "%",
    decimals: 1,
    meaning: "Tests passed as a percentage of all tests.",
    formula: (t, n) => `(${t.passed} passes / ${n} tests) x 100`,
    compute: (t, n) => round((t.passed / n) * 100, 1),
  },
];

function emptyTotals() {
  return {
    tests: 0,
    passed: 0,
    failed: 0,
    driving: 0,
    serious: 0,
    dangerous: 0,
    interventions: 0,
    verbalInstructions: 0,
  };
}

function totalsFrom(tests) {
  return tests.reduce((acc, t) => {
    acc.tests += 1;
    if (t.result === "pass") acc.passed += 1;
    else acc.failed += 1;
    acc.driving += t.faults?.driving || 0;
    acc.serious += t.faults?.serious || 0;
    acc.dangerous += t.faults?.dangerous || 0;
    if (t.physicalIntervention) acc.interventions += 1;
    if (t.verbalIntervention) acc.verbalInstructions += 1;
    return acc;
  }, emptyTotals());
}

function metricsFrom(totals) {
  const n = totals.tests;
  if (!n) {
    return {
      drivingFaultAverage: 0,
      seriousFaultAverage: 0,
      physicalInterventionRate: 0,
      passRate: 0,
    };
  }

  return METRICS.reduce((acc, metric) => {
    acc[metric.key] = metric.compute(totals, n);
    return acc;
  }, {});
}

function isTriggered(metric, value) {
  const threshold = thresholds[metric.key];
  return metric.kind === "lower" ? value >= threshold : value <= threshold;
}

function triggersFrom(metrics) {
  return METRICS.filter((m) => isTriggered(m, metrics[m.key])).map((m) => m.key);
}

// How far along the scale a metric sits: 0 = spotless, 1 = exactly on its
// trigger, 2 = twice as bad as the trigger. Capped at 2.
function severityFor(metric, value) {
  const threshold = thresholds[metric.key];

  if (metric.kind === "higher") {
    // Pass rate runs the other way: full marks at the target, on the trigger
    // at the threshold, and it keeps falling below that.
    const span = scoring.passRateTarget - threshold;
    if (span <= 0) return value <= threshold ? 1 : 0;
    return Math.min(Math.max((scoring.passRateTarget - value) / span, 0), 2);
  }

  if (threshold <= 0) return 0;
  return Math.min(Math.max(value / threshold, 0), 2);
}

const POINTS_PER_METRIC = 100 / METRICS.length;

// Each metric is worth 25 points, so the score runs 0-100. A metric sitting
// exactly on its trigger scores half marks, which puts the trigger line at 50:
// above 50 the metrics have headroom, below it they are past their thresholds.
function scoreBreakdown(metrics) {
  const rows = METRICS.map((metric) => {
    const value = metrics[metric.key];
    const severity = severityFor(metric, value);
    const points = POINTS_PER_METRIC * (1 - severity / 2);

    return {
      key: metric.key,
      label: metric.label,
      value,
      unit: metric.unit,
      threshold: thresholds[metric.key],
      comparison: metric.kind === "lower" ? "at or above" : "at or below",
      triggered: isTriggered(metric, value),
      severity: round(severity, 3),
      points: round(points, 1),
      maxPoints: POINTS_PER_METRIC,
      // The arithmetic, spelled out for the report.
      working:
        metric.kind === "higher"
          ? `(${scoring.passRateTarget} - ${value}) / (${scoring.passRateTarget} - ${thresholds[metric.key]}) = ${round(severity, 3)} severity; ${POINTS_PER_METRIC} x (1 - ${round(severity, 3)} / 2) = ${round(points, 1)} points`
          : `${value} / ${thresholds[metric.key]} = ${round(severity, 3)} severity; ${POINTS_PER_METRIC} x (1 - ${round(severity, 3)} / 2) = ${round(points, 1)} points`,
    };
  });

  const total = Math.round(rows.reduce((sum, row) => sum + row.points, 0));
  return { rows, total };
}

// The colour comes from how many metrics triggered - nothing else.
// An instructor who is inside every threshold is green, by definition.
function bandFor(triggerCount) {
  if (triggerCount >= bands.redTriggers) return "red";
  if (triggerCount >= bands.amberTriggers) return "amber";
  return "green";
}

// Metric-by-metric working, for the report's "how this was calculated" table.
function workingsFor(totals, metrics) {
  const n = totals.tests;

  return METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    meaning: metric.meaning,
    formula: n ? metric.formula(totals, n) : "no tests in this period",
    value: metrics[metric.key],
    unit: metric.unit,
    decimals: metric.decimals,
    threshold: thresholds[metric.key],
    triggerRule:
      metric.kind === "lower"
        ? `Triggers at ${thresholds[metric.key]}${metric.unit} or more`
        : `Triggers at ${thresholds[metric.key]}${metric.unit} or less`,
    triggered: n ? isTriggered(metric, metrics[metric.key]) : false,
  }));
}

// Everything the report needs to print the rules it applied.
function ruleSummary() {
  return {
    windowMonths: config.windowMonths,
    minTests: config.minTests,
    passRateTarget: scoring.passRateTarget,
    pointsPerMetric: POINTS_PER_METRIC,
    redTriggers: bands.redTriggers,
    amberTriggers: bands.amberTriggers,
    thresholds,
    metrics: METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      unit: m.unit,
      threshold: thresholds[m.key],
      rule:
        m.kind === "lower"
          ? `${thresholds[m.key]}${m.unit} or more triggers`
          : `${thresholds[m.key]}${m.unit} or less triggers`,
    })),
  };
}

module.exports = {
  METRICS,
  POINTS_PER_METRIC,
  round,
  emptyTotals,
  totalsFrom,
  metricsFrom,
  triggersFrom,
  severityFor,
  scoreBreakdown,
  bandFor,
  workingsFor,
  ruleSummary,
};
