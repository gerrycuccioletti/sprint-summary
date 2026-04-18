// src/release-set-pipeline.js
const { getReleaseSetIssues, normalizeSetIssues }  = require('./jira');
const { analyzeReleaseSetWithClaude }              = require('./release-set-claude');
const { printReleaseSetReport }                    = require('./reporters/release-set-console');
const { generateReleaseSetHtml }                   = require('./reporters/release-set-html');
const { sendReleaseSetSlack }                      = require('./reporters/release-set-slack');
const setStore                                     = require('./release-set-store');

/**
 * Parse RELEASE_SET_{NAME} and RELEASE_SET_{NAME}_PATTERN env vars.
 *
 * Two modes per set — use one or the other, not both:
 *
 *   List mode (explicit version names):
 *     RELEASE_SET_Q2_2025=v2.1.0,v2.2.0,hotfix-april
 *
 *   Pattern mode (versionmatch regex — Jira evaluates server-side):
 *     RELEASE_SET_Q2_2025_PATTERN=(?i)Guest App 1.76|MyCruise Web 1.86|Commerce SVCS Apr 26
 *
 * Returns: [{ setName, versionNames?, pattern? }]
 */
/**
 * Read a pattern for a release set. Tries in this order:
 *  1. RELEASE_SET_{NAME}_PATTERN env var (may fail on Windows with | chars)
 *  2. ./patterns/{setName}.txt file (recommended for complex patterns on Windows)
 */
function resolvePattern(setName) {
  const fs   = require('fs');
  const path = require('path');

  // Try env var first
  const fromEnv = (process.env[`RELEASE_SET_${setName}_PATTERN`] || '').trim();
  if (fromEnv) return fromEnv;

  // Try pattern file — path is relative to project root (one level up from src/)
  const filePath = path.resolve(__dirname, '../patterns', `${setName}.txt`);
  console.log(`   [Set: ${setName}] Looking for pattern file: ${filePath}`);

  if (fs.existsSync(filePath)) {
    const fromFile = fs.readFileSync(filePath, 'utf8').trim();
    if (fromFile) {
      console.log(`   [Set: ${setName}] Pattern loaded from file.`);
      return fromFile;
    }
    console.log(`   [Set: ${setName}] Pattern file exists but is empty.`);
  } else {
    console.log(`   [Set: ${setName}] Pattern file not found.`);
  }

  return null;
}

function getReleaseSetConfigs() {
  const setNames = (process.env.JIRA_RELEASE_SETS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!setNames.length) throw new Error('No JIRA_RELEASE_SETS defined in .env');

  return setNames.map(setName => {
    const listRaw = (process.env[`RELEASE_SET_${setName}`] || '').trim();

    // Detect raw JQL clause — if value starts with a JQL function/keyword
    // e.g. "fixVersion in versionmatch(...)" or "fixVersion in (...)"
    const isJql = /^fixVersion\s+/i.test(listRaw);

    if (isJql) {
      // Raw JQL mode — used directly as the version clause
      return { setName, versionNames: [], pattern: null, jqlClause: listRaw };
    }

    const versionNames = listRaw
      ? listRaw.split(',').map(v => v.trim()).filter(Boolean)
      : [];

    // Only look for a pattern when no explicit list is defined
    const pattern = versionNames.length > 0 ? null : resolvePattern(setName);

    if (!pattern && !versionNames.length) {
      throw new Error(
        `RELEASE_SET_${setName} is empty or not defined.\n` +
        `  List mode    : RELEASE_SET_${setName}=v1.0,v2.0\n` +
        `  JQL mode     : RELEASE_SET_${setName}=fixVersion in versionmatch("(?i)App 1.76|Web 1.86")\n` +
        `  Pattern mode : create patterns/${setName}.txt with the regex\n` +
        `  Current raw value: "${listRaw || '(not set)'}"`
      );
    }

    return { setName, versionNames, pattern: pattern || null, jqlClause: null };
  });
}

/**
 * Run the full release set pipeline for one set.
 */
