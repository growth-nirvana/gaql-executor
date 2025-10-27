// steps/rollup-envelope.js
const { getAtPath, setAtPath } = require('./utils');

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * rollupEnvelopeStep
 *
 * Computes a summary object from the current rows and stores it in ctx.state.envelopeData[as].
 *
 * cfg:
 * {
 *   as: "account_rollup",                // envelope key (required)
 *   rollupKey: "meta.rollup_key",        // optional path to set a rollup identifier
 *   rollupValue: "ACCOUNT",              // optional value for rollupKey (default "ALL")
 *   mark: true,                          // set __rollup: true on the summary object
 *
 *   // Sum these numeric fields across rows:
 *   sum: [
 *     "metrics.cost", "metrics.clicks", "metrics.impressions",
 *     "metrics.conversions", "metrics.conversions_value",
 *     "metrics_prev.cost", "metrics_prev.clicks", "metrics_prev.impressions", "metrics_prev.conversions"
 *   ],
 *
 *   // Compute ratios on top of the summed totals:
 *   ratios: [
 *     { as: "metrics.ctr", num: "metrics.clicks", den: "metrics.impressions" },
 *     { as: "metrics.cpc", num: "metrics.cost",   den: "metrics.clicks" },
 *     { as: "metrics.cvr", num: "metrics.conversions", den: "metrics.clicks" },
 *     { as: "metrics.cpa", num: "metrics.cost",   den: "metrics.conversions" },
 *     // previous-period ratios if you want them in the rollup too:
 *     { as: "metrics_prev.ctr", num: "metrics_prev.clicks", den: "metrics_prev.impressions" },
 *     { as: "metrics_prev.cpc", num: "metrics_prev.cost",   den: "metrics_prev.clicks" },
 *     { as: "metrics_prev.cvr", num: "metrics_prev.conversions", den: "metrics_prev.clicks" },
 *     { as: "metrics_prev.cpa", num: "metrics_prev.cost",   den: "metrics_prev.conversions" },
 *   ],
 *
 *   // Optional additional computed fields (row-independent):
 *   expressions: {                        // evaluated after sums & ratios
 *     "metrics_delta.cost": (s) => (s.metrics?.cost ?? 0) - (s.metrics_prev?.cost ?? 0),
 *     "metrics_delta.conversions": (s) => (s.metrics?.conversions ?? 0) - (s.metrics_prev?.conversions ?? 0),
 *   },
 *
 *   // If you want to include a few identifier fields from context or first row:
 *   copyFromFirst: ["customer.id", "customer.descriptive_name"],  // optional
 *
 *   // If you want to exclude rows (e.g., drop __rollup grand total rows that may already exist):
 *   excludeRollupRows: true
 * }
 */
function rollupEnvelopeStep(rows, cfg = {}, ctx) {
  const {
    as,
    rollupKey,
    rollupValue = "ALL",
    mark = true,
    sum = [],
    ratios = [],
    expressions = {},
    copyFromFirst = [],
    excludeRollupRows = true,
  } = cfg;

  if (!as) throw new Error("rollupEnvelopeStep: 'as' (envelope key) is required.");
  if (!Array.isArray(rows) || rows.length === 0) {
    // still create an empty object so the envelope has a predictable key
    if (ctx && ctx.state) {
      ctx.state.envelopeData ||= {};
      ctx.state.envelopeData[as] = {};
    }
    return rows;
  }

  const scan = excludeRollupRows ? rows.filter(r => !r.__rollup) : rows;

  // 1) Start summary object
  const summary = {};

  // 2) Optional: copy identifiers from the first row
  if (copyFromFirst.length && scan.length) {
    const first = scan[0];
    for (const path of copyFromFirst) {
      const val = getAtPath(first, path);
      if (val !== undefined) setAtPath(summary, path, val);
    }
  }

  // 2b) Handle multi-customer scenarios
  if (copyFromFirst.includes("customer.id") && scan.length > 1) {
    const customerIds = new Set();
    const customerNames = new Set();
    
    for (const row of scan) {
      const customerId = getAtPath(row, "customer.id");
      const customerName = getAtPath(row, "customer.descriptive_name");
      
      if (customerId !== undefined) customerIds.add(customerId);
      if (customerName !== undefined) customerNames.add(customerName);
    }
    
    // If multiple customers, create a multi-customer summary
    if (customerIds.size > 1) {
      setAtPath(summary, "customer.id", Array.from(customerIds));
      setAtPath(summary, "customer.descriptive_name", Array.from(customerNames));
      setAtPath(summary, "customer.count", customerIds.size);
    }
  }

  // 3) Sums
  for (const path of sum) {
    let total = 0;
    for (const row of scan) total += safeNumber(getAtPath(row, path));
    setAtPath(summary, path, total);
  }

  // 4) Ratios (based on the *summed* totals)
  for (const r of ratios) {
    const num = safeNumber(getAtPath(summary, r.num));
    const den = safeNumber(getAtPath(summary, r.den));
    const val = den === 0 ? null : num / den;
    setAtPath(summary, r.as || `${r.num}_per_${r.den}`, val);
  }

  // 5) Extra expressions (post-compute on the summary object)
  if (expressions && typeof expressions === "object") {
    for (const [path, fn] of Object.entries(expressions)) {
      const v = (typeof fn === "function") ? fn(summary) : fn;
      setAtPath(summary, path, v);
    }
  }

  // 6) Rollup markers
  if (rollupKey) setAtPath(summary, rollupKey, rollupValue);
  if (mark) summary.__rollup = true;

  // 7) Store in envelope
  if (ctx && ctx.state) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData[as] = summary;
  }

  return rows; // do not modify the flowing dataset
}

module.exports = { rollupEnvelopeStep };