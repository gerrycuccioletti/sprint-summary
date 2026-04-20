// src/sprint-analytics-jira.js
// GreenHopper (Jira Agile internal) API client
// Provides: velocity, sprint report

const axios = require('axios');

function createJiraClient() {
  const { JIRA_BASE_URL, JIRA_PAT } = process.env;
  if (!JIRA_BASE_URL || !JIRA_PAT) throw new Error('Missing JIRA_BASE_URL or JIRA_PAT.');
  return axios.create({
    baseURL: `${JIRA_BASE_URL}/rest`,
    headers: { Authorization: `Bearer ${JIRA_PAT}`, 'Content-Type': 'application/json' },
  });
}

// ── Velocity ──────────────────────────────────────────────────────────────
// Returns story points committed vs completed per sprint for the last N sprints
async function getVelocityData(boardId) {
  const client = createJiraClient();
  const res    = await client.get('/greenhopper/1.0/rapid/charts/velocity', {
    params: { rapidViewId: boardId },
  });

  const data = res.data;
  // velocityStatEntries is keyed by sprintId
  const sprints = data.sprints || [];
  const entries = data.velocityStatEntries || {};

  return sprints.map(sprint => ({
    sprintId:   sprint.id,
    sprintName: sprint.name,
    state:      (sprint.state || '').toLowerCase(),
    committed:  entries[sprint.id]?.estimated?.value  || 0,
    completed:  entries[sprint.id]?.completed?.value  || 0,
  })).reverse(); // oldest first
}

// ── Sprint report ─────────────────────────────────────────────────────────
// Returns completed, incomplete, and removed issues for a sprint
// plus the sprint goal and key metadata
async function getSprintReport(boardId, sprintId) {
  const client = createJiraClient();
  const res    = await client.get('/greenhopper/1.0/rapid/charts/sprintreport', {
    params: { rapidViewId: boardId, sprintId },
  });

  const data     = res.data;
  const sprint   = data.sprint || {};
  const contents = data.contents || {};
  const entity   = contents.entityData || {};

  const statusName   = id => entity.statuses?.[id]?.statusName     || entity.statuses?.[id]?.name    || String(id);
  const typeName_    = id => entity.types?.[id]?.typeName          || entity.types?.[id]?.name        || String(id);
  const priorityName = id => entity.priorities?.[id]?.priorityName || entity.priorities?.[id]?.name  || String(id);

  const normalizeIssue = i => ({
    key:          i.key,
    summary:      i.summary,
    typeName:     i.typeName     || typeName_(i.typeId)        || '',
    priorityName: i.priorityName || priorityName(i.priorityId) || '',
    assigneeName: i.assigneeName || i.assignee?.displayName    || 'Unassigned',
    storyPoints:  i.estimateStatistic?.statFieldValue?.value
               ?? i.currentEstimateStatistic?.statFieldValue?.value
               ?? 0,
    status:       i.statusName   || statusName(i.statusId)     || '',
  });

  return {
    sprintId,
    sprintName:             sprint.name,
    sprintGoal:             sprint.goal        || null,
    startDate:              sprint.startDate,
    endDate:                sprint.endDate,
    completeDate:           sprint.completeDate || null,
    state:                  (sprint.state || '').toLowerCase(),
    completedIssues:        (contents.completedIssues                      || []).map(normalizeIssue),
    incompletedIssues:      (contents.issuesNotCompletedInCurrentSprint
                          || contents.incompletedIssues                    || []).map(normalizeIssue),
    completedOutsideIssues: (contents.issuesCompletedInAnotherSprint       || []).map(normalizeIssue),
    removedIssues:          (contents.puntedIssues                         || []).map(normalizeIssue),
    addedDuringSprintCount: Object.keys(contents.issueKeysAddedDuringSprint || {}).length,
    addedDuringSprintPoints: (() => {
      const addedKeys = new Set(Object.keys(contents.issueKeysAddedDuringSprint || {}));
      if (!addedKeys.size) return 0;
      const allIssues = [
        ...(contents.completedIssues                   || []),
        ...(contents.issuesNotCompletedInCurrentSprint || contents.incompletedIssues || []),
        ...(contents.issuesCompletedInAnotherSprint    || []),
        ...(contents.puntedIssues                      || []),
      ];
      return allIssues
        .filter(i => addedKeys.has(i.key))
        .reduce((sum, i) => sum + (i.estimateStatistic?.statFieldValue?.value
                                ?? i.currentEstimateStatistic?.statFieldValue?.value
                                ?? 0), 0);
    })(),
    completedPoints:        contents.completedIssuesEstimateSum?.value                || 0,
    incompletedPoints:      contents.issuesNotCompletedEstimateSum?.value             || 0,
    completedOutsidePoints: contents.issuesCompletedInAnotherSprintEstimateSum?.value || 0,
    removedPoints:          contents.puntedIssuesEstimateSum?.value                   || 0,
  };
}

