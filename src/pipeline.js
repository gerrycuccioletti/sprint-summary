// src/pipeline.js
// Shared pipeline: fetch → analyze → dispatch to all reporters
// Used by index.js, scheduler.js, and the dashboard's /api/run endpoint

const { getActiveSprint, getSprintIssues, normalizeIssues } = require('./jira');
const { analyzeSprintWithClaude }                           = require('./claude');
const { printConsoleReport }                                = require('./reporters/console');
const { generateHtmlReport }                                = require('./reporters/html');
const { sendSlackNotification }                             = require('./reporters/slack');
const store                                                 = require('./store');

/**
 * Run the full sprint summary pipeline for a single board.
 *
 * @param {string|number} boardId
 * @param {object} opts
 * @param {boolean} [opts.console=true]   Print to terminal
 * @param {boolean} [opts.slack=false]    Send Slack notification
 * @param {boolean} [opts.html=false]     Save HTML file
 * @param {boolean} [opts.store=true]     Persist to reports.json
 * @returns {Promise<{sprint, analysis, htmlPath?}>}
 */
async function runPipeline(boardId, opts = {}) {
  const options = {
    console: true,
    slack:   false,
    html:    false,
    store:   true,
    ...opts,
  };

  const label = `[Board ${boardId}]`;
  console.log(`\n${label} Fetching active sprint...`);
  const sprint = await getActiveSprint(boardId);
  console.log(`${label} Sprint: "${sprint.name}"`);

  console.log(`${label} Fetching issues...`);
  const rawIssues = await getSprintIssues(sprint.id);
  const issues    = normalizeIssues(rawIssues);
  console.log(`${label} ${issues.length} issues loaded.`);

  console.log(`${label} Analyzing with Claude...`);
  const analysis = await analyzeSprintWithClaude(sprint, issues);

  // ── Dispatch to reporters ───────────────────────────────────────────────
  const results = { sprint, analysis };

  if (options.console) {
    printConsoleReport(analysis, sprint);
  }

  if (options.slack) {
    console.log(`${label} Sending Slack notification...`);
    await sendSlackNotification(analysis, sprint, boardId);
    console.log(`${label} Slack sent.`);
  }

  if (options.html) {
    results.htmlPath = generateHtmlReport(analysis, sprint, './output');
    console.log(`${label} HTML saved: ${results.htmlPath}`);
  }

  if (options.store) {
    store.saveReport(boardId, sprint, analysis);
  }

  return results;
}

/**
 * Run the pipeline across multiple boards in sequence.
 *
 * @param {string[]|number[]} boardIds
 * @param {object} opts  Same as runPipeline opts
 * @returns {Promise<Array<{boardId, sprint, analysis}|{boardId, error}>>}
 */
async function runMultiBoard(boardIds, opts = {}) {
  const results = [];

  for (const boardId of boardIds) {
    try {
      const result = await runPipeline(boardId, opts);
      results.push({ boardId, ...result });
    } catch (err) {
      console.error(`[Board ${boardId}] Failed: ${err.message}`);
      results.push({ boardId, error: err.message });

      // Send error alert to Slack if enabled
      if (opts.slack && process.env.SLACK_WEBHOOK_URL) {
        try {
          const axios = require('axios');
          await axios.post(process.env.SLACK_WEBHOOK_URL, {
            text: `⚠️ Sprint Summary failed for board *${boardId}*\n\`\`\`${err.message}\`\`\``,
          });
        } catch { /* swallow */ }
      }
    }
  }

  return results;
}

/**
 * Parse JIRA_BOARD_IDS env var into an array of board IDs.
 * Supports: "1", "1,2,3", "1, 2, 3"
 */
function getBoardIdsFromEnv() {
  const raw = process.env.JIRA_BOARD_IDS || process.env.JIRA_BOARD_ID || '1';
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

module.exports = { runPipeline, runMultiBoard, getBoardIdsFromEnv };
