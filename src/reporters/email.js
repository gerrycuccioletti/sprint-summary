// src/reporters/email.js
// Sends the sprint HTML report via SMTP using nodemailer
const nodemailer  = require('nodemailer');
const { generateHtmlReport } = require('./html');
const fs          = require('fs');
const path        = require('path');

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  if (!SMTP_HOST) throw new Error('Missing SMTP_HOST in environment variables.');
  if (!SMTP_USER) throw new Error('Missing SMTP_USER in environment variables.');

  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   parseInt(SMTP_PORT || '587', 10),
    secure: SMTP_SECURE === 'true',     // true for port 465, false for 587
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS || '',
    },
  });
}

/**
 * Send the sprint summary as a rich HTML email.
 * The full HTML report is used as the email body, and also attached as a file.
 *
 * @param {object} analysis  Claude analysis object
 * @param {object} sprint    Jira sprint object
 */
async function sendEmailReport(analysis, sprint) {
  const {
    EMAIL_FROM,
    EMAIL_TO,
    EMAIL_CC,
  } = process.env;

  if (!EMAIL_TO) throw new Error('Missing EMAIL_TO in environment variables.');

  const transport = createTransport();

  // Generate HTML (also saves file as side-effect)
  const htmlPath  = generateHtmlReport(analysis, sprint, './output');
  const htmlBody  = fs.readFileSync(htmlPath, 'utf8');

  const HEALTH_EMOJI = { Green: '🟢', Yellow: '🟡', Red: '🔴' };
  const emoji = HEALTH_EMOJI[analysis.overallHealth] || '⚪';
  const subject = `${emoji} Sprint Report — ${analysis.sprintName} · ${analysis.overallHealth}`;

  const toAddresses = EMAIL_TO.split(',').map((e) => e.trim());
  const ccAddresses = EMAIL_CC ? EMAIL_CC.split(',').map((e) => e.trim()) : [];

  await transport.sendMail({
    from:        EMAIL_FROM || SMTP_USER,
    to:          toAddresses,
    cc:          ccAddresses.length ? ccAddresses : undefined,
    subject,
    html:        htmlBody,
    attachments: [{
      filename:    path.basename(htmlPath),
      path:        htmlPath,
      contentType: 'text/html',
    }],
  });

  return { subject, to: toAddresses };
}

module.exports = { sendEmailReport };
