// share-of.js
function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function setAtPath(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}
function stableKey(obj) {
  if (obj == null || typeof obj !== "object") return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k)+":"+stableKey(obj[k])).join(",") + "}";
}
function extractDims(row, by) {
  if (!Array.isArray(by) || by.length === 0) return {};
  const dims = {};
  for (const p of by) setAtPath(dims, p, getAtPath(row, p));
  return dims;
}
function safeDivide(n, d, onZero=0) {
  const nn = Number(n), dd = Number(d);
  if (!Number.isFinite(nn) || !Number.isFinite(dd) || dd === 0) return onZero;
  return nn / dd;
}

/**
 * cfg:
 * {
 *   fields: ["metrics.cost","metrics.clicks"] | { "metrics.cost":"metrics.cost_share", ... },
 *   by?: ["campaign.bidding_strategy_type"],   // optional partition
 *   asSuffix?: "_share",                       // used when fields is an array
 *   includeRollup?: false                      // ignore rows with __rollup by default
 * }
 */
function shareOfStep(rows, cfg = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const by = Array.isArray(cfg.by) ? cfg.by : [];
  const includeRollup = !!cfg.includeRollup;

  // Normalize fields config
  let fieldMap = {};
  if (Array.isArray(cfg.fields)) {
    const suffix = typeof cfg.asSuffix === "string" ? cfg.asSuffix : "_share";
    for (const f of cfg.fields) fieldMap[f] = `${f}${suffix}`;
  } else if (cfg.fields && typeof cfg.fields === "object") {
    fieldMap = { ...cfg.fields };
  } else {
    console.warn("[shareOf] cfg.fields is required (array or map). Skipping.");
    return rows;
  }

  // 1) Build partition totals
  const totals = new Map(); // key -> { field: sum }
  for (const r of rows) {
    if (!includeRollup && r && r.__rollup) continue;
    const dims = extractDims(r, by);
    const key = stableKey(dims);
    let bucket = totals.get(key);
    if (!bucket) { bucket = {}; totals.set(key, bucket); }
    for (const src of Object.keys(fieldMap)) {
      const v = Number(getAtPath(r, src));
      if (Number.isFinite(v)) bucket[src] = (bucket[src] || 0) + v;
    }
  }

  // 2) Attach shares per row
  return rows.map(r => {
    const out = Array.isArray(r) ? [...r] : { ...r };
    const dims = extractDims(r, by);
    const key = stableKey(dims);
    const bucket = totals.get(key) || {};
    for (const [src, as] of Object.entries(fieldMap)) {
      const numer = Number(getAtPath(r, src));
      const denom = Number(bucket[src] || 0);
      const share = safeDivide(numer, denom, 0);
      setAtPath(out, as, share);
    }
    return out;
  });
}

module.exports = { shareOfStep };