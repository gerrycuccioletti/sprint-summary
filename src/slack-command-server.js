// src/slack-command-server.js
// Receives Slack slash commands and runs the sprint analytics pipeline.
// Start with: npm run slack-server

require('dotenv').config();

const express = require('express');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.SLACK_COMMAND_PORT || 3001;

// ── Signature verification ────────────────────────────────────────────────
function verifySlackSignature(req) {
  const secret    = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.warn('[SlackCmd] SLACK_SIGNING_SECRET not set — skipping verification');
    return true;
  }
  const timestamp = req.headers['x-slack-request-timestamp'];
  const sigHeader = req.headers['x-slack-signature'];
  if (!timestamp || !sigHeader) return false;

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const base = `v0:${timestamp}:${req.rawBody}`;
  const sig  = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sigHeader));
}

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[SlackCmd] ${req.method} ${req.path}`);
  next();
});

// Capture raw body inside urlencoded verify — avoids stream conflict
app.use(express.urlencoded({
  extended: true,
  verify: (req, res, buf) => { req.rawBody = buf.toString(); },
}));

// ── Argument parser ───────────────────────────────────────────────────────
function parseArgs(text = '') {
  const args = text.trim().split(/\s+/);
  const get  = flag => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args.slice(i + 1).join(' ').match(/^"([^"]+)"|^(\S+)/)?.[1] || args[i + 1] : null;
  };

  // Handle quoted values like --sprint "LOY COB 26 S08"
  const getQuoted = flag => {
    const raw  = text;
    const re   = new RegExp(`${flag}\\s+"([^"]+)"`);
    const re2  = new RegExp(`${flag}\\s+(\\S+)`);
    const m    = raw.match(re) || raw.match(re2);
    return m ? m[1] : null;
  };

  return {
    team:   getQuoted('--team'),
    board:  getQuoted('--board'),
    sprint: getQuoted('--sprint'),
    help:   args.includes('--help') || args.includes('help'),
  };
}

function helpText() {
  return `*Sprint Analytics command usage:*
\`/analytics\` — all teams, last closed sprint
\`/analytics --team Mobile\` — specific team
\`/analytics --board 1599\` — specific board ID
\`/analytics --sprint active\` — active sprint
\`/analytics --sprint 9846\` — sprint by ID
\`/analytics --sprint "LOY COB 26 S08"\` — sprint by name
\`/analytics --team Mobile --sprint active\`
\`/analytics help\` — show this message`;
}

// ── Slash command handler ─────────────────────────────────────────────────
app.post('/slack/analytics', (req, res) => {
  // Respond with HTTP 200 instantly — this is all Slack needs to avoid timeout
  res.status(200).end();

  const { text = '', user_name = '', response_url } = req.body || {};
  console.log(`[SlackCmd] @${user_name} → /analytics ${text}`);

  const postBack = async (message) => {
    if (!response_url) return;
    try {
      await require('axios').post(response_url, {
        response_type: 'ephemeral',
        text: message,
      });
    } catch (err) {
      console.error(`[SlackCmd] postBack failed: ${err.message}`);
    }
  };

  const args = parseArgs(text);

  if (args.help) {
    postBack(helpText());
    return;
  }

  postBack(`⏳ Running sprint analytics${args.team ? ` for *${args.team}*` : ''}${args.sprint ? ` · sprint: *${args.sprint}*` : ''}…`);

  const opts = { console: false, slack: true, html: false, store: true };

  (async () => {
    try {
      if (args.team) {
        const resolved = resolveTeam(args.team);
        await runSprintAnalyticsPipeline(resolved.boardId, opts, args.sprint, resolved.teamName || args.team);
      } else if (args.board) {
        const boards = args.board.split(',').map(b => b.trim());
        await runMultiBoardAnalytics(boards, opts, args.sprint);
      } else {
        await runMultiBoardAnalytics(getAnalyticsBoardIds(), opts, args.sprint);
      }
      console.log(`[SlackCmd] Done: /analytics ${text}`);
      await postBack(`✅ Report sent${args.team ? ` for *${args.team}*` : ''}.`);
    } catch (err) {
      console.error(`[SlackCmd] Pipeline error: ${err.message}`);
      await postBack(`❌ Error: ${err.message}`);
    }
  })();
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', port: PORT }));

// Root test
app.get('/', (req, res) => res.send('Slack command server is running'));

app.listen(PORT, () => {
  console.log(`\n🤖 Slack command server running on port ${PORT}`);
  console.log(`   POST /slack/analytics`);
  console.log(`   GET  /health\n`);
});
