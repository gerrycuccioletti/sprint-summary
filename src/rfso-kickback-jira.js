// src/rfso-kickback-jira.js
// RFSO Kickback Ratio — three independent JQL queries, no union or changelog scan.
//
// D1  = status changed TO "Ready for SignOff" DURING (from, to)
// D2  = status was "Ready for SignOff" DURING (from, to)
// Num = status changed FROM "Ready for SignOff" TO "ReOpen" DURING (from, to)

const axios = require('axios');

function createJiraClient() {
  const { JIRA_BASE_URL, JIRA_PAT } = process.env;
  if (!JIRA_BASE_URL || !JIRA_PAT) throw new Error('Missing JIRA_BASE_URL or JIRA_PAT');
  return axios.create({
    baseURL: `${JIRA_BASE_URL}/rest`,
    headers: {
      Authorization: `Bearer ${JIRA_PAT}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
}

const statusEnv = (key, def) => process.env[key] || def;

async function fetchIssues(client, jql) {
  const issues = [];
  let startAt  = 0;
  const maxResults = 100;
  console.log(`   JQL: ${jql}`);
  while (true) {
    const res = await client.get('/api/2/search', {
      params: { jql, startAt, maxResults, fields: 'summary,assignee' },
    });
    for (const i of res.data.issues || []) {
      issues.push({ key: i.key, summary: i.fields.summary, author: i.fields.assignee?.displayName || '—' });
    }
    if (startAt + maxResults >= res.data.total) break;
    startAt += maxResults;
  }
  return issues;
}

async function fetchRFSOKickbackData(projectKey, fromDate, toDate) {
  const client      = createJiraClient();
  const rfsoStatus  = statusEnv('RFSO_STATUS_READY_FOR_SIGNOFF', 'Ready for SignOff');
  const roStatus    = statusEnv('RFSO_STATUS_REOPEN',            'ReOpen');
  const from        = fromDate.replace(/-/g, '/');
  const to          = toDate.replace(/-/g, '/');

  // D1 — tickets that entered Ready for SignOff during the period
  const jqlD1 = `project = "${projectKey}" AND status changed TO "${rfsoStatus}" DURING ("${from}", "${to}")`;
  const d1Issues = await fetchIssues(client, jqlD1);
  console.log(`   [${projectKey}] D1 (→RFSO): ${d1Issues.length}`);

  // D2 — tickets that were IN Ready for SignOff at any point during the period
  const jqlD2 = `project = "${projectKey}" AND status was "${rfsoStatus}" DURING ("${from}", "${to}")`;
  const d2Issues = await fetchIssues(client, jqlD2);
  console.log(`   [${projectKey}] D2 (InRFSO): ${d2Issues.length}`);

  // Numerator — kicked back from Ready for SignOff to ReOpen
  const jqlNum = `project = "${projectKey}" AND status changed FROM "${rfsoStatus}" TO "${roStatus}" DURING ("${from}", "${to}")`;
  const numIssues = await fetchIssues(client, jqlNum);
  console.log(`   [${projectKey}] Kickbacks: ${numIssues.length}`);

  const denominator  = d1Issues.length;
  const denominator2 = d2Issues.length;
  const numerator    = numIssues.length;
  const ratio        = denominator  > 0 ? Math.round((numerator / denominator)  * 1000) / 10 : 0;
  const ratio2       = denominator2 > 0 ? Math.round((numerator / denominator2) * 1000) / 10 : 0;

  return {
    projectKey, fromDate, toDate,
    denominator, denominator2, numerator, ratio, ratio2,
    details: { toRFSO: d1Issues, inRFSO: d2Issues, kickedBack: numIssues },
  };
}

async function fetchAllProjectsRFSOKickback(fromDate, toDate) {
  const raw = process.env.RFSO_KICKBACK_PROJECTS
           || process.env.QA_KICKBACK_PROJECTS
           || process.env.CR_KICKBACK_PROJECTS
           || process.env.JIRA_PROJECT_KEYS
           || process.env.JIRA_PROJECT_KEY || '';
  const projects = raw.split(',').map(p => p.trim()).filter(Boolean);
  if (!projects.length) throw new Error('No projects defined. Set RFSO_KICKBACK_PROJECTS in .env');

  const results = [];
  for (const projectKey of projects) {
    try {
      console.log(`\n[RFSOKickback] Project ${projectKey}...`);
      results.push(await fetchRFSOKickbackData(projectKey, fromDate, toDate));
    } catch (err) {
      console.error(`[RFSOKickback] ${projectKey} failed: ${err.message}`);
      results.push({ projectKey, error: err.message });
    }
  }
  return results;
}

module.exports = { fetchRFSOKickbackData, fetchAllProjectsRFSOKickback };
