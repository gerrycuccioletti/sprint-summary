// src/release-store.js
// Persists release health reports to ./output/releases.json

const fs   = require('fs');
const path = require('path');

const STORE_PATH            = path.resolve('./output/releases.json');
const MAX_REPORTS_PER_VERSION = 10;

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

function saveReleaseReport(projectKey, version, analysis) {
  const store = readStore();
  const key   = `${projectKey}::${version.name}`;

  if (!store[key]) store[key] = [];
  store[key].unshift({
    projectKey,
    versionId:   version.id,
    versionName: version.name,
    releaseDate: version.releaseDate || null,
    runAt:       new Date().toISOString(),
    analysis,
  });
  store[key] = store[key].slice(0, MAX_REPORTS_PER_VERSION);
  writeStore(store);
}

function getReleaseReports(projectKey, versionName) {
  const store = readStore();
  return store[`${projectKey}::${versionName}`] || [];
}

function getLatestReleaseReport(projectKey, versionName) {
  return getReleaseReports(projectKey, versionName)[0] || null;
}

// Get all unique project keys that have stored release reports
function getAllProjectKeys() {
  return [...new Set(Object.keys(readStore()).map(k => k.split('::')[0]))];
}

// Summary of all releases (latest report per version)
function getAllReleaseSummaries() {
  const store = readStore();
  return Object.entries(store).map(([key, reports]) => {
    const [projectKey, versionName] = key.split('::');
    const latest = reports[0];
    return {
      projectKey,
      versionName,
      releaseDate:      latest?.releaseDate || null,
      latestRun:        latest?.runAt || null,
      health:           latest?.analysis?.overallHealth || null,
      readiness:        latest?.analysis?.readiness || 0,
      feasibility:      latest?.analysis?.releaseFeasibility || null,
      totalIssues:      latest?.analysis?.stats?.total || 0,
      done:             latest?.analysis?.stats?.done || 0,
      riskCount:        latest?.analysis?.risks?.length || 0,
      blockerCount:     latest?.analysis?.blockers?.length || 0,
      criticalCount:    latest?.analysis?.criticalUnfinished?.length || 0,
    };
  });
}

module.exports = {
  saveReleaseReport,
  getReleaseReports,
  getLatestReleaseReport,
  getAllProjectKeys,
  getAllReleaseSummaries,
};
