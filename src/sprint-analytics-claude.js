// src/sprint-analytics-claude.js
const Anthropic = require('@anthropic-ai/sdk');

function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY.');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Local computations ────────────────────────────────────────────────────

function computeVelocityStats(velocityData) {
  const closed = velocityData.filter(s => s.state === 'closed');
  if (!closed.length) return { avg: 0, trend: 'stable', sprints: [] };

  const last  = closed.slice(-3);
  const avg   = Math.round(closed.reduce((s, v) => s + v.completed, 0) / closed.length);
  const avgRecent = last.length > 1
    ? Math.round(last.reduce((s, v) => s + v.completed, 0) / last.length)
    : avg;

  const trend = avgRecent > avg * 1.1 ? 'improving'
              : avgRecent < avg * 0.9 ? 'declining'
              : 'stable';

  return { avg, avgRecent, trend, sprints: closed };
}

function computeSprintCompletion(sprintReport) {
  const completedInSprint  = sprintReport.completedIssues.length;
  const completedOutside   = sprintReport.completedOutsideIssues?.length || 0;
  const incompleted        = sprintReport.incompletedIssues?.length || 0;

  const totalCompleted     = completedInSprint + completedOutside;
  const total              = totalCompleted + incompleted;
  const pct                = total > 0 ? Math.round((totalCompleted / total) * 100) : 0;

  const completedPts       = (sprintReport.completedPoints || 0) + (sprintReport.completedOutsidePoints || 0);
  const totalPts           = completedPts + (sprintReport.incompletedPoints || 0);
  const ptsPct             = totalPts > 0 ? Math.round((completedPts / totalPts) * 100) : 0;

  return { total, completed: totalCompleted, completedInSprint, completedOutside, pct, completedPts, totalPts, ptsPct };
}

// ── Claude prompt ─────────────────────────────────────────────────────────

function buildAnalyticsPrompt(boardId, sprintReport, velocityStats) {
  const completion = computeSprintCompletion(sprintReport);
  const isClosed   = sprintReport.state === 'closed';

  const velocitySummary = velocityStats.sprints.slice(-6).map(s =>
    `  ${s.sprintName}: committed=${s.committed} completed=${s.completed}`
  ).join('\n');

  const incompleteSummary = sprintReport.incompletedIssues.slice(0, 20).map(i =>
    `  [${i.key}] ${i.summary} (${i.storyPoints}pts, ${i.status}, ${i.assigneeName})`
  ).join('\n');

  const completedOutsideSummary = sprintReport.completedOutsideIssues.slice(0, 10).map(i =>
    `  [${i.key}] ${i.summary} (${i.storyPoints}pts, ${i.assigneeName})`
  ).join('\n');

  const removedSummary = sprintReport.removedIssues.slice(0, 10).map(i =>
    `  [${i.key}] ${i.summary} (${i.storyPoints}pts)`
  ).join('\n');

  const sharedContext = `You are a Scrum Master analyzing sprint analytics for board ${boardId}.

SPRINT: ${sprintReport.sprintName}
State: ${sprintReport.state}
Goal: ${sprintReport.sprintGoal || 'No goal set'}
Period: ${sprintReport.startDate} → ${sprintReport.endDate}

COMPLETION:
  Issues completed (in sprint + outside): ${completion.completed}/${completion.total} (${completion.pct}%)
  Story points completed: ${completion.completedPts}/${completion.totalPts} (${completion.ptsPct}%)
  — In sprint: ${sprintReport.completedPoints}pts | Outside: ${sprintReport.completedOutsidePoints || 0}pts
  Added during sprint: ${sprintReport.addedDuringSprintCount || 0} issues (${sprintReport.addedDuringSprintPoints || 0}pts)
  Removed mid-sprint: ${sprintReport.removedIssues.length} issues (${sprintReport.removedPoints || 0}pts)

VELOCITY (last 6 sprints):
${velocitySummary || '  No data'}
  Average: ${velocityStats.avg} pts | Recent avg: ${velocityStats.avgRecent || velocityStats.avg} pts | Trend: ${velocityStats.trend}

INCOMPLETE ISSUES (${sprintReport.incompletedIssues.length}):
${incompleteSummary || '  None'}

COMPLETED OUTSIDE THIS SPRINT (${sprintReport.completedOutsideIssues.length}):
${completedOutsideSummary || '  None'}

REMOVED FROM SPRINT (${sprintReport.removedIssues.length}):
${removedSummary || '  None'}`;

  if (isClosed) {
    return `${sharedContext}

This sprint is CLOSED. Focus on retrospective analysis — what happened, what worked, what didn't.

Respond ONLY with valid JSON (no markdown):

{
  "sprintHealth": "Green | Yellow | Red",
  "healthReason": "One sentence",
  "velocityAssessment": "One sentence on velocity trend",
  "completionAssessment": "One sentence on what was completed",
  "goalMet": true | false | null,
  "goalComment": "One sentence on whether the sprint goal was achieved",
  "predictedVelocity": 0,
  "summary": "2-3 sentence overall sprint narrative",
  "analysis": {
    "whatWentWell": ["..."],
    "whatDidntGoWell": ["..."],
    "scopeChanges": "One sentence on scope additions/removals and their impact",
    "velocityInsight": "One sentence comparing this sprint's velocity to the trend",
    "carryoverImpact": "One sentence on the impact of incomplete issues carried over",
    "processObservations": ["..."],
    "retrospectiveActions": ["..."]
  }
}`;
  }

  return `${sharedContext}

This sprint is ACTIVE. Focus on current risks and what the team should do now.

Respond ONLY with valid JSON (no markdown):

{
  "sprintHealth": "Green | Yellow | Red",
  "healthReason": "One sentence",
  "velocityAssessment": "One sentence on velocity trend",
  "completionAssessment": "One sentence on progress so far",
  "goalMet": null,
  "goalComment": "One sentence on likelihood of meeting the sprint goal",
  "risks": [{ "level": "High|Medium|Low", "description": "..." }],
  "recommendations": ["..."],
  "predictedVelocity": 0,
  "summary": "2-3 sentence overall sprint narrative"
}`;
}

