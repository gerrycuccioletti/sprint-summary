// src/store.js
// Persists sprint reports to ./output/reports.json
// Keeps the last MAX_REPORTS_PER_BOARD reports per board

const fs   = require('fs');
const path = require('path');

const STORE_PATH          = path.resolve('./output/reports.json');
const MAX_REPORTS_PER_BOARD = 20;

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(data) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Save a completed sprint analysis to the store.
 */
function saveReport(boardId, sprint, analysis) {
  const store = readStore();
  const key   = String(boardId);

  if (!store[key]) store[key] = [];

  store[key].unshift({
    boardId:   key,
    sprintId:  sprint.id,
    sprintName: sprint.name,
    runAt:     new Date().toISOString(),
    analysis,
  });

  // Keep only the most recent N reports per board
  store[key] = store[key].slice(0, MAX_REPORTS_PER_BOARD);

  writeStore(store);
}

/**
 * Get all stored reports, optionally filtered by boardId.
 */
function getReports(boardId = null) {
  const store = readStore();
  if (boardId) return store[String(boardId)] || [];
  return store;
}

/**
 * Get the most recent report for a given board.
 */
function getLatestReport(boardId) {
  const reports = getReports(String(boardId));
  return reports[0] || null;
}

/**
 * Get all board IDs that have stored reports.
 */
function getAllBoardIds() {
  return Object.keys(readStore());
}

/**
 * Get a summary of all boards (latest report per board).
 */
function getBoardSummaries() {
  const store = readStore();
  return Object.entries(store).map(([boardId, reports]) => ({
    boardId,
    latestRun:    reports[0]?.runAt || null,
    sprintName:   reports[0]?.sprintName || null,
    health:       reports[0]?.analysis?.overallHealth || null,
    healthReason: reports[0]?.analysis?.healthReason || null,
    totalIssues:  reports[0]?.analysis?.stats?.total || 0,
    riskCount:    reports[0]?.analysis?.risks?.length || 0,
    blockerCount: reports[0]?.analysis?.blockers?.length || 0,
    runCount:     reports.length,
  }));
}

module.exports = { saveReport, getReports, getLatestReport, getAllBoardIds, getBoardSummaries };