// ── Platform velocity ─────────────────────────────────────────────────────
// Uses the sprint report API (same source as velocity chart) to guarantee
// platform pts match the velocity totals exactly.
async function getPlatformVelocity(boardId, closedSprints) {
  if (!closedSprints?.length) return [];

  const platformField = process.env.SPRINT_ANALYTICS_PLATFORM_FIELD || 'customfield_11500';
  const client        = createJiraClient();

  // { platform → { sprintId → points } }
  const platformData = {};

  for (const sprint of closedSprints) {
    // Fetch sprint report to get the exact same completed issues as the velocity chart
    let reportData;
    try {
      const res = await client.get('/greenhopper/1.0/rapid/charts/sprintreport', {
        params: { rapidViewId: boardId, sprintId: sprint.sprintId },
      });
      reportData = res.data;
    } catch (err) {
      console.warn(`   [Platform] Sprint report unavailable for sprint ${sprint.sprintId}: ${err.message}`);
      continue;
    }

    const completedIssues = reportData.contents?.completedIssues || [];
    if (!completedIssues.length) continue;

    // Fetch the platform field for these specific issue keys
    const keys    = completedIssues.map(i => i.key).join(',');
    let   issueFields = {};

    try {
      let startAt = 0;
      const maxResults = 100;
      while (true) {
        const res = await client.get('/api/2/search', {
          params: {
            jql:        `issueKey in (${keys})`,
            startAt,
            maxResults,
            fields:     `${platformField}`,
          },
        });
        for (const issue of res.data.issues || []) {
          issueFields[issue.key] = issue.fields;
        }
        if (startAt + maxResults >= res.data.total) break;
        startAt += maxResults;
      }
    } catch (err) {
      console.warn(`   [Platform] Could not fetch platform field: ${err.message}`);
      continue;
    }

    // Group completed story points by platform
    const sprintPts = {};
    for (const issue of completedIssues) {
      const f   = issueFields[issue.key] || {};
      const pf  = f[platformField];
      let platform;
      if (!pf)                         platform = '(none)';
      else if (typeof pf === 'string') platform = pf.trim();
      else if (Array.isArray(pf))      platform = pf.map(p => p?.value || p?.name || String(p)).join(', ');
      else                             platform = pf.value || pf.name || String(pf);

      if (platform === '(none)') continue;

      // Use the same story points value the sprint report uses
      const pts = issue.estimateStatistic?.statFieldValue?.value
               ?? issue.currentEstimateStatistic?.statFieldValue?.value
               ?? 0;

      sprintPts[platform] = (sprintPts[platform] || 0) + (Number(pts) || 0);
    }

    // Store by sprintId
    for (const [platform, pts] of Object.entries(sprintPts)) {
      if (!platformData[platform]) platformData[platform] = {};
      platformData[platform][String(sprint.sprintId)] = pts;
    }
  }

  // Compute average per platform
  return Object.entries(platformData)
    .map(([platform, bySprintMap]) => {
      const values = Object.values(bySprintMap);
      return {
        platform,
        avg:         Math.round(values.reduce((s, v) => s + v, 0) / values.length),
        total:       values.reduce((s, v) => s + v, 0),
        sprintCount: values.length,
        bySprint:    bySprintMap,
      };
    })
    .sort((a, b) => b.avg - a.avg);
}

