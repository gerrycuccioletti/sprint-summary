// src/reporters/rfso-kickback-console.js
const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[97m';
const ACCENT = '\x1b[36m';
const c = (col, txt) => `${col}${txt}${RESET}`;

function ratioColor(ratio) {
  if (ratio === 0)  return '\x1b[32m';
  if (ratio <= 10)  return '\x1b[33m';
  if (ratio <= 25)  return '\x1b[91m';
  return '\x1b[31m';
}

function bar(ratio, width = 20) {
  const filled = Math.min(width, Math.round((ratio / 100) * width));
  return c(ratioColor(ratio), '█'.repeat(filled)) + DIM + '░'.repeat(width - filled) + RESET;
}

function printRFSOKickbackReport(results, fromDate, toDate) {
  console.log('\n' + '═'.repeat(80));
  console.log(`${BOLD}  RFSO KICKBACK RATIO REPORT${RESET}`);
  console.log(`  ${DIM}Period: ${fromDate} → ${toDate}${RESET}`);
  console.log(`  ${DIM}Ready for SignOff → ReOpen transitions${RESET}`);
  console.log('═'.repeat(80));

  console.log(`\n${BOLD}Summary by project${RESET}`);
  console.log(`  ${'Project'.padEnd(14)} ${'→RFSO(1)'.padStart(9)} ${'InRFSO(2)'.padStart(10)} ${'←Back'.padStart(7)} ${'Ratio1'.padStart(8)} ${'Ratio2'.padStart(8)}  Bar`);
  console.log(`  ${'─'.repeat(80)}`);

  const valid = results.filter(r => !r.error);
  const total = {
    denominator:  valid.reduce((s, r) => s + r.denominator,          0),
    denominator2: valid.reduce((s, r) => s + (r.denominator2 || 0),  0),
    numerator:    valid.reduce((s, r) => s + r.numerator,            0),
  };
  const totalRatio  = total.denominator  > 0 ? Math.round((total.numerator / total.denominator)  * 1000) / 10 : 0;
  const totalRatio2 = total.denominator2 > 0 ? Math.round((total.numerator / total.denominator2) * 1000) / 10 : 0;

  results.forEach(r => {
    if (r.error) {
      console.log(`  ${c(ACCENT, r.projectKey.padEnd(14))} ${c('\x1b[31m', 'ERROR: ' + r.error)}`);
      return;
    }
    console.log(
      `  ${c(ACCENT, r.projectKey.padEnd(14))}` +
      ` ${String(r.denominator).padStart(9)}` +
      ` ${String(r.denominator2 || 0).padStart(10)}` +
      ` ${String(r.numerator).padStart(7)}` +
      ` ${c(ratioColor(r.ratio),        String(r.ratio        + '%').padStart(8))}` +
      ` ${c(ratioColor(r.ratio2 || 0),  String((r.ratio2 || 0) + '%').padStart(8))}` +
      `  ${bar(r.ratio)}`
    );
  });

  console.log(`  ${'─'.repeat(80)}`);
  console.log(
    `  ${BOLD}${'TOTAL'.padEnd(14)}${RESET}` +
    ` ${String(total.denominator).padStart(9)}` +
    ` ${String(total.denominator2).padStart(10)}` +
    ` ${String(total.numerator).padStart(7)}` +
    ` ${c(ratioColor(totalRatio),  String(totalRatio  + '%').padStart(8))}` +
    ` ${c(ratioColor(totalRatio2), String(totalRatio2 + '%').padStart(8))}` +
    `  ${bar(totalRatio)}`
  );

  console.log(`\n  ${DIM}→RFSO(1)  = tickets moved TO Ready for SignOff in period (denominator 1)${RESET}`);
  console.log(`  ${DIM}InRFSO(2) = tickets IN Ready for SignOff at any point in period (denominator 2)${RESET}`);
  console.log(`  ${DIM}←Back     = tickets kicked back from Ready for SignOff to ReOpen${RESET}`);
  console.log(`  ${DIM}Ratio1    = ←Back / →RFSO(1) × 100${RESET}`);
  console.log(`  ${DIM}Ratio2    = ←Back / InRFSO(2) × 100${RESET}`);

  results.forEach(r => {
    if (r.error || !r.details) return;
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${c(ACCENT, BOLD + r.projectKey + RESET)}`);
    console.log(`  Moved TO Ready for SignOff  : ${r.denominator} tickets  (denominator 1)`);
    console.log(`  IN Ready for SignOff         : ${r.denominator2 || 0} tickets  (denominator 2)`);
    console.log(`  Kicked back (ReOpen)         : ${r.numerator} tickets`);
    console.log(`  RFSO Kickback Ratio 1        : ${c(ratioColor(r.ratio),        r.ratio        + '%')}  (vs entered RFSO)`);
    console.log(`  RFSO Kickback Ratio 2        : ${c(ratioColor(r.ratio2 || 0), (r.ratio2 || 0) + '%')}  (vs in RFSO)`);

    if (r.details.kickedBack.length) {
      console.log(`\n  ${BOLD}Kicked back tickets${RESET}`);
      r.details.kickedBack.forEach(i => {
        console.log(`    ${c(ACCENT, i.key.padEnd(14))} ${DIM}${i.summary.substring(0, 40).padEnd(40)}${RESET}  ${i.author}`);
      });
    }
  });

  console.log('\n' + '═'.repeat(80) + '\n');
}

module.exports = { printRFSOKickbackReport };
