// src/cr-kickback-pipeline.js
const { fetchAllProjectsCRKickback } = require('./cr-kickback-jira');
const { printCRKickbackReport }      = require('./reporters/cr-kickback-console');
const { sendCRKickbackSlack }        = require('./reporters/cr-kickback-slack');
const { generateKickbackExcel }        = require('./reporters/kickback-excel');

async function runCRKickbackPipeline(fromDate, toDate, opts = {}) {
  const options = { console: true, slack: false, ...opts };
  const label   = '[CRKickback]';

  console.log(`\n${label} Fetching CR transition data...`);
  console.log(`${label} Period: ${fromDate} → ${toDate}`);

  const results = await fetchAllProjectsCRKickback(fromDate, toDate);

  if (options.console) {
    printCRKickbackReport(results, fromDate, toDate);
  }

  if (options.slack) {
    console.log(`${label} Sending Slack report...`);
    await sendCRKickbackSlack(results, fromDate, toDate);
    console.log(`${label} Slack sent.`);
  }

  // Excel output
  try {
    const xlsxPath = generateKickbackExcel(results, fromDate, toDate, 'CR', './output');
    console.log(`${label} Excel saved: ${xlsxPath}`);
  } catch (err) {
    console.warn(`${label} Excel generation failed: ${err.message}`);
  }

  return results;
}

module.exports = { runCRKickbackPipeline };
