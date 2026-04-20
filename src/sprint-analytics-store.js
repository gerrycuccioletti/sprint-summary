// src/sprint-analytics-store.js
const fs   = require('fs');
const path = require('path');

const STORE_PATH = path.resolve('./output/sprint-analytics.json');
const MAX_PER_BOARD = 10;

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch { return {}; }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function saveAnalyticsReport(boardId, analysis) {
  const store = readStore();
  const key   = String(boardId);
  if (!store[key]) store[key] = [];
  store[key].unshift({
    boardId:    key,
    sprintId:   analysis.sprintReport?.sprintId,
    sprintName: analysis.sprintReport?.sprintName,
    runAt:      new Date().toISOString(),
    analysis,
  });
  store[key] = store[key].slice(0, MAX_PER_BOARD);
  writeStore(store);
}

function getAnalyticsReports(boardId) {
  return readStore()[String(boardId)] || [];
}

function getLatestAnalyticsReport(boardId) {
  return getAnalyticsReports(boardId)[0] || null;
}

function getAllAnalyticsSummaries() {
  const store = readStore();
  return Object.entries(store).map(([boardId, reports]) => {
    const latest = reports[0];
    const a      = latest?.analysis;
    return {
      boardId,
      sprintName:        latest?.sprintName || null,
      latestRun:         latest?.runAt      || null,
      sprintHealth:      a?.sprintHealth    || null,
      completion:        a?.completion?.pct || 0,
      velocityAvg:       a?.velocityStats?.avg || 0,
      velocityTrend:     a?.velocityStats?.trend || null,
      predictedVelocity: a?.predictedVelocity || 0,
    };
  });
}

module.exports = { saveAnalyticsReport, getAnalyticsReports, getLatestAnalyticsReport, getAllAnalyticsSummaries };
