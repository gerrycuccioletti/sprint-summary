// src/release-set-claude.js
const Anthropic   = require('@anthropic-ai/sdk');
const { applyRules } = require('./release-set-rules');

// Jira statusCategory keys are universal across all Jira instances:
//   'done'          → Done     (Done, Resolved, Closed, Released, etc.)
//   'indeterminate' → In Progress (In Progress, In Review, In Dev, etc.)
//   'new'           → To Do   (Open, To Do, Backlog, etc.)
const isDone       = i => i.statusCategory === 'done';
const isInProgress = i => i.statusCategory === 'indeterminate';
const isNotStarted = i => !isDone(i) && !isInProgress(i);

const HIGH_PRI = new Set(['Highest', 'High', 'Critical', 'Blocker']);

function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY.');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Compute ALL stats locally using statusCategory ────────────────────────
function computeLocalStats(issues) {
  const ignoreStatuses = new Set(
    (process.env.RELEASE_SET_IGNORE_STATUSES || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  const filtered = ignoreStatuses.size > 0
    ? issues.filter(i => !ignoreStatuses.has(i.status.toLowerCase()))
    : issues;

  const byProject = {};
  const byTeam    = {};
  const byVersion = {};

  for (const i of filtered) {
    // ── Init buckets ───────────────────────────────────────────────────────
    if (!byProject[i.projectKey]) {
      byProject[i.projectKey] = {
        projectKey: i.projectKey, projectName: i.projectName,
        total: 0, done: 0, inProgress: 0, notStarted: 0,
      };
    }
    if (!byTeam[i.team]) {
      byTeam[i.team] = {
        team: i.team, total: 0, done: 0, inProgress: 0, notStarted: 0, projects: new Set(),
      };
    }

    // ── Classify using statusCategory ──────────────────────────────────────
    const done_  = isDone(i);
    const inProg = isInProgress(i);

    // ── Project ────────────────────────────────────────────────────────────
    byProject[i.projectKey].total++;
    if (done_)       byProject[i.projectKey].done++;
    else if (inProg) byProject[i.projectKey].inProgress++;
    else             byProject[i.projectKey].notStarted++;

    // ── Team ───────────────────────────────────────────────────────────────
    byTeam[i.team].total++;
    byTeam[i.team].projects.add(i.projectKey);
    if (done_)       byTeam[i.team].done++;
    else if (inProg) byTeam[i.team].inProgress++;
    else             byTeam[i.team].notStarted++;

    // ── Version — only computed when RELEASE_SET_SHOW_BY_VERSION=true ─────────
    if (process.env.RELEASE_SET_SHOW_BY_VERSION === 'true') {
      const versions = i.matchedVersions?.length ? i.matchedVersions : ['(unversioned)'];
      for (const v of versions) {
        if (!byVersion[v]) {
          byVersion[v] = { version: v, total: 0, done: 0, inProgress: 0, notStarted: 0, projects: new Set() };
        }
        byVersion[v].total++;
        byVersion[v].projects.add(i.projectKey);
        if (done_)       byVersion[v].done++;
        else if (inProg) byVersion[v].inProgress++;
        else             byVersion[v].notStarted++;
      }
    }
  }

  // ── Build sorted lists ────────────────────────────────────────────────────
  const projectList = Object.values(byProject)
    .sort((a, b) => b.total - a.total)
    .map(p => ({ ...p, readiness: p.total > 0 ? Math.round((p.done / p.total) * 100) : 0 }));

  const teamList = Object.values(byTeam)
    .sort((a, b) => {
      if (a.team === '*NONE*') return 1;
      if (b.team === '*NONE*') return -1;
      return b.total - a.total;
    })
    .map(t => ({
      ...t,
      readiness: t.total > 0 ? Math.round((t.done / t.total) * 100) : 0,
      projects:  [...t.projects].sort(),
    }));

  const versionList = process.env.RELEASE_SET_SHOW_BY_VERSION === 'true'
    ? Object.values(byVersion)
        .sort((a, b) => a.version.localeCompare(b.version))
        .map(v => ({
          ...v,
          readiness: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0,
          projects:  [...v.projects].sort(),
        }))
    : [];

  const doneCount  = filtered.filter(isDone).length;
  const inProgCount = filtered.filter(isInProgress).length;
  const unassigned = filtered.filter(i => i.assignee === 'Unassigned').length;

  return {
    byProject: projectList,
    byTeam:    teamList,
    byVersion: versionList,
    stats: {
      total:        filtered.length,
      done:         doneCount,
      inProgress:   inProgCount,
      notStarted:   filtered.length - doneCount - inProgCount,
      unassigned,
      projectCount: projectList.length,
      teamCount:    teamList.length,
      versionCount: versionList.length,
    },
  };
}

// ── Prompt: ask Claude only for qualitative analysis ──────────────────────
function buildSetPrompt(setName, versionNames, issues, localStats) {
  const ignoreStatuses = new Set(
    (process.env.RELEASE_SET_IGNORE_STATUSES || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );
  const filtered = ignoreStatuses.size > 0
    ? issues.filter(i => !ignoreStatuses.has(i.status.toLowerCase()))
    : issues;

  const active     = filtered.filter(i => !isDone(i));
  const inProgress = active.filter(isInProgress);
  const highPriTodo = active.filter(i => !isInProgress(i) && HIGH_PRI.has(i.priority));
  const otherTodo   = active.filter(i => !isInProgress(i) && !HIGH_PRI.has(i.priority));

  const MAX_ISSUES = 250;
  const toSend = [
    ...inProgress,
    ...highPriTodo,
    ...otherTodo.slice(0, Math.max(0, MAX_ISSUES - inProgress.length - highPriTodo.length)),
  ].slice(0, MAX_ISSUES);

  const fmt = i => {
    const parts = [`- [${i.projectKey}/${i.key}] (${i.type}/${i.priority}) "${i.summary}"`];
    parts.push(`  Status: ${i.status} [${i.statusCategoryName}] | Assignee: ${i.assignee} | Team: ${i.team}`);
    if (i.dueDate) parts.push(`  Due: ${i.dueDate}`);
    if (i.lastComment) parts.push(`  Comment: "${i.lastComment.body?.substring(0, 120)}"`);
    return parts.join('\n');
  };

  const projectSummary = localStats.byProject
    .map(p => `${p.projectKey}: total=${p.total} done=${p.done} inProgress=${p.inProgress} notStarted=${p.notStarted} readiness=${p.readiness}%`)
    .join('\n');

  const teamSummary = localStats.byTeam
    .map(t => `${t.team}: total=${t.total} done=${t.done} inProgress=${t.inProgress} notStarted=${t.notStarted} readiness=${t.readiness}%`)
    .join('\n');

  const versionSummary = localStats.byVersion
    .map(v => `${v.version}: total=${v.total} done=${v.done} inProgress=${v.inProgress} notStarted=${v.notStarted} readiness=${v.readiness}%`)
    .join('\n');

  return `You are a Release Manager analyzing a cross-project release set.

Release set: "${setName}"
Fix versions: ${versionNames.join(', ')}
Classification method: Jira statusCategory (done/indeterminate/new)
Total issues: ${filtered.length} | Done: ${localStats.stats.done} | Active: ${active.length}
Projects (${localStats.byProject.length}): ${localStats.byProject.map(p => p.projectKey).join(', ')}
Teams (${localStats.byTeam.length}): ${localStats.byTeam.map(t => t.team).join(', ')}

PRE-COMPUTED STATS BY PROJECT:
${projectSummary}

PRE-COMPUTED STATS BY TEAM:
${teamSummary}

PRE-COMPUTED STATS BY FIX VERSION:
${versionSummary}

ACTIVE ISSUES FOR ANALYSIS (${toSend.length} of ${active.length}):
${active.length > MAX_ISSUES ? `Note: ${active.length - toSend.length} lower-priority issues omitted.` : ''}

${toSend.map(fmt).join('\n\n')}

IMPORTANT: Stats are already computed. Focus ONLY on health, risks, blockers, and recommendations.

Respond ONLY with valid JSON (no markdown):

{
  "overallHealth": "Green | Yellow | Red",
  "healthReason": "One sentence",
  "readiness": 0,
  "releaseFeasibility": "On track | At risk | Likely delayed | Should be descoped",
  "summary": "2-3 sentence narrative",
  "byProject": [
    {
      "projectKey": "...",
      "health": "Green | Yellow | Red",
      "risks": [{ "level": "High|Medium|Low", "issueKey": "...", "title": "...", "reason": "..." }],
      "blockers": [{ "issueKey": "...", "title": "...", "suggestedAction": "..." }],
      "criticalUnfinished": [{ "issueKey": "...", "title": "...", "priority": "...", "status": "...", "assignee": "..." }]
    }
  ],
  "byTeam": [
    {
      "team": "...",
      "health": "Green | Yellow | Red",
      "risks": [{ "level": "High|Medium|Low", "issueKey": "...", "title": "...", "reason": "..." }],
      "blockers": [{ "issueKey": "...", "title": "...", "suggestedAction": "..." }]
    }
  ],
  "crossProjectBlockers": [
    { "issueKey": "...", "projectKey": "...", "title": "...", "impact": "...", "suggestedAction": "..." }
  ],
  "recommendations": ["..."]
}`;
}

// ── Merge local stats with Claude qualitative response ────────────────────
function mergeAnalysis(claudeResponse, localStats, setName, versionNames) {
  const projectMap = {};
  (claudeResponse.byProject || []).forEach(p => { projectMap[p.projectKey] = p; });

  const teamMap = {};
  (claudeResponse.byTeam || []).forEach(t => { teamMap[t.team] = t; });

  const byProject = localStats.byProject.map(p => ({
    projectKey:         p.projectKey,
    projectName:        p.projectName,
    health:             projectMap[p.projectKey]?.health              || deriveHealth(p.readiness),
    readiness:          p.readiness,
    total:              p.total,
    done:               p.done,
    inProgress:         p.inProgress,
    notStarted:         p.notStarted,
    risks:              projectMap[p.projectKey]?.risks               || [],
    blockers:           projectMap[p.projectKey]?.blockers            || [],
    criticalUnfinished: projectMap[p.projectKey]?.criticalUnfinished  || [],
  }));

  const byTeam = localStats.byTeam.map(t => ({
    team:       t.team,
    health:     teamMap[t.team]?.health   || deriveHealth(t.readiness),
    readiness:  t.readiness,
    total:      t.total,
    done:       t.done,
    inProgress: t.inProgress,
    notStarted: t.notStarted,
    projects:   t.projects,
    risks:      teamMap[t.team]?.risks    || [],
    blockers:   teamMap[t.team]?.blockers || [],
  }));

  const overallReadiness = localStats.stats.total > 0
    ? Math.round((localStats.stats.done / localStats.stats.total) * 100)
    : 0;

  return {
    setName,
    versionNames,
    overallHealth:        claudeResponse.overallHealth       || deriveHealth(overallReadiness),
    healthReason:         claudeResponse.healthReason        || '',
    readiness:            claudeResponse.readiness           || overallReadiness,
    releaseFeasibility:   claudeResponse.releaseFeasibility  || 'At risk',
    summary:              claudeResponse.summary             || '',
    stats:                localStats.stats,
    byVersion:            localStats.byVersion,
    byProject,
    byTeam,
    crossProjectBlockers: claudeResponse.crossProjectBlockers || [],
    recommendations:      claudeResponse.recommendations     || [],
  };
}

function deriveHealth(readiness) {
  if (readiness >= 80) return 'Green';
  if (readiness >= 50) return 'Yellow';
  return 'Red';
}

// ── Main export ───────────────────────────────────────────────────────────
async function analyzeReleaseSetWithClaude(setName, versionNames, issues) {
  const localStats = computeLocalStats(issues);

  console.log(`   Local stats: ${localStats.byProject.length} projects · ${localStats.byTeam.length} teams${localStats.byVersion.length ? ` · ${localStats.byVersion.length} versions` : ''}`);
  console.log(`   Classification: statusCategory (done=${localStats.stats.done} inProgress=${localStats.stats.inProgress} notStarted=${localStats.stats.notStarted})`);

  // Dry-run mode — skip Claude API call (useful when credits are exhausted)
  if (process.env.RELEASE_SET_DRY_RUN === 'true') {
    console.log('   Dry-run mode: skipping Claude API call.');
    const claudeResponse = {
      overallHealth: null, healthReason: '', readiness: null,
      releaseFeasibility: null, summary: '[Dry-run — Claude not called]',
      byProject: [], byTeam: [], crossProjectBlockers: [], recommendations: [],
    };
    const merged = mergeAnalysis(claudeResponse, localStats, setName, versionNames);
    return applyRules(merged); // always apply rules in dry-run so health/feasibility are populated
  }

  const client  = createClient();
  const message = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 8192,
    messages:   [{ role: 'user', content: buildSetPrompt(setName, versionNames, issues, localStats) }],
  });

  const raw   = message.content[0].text.trim();
  const clean = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');

  let claudeResponse;
  try {
    claudeResponse = JSON.parse(clean);
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${raw}`);
  }

  const merged = mergeAnalysis(claudeResponse, localStats, setName, versionNames);

  // Rule-based mode — overwrite Claude's health/feasibility with deterministic rules
  if (process.env.RELEASE_SET_RULE_BASED === 'true') {
    console.log('   Rule-based mode: applying deterministic health and feasibility rules.');
    return applyRules(merged);
  }

  return merged;
}

module.exports = { analyzeReleaseSetWithClaude };
