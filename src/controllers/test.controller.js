const testService = require("../services/test.service");
const performanceService = require("../services/performance.service");
const trendService = require("../services/trend.service");

async function createTest(req, res) {
  const test = await testService.createTest(req.user.id, req.body);
  res.status(201).json({ success: true, data: { test } });
}

async function listTests(req, res) {
  const { tests, pagination } = await testService.listTests(req.user.id, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    from: req.query.from,
    to: req.query.to,
    physicalIntervention: req.query.physicalIntervention,
    verbalIntervention: req.query.verbalIntervention,
  });
  res.json({ success: true, data: { tests, pagination } });
}

// Monthly buckets for the charts. range is "6", "12" or "all".
async function getTrend(req, res) {
  const trend = await trendService.getTrend(req.user.id, req.query.range);
  res.json({ success: true, data: { trend } });
}

// Recalculated on every call, so it is up to date after each new test.
async function getPerformance(req, res) {
  const performance = await performanceService.getPerformance(req.user.id);
  res.json({ success: true, data: { performance } });
}

async function updateTest(req, res) {
  const { test, affectsRating } = await testService.updateTest(
    req.user.id,
    req.params.testId,
    req.body
  );
  // affectsRating tells the client whether the performance figures moved.
  res.json({ success: true, data: { test, affectsRating } });
}

async function deleteTest(req, res) {
  await testService.deleteTest(req.user.id, req.params.testId);
  res.json({ success: true, message: "Test deleted" });
}

module.exports = {
  createTest,
  listTests,
  getTrend,
  getPerformance,
  updateTest,
  deleteTest,
};
