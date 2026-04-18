# Sprint Summary & Risk Flagging

Fetches your active Jira Data Center sprint, sends the issues to Claude for analysis, and delivers a structured report with risks, blockers, and recommendations — to your terminal, an HTML file, and Slack.

## Project structure

```
sprint-summary/
├── src/
│   ├── index.js              ← One-off run
│   ├── scheduler.js          ← Cron scheduler
│   ├── jira.js               ← Jira Data Center API client
│   ├── claude.js             ← Claude analysis
│   └── reporters/
│       ├── console.js        ← Color terminal output
│       ├── html.js           ← Standalone HTML report
│       └── slack.js          ← Slack Block Kit notification
├── .env.example
├── package.json
└── README.md
```

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
```

## Usage

### One-off runs

```bash
npm start              # Console only
npm run start:slack    # Console + Slack
npm run report         # Console + Slack + HTML report
```

### Scheduled runs

```bash
npm run schedule       # Start scheduler (uses CRON_SCHEDULE from .env)
npm run test:now       # Start scheduler AND run immediately
```

## Slack setup

1. Go to api.slack.com/apps → Create New App → Incoming Webhooks → enable
2. Add New Webhook to Workspace → pick your channel → copy the URL
3. Set SLACK_WEBHOOK_URL in your .env

## Cron schedule reference

| CRON_SCHEDULE         | When it runs                  |
|-----------------------|-------------------------------|
| 0 9 * * 1             | Every Monday at 9:00 AM       |
| 0 9 * * 1,3,5         | Mon, Wed, Fri at 9:00 AM      |
| 0 9,17 * * 1-5        | Weekdays at 9 AM and 5 PM     |

Set TZ in .env to your timezone (e.g. Europe/London, Asia/Tokyo).

## Running in production with PM2

```bash
npm install -g pm2
pm2 start src/scheduler.js --name sprint-summary
pm2 startup && pm2 save
pm2 logs sprint-summary
```

## Environment variables

| Variable            | Description                                       |
|---------------------|---------------------------------------------------|
| ANTHROPIC_API_KEY   | Your Anthropic API key                            |
| JIRA_BASE_URL       | e.g. https://jira.yourcompany.com                 |
| JIRA_PAT            | Your Jira Personal Access Token                   |
| JIRA_BOARD_ID       | Numeric board ID from your Jira board URL         |
| SLACK_WEBHOOK_URL   | Incoming Webhook URL from api.slack.com           |
| CRON_SCHEDULE       | Cron expression (default: 0 9 * * 1)              |
| TZ                  | Timezone (default: America/New_York)              |
| RUN_NOW             | true to run immediately on scheduler start        |
| SAVE_HTML_REPORT    | true to save HTML report on each scheduled run    |
