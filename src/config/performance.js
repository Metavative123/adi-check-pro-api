// Every tunable value for the performance rating lives here - nothing is
// hard-coded in the service. Change a number in this file, or set the matching
// environment variable, and the API and dashboard both follow.
require("dotenv").config();

// Reads a number from the environment, falling back to the default.
// A non-numeric value is a mistake worth stopping for, not silently ignoring.
function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(`${name} must be a number, got "${raw}". Check your .env file.`);
    process.exit(1);
  }
  return value;
}

module.exports = {
  // How far back the rating looks.
  windowMonths: num("PERF_WINDOW_MONTHS", 12),

  // Below this many tests in the window the instructor is not shown a colour.
  // The score and band are still calculated, for admin use.
  minTests: num("PERF_MIN_TESTS", 5),

  // A metric triggers when it reaches its threshold.
  // Faults and intervention: at or ABOVE. Pass rate: at or BELOW.
  thresholds: {
    drivingFaultAverage: num("PERF_DRIVING_FAULT_AVERAGE", 6),
    seriousFaultAverage: num("PERF_SERIOUS_FAULT_AVERAGE", 0.55),
    physicalInterventionRate: num("PERF_PHYSICAL_INTERVENTION_RATE", 10), // percent
    passRate: num("PERF_PASS_RATE", 55), // percent
  },

  scoring: {
    // A pass rate at or above this scores full marks; it slides down to zero
    // at the pass rate threshold. Scoring only - it never causes a trigger.
    passRateTarget: num("PERF_PASS_RATE_TARGET", 70),
  },

  // How the colour is chosen, by how many metrics have triggered.
  bands: {
    redTriggers: num("PERF_RED_TRIGGERS", 3), // this many triggers or more
    amberTriggers: num("PERF_AMBER_TRIGGERS", 1),
  },
};