// ── Sprint resolution ─────────────────────────────────────────────────────
/**
 * Resolve a sprint ID for a board based on a selector:
 *   undefined / null / ''  → last closed sprint (default)
 *   'active'               → current active sprint
 *   numeric string / number → exact sprint ID
 *   other string            → sprint name search (case-insensitive)
 */
async function resolveSprintId(boardId, selector) {
  // Active sprint
  if (selector && String(selector).toLowerCase() === 'active') {
    const client = createJiraClient();
    const res = await client.get(`/agile/1.0/board/${boardId}/sprint`, {
      params: { state: 'active' },
    });
    const sprints = res.data.values || [];
    if (!sprints.length) throw new Error(`No active sprint found for board ${boardId}`);

    if (sprints.length > 1) {
      console.log(`   ⚠️  Multiple active sprints on board ${boardId}:`);
      sprints.forEach((s, i) => console.log(`     [${i}] ID=${s.id} "${s.name}" started ${s.startDate}`));
      console.log(`   Tip: use --sprint "<name>" to select a specific one`);
    }

    // Pick the sprint with the earliest startDate (first started)
    const s = sprints.slice().sort((a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    )[0];
    console.log(`   → Using: "${s.name}" ID=${s.id}`);
    return s.id;
  }

  // Numeric sprint ID
  if (selector && /^\d+$/.test(String(selector).trim())) {
    const id = parseInt(selector, 10);
    console.log(`   Using sprint ID: ${id}`);
    return id;
  }

  // Sprint name search
  if (selector) {
    const name   = String(selector).trim().toLowerCase();
    const client = createJiraClient();
    // Search across closed, active, future sprints
    for (const state of ['closed', 'active', 'future']) {
      let startAt = 0;
      const maxResults = 50;
      while (true) {
        const res = await client.get(`/agile/1.0/board/${boardId}/sprint`, {
          params: { state, startAt, maxResults },
        });
        const page = res.data.values || [];
        const match = page.find(s => s.name.toLowerCase().includes(name));
        if (match) {
          console.log(`   Sprint by name: "${match.name}" (ID: ${match.id})`);
          return match.id;
        }
        if (res.data.isLast || page.length < maxResults) break;
        startAt += maxResults;
      }
    }
    throw new Error(`No sprint found matching name: "${selector}" on board ${boardId}`);
  }

  // Default — last closed sprint
  return getLatestSprintId(boardId);
}

// ── Active sprint ID ──────────────────────────────────────────────────────
async function getLatestSprintId(boardId) {
  const client = createJiraClient();

  // Paginate through ALL closed sprints — Jira returns them oldest-first in pages
  let allClosed = [];
  let startAt   = 0;
  const maxResults = 50;

  while (true) {
    const res = await client.get('/agile/1.0/board/' + boardId + '/sprint', {
      params: { state: 'closed', startAt, maxResults },
    });
    const page = res.data.values || [];
    allClosed.push(...page);
    if (res.data.isLast || page.length < maxResults) break;
    startAt += maxResults;
  }

  if (allClosed.length) {
    allClosed.sort((a, b) => {
      const da = a.endDate ? new Date(a.endDate).getTime() : a.id;
      const db = b.endDate ? new Date(b.endDate).getTime() : b.id;
      return db - da;
    });
    const last = allClosed[0];
    console.log(`   Resolved sprint: "${last.name}" ID=${last.id} ended=${last.endDate || 'unknown'} (last closed, board ${boardId})`);
    return last.id;
  }

  const activeRes = await client.get('/agile/1.0/board/' + boardId + '/sprint', {
    params: { state: 'active' },
  });
  const active = activeRes.data.values || [];
  if (!active.length) throw new Error(`No closed or active sprint found for board ${boardId}`);
  console.log(`   No closed sprints — resolved sprint: "${active[0].name}" ID=${active[0].id} (active, board ${boardId})`);
  return active[0].id;
}

module.exports = {
  getVelocityData,
  getSprintReport,
  getLatestSprintId,
  resolveSprintId,
  getPlatformVelocity,
};
