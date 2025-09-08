// delta.js
const { groupRows } = require("./group-by");

// ----- tiny path utils -----
function getAtPath(obj, path) {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function setAtPath(obj, path, value) {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}
function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
function keyFromRow(row, keys) {
  const dims = {};
  for (const k of keys) setAtPath(dims, k, getAtPath(row, k));
  return stableStringify(dims);
}
function leaf(path) { return String(path).split(".").pop(); }
function safeDivide(n, d, onZero = null) {
  const nn = Number(n), dd = Number(d);
  if (!Number.isFinite(nn) || !Number.isFinite(dd) || dd === 0) return onZero;
  return nn / dd;
}

// ----- previous-period date helpers -----
function parseYmd(s) {
  // Expect "YYYY-MM-DD"
  if (typeof s !== "string") return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  // force UTC midnight
  return new Date(Date.UTC(y, m - 1, d));
}
function formatYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function prevRangeSameLength(from_date, to_date) {
  const from = parseYmd(from_date);
  const to = parseYmd(to_date);
  if (!from || !to) return null;
  const lenDays = Math.round((to - from) / 86400000) + 1; // inclusive
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - (lenDays - 1) * 86400000);
  return { from_date: formatYmd(prevFrom), to_date: formatYmd(prevTo) };
}

// ----- main step (augment mode) -----
/**
 * cfg signature (minimal):
 * {
 *   // optional: explicit baseline; if omitted we compute previous using report.from_date/to_date
 *   baseline?: { from_date: "YYYY-MM-DD", to_date: "YYYY-MM-DD" },
 *
 *   // optional: join keys; if omitted, we derive from ctx.state.lastGroupCfg (by + timeBucket)
 *   keys?: string[],
 *
 *   // which measures to delta
 *   measures: [
 *     { field: "metrics.cost", kind: "absolute" },
 *     { field: "metrics.clicks", kind: "absolute" },
 *     { field: "metrics.impressions", kind: "absolute" },
 *     // ratios recomputed from bases (recommended)
 *     { field: "metrics.ctr", kind: "ratio", num: "metrics.clicks", den: "metrics.impressions" },
 *     { field: "metrics.cpc", kind: "ratio", num: "metrics.cost",   den: "metrics.clicks" }
 *   ],
 *
 *   // output namespaces (augment mode)
 *   emit?: {
 *     previous?: "metrics_prev",
 *     delta_abs?: "metrics_delta",
 *     delta_pct?: "metrics_delta_pct"
 *   },
 *
 *   policies?: { pctOnZero?: "null" | "0" | "inf" } // default "null"
 * }
 */
async function deltaAugment(rows, cfg = {}, ctx) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // 1) resolve join keys
  let keys = Array.isArray(cfg.keys) && cfg.keys.length ? cfg.keys.slice() : null;
  const gcfg = ctx?.state?.lastGroupCfg || null;
  if (!keys) {
    if (!gcfg) {
      throw new Error(
        'delta step needs "keys" or a prior "group" step (ctx.state.lastGroupCfg missing)'
      );
    }
    keys = Array.isArray(gcfg.by) ? gcfg.by.slice() : [];
    if (gcfg.timeBucket && gcfg.timeBucket.field) {
      const tbKey = gcfg.timeBucket.as || "timeBucket"; // group-by emits bucket at this key
      keys.push(tbKey); // note: this is a top-level key, not dotted
    }
  }

  // 2) resolve baseline date range
  let baseline = cfg.baseline;
  if (!baseline) {
    const r = ctx?.options?.report || {};
    if (r.from_date && r.to_date) {
      baseline = prevRangeSameLength(r.from_date, r.to_date);
    }
  }
  if (!baseline || !baseline.from_date || !baseline.to_date) {
    console.warn(
      "[delta] Missing baseline; provide cfg.baseline.from_date/to_date or report.from_date/to_date. Skipping delta."
    );
    return rows;
  }

  // 3) fetch previous raw, normalize with identical pre-steps, then group with same config
  const prevRaw = await ctx.fetch(
    { from_date: baseline.from_date, to_date: baseline.to_date },
    "previous"
  );
  const prevNorm = await ctx.runPre(prevRaw);
  const prevGrouped = gcfg ? groupRows(prevNorm, gcfg) : prevNorm;

  // 4) index previous by keys
  const prevIdx = new Map();
  for (const pr of prevGrouped) {
    prevIdx.set(keyFromRow(pr, keys), pr);
  }

  // 5) emit deltas (augment mode)
  const nsPrev = (cfg.emit && cfg.emit.previous) || "metrics_prev";
  const nsDAbs = (cfg.emit && cfg.emit.delta_abs) || "metrics_delta";
  const nsDPct = (cfg.emit && cfg.emit.delta_pct) || "metrics_delta_pct";
  const pctPolicy = (cfg.policies && cfg.policies.pctOnZero) || "null";

  function pctDelta(cur, prev) {
    if (prev == null || prev === 0) {
      return pctPolicy === "0" ? 0 : pctPolicy === "inf" ? Infinity : null;
    }
    return (cur - prev) / prev;
  }

  const measures = Array.isArray(cfg.measures) ? cfg.measures : [];
  if (!measures.length) {
    console.warn("[delta] No measures provided; nothing to compute. Skipping.");
    return rows;
  }

  const out = [];
  for (const curr of rows) {
    const key = keyFromRow(curr, keys);
    const prev = prevIdx.get(key);

    const row = Array.isArray(curr) ? [...curr] : { ...curr };

    for (const m of measures) {
      if (m.kind === "absolute") {
        const currVal = Number(getAtPath(row, m.field));
        const prevVal = prev != null ? Number(getAtPath(prev, m.field)) : 0;

        const leafName = leaf(m.field);
        setAtPath(row, `${nsPrev}.${leafName}`, Number.isFinite(prevVal) ? prevVal : null);

        const abs = (Number.isFinite(currVal) ? currVal : 0) - (Number.isFinite(prevVal) ? prevVal : 0);
        setAtPath(row, `${nsDAbs}.${leafName}`, Number.isFinite(abs) ? abs : null);

        const pct = pctDelta(currVal, prevVal);
        setAtPath(row, `${nsDPct}.${leafName}`, pct);

      } else if (m.kind === "ratio") {
        // recompute ratios from bases so we don't depend on current rows having them precomputed
        const cNum = Number(getAtPath(row, m.num));
        const cDen = Number(getAtPath(row, m.den));
        const pNum = prev != null ? Number(getAtPath(prev, m.num)) : 0;
        const pDen = prev != null ? Number(getAtPath(prev, m.den)) : 0;

        const currRatio = safeDivide(cNum, cDen, null);
        const prevRatio = safeDivide(pNum, pDen, null);

        const leafName = leaf(m.field);
        setAtPath(row, `${nsPrev}.${leafName}`, prevRatio);

        const abs = currRatio == null || prevRatio == null ? null : currRatio - prevRatio;
        setAtPath(row, `${nsDAbs}.${leafName}`, abs);

        const pct =
          prevRatio == null ? (pctPolicy === "0" ? 0 : pctPolicy === "inf" ? Infinity : null)
                            : safeDivide(abs, prevRatio, pctPolicy === "0" ? 0 : pctPolicy === "inf" ? Infinity : null);
        setAtPath(row, `${nsDPct}.${leafName}`, pct);
      }
    }

    out.push(row);
  }

  return out;
}

module.exports = { deltaAugment };