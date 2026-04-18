// src/release-set-rules.js
// Rule-based health and feasibility — enabled by RELEASE_SET_RULE_BASED=true
//
// All thresholds are configurable via .env.
// When enabled, Claude's health/feasibility judgments are replaced by these rules.

function getThresholds() {
  return {
    // Readiness % thresholds for overall / project / team health
    healthGreen:  parseInt(process.env.RULES_HEALTH_GREEN  || '80', 10),
    healthYellow: parseInt(process.env.RULES_HEALTH_YELLOW || '50', 10),

    // Feasibility thresholds (readiness %)
    feasibilityOnTrack:   parseInt(process.env.RULES_FEASIBILITY_ON_TRACK    || '80', 10),
    feasibilityAtRisk:    parseInt(process.env.RULES_FEASIBILITY_AT_RISK     || '50', 10),
    feasibilityDelayed:   parseInt(process.env.RULES_FEASIBILITY_DELAYED     || '20', 10),
    // Below feasibilityDelayed → "Should be descoped"

    // Blocker/critical counts that force health down regardless of readiness
    blockersForRed:    parseInt(process.env.RULES_BLOCKERS_FOR_RED    || '1', 10),
    blockersForYellow: parseInt(process.env.RULES_BLOCKERS_FOR_YELLOW || '1', 10),

    // notStarted % that forces Yellow/Red regardless of readiness
    notStartedRedPct:    parseInt(process.env.RULES_NOT_STARTED_RED_PCT    || '50', 10),
    notStartedYellowPct: parseInt(process.env.RULES_NOT_STARTED_YELLOW_PCT || '30', 10),
  };
}

/**
 * Derive health for a single bucket (project, team, or overall).
 *
 * Priority order:
 *   1. Blocker count  → can force Red or Yellow regardless of readiness
 *   2. notStarted %   → can force Yellow or Red if too high
 *   3. Readiness %    → Green / Yellow / Red by threshold
 */
function deriveHealth(stats, blockerCount = 0) {
  const t          = getThresholds();
  const { readiness, total, notStarted } = stats;
  const notStartedPct = total > 0 ? Math.round((notStarted / total) * 100) : 0;

  // Blocker rules
  if (blockerCount >= t.blockersForRed)    return 'Red';
  if (blockerCount >= t.blockersForYellow) return 'Yellow';

  // notStarted % rules
  if (notStartedPct >= t.notStartedRedPct)    return 'Red';
  if (notStartedPct >= t.notStartedYellowPct) return 'Yellow';

  // Readiness rules
  if (readiness >= t.healthGreen)  return 'Green';
  if (readiness >= t.healthYellow) return 'Yellow';
  return 'Red';
}

/**
 * Derive feasibility for the overall release set.
 */
function deriveFeasibility(readiness) {
  const t = getThresholds();
  if (readiness >= t.feasibilityOnTrack) return 'On track';
  if (readiness >= t.feasibilityAtRisk)  return 'At risk';
  if (readiness >= t.feasibilityDelayed) return 'Likely delayed';
  return 'Should be descoped';
}

/**
 * Apply rule-based health and feasibility to the full analysis object.
 * Overwrites Claude's health/feasibility fields with deterministic values.
 *
 * @param {object} analysis  The merged analysis from mergeAnalysis()
 * @returns {object}         Same object with rule-based fields applied
 */
function applyRules(analysis) {
  const overall = {
    readiness:  analysis.readiness || 0,
    total:      analysis.stats.total,
    notStarted: analysis.stats.notStarted,
  };
  const totalBlockers = (analysis.crossProjectBlockers || []).length;

  analysis.overallHealth      = deriveHealth(overall, totalBlockers);
  analysis.releaseFeasibility = deriveFeasibility(overall.readiness);
  analysis.healthReason       = buildHealthReason(overall, totalBlockers, analysis.overallHealth);

  // Per-project
  analysis.byProject = (analysis.byProject || []).map(p => ({
    ...p,
    health: deriveHealth(
      { readiness: p.readiness, total: p.total, notStarted: p.notStarted },
      (p.blockers || []).length
    ),
  }));

  // Per-team
  analysis.byTeam = (analysis.byTeam || []).map(t => ({
    ...t,
    health: deriveHealth(
      { readiness: t.readiness, total: t.total, notStarted: t.notStarted },
      (t.blockers || []).length
    ),
  }));

  return analysis;
}

/**
 * Build a one-sentence explanation of the health decision.
 */
function buildHealthReason(stats, blockerCount, health) {
  const t = getThresholds();
  const notStartedPct = stats.total > 0
    ? Math.round((stats.notStarted / stats.total) * 100)
    : 0;

  if (blockerCount >= t.blockersForRed)
    return `${blockerCount} cross-project blocker(s) detected (threshold: ${t.blockersForRed}).`;
  if (notStartedPct >= t.notStartedRedPct)
    return `${notStartedPct}% of issues not yet started (threshold for Red: ${t.notStartedRedPct}%).`;
  if (notStartedPct >= t.notStartedYellowPct)
    return `${notStartedPct}% of issues not yet started (threshold for Yellow: ${t.notStartedYellowPct}%).`;
  if (health === 'Green')
    return `Readiness is ${stats.readiness}%, above the Green threshold of ${t.healthGreen}%.`;
  if (health === 'Yellow')
    return `Readiness is ${stats.readiness}%, between Yellow (${t.healthYellow}%) and Green (${t.healthGreen}%) thresholds.`;
  return `Readiness is ${stats.readiness}%, below the Yellow threshold of ${t.healthYellow}%.`;
}

module.exports = { applyRules, deriveHealth, deriveFeasibility };
