// zscore.js
function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
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
function extractDims(row, by) {
  if (!Array.isArray(by) || by.length === 0) return {};
  const dims = {};
  for (const p of by) setAtPath(dims, p, getAtPath(row, p));
  return dims;
}
function stableKey(obj) {
  if (obj == null || typeof obj !== "object") return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k)+":"+stableKey(obj[k])).join(",") + "}";
}

/**
 * cfg:
 * {
 *   fields: ["metrics.cpc","metrics.ctr"] | { "metrics.cpc": "metrics.cpc_z", ... },
 *   by?: ["program"],
 *   asSuffix?: "_z",          // used when fields is an array
 *   ddof?: 0|1,               // degrees of freedom for std; 0=population (default), 1=sample
 *   onZeroStd?: "null"|"zero" // default "null"
 * }
 */
function zScoreStep(rows, cfg = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // normalize fields map
  let fieldMap = {};
  if (Array.isArray(cfg.fields)) {
    const suffix = typeof cfg.asSuffix === "string" ? cfg.asSuffix : "_z";
    for (const f of cfg.fields) fieldMap[f] = `${f}${suffix}`;
  } else if (cfg.fields && typeof cfg.fields === "object") {
    fieldMap = { ...cfg.fields };
  } else {
    console.warn("[zScore] cfg.fields is required. Skipping.");
    return rows;
  }

  const by = Array.isArray(cfg.by) ? cfg.by : [];
  const ddof = (cfg.ddof === 1) ? 1 : 0;
  const onZeroStd = (cfg.onZeroStd === "zero") ? "zero" : "null";

  // 1) Welford pass: mean & M2 per partition+field
  const stats = new Map(); // key -> { field -> { n, mean, M2 } }
  function getFieldStats(bucket, field) {
    const t = bucket[field] || (bucket[field] = { n: 0, mean: 0, M2: 0 });
    return t;
  }
  for (const r of rows) {
    const dims = extractDims(r, by);
    const key = stableKey(dims);
    let bucket = stats.get(key);
    if (!bucket) { bucket = {}; stats.set(key, bucket); }
    for (const src of Object.keys(fieldMap)) {
      const v = Number(getAtPath(r, src));
      if (!Number.isFinite(v)) continue;
      const s = getFieldStats(bucket, src);
      s.n += 1;
      const delta = v - s.mean;
      s.mean += delta / s.n;
      const delta2 = v - s.mean;
      s.M2 += delta * delta2;
    }
  }

  // 2) finalize variance/std per partition+field
  for (const bucket of stats.values()) {
    for (const src of Object.keys(bucket)) {
      const s = bucket[src];
      const denom = s.n - ddof;
      s.var = (denom > 0) ? (s.M2 / denom) : null;
      s.std = (s.var != null) ? Math.sqrt(s.var) : null;
    }
  }

  // 3) attach z-scores
  return rows.map(r => {
    const out = Array.isArray(r) ? [...r] : { ...r };
    const key = stableKey(extractDims(r, by));
    const bucket = stats.get(key) || {};
    for (const [src, as] of Object.entries(fieldMap)) {
      const v = Number(getAtPath(r, src));
      const s = bucket[src];
      let z = null;
      if (s && Number.isFinite(v) && s.std != null && s.std !== 0) {
        z = (v - s.mean) / s.std;
      } else if (s && s.std === 0 && onZeroStd === "zero") {
        z = 0; // every point identical
      } // else keep null
      setAtPath(out, as, z);
    }
    return out;
  });
}

module.exports = { zScoreStep };