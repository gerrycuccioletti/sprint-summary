// src/jira.js
// Jira Data Center REST API client
const axios = require('axios');

function createJiraClient() {
  const { JIRA_BASE_URL, JIRA_PAT } = process.env;

  if (!JIRA_BASE_URL || !JIRA_PAT) {
    throw new Error('Missing JIRA_BASE_URL or JIRA_PAT in environment variables.');
  }

  return axios.create({
    baseURL: `${JIRA_BASE_URL}/rest`,
    headers: {
      Authorization: `Bearer ${JIRA_PAT}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

// Get the active sprint for a board (uses Agile REST API)
async function getActiveSprint(boardId) {
  const client = createJiraClient();
  const res = await client.get(`/agile/1.0/board/${boardId}/sprint`, {
    params: { state: 'active' },
  });

  const sprints = res.data.values;
  if (!sprints || sprints.length === 0) {
    throw new Error(`No active sprint found for board ${boardId}`);
  }

  return sprints[0]; // Return the most recent active sprint
}

// Get all issues in a sprint with relevant fields
async function getSprintIssues(sprintId) {
  const client = createJiraClient();
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;

  // Paginate through all issues
  while (true) {
    const res = await client.get(`/agile/1.0/sprint/${sprintId}/issue`, {
      params: {
        startAt,
        maxResults,
        fields: [
          'summary',
          'status',
          'assignee',
          'priority',
          'issuetype',
          'labels',
          'description',
          'created',
          'updated',
          'duedate',
          'story_points',
          'comment',
          'blockedStatus', // may not exist on all instances
        ].join(','),
      },
    });

    const issues = res.data.issues || [];
    allIssues.push(...issues);

    if (startAt + maxResults >= res.data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

// Normalize raw Jira issues into a clean structure for Claude
function normalizeIssues(issues) {
  return issues.map((issue) => {
    const f = issue.fields;
    const lastComment = f.comment?.comments?.slice(-1)[0];

    return {
      key: issue.key,
      summary: f.summary,
      type: f.issuetype?.name || 'Unknown',
      status: f.status?.name || 'Unknown',
      priority: f.priority?.name || 'None',
      assignee: f.assignee?.displayName || 'Unassigned',
      labels: f.labels || [],
      dueDate: f.duedate || null,
      updatedAt: f.updated,
      lastComment: lastComment
        ? {
            author: lastComment.author?.displayName,
            body: lastComment.body?.substring(0, 300), // Trim long comments
          }
        : null,
    };
  });
}

// ─── Release / FixVersion ─────────────────────────────────────────────────

// Get all versions for a project, optionally filtered by status
// status: 'released' | 'unreleased' | undefined (all)
async function getProjectVersions(projectKey, status) {
  const client = createJiraClient();
  const res = await client.get(`/api/2/project/${projectKey}/versions`);
  let versions = res.data || [];
  if (status === 'unreleased') versions = versions.filter(v => !v.released && !v.archived);
  if (status === 'released')   versions = versions.filter(v => v.released);
  return versions;
}

// Get all issues for a specific fixVersion, with relevant fields
async function getVersionIssues(projectKey, versionName) {
  const client  = createJiraClient();
  const allIssues = [];
  let startAt   = 0;
  const maxResults = 50;

  while (true) {
    const res = await client.get('/api/2/search', {
      params: {
        jql:        `project="${projectKey}" AND fixVersion="${versionName}" ORDER BY priority ASC`,
        startAt,
        maxResults,
        fields:     'summary,status,assignee,priority,issuetype,labels,duedate,updated,comment,resolution',
      },
    });

    const issues = res.data.issues || [];
    allIssues.push(...issues);
    if (startAt + maxResults >= res.data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

// Normalize raw version issues into a clean structure for Claude
function normalizeVersionIssues(issues) {
  return issues.map((issue) => {
    const f = issue.fields;
    const lastComment = f.comment?.comments?.slice(-1)[0];
    return {
      key:        issue.key,
      summary:    f.summary,
      type:       f.issuetype?.name || 'Unknown',
      status:     f.status?.name    || 'Unknown',
      resolution: f.resolution?.name || null,
      priority:   f.priority?.name  || 'None',
      assignee:   f.assignee?.displayName || 'Unassigned',
      labels:     f.labels || [],
      dueDate:    f.duedate || null,
      updatedAt:  f.updated,
      lastComment: lastComment ? {
        author: lastComment.author?.displayName,
        body:   lastComment.body?.substring(0, 300),
      } : null,
    };
  });
}

// ─── Release Sets ─────────────────────────────────────────────────────────

/**
 * Fetch all issues for a release set using either:
 *   - A list of explicit version names  → fixVersion in ("v1","v2")
 *   - A versionmatch regex pattern      → fixVersion in versionmatch("(?i)App 1.76|Web 1.86")
 *
 * @param {object} setConfig
 * @param {string[]} [setConfig.versionNames]  Explicit names (list mode)
 * @param {string}   [setConfig.pattern]       Regex string (pattern mode)
 */
/**
 * Validate each fix version name against Jira and return only the ones that exist.
 * Tests each name individually using fixVersion = "name" with maxResults=0.
 */
async function validateAndFilterVersions(versionNames) {
  const client  = createJiraClient();
  const valid   = [];
  const invalid = [];

  console.log(`   Validating ${versionNames.length} fix version(s) against Jira...`);

  for (const name of versionNames) {
    try {
      await client.get('/api/2/search', {
        params: {
          jql:        `fixVersion = "${name.replace(/"/g, '\\"')}"`,
          maxResults: 0,
          fields:     'summary',
        },
      });
      valid.push(name);
    } catch (err) {
      if (err.response?.status === 400) {
        invalid.push(name);
        console.log(`   ⚠️  Not found in Jira, skipping: "${name}"`);
      } else {
        throw err; // Re-throw unexpected errors
      }
    }
  }

  if (invalid.length) {
    console.log(`   Removed ${invalid.length} version(s) not found in Jira.`);
  }
  console.log(`   Using ${valid.length} valid version(s).`);

  return valid;
}