// ── Main export ───────────────────────────────────────────────────────────

async function analyzeSprintAnalytics(boardId, sprintReport, velocityData) {
  const velocityStats = computeVelocityStats(velocityData);
  const completion    = computeSprintCompletion(sprintReport);

  const useClaude  = process.env.SPRINT_ANALYTICS_USE_CLAUDE !== 'false';
  const isDryRun   = process.env.SPRINT_ANALYTICS_DRY_RUN   === 'true';

  if (!useClaude || isDryRun) {
    if (!useClaude) console.log('   Claude analysis disabled (SPRINT_ANALYTICS_USE_CLAUDE=false).');
    if (isDryRun)   console.log('   Dry-run: skipping Claude API call.');
    return buildDryRunResult(boardId, sprintReport, velocityStats, completion);
  }

  const client  = createClient();
  const message = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: buildAnalyticsPrompt(boardId, sprintReport, velocityStats) }],
  });

  const raw   = message.content[0].text.trim();
  const clean = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');

  let claudeResponse;
  try { claudeResponse = JSON.parse(clean); }
  catch { throw new Error(`Claude returned invalid JSON:\n${raw}`); }

  return {
    boardId,
    sprintReport,
    velocityStats,
    completion,
    ...claudeResponse,
  };
}

function buildDryRunResult(boardId, sprintReport, velocityStats, completion) {
  const health = completion.pct >= 80 ? 'Green' : completion.pct >= 60 ? 'Yellow' : 'Red';
  return {
    boardId,
    sprintReport,
    velocityStats,
    completion,
    sprintHealth:         health,
    healthReason:         `${completion.pct}% of issues completed.`,
    velocityAssessment:   `Velocity trend is ${velocityStats.trend}, avg ${velocityStats.avg} pts.`,
    completionAssessment: `${completion.completed}/${completion.total} issues done.`,
    goalMet:              null,
    goalComment:          '[Dry-run]',
    risks:                [],
    recommendations:      [],
    predictedVelocity:    velocityStats.avg,
    summary:              '[Dry-run — Claude not called]',
  };
}

module.exports = { analyzeSprintAnalytics };
