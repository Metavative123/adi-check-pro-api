// Whether a test's result agrees with its faults, under the DVSA marking rules:
//   - one serious or dangerous fault is a fail
//   - 16 or more driving faults is a fail, even with no serious or dangerous
//   - so a pass has no serious or dangerous faults and at most 15 driving faults
//
// The web app applies the same rule (src/lib/testRules.ts) so the instructor
// sees the problem before saving; this is the check that cannot be skipped.
const MAX_DRIVING_FAULTS_FOR_PASS = 15;

// Returns a message describing the problem, or null when the test is consistent.
function resultProblem({ result, faults = {} }) {
  const driving = faults.driving || 0;
  const failLevel = (faults.serious || 0) + (faults.dangerous || 0);

  if (result === "fail" && failLevel === 0 && driving <= MAX_DRIVING_FAULTS_FOR_PASS) {
    return (
      "A fail needs at least one serious or dangerous fault " +
      `(or more than ${MAX_DRIVING_FAULTS_FOR_PASS} driving faults). Add the fault that caused the fail.`
    );
  }
  if (result === "pass" && failLevel > 0) {
    return "A pass cannot have serious or dangerous faults. Check the result or the faults.";
  }
  if (result === "pass" && driving > MAX_DRIVING_FAULTS_FOR_PASS) {
    return `A pass allows at most ${MAX_DRIVING_FAULTS_FOR_PASS} driving faults. Check the result or the faults.`;
  }
  return null;
}

module.exports = { MAX_DRIVING_FAULTS_FOR_PASS, resultProblem };
