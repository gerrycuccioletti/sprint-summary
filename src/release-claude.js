// src/release-claude.js
// Claude analysis for release health & risk tracking by FixVersion
const Anthropic = require('@anthropic-ai/sdk');

function createClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY.');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildPrompt(version, issues) {
  // Group issues by status for the prompt
  const done    = issues.filter(i => ['Done', 'Closed', 'Resolved'].includes(i.status));
  const inProg  = issues.filter(i => ['In Progress', 'In Review', 'In Development'].includes(i.status));
  const todo    = issues.filter(i => !done.includes(i) && !inProg.includes(i));

  const formatIssue = (i) => {
    const parts = [`- [${i.key}] (${i.type}) "${i.summary}"`];
    parts.push(`  Status: ${i.status} | Priority: ${i.priority} | Assignee: ${i.assignee}`);
    if (i.dueDate)      parts.push(`  Due: ${i.dueDate}`);
    if (i.labels.length) parts.push(`  Labels: ${i.labels.join(', ')}`);
    if (i.lastComment)  parts.push(`  Last comment (${i.lastComment.author}): "${i.lastComment.body}"`);
    return parts.join('\n');
  };

  return `You are a Release Manager analyzing a Jira release (FixVersion).

Release: "${version.name}"
Release date: ${version.releaseDate || 'not set'}
Status: ${version.released ? 'Released' : version.archived ? 'Archived' : 'Unreleased'}
Description: ${version.description || 'None'}

Total issues: ${issues.length}
Done: ${done.length} | In progress: ${inProg.length} | Not started: ${todo.length}

--- DONE (${done.length}) ---
${done.map(formatIssue).join('\n\n') || 'None'}

--- IN PROGRESS (${inProg.length}) ---
${inProg.map(formatIssue).join('\n\n') || 'None'}

--- NOT STARTED / OPEN (${todo.length}) ---
${todo.map(formatIssue).join('\n\n') || 'None'}

Analyze this release and respond ONLY with valid JSON (no markdown):

{
  "releaseName": "...",
  "releaseDate": "...",
  "overallHealth": "Green | Yellow | Red",
  "healthReason": "One sentence explaining the health status",
  "readiness": "number 0-100 representing release readiness percentage",
  "summary": "2-3 sentence narrative of where this release stands",
  "stats": {
    "total": 0,
    "done": 0,
    "inProgress": 0,
    "notStarted": 0,
    "unassigned": 0,
    "byPriority": {}
  },
  "risks": [
    {
      "level": "High | Medium | Low",
      "issueKey": "...",
      "title": "...",
      "reason": "Why this issue threatens the release"
    }
  ],
  "blockers": [
    {
      "issueKey": "...",
      "title": "...",
      "suggestedAction": "..."
    }
  ],
  "criticalUnfinished": [
    {
      "issueKey": "...",
      "title": "...",
      "priority": "...",
      "status": "...",
      "assignee": "..."
    }
  ],
  "recommendations": [
    "Actionable recommendation string"
  ],
  "releaseFeasibility": "On track | At risk | Likely delayed | Should be descoped"
}`;
}

async function analyzeReleaseWithClaude(version, issues) {
  const client  = createClient();
  const message = await client.messages.create({
    model:      'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: buildPrompt(version, issues) }],
  });

  const raw   = message.content[0].text.trim();
  const clean = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${raw}`);
  }
}

module.exports = { analyzeReleaseWithClaude };