async function getReleaseSetIssues({ versionNames, pattern, jqlClause, setName }) {
  const client    = createJiraClient();
  const allIssues = [];
  let   startAt   = 0;
  const maxResults = 50;

  let versionClause;
  if (jqlClause) {
    // Raw JQL mode — use the clause exactly as defined in .env
    versionClause = jqlClause;
  } else if (pattern) {
    const jqlPattern = pattern
      .replace(/\^\(/g, '(')
      .replace(/\)\$/g, ')')
      .replace(/\\\./g, '.');
    versionClause = `fixVersion in versionmatch("${jqlPattern.replace(/"/g, '\\"')}")`;
  } else {
    if (!versionNames || versionNames.length === 0) {
      throw new Error(
        'No fix versions provided for this release set.\n' +
        '  Set RELEASE_SET_{NAME}=v1.0,v2.0  (list mode)\n' +
        '  or  RELEASE_SET_{NAME}_PATTERN=(?i)App 1.76|Web 1.86  (pattern mode)'
      );
    }

    // Validate each version exists in Jira, remove ones that don't
    const validVersions = await validateAndFilterVersions(versionNames);

    if (validVersions.length === 0) {
      throw new Error('None of the specified fix versions were found in Jira. Check your RELEASE_SET definition.');
    }

    // Now safe to use fixVersion in (list) — all versions are confirmed to exist
    const quoted = validVersions.map(v => `"${v.replace(/"/g, '\\"')}"`).join(',');
    versionClause = `fixVersion in (${quoted})`;
  }

  // Project scope filter — optional, limits which projects are searched
  const projectScope = (process.env[`RELEASE_SET_${setName}_PROJECTS`] || '')
    .split(',').map(p => p.trim()).filter(Boolean);
  const projectClause = projectScope.length
    ? `AND project in (${projectScope.map(p => `"${p}"`).join(',')})`
    : '';

  // Team filter — optional, uses same field as RELEASE_TEAM_FIELD
  const teamScope  = (process.env[`RELEASE_SET_${setName}_TEAMS`] || '')
    .split(',').map(t => t.trim()).filter(Boolean);
  let teamClause   = '';
  if (teamScope.length) {
    const teamField_ = process.env.RELEASE_TEAM_FIELD || 'component';
    // Check if values are all numeric — if so, use unquoted integers in JQL
    const allNumeric = teamScope.every(t => /^\d+$/.test(t));
    const values     = allNumeric
      ? teamScope.join(',')                              // 123,456
      : teamScope.map(t => `"${t}"`).join(',');          // "Name A","Name B"

    if (teamField_ === 'component') {
      teamClause = `AND component in (${values})`;
    } else if (teamField_ === 'label') {
      const prefix = process.env.RELEASE_TEAM_LABEL_PREFIX || 'team-';
      const labels = teamScope.map(t => `"${prefix}${t}"`).join(',');
      teamClause = `AND labels in (${labels})`;
    } else if (teamField_.startsWith('customfield_')) {
      teamClause = `AND Team in (${values})`;
    }
  }

  // Issue type filter
  const issueTypes = (process.env.RELEASE_SET_ISSUE_TYPES || 'Story,Bug')
    .split(',').map(t => `"${t.trim()}"`).join(',');
  const issueTypeClause = `AND issuetype in (${issueTypes})`;

  // Status exclusion filter
  const ignoreStatuses = (process.env.RELEASE_SET_IGNORE_STATUSES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const statusClause = ignoreStatuses.length
    ? `AND status NOT IN (${ignoreStatuses.map(s => `"${s}"`).join(',')})`
    : '';

  // Build fields list — always include the configured team field if it's a custom field
  const teamField  = process.env.RELEASE_TEAM_FIELD || 'component';
  const baseFields = [
    'summary', 'status', 'assignee', 'priority', 'issuetype',
    'project', 'components', 'labels', 'fixVersions',
    'duedate', 'updated', 'comment', 'resolution',
  ];
  const fields = teamField.startsWith('customfield_')
    ? [...baseFields, teamField]
    : baseFields;

  const jql = `${versionClause} ${projectClause} ${teamClause} ${issueTypeClause} ${statusClause} ORDER BY project ASC, priority ASC`.replace(/\s+/g, ' ').trim();
  console.log(`   JQL: ${jql}`);
  console.log(`   Team field: ${teamField}`);
  if (projectScope.length)   console.log(`   Project scope: ${projectScope.join(', ')}`);
  if (teamScope.length)      console.log(`   Team scope: ${teamScope.join(', ')}`);
  if (ignoreStatuses.length) console.log(`   Ignoring statuses: ${ignoreStatuses.join(', ')}`);

  while (true) {
    const res = await client.get('/api/2/search', {
      params: { jql, startAt, maxResults, fields: fields.join(',') },
    });
    const issues = res.data.issues || [];
    allIssues.push(...issues);
    if (startAt + maxResults >= res.data.total) break;
    startAt += maxResults;
  }

  return { issues: allIssues, jql };
}

/**
 * Normalize raw set issues, resolving the team dimension from
 * RELEASE_TEAM_FIELD env var.
 *
 * @param {object[]} issues       Raw Jira issues
 * @param {string[]} versionNames The fix version names in this set (for matching)
 * @param {string}   [pattern]    Pattern string, used for display when no explicit names
 */
function normalizeSetIssues(issues, versionNames = [], pattern) {
  const teamField   = process.env.RELEASE_TEAM_FIELD       || 'component';
  const labelPrefix = process.env.RELEASE_TEAM_LABEL_PREFIX || 'team-';

  // Compile pattern once for version filtering
  let patternRegex = null;
  if (pattern) {
    try { patternRegex = new RegExp(pattern); } catch { patternRegex = null; }
  }

  return issues.map(issue => {
    const f = issue.fields;
    const lastComment = f.comment?.comments?.slice(-1)[0];

    const issueVersions = (f.fixVersions || []).map(v => v.name);

    // Filter to only versions that actually match:
    // - List mode : must be in the explicit versionNames list
    // - Pattern mode: must match the compiled regex
    let matchedVersions;
    if (patternRegex) {
      matchedVersions = issueVersions.filter(name => patternRegex.test(name));
    } else if (versionNames.length) {
      matchedVersions = issueVersions.filter(name => versionNames.includes(name));
    } else {
      matchedVersions = issueVersions;
    }

    // Resolve team
    let team = '*NONE*';
    if (teamField === 'component') {
      team = f.components?.[0]?.name || '*NONE*';
    } else if (teamField === 'label') {
      const tl = (f.labels || []).find(l => l.startsWith(labelPrefix));
      team = tl ? tl.slice(labelPrefix.length) : '*NONE*';
    } else if (teamField === 'project') {
      team = f.project?.key || '*NONE*';
    } else if (teamField.startsWith('customfield_')) {
      const cf = f[teamField];
      team = cf?.value || cf?.name || (cf ? String(cf) : '*NONE*');
    }

    return {
      key:                issue.key,
      summary:            f.summary,
      type:               f.issuetype?.name                      || 'Unknown',
      status:             f.status?.name                         || 'Unknown',
      statusCategory:     f.status?.statusCategory?.key          || 'undefined',
      statusCategoryName: f.status?.statusCategory?.name         || 'Unknown',
      resolution:         f.resolution?.name                     || null,
      priority:           f.priority?.name                       || 'None',
      assignee:           f.assignee?.displayName                || 'Unassigned',
      projectKey:         f.project?.key                         || 'Unknown',
      projectName:        f.project?.name                        || 'Unknown',
      team,
      matchedVersions,
      allVersions:        issueVersions,
      labels:             f.labels || [],
      dueDate:            f.duedate || null,
      updatedAt:          f.updated,
      lastComment: lastComment ? {
        author: lastComment.author?.displayName,
        body:   lastComment.body?.substring(0, 300),
      } : null,
    };
  });
}

module.exports = {
  getActiveSprint, getSprintIssues, normalizeIssues,
  getProjectVersions, getVersionIssues, normalizeVersionIssues,
  getReleaseSetIssues, normalizeSetIssues,
};