async function runReleaseSetPipeline(setName, versionNames, opts = {}, pattern = null, jqlClause = null) {
  const options = { console: true, slack: false, html: false, store: true, ...opts };
  const label   = `[Set: ${setName}]`;

  if (jqlClause) {
    console.log(`\n${label} Mode: raw JQL`);
    console.log(`${label} Clause: ${jqlClause}`);
  } else if (pattern) {
    console.log(`\n${label} Mode: versionmatch pattern`);
    console.log(`${label} Pattern: ${pattern}`);
  } else {
    console.log(`\n${label} Mode: explicit list`);
    console.log(`${label} Fix versions: ${versionNames.join(', ')}`);
  }

  console.log(`${label} Fetching issues across all projects...`);
  const { issues: rawIssues, jql: executedJql } = await getReleaseSetIssues({ versionNames, pattern, jqlClause, setName });
  const issues = normalizeSetIssues(rawIssues, versionNames, pattern);

  // Resolved versions: from data in JQL/pattern mode, from list in list mode
  const resolvedVersions = (jqlClause || pattern)
    ? [...new Set(issues.flatMap(i => i.allVersions))].sort()
    : versionNames;

  const projects = [...new Set(issues.map(i => i.projectKey))].sort();
  const teams    = [...new Set(issues.map(i => i.team))].sort();

  console.log(`${label} ${issues.length} issues · ${projects.length} projects · ${teams.length} teams`);
  if (pattern) console.log(`${label} Matched versions: ${resolvedVersions.join(', ')}`);
  console.log(`${label} Analyzing with Claude...`);

  const analysis = await analyzeReleaseSetWithClaude(setName, resolvedVersions, issues);

  analysis.versionNames   = resolvedVersions;
  analysis.patternUsed    = pattern      || null;
  analysis.jqlClauseUsed  = jqlClause    || null;
  analysis.jqlExecuted    = executedJql  || null;
  analysis.resolvedByJira = !!(pattern || jqlClause);

  // Attach individual tickets when team scope is active — enables ticket table in reporters
  const teamScope = (process.env[`RELEASE_SET_${setName}_TEAMS`] || '')
    .split(',').map(t => t.trim()).filter(Boolean);

  if (teamScope.length) {
    analysis.tickets = issues.map(i => ({
      key:            i.key,
      summary:        i.summary,
      status:         i.status,
      statusCategory: i.statusCategory,
      priority:       i.priority,
      assignee:       i.assignee,
      team:           i.team,
      projectKey:     i.projectKey,
      fixVersions:    i.matchedVersions || [],
    })).sort((a, b) => {
      // Sort by project key first, then by numeric issue number
      const [aPrj, aNum] = a.key.split('-');
      const [bPrj, bNum] = b.key.split('-');
      return aPrj.localeCompare(bPrj) || parseInt(aNum, 10) - parseInt(bNum, 10);
    });
  }

  const result = { setName, versionNames: resolvedVersions, pattern, jqlClause, analysis };

  if (options.console) printReleaseSetReport(analysis);

  if (options.slack) {
    console.log(`${label} Sending Slack notification...`);
    await sendReleaseSetSlack(analysis, setName);
    console.log(`${label} Slack sent.`);
  }

  if (options.html) {
    result.htmlPath = generateReleaseSetHtml(analysis, setName, './output');
    console.log(`${label} HTML saved: ${result.htmlPath}`);
  }

  if (options.store) {
    setStore.saveSetReport(setName, resolvedVersions, analysis, pattern);
  }

  return result;
}

/**
 * Run all configured release sets.
 */
async function runAllReleaseSets(opts = {}) {
  const configs = getReleaseSetConfigs();
  const results = [];

  for (const { setName, versionNames, pattern, jqlClause } of configs) {
    try {
      const result = await runReleaseSetPipeline(setName, versionNames, opts, pattern, jqlClause);
      results.push({ setName, ...result });
    } catch (err) {
      console.error(`[Set: ${setName}] Failed: ${err.message}`);
      results.push({ setName, error: err.message });
    }
  }

  return results;
}

module.exports = { getReleaseSetConfigs, runReleaseSetPipeline, runAllReleaseSets };
