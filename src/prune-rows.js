// steps/prune-rows.js
const { getAtPath, setAtPath } = require('./utils');

function pickPaths(obj, paths) {
  const out = {};
  for (const p of paths) {
    const v = getAtPath(obj, p);
    if (v !== undefined) setAtPath(out, p, v);
  }
  return out;
}

/**
 * Prunes the flowing row set while preserving envelope data.
 *
 * cfg:
 * {
 *   enabled: true,                 // turn on/off
 *   when: { maxRows: 2000 },       // condition to prune (optional)
 *   mode: "empty" | "select" | "head" | "sample",
 *
 *   // mode: "select"
 *   select: ["search_term_view.search_term","metrics.cost","metrics.conversions"],
 *
 *   // mode: "head"
 *   limit: 500,
 *
 *   // mode: "sample"
 *   sample: { rate: 0.1, seed: 42, limit: 1000 },  // rate in (0,1], optional cap
 *
 *   // bookkeeping into envelope
 *   as: "rows_meta",               // envelope key to store metadata
 *   annotate: true                 // record before/after counts, mode, etc.
 * }
 */
function pruneRowsStep(rows, cfg = {}, ctx) {
  const {
    enabled = true,
    when = null,
    mode = "empty",
    select = null,
    limit = null,
    sample = null,
    as = "rows_meta",
    annotate = true,
  } = cfg;

  if (!enabled || !Array.isArray(rows)) return rows;

  const beforeCount = rows.length;

  // Conditional trigger
  let shouldPrune = true;
  if (when && typeof when === "object") {
    const { maxRows } = when;
    if (typeof maxRows === "number") shouldPrune = beforeCount > maxRows;
  }
  if (!shouldPrune) return rows;

  let out = rows;

  if (mode === "empty") {
    out = [];
  } else if (mode === "select" && Array.isArray(select) && select.length > 0) {
    out = rows.map(r => pickPaths(r, select));
  } else if (mode === "head") {
    out = typeof limit === "number" ? rows.slice(0, limit) : rows;
  } else if (mode === "sample" && sample) {
    const rate = Math.min(Math.max(Number(sample.rate) || 0, 0), 1) || 0.1;
    let rng = Math.random;
    if (Number.isFinite(sample.seed)) {
      // simple LCG for deterministic sampling
      let s = (sample.seed >>> 0) || 1;
      rng = () => (s = (1664525 * s + 1013904223) >>> 0) / 2**32;
    }
    const chosen = [];
    for (const r of rows) if (rng() < rate) chosen.push(r);
    out = typeof sample.limit === "number" ? chosen.slice(0, sample.limit) : chosen;
  }

  // Envelope metadata
  if (ctx && ctx.state && annotate) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData[as] = {
      pruned: true,
      mode,
      before_count: beforeCount,
      after_count: out.length,
      ...(when ? { when } : {}),
      ...(mode === "select" && select ? { select } : {}),
      ...(mode === "head" && Number.isFinite(limit) ? { limit } : {}),
      ...(mode === "sample" && sample ? { sample } : {}),
    };
  }

  return out;
}

module.exports = { pruneRowsStep };
