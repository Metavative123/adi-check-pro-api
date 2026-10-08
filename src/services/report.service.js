// Builds the data behind the PDF standards report.
//
// The report covers a period the instructor chooses, and shows the working for
// every figure plus the rules used to derive the overall score - so the PDF can
// be read and checked by someone who has never seen the app.
const Test = require("../models/test.model");
const User = require("../models/user.model");
const ApiError = require("../utils/ApiError");
const config = require("../config/performance");
const scoring = require("./scoring");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Read dates as whole UTC days so the last day of the range is included.
function startOfDay(value) {
  return DATE_ONLY.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
}

function endOfDay(value) {
  return DATE_ONLY.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function buildReport(instructorId, { from, to, hideNames = false } = {}) {
  if (!from || !to) throw new ApiError(400, "A start and end date are both required");

  const start = startOfDay(String(from));
  const end = endOfDay(String(to));

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(400, "Those dates could not be read");
  }
  if (start > end) throw new ApiError(400, "The start date must be before the end date");

  const user = await User.findById(instructorId);
  if (!user) throw new ApiError(404, "User not found");

  const tests = await Test.findAll(instructorId, { from: start, to: end }, { order: "oldest" });

  // Is the chosen period exactly the standard window (12 months ending on the
  // "to" date)? If it also ends today, it is the dashboard's period exactly.
  const fromIso = start.toISOString().slice(0, 10);
  const toIso = end.toISOString().slice(0, 10);
  const windowForTo = scoring.ratingWindowStart(new Date(`${toIso}T12:00:00.000Z`));
  const isStandardWindow = windowForTo.toISOString().slice(0, 10) === fromIso;
  const matchesDashboard = isStandardWindow && toIso === scoring.ukDate(new Date());

  const totals = scoring.totalsFrom(tests);
  const metrics = scoring.metricsFrom(totals);
  const triggers = totals.tests ? scoring.triggersFrom(metrics) : [];
  const breakdown = scoring.scoreBreakdown(metrics);
  const band = scoring.bandFor(triggers.length);

  return {
    generatedAt: new Date().toISOString(),

    period: {
      from: DATE_ONLY.test(String(from)) ? String(from) : start.toISOString().slice(0, 10),
      to: DATE_ONLY.test(String(to)) ? String(to) : end.toISOString().slice(0, 10),
      label: `${formatDate(start)} to ${formatDate(end)}`,
      // True when the period is exactly the standard rolling window.
      isStandardWindow,
      // True when it is also the period the dashboard shows today.
      matchesDashboard,
      windowMonths: config.windowMonths,
    },

    instructor: {
      name: user.name,
      adiBadgeNumber: user.adiBadgeNumber || "Not set",
      testCenters: user.testCenters.map((c) => (c.code ? `${c.name} (${c.code})` : c.name)),
    },

    // Names are dropped here, not in the browser, so a report asked for
    // without names never contains one.
    namesHidden: Boolean(hideNames),

    totals,
    metrics,
    triggers,

    // How each metric was arrived at.
    workings: scoring.workingsFor(totals, metrics),

    score: {
      total: totals.tests ? breakdown.total : 0,
      rows: totals.tests ? breakdown.rows : [],
      pointsPerMetric: scoring.POINTS_PER_METRIC,
    },

    band,
    // The colour is only shown to the instructor once there is enough to judge,
    // but it is always calculated so an assessor can see it.
    hasEnoughData: totals.tests >= config.minTests,

    rules: scoring.ruleSummary(),

    // True when the chosen period is not the standard rating window, so the
    // report can say so rather than implying these are the official figures.
    // Only when the period is not the standard window: then the figures can
    // differ from the dashboard, and the report says so.
    windowNote: isStandardWindow
      ? null
      : `Thresholds are defined against a rolling ${config.windowMonths}-month window. ` +
        `This report covers the period selected above, so the figures may differ from ` +
        `the ${config.windowMonths}-month rating shown in the app.`,

    tests: tests.map((t) => ({
      reference: t.reference,
      date: formatDate(t.testDate),
      pupilName: hideNames ? null : t.pupilName,
      testCenter: t.testCenter?.name || "",
      result: t.result,
      driving: t.faults?.driving || 0,
      serious: t.faults?.serious || 0,
      dangerous: t.faults?.dangerous || 0,
      physicalIntervention: Boolean(t.physicalIntervention),
      verbalIntervention: Boolean(t.verbalIntervention),
    })),
  };
}

module.exports = { buildReport };
