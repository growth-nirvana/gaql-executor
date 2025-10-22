// steps/derive.js
// A lightweight, row-wise transform that adds/renames/drops fields.
// Does NOT change grain, order, or count. Think: SELECT ... AS ... per row.

const { getAtPath, setAtPath } = require('./utils');

// Safe math helpers available to expression functions
const H = {
  coalesce: (v, d) => (v == null || Number.isNaN(v) ? d : v),
  clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
  safeDivide: (n, d, onZero = 0) => {
    const nn = Number(n), dd = Number(d);
    if (!Number.isFinite(nn) || !Number.isFinite(dd) || dd === 0) return onZero;
    return nn / dd;
  },
  pos: (x) => Math.max(Number(x) || 0, 0),
  neg: (x) => Math.max(-(Number(x) || 0), 0),
};

function derive(rows, cfg = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const {
    add = {},          // { "path.to.new": (row, H) => any | literal, ... }
    rename = {},       // { "old.path": "new.path", ... }
    drop = [],         // ["path.to.field", ...]
    keep = null,       // optional allowlist: if set, remove all fields NOT in keep (after add/rename)
    prefix = null,     // optional: prefix to put in front of every path in `add` results, e.g. "diagnostics"
  } = cfg;

  const out = new Array(rows.length);

  for (let i = 0; i < rows.length; i++) {
    // Shallow clone so we don’t mutate upstream references.
    const r = JSON.parse(JSON.stringify(rows[i]));

    // 1) add new fields
    for (const [path, expr] of Object.entries(add)) {
      const finalPath = prefix ? `${prefix}.${path}` : path;
      const val = (typeof expr === 'function') ? expr(r, H) : expr;
      setAtPath(r, finalPath, val);
    }

    // 2) rename fields
    for (const [src, dst] of Object.entries(rename)) {
      const val = getAtPath(r, src);
      if (val !== undefined) {
        setAtPath(r, dst, val);
        setAtPath(r, src, undefined);
      }
    }

    // 3) drop fields
    for (const path of drop) {
      setAtPath(r, path, undefined);
    }

    // 4) keep allowlist (optional & last)
    if (Array.isArray(keep)) {
      // Build a new object containing only whitelisted paths
      const kept = {};
      for (const path of keep) {
        const val = getAtPath(r, path);
        if (val !== undefined) setAtPath(kept, path, val);
      }
      out[i] = kept;
    } else {
      out[i] = r;
    }
  }

  return out;
}

module.exports = { derive };