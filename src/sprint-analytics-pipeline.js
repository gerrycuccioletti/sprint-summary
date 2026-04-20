// src/sprint-analytics-pipeline.js
const {
  getVelocityData,
  getSprintReport, getLatestSprintId, resolveSprintId, getPlatformVelocity,
} = require('./sprint-analytics-jira');
const { analyzeSprintAnalytics }          = require('./sprint-analytics-claude');
const { printSprintAnalyticsReport }      = require('./reporters/sprint-analytics-console');
const { generateSprintAnalyticsHtml }     = require('./reporters/sprint-analytics-html');
const { sendSprintAnalyticsSlack }        = require('./reporters/sprint-analytics-slack');
const { uploadAnalyticsCharts }           = require('./slack-upload');
const store                               = require('./sprint-analytics-store');

/**
 * Run the full sprint analytics pipeline for one board.
 */
async function runSprintAnalyticsPipeline(boardId, opts = {}, sprintSelector = null, teamName = null) {
  const options    = { console: true, slack: false, html: false, store: true, ...opts };
  const displayName = teamName ? `${teamName} (Board ${boardId})` : `Board ${boardId}`;
  const label      = `[Analytics ${displayName}]`;
  const N          = parseInt(process.env.SPRINT_ANALYTICS_VELOCITY_SPRINTS || '6', 10);

  console.log(`\n${label} Resolving sprint...`);
  const sprintId = await resolveSprintId(boardId, sprintSelector);
  console.log(`${label} Sprint ID: ${sprintId}`);

  console.log(`${label} Fetching sprint report...`);
  const sprintReport = await getSprintReport(boardId, sprintId);
  console.log(`${label} Sprint: "${sprintReport.sprintName}"`);

  console.log(`${label} Fetching velocity (last ${N} sprints)...`);
  const velocityData    = await getVelocityData(boardId);
  const closedSprints   = velocityData.filter(s => s.state === 'closed').slice(-N);

  console.log(`${label} Fetching platform velocity...`);
  let platformVelocity = [];
  try {
    platformVelocity = await getPlatformVelocity(boardId, closedSprints);
    if (platformVelocity.length) {
      console.log(`${label} Platforms: ${platformVelocity.map(p => p.platform).join(', ')}`);
    } else {
      console.log(`${label} No platform data found (check SPRINT_ANALYTICS_PLATFORM_FIELD)`);
    }
  } catch (err) {
    console.warn(`${label} Platform velocity unavailable: ${err.message}`);
  }

  console.log(`${label} Analyzing with Claude...`);
  const analysis = await analyzeSprintAnalytics(
    boardId, sprintReport,
    velocityData.slice(-N),
  );

  analysis.platformVelocity = platformVelocity;
  analysis.teamName         = teamName;
  analysis.displayName      = displayName;

  const result = { boardId, sprintId, analysis };

  if (options.console) printSprintAnalyticsReport(analysis, boardId);

  if (options.slack) {
    console.log(`${label} Sending Slack notification...`);
    await sendSprintAnalyticsSlack(analysis, boardId);
    console.log(`${label} Slack sent.`);
    if (process.env.SLACK_BOT_TOKEN) {
      await uploadAnalyticsCharts(analysis, boardId);
    }
  }

  if (options.html) {
    result.htmlPath = generateSprintAnalyticsHtml(analysis, boardId, './output');
    console.log(`${label} HTML saved: ${result.htmlPath}`);
  }

  if (options.store) {
    store.saveAnalyticsReport(boardId, analysis);
  }

  return result;
}

/**
 * Run for multiple boards.
 */
async function runMultiBoardAnalytics(boardIds, opts = {}, sprintSelector = null) {
  const map     = getTeamBoardMap();
  const inverted = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
  const results = [];
  for (const boardId of boardIds) {
    const teamName = inverted[boardId] || null;
    try {
      const result = await runSprintAnalyticsPipeline(boardId, opts, sprintSelector, teamName);
      results.push({ boardId, ...result });
    } catch (err) {
      console.error(`[Analytics Board ${boardId}] Failed: ${err.message}`);
      results.push({ boardId, error: err.message });
    }
  }
  return results;
}

/**
 * Parse TEAMS_BOARDS=Mobile:1852,Web:1598 into a map
 * Returns: { Mobile: '1852', Web: '1598' }
 */
function getTeamBoardMap() {
  const raw = (process.env.TEAMS_BOARDS || '').trim();
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',')
      .map(entry => entry.trim().split(':').map(s => s.trim()))
      .filter(([name, id]) => name && id)
  );
}

/**
 * Resolve a team name or board ID to a { boardId, teamName } pair.
 * Accepts: numeric board ID, or a team name defined in TEAMS_BOARDS.
 */
function resolveTeam(value) {
  const map = getTeamBoardMap();
  // Exact team name match
  if (map[value]) return { boardId: map[value], teamName: value };
  // Case-insensitive partial match
  const key = Object.keys(map).find(k => k.toLowerCase().includes(value.toLowerCase()));
  if (key) return { boardId: map[key], teamName: key };
  // Numeric board ID — look up team name if mapped
  if (/^\d+$/.test(value)) {
    const teamName = Object.keys(map).find(k => map[k] === value) || null;
    return { boardId: value, teamName };
  }
  throw new Error(`Unknown team or board: "${value}". Define it in TEAMS_BOARDS or use a numeric board ID.`);
}

function getAnalyticsBoardIds() {
  const map = getTeamBoardMap();
  if (Object.keys(map).length) {
    return Object.values(map);
  }
  const raw = process.env.JIRA_BOARD_IDS || process.env.JIRA_BOARD_ID || '1';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

module.exports = { runSprintAnalyticsPipeline, runMultiBoardAnalytics, getAnalyticsBoardIds, getTeamBoardMap, resolveTeam };
