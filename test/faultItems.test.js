// The DL25 fault-by-fault entry the client asked for:
//   - the full DL25 list, grouped under its headings
//   - repeated driving faults on one item, plus serious / dangerous marks
//   - totals worked out from the items, so they are never entered twice
//   - totals-only tests left out of the category breakdown, and counted
//
//   npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { GROUPS, ITEMS } = require("../src/config/dl25");
const {
  normalizeFaultItems,
  totalsFromItems,
  faultBreakdown,
  recurringFaults,
} = require("../src/services/faultItems");

test("the list has every item on the DL25 form, each with a unique key", () => {
  assert.equal(ITEMS.length, 44);
  assert.equal(new Set(ITEMS.map((i) => i.key)).size, 44);
  assert.equal(GROUPS.find((g) => g.key === "junctions").items.length, 5);
  assert.equal(GROUPS.find((g) => g.key === "control").items.length, 6);
});

test("an item takes repeated driving faults and a serious or dangerous mark", () => {
  const items = normalizeFaultItems({
    "junctions.observation": { driving: 3, serious: 1 },
    "mirrors.changeDirection": { driving: 2, dangerous: true },
    "signals.timed": { driving: 0 },
  });
  assert.deepEqual(items, {
    "junctions.observation": { driving: 3, serious: 1, dangerous: 0 },
    "mirrors.changeDirection": { driving: 2, serious: 0, dangerous: 1 },
  });
  assert.deepEqual(totalsFromItems(items), { driving: 5, serious: 1, dangerous: 1 });
});

test("the eyesight test can only be marked serious, as on the form", () => {
  assert.deepEqual(normalizeFaultItems({ "eyesight.eyesight": { serious: 1 } }), {
    "eyesight.eyesight": { driving: 0, serious: 1, dangerous: 0 },
  });
  assert.throws(() => normalizeFaultItems({ "eyesight.eyesight": { driving: 1 } }));
  assert.throws(() => normalizeFaultItems({ "eyesight.eyesight": { dangerous: 1 } }));
});

test("unknown items and impossible marks are turned away", () => {
  assert.throws(() => normalizeFaultItems({ "junctions.reversing": { driving: 1 } }), /not an item/);
  assert.throws(() => normalizeFaultItems({ "junctions.observation": { serious: 2 } }));
  assert.throws(() => normalizeFaultItems({ "junctions.observation": { driving: -1 } }));
  assert.throws(() => normalizeFaultItems({ "junctions.observation": { driving: 1.5 } }));
  assert.throws(() => normalizeFaultItems([]));
});

test("the breakdown covers detailed entries only and says how many were left out", () => {
  const tests = [
    { faultItems: { "junctions.observation": { driving: 2, serious: 1, dangerous: 0 } } },
    {
      faultItems: {
        "junctions.observation": { driving: 1, serious: 0, dangerous: 0 },
        "mirrors.changeDirection": { driving: 4, serious: 0, dangerous: 0 },
        "judgement.meeting": { driving: 0, serious: 0, dangerous: 1 },
      },
    },
    // A clean detailed pass still counts as a detailed entry.
    { faultItems: {} },
    // Totals only: never in the breakdown, whatever its totals say.
    { faultItems: null, faults: { driving: 9, serious: 1, dangerous: 1 } },
  ];

  const breakdown = faultBreakdown(tests);
  assert.equal(breakdown.detailedTests, 3);
  assert.equal(breakdown.totalsOnlyTests, 1);

  assert.deepEqual(
    breakdown.drivingFaults.map((r) => [r.key, r.driving, r.testsWithDriving]),
    [
      ["mirrors.changeDirection", 4, 1],
      ["junctions.observation", 3, 2],
    ]
  );

  assert.deepEqual(
    breakdown.seriousDangerous.map((g) => [g.key, g.serious, g.dangerous]),
    [
      ["judgement", 0, 1],
      ["junctions", 1, 0],
    ]
  );
  assert.deepEqual(breakdown.seriousDangerous[1].items, [
    { key: "junctions.observation", label: "Observation", serious: 1, dangerous: 0 },
  ]);
});

test("recurring faults: an item on enough of the latest detailed tests is flagged", () => {
  const obs = { "junctions.observation": { driving: 1, serious: 0, dangerous: 0 } };
  const both = { ...obs, "mirrors.changeDirection": { driving: 2, serious: 1, dangerous: 0 } };
  const tests = [
    // newest first
    { faultItems: both },
    { faultItems: null, faults: { driving: 5, serious: 0, dangerous: 0 } }, // totals only: skipped
    { faultItems: obs },
    { faultItems: {} },
    { faultItems: both },
    // outside the last 4 detailed tests
    { faultItems: both },
  ];

  const result = recurringFaults(tests, { lookbackTests: 4, minAppearances: 2 });
  assert.equal(result.testsChecked, 4);
  assert.deepEqual(
    result.alerts.map((a) => [a.key, a.tests, a.driving, a.serious]),
    [
      ["junctions.observation", 3, 3, 0],
      ["mirrors.changeDirection", 2, 4, 2],
    ]
  );

  assert.equal(recurringFaults(tests, { lookbackTests: 4, minAppearances: 4 }).alerts.length, 0);
});
