// src/release-pipeline.js
// Release health pipeline: fetch FixVersion → Claude → dispatch to all reporters

const { getProjectVersions, getVersionIssues, normalizeVersionIssues } = require('./jira');
const { analyzeReleaseWithClaude }   = require('./release-claude');
const { printReleaseReport }         = require('./reporters/release-console');
const { generateReleaseHtmlReport }  = require('./reporters/release-html');
const { sendReleaseSlackNotification } = require('./reporters/release-slack');
const releaseStore                   = require('./release-store');

/**
 * Run the release health pipeline for one version of a project.
 *
 * @param {string} projectKey   e.g. "MYPROJECT"
 * @param {string} versionName  e.g. "v2.1.0"
 * @param {object} opts
 * @param {boolean} [opts.console=true]
 * @param {boolean} [opts.slack=false]
 * @param {boolean} [opts.html=false]
 * @param {boolean} [opts.store=true]
 */
async function runReleasePipeline(projectKey, versionName, opts = {}) {
  const options = { console: true, slack: false, html: false, store: true, ...opts };
  const label   = `[${projectKey} / ${versionName}]`;

  console.log(`\n${label} Fetching version info...`);
  const versions = await getProjectVersions(projectKey);
  const version  = versions.find(v => v.name === versionName);
  if (!version) throw new Error(`Version "${versionName}" not found in project ${projectKey}.`);

  console.log(`${label} Fetching issues...`);
  const rawIssues = await getVersionIssues(projectKey, versionName);
  const issues    = normalizeVersionIssues(rawIssues);
  console.log(`${label} ${issues.length} issues loaded.`);

  console.log(`${label} Analyzing with Claude...`);
  const analysis = await analyzeReleaseWithClaude(version, issues);

  const result = { version, analysis };

  if (options.console) printReleaseReport(analysis, version);

  if (options.slack) {
    console.log(`${label} Sending Slack notification...`);
    await sendReleaseSlackNotification(analysis, version, projectKey);
    console.log(`${label} Slack sent.`);
  }

  if (options.html) {
    result.htmlPath = generateReleaseHtmlReport(analysis, version, projectKey, './output');
    console.log(`${label} HTML saved: ${result.htmlPath}`);
  }

  if (options.store) {
    releaseStore.saveReleaseReport(projectKey, version, analysis);
  }

  return result;
}

/**
 * Run the pipeline across multiple versions of a project.
 * If versionNames is empty, targets all unreleased versions automatically.
 */
async function runMultiVersionPipeline(projectKey, versionNames = [], opts = {}) {
  let targetNames = versionNames;

  if (!targetNames.length) {
    console.log(`\n[${projectKey}] No versions specified — fetching all unreleased versions...`);
    const versions = await getProjectVersions(projectKey, 'unreleased');
    targetNames    = versions.map(v => v.name);
    console.log(`[${projectKey}] Found: ${targetNames.join(', ') || 'none'}`);
  }

  const results = [];
  for (const name of targetNames) {
    try {
      const result = await runReleasePipeline(projectKey, name, opts);
      results.push({ versionName: name, ...result });
    } catch (err) {
      console.error(`[${projectKey} / ${name}] Failed: ${err.message}`);
      results.push({ versionName: name, error: err.message });
    }
  }
  return results;
}

/**
 * Parse JIRA_RELEASE_VERSIONS env var into a { projectKey, versions[] } config.
 * Format: "MYPROJECT:v1.0,v2.0;OTHERPROJECT:v3.0"
 * Or simply: "MYPROJECT" (will auto-detect unreleased versions)
 */
function getReleaseConfigFromEnv() {
  const raw = process.env.JIRA_RELEASE_VERSIONS || '';
  if (!raw) {
    const projectKey = process.env.JIRA_PROJECT_KEY;
    if (!projectKey) throw new Error('Set JIRA_RELEASE_VERSIONS or JIRA_PROJECT_KEY in .env');
    return [{ projectKey, versions: [] }];
  }

  return raw.split(';').map(entry => {
    const [projectKey, versionsRaw] = entry.split(':');
    const versions = versionsRaw ? versionsRaw.split(',').map(v => v.trim()) : [];
    return { projectKey: projectKey.trim(), versions };
  });
}

module.exports = { runReleasePipeline, runMultiVersionPipeline, getReleaseConfigFromEnv };
