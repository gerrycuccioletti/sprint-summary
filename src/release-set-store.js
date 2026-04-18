// src/release-set-store.js
const fs   = require('fs');
const path = require('path');

const STORE_PATH           = path.resolve('./output/release-sets.json');
const MAX_REPORTS_PER_SET  = 10;

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

function saveSetReport(setName, versionNames, analysis, pattern = null) {
  const store = readStore();
  if (!store[setName]) store[setName] = [];

  store[setName].unshift({
    setName,
    versionNames,
    pattern:  pattern || null,
    runAt:    new Date().toISOString(),
    analysis,
  });

  store[setName] = store[setName].slice(0, MAX_REPORTS_PER_SET);
  writeStore(store);
}

function getSetReports(setName) {
  return readStore()[setName] || [];
}

function getLatestSetReport(setName) {
  return getSetReports(setName)[0] || null;
}

function getAllSetSummaries() {
  const store = readStore();
  return Object.entries(store).map(([setName, reports]) => {
    const latest = reports[0];
    const a      = latest?.analysis;
    return {
      setName,
      versionNames:    latest?.versionNames   || [],
      latestRun:       latest?.runAt          || null,
      health:          a?.overallHealth       || null,
      readiness:       a?.readiness           || 0,
      feasibility:     a?.releaseFeasibility  || null,
      totalIssues:     a?.stats?.total        || 0,
      done:            a?.stats?.done         || 0,
      projectCount:    a?.stats?.projectCount || 0,
      teamCount:       a?.stats?.teamCount    || 0,
      crossBlockers:   a?.crossProjectBlockers?.length || 0,
      runCount:        reports.length,
    };
  });
}

module.exports = { saveSetReport, getSetReports, getLatestSetReport, getAllSetSummaries };
