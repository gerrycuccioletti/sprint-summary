// src/claude.js
// Claude API integration — sprint analysis & risk flagging
const Anthropic = require('@anthropic-ai/sdk');

function createClaudeClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY in environment variables.');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// Build the prompt with structured issue data
function buildPrompt(sprint, issues) {
  const issueLines = issues
    .map((i) => {
      const parts = [
        `- [${i.key}] (${i.type}) "${i.summary}"`,
        `  Status: ${i.status} | Priority: ${i.priority} | Assignee: ${i.assignee}`,
      ];
      if (i.dueDate) parts.push(`  Due: ${i.dueDate}`);
      if (i.labels.length) parts.push(`  Labels: ${i.labels.join(', ')}`);
      if (i.lastComment) {
        parts.push(`  Last comment (${i.lastComment.author}): "${i.lastComment.body}"`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  return `You are an experienced Scrum Master analyzing a Jira sprint.

Sprint: "${sprint.name}"
Start: ${sprint.startDate || 'N/A'} → End: ${sprint.endDate || 'N/A'}
Total issues: ${issues.length}

Issues:
${issueLines}

Provide a structured sprint analysis in the following JSON format (respond with ONLY valid JSON, no markdown):

{
  "sprintName": "...",
  "overallHealth": "Green | Yellow | Red",
  "healthReason": "One sentence explaining the overall health status",
  "summary": "2-3 sentence narrative summary of the sprint state",
  "stats": {
    "total": 0,
    "byStatus": {},
    "byPriority": {},
    "unassigned": 0
  },
  "risks": [
    {
      "level": "High | Medium | Low",
      "issueKey": "...",
      "title": "...",
      "reason": "Concise explanation of the risk"
    }
  ],
  "blockers": [
    {
      "issueKey": "...",
      "title": "...",
      "blockedSince": "...",
      "suggestedAction": "..."
    }
  ],
  "recommendations": [
    "Actionable recommendation string"
  ],
  "workloadWarnings": [
    "e.g. 'Assignee X has 7 open issues — consider redistributing'"
  ]
}`;
}

// Call Claude and parse the structured JSON response
async function analyzeSprintWithClaude(sprint, issues) {
  const client = createClaudeClient();
  const prompt = buildPrompt(sprint, issues);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = message.content[0].text.trim();

  try {
    // Strip any accidental markdown fences
    const clean = rawText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(clean);
  } catch {
    throw new Error(`Claude returned invalid JSON:\n${rawText}`);
  }
}

module.exports = { analyzeSprintWithClaude };
