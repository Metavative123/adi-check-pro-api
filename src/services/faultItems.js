// Faults logged item by item against the DL25 form (see config/dl25.js).
//
// A test is entered one of two ways, never both, so nothing is counted twice:
//   detailed  faultItems holds each DL25 item marked; the three totals are
//             worked out from it here and cannot be typed in
//   totals    faultItems is null and only the three totals were entered.
//             These tests count in every figure except the category breakdown.
//
// Stored shape, with only the items that have a fault:
//   { "junctions.observation": { driving: 2, serious: 1, dangerous: 0 }, ... }
// driving is a count, as the examiner tallies them. serious and dangerous are
// marks, 0 or 1, as on the form.
const ApiError = require("../utils/ApiError");
const { GROUPS, ITEMS, ITEM_BY_KEY } = require("../config/dl25");

// Generous, but stops a typo of 300 instead of 3 being saved.
const MAX_DRIVING_PER_ITEM = 20;

// what is e.g. "Junctions: Observation driving faults".
function count(value, max, what) {
  const n = value === true ? 1 : value === false || value == null ? 0 : Number(value);
  if (max === 0 && n !== 0) throw new ApiError(400, `${what} cannot be recorded on the DL25`);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new ApiError(400, `${what} must be a whole number from 0 to ${max}`);
  }
  return n;
}

// Checks the items against the form and drops the ones with nothing marked.
function normalizeFaultItems(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "Fault items could not be read");
  }

  const clean = {};
  for (const [key, marks] of Object.entries(raw)) {
    const item = ITEM_BY_KEY.get(key);
    if (!item) throw new ApiError(400, `"${key}" is not an item on the DL25`);

    const name = item.groupLabel === item.label ? item.label : `${item.groupLabel}: ${item.label}`;
    const entry = {
      driving: count(marks?.driving, item.drivingFaults ? MAX_DRIVING_PER_ITEM : 0, `${name} driving faults`),
      serious: count(marks?.serious, 1, `${name} serious fault`),
      dangerous: count(marks?.dangerous, item.dangerous ? 1 : 0, `${name} dangerous fault`),
    };
    if (entry.driving || entry.serious || entry.dangerous) clean[key] = entry;
  }
  return clean;
}

function totalsFromItems(items) {
  const totals = { driving: 0, serious: 0, dangerous: 0 };
  for (const marks of Object.values(items || {})) {
    totals.driving += marks.driving || 0;
    totals.serious += marks.serious || 0;
    totals.dangerous += marks.dangerous || 0;
  }
  return totals;
}

// Which items and headings come up across a set of tests. Only detailed
// entries can be broken down; the rest are counted so the reader knows what
// the breakdown leaves out.
function faultBreakdown(tests) {
  const detailed = tests.filter((t) => t.faultItems);

  const items = ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    group: item.group,
    groupLabel: item.groupLabel,
    driving: 0,
    serious: 0,
    dangerous: 0,
    // How many tests the item had a driving fault on: a fault that comes up
    // test after test is the one to work on.
    testsWithDriving: 0,
  }));
  const byKey = new Map(items.map((item) => [item.key, item]));

  for (const test of detailed) {
    for (const [key, marks] of Object.entries(test.faultItems)) {
      const row = byKey.get(key);
      if (!row) continue;
      row.driving += marks.driving || 0;
      row.serious += marks.serious || 0;
      row.dangerous += marks.dangerous || 0;
      if (marks.driving) row.testsWithDriving += 1;
    }
  }

  const groups = GROUPS.map((group) => {
    const rows = items.filter((row) => row.group === group.key);
    const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
    return {
      key: group.key,
      label: group.label,
      driving: sum("driving"),
      serious: sum("serious"),
      dangerous: sum("dangerous"),
    };
  });

  return {
    detailedTests: detailed.length,
    totalsOnlyTests: tests.length - detailed.length,
    // Most driving faults first; ties go to the one seen on more tests.
    drivingFaults: items
      .filter((row) => row.driving > 0)
      .sort((a, b) => b.driving - a.driving || b.testsWithDriving - a.testsWithDriving)
      .map(({ key, label, groupLabel, driving, testsWithDriving }) => ({
        key,
        label,
        groupLabel,
        driving,
        testsWithDriving,
      })),
    // Headings with a serious or dangerous fault, worst first, with the items
    // behind them.
    seriousDangerous: groups
      .filter((group) => group.serious + group.dangerous > 0)
      .sort((a, b) => b.dangerous - a.dangerous || b.serious - a.serious)
      .map((group) => ({
        key: group.key,
        label: group.label,
        serious: group.serious,
        dangerous: group.dangerous,
        items: items
          .filter((row) => row.group === group.key && row.serious + row.dangerous > 0)
          .map(({ key, label, serious, dangerous }) => ({ key, label, serious, dangerous })),
      })),
  };
}

module.exports = { MAX_DRIVING_PER_ITEM, normalizeFaultItems, totalsFromItems, faultBreakdown };
