// src/rfso-kickback-pipeline.js
const { fetchAllProjectsRFSOKickback } = require('./rfso-kickback-jira');
const { printRFSOKickbackReport }      = require('./reporters/rfso-kickback-console');
const { sendRFSOKickbackSlack }        = require('./reporters/rfso-kickback-slack');
const { generateKickbackExcel }        = require('./reporters/kickback-excel');

async function runRFSOKickbackPipeline(fromDate, toDate, opts = {}) {
  const options = { console: true, slack: false, ...opts };
  const label   = '[RFSOKickback]';

  console.log(`\n${label} Fetching RFSO transition data...`);
  console.log(`${label} Period: ${fromDate} → ${toDate}`);

  const results = await fetchAllProjectsRFSOKickback(fromDate, toDate);

  if (options.console) printRFSOKickbackReport(results, fromDate, toDate);

  if (options.slack) {
    console.log(`${label} Sending Slack report...`);
    await sendRFSOKickbackSlack(results, fromDate, toDate);
    console.log(`${label} Slack sent.`);
  }

  // Excel output
  try {
    const xlsxPath = generateKickbackExcel(results, fromDate, toDate, 'RFSO', './output');
    console.log(`${label} Excel saved: ${xlsxPath}`);
  } catch (err) {
    console.warn(`${label} Excel generation failed: ${err.message}`);
  }

  return results;
}

module.exports = { runRFSOKickbackPipeline };
