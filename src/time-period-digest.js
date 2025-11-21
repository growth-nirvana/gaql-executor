// time-period-digest.js
const { groupRows } = require("./group-by");

/**
 * Creates a time period digest - aggregates all rows by date (and optionally account)
 * and stores the result in ctx.state.envelopeData for LLM consumption.
 * 
 * This step does NOT modify the input rows - it only creates the digest and stores it.
 * 
 * cfg:
 * {
 *   by: ['segments.date'], // Dimensions to group by (default: segments.date)
 *   aggregates: { ... },   // Same as group step aggregates
 * }
 */
function timePeriodDigestStep(rows, cfg = {}, ctx) {
  if (!Array.isArray(rows) || rows.length === 0) {
    // Store empty array in envelope
    if (ctx && ctx.state) {
      ctx.state.envelopeData ||= {};
      ctx.state.envelopeData.time_period_digest = [];
    }
    return rows; // Return rows unchanged
  }

  // Default config: group by date only
  const digestConfig = {
    by: cfg.by || ['segments.date'],
    aggregates: cfg.aggregates || {},
    rollup: false,
    nulls: "include",
    orderBy: cfg.orderBy || [{ field: "segments.date", dir: "ASC" }],
  };

  // Create digest by grouping rows
  const digest = groupRows(rows, digestConfig);

  // Store digest in envelope
  if (ctx && ctx.state) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData.time_period_digest = digest;
  }

  // Return original rows unchanged
  return rows;
}

module.exports = { timePeriodDigestStep };

