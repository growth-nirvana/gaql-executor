// percentile-rank.js
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
function lowerBound(arr, x) { // first index >= x
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
function upperBound(arr, x) { // first index > x
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * cfg:
 * {
 *   fields: ["metrics.cpc","metrics.ctr"] | { "metrics.cpc": "metrics.cpc_pr", ... },
 *   by?: ["program","campaign.bidding_strategy_type"], // partition(s)
 *   asSuffix?: "_pr",             // used when fields is an array
 *   method?: "cdf"|"average_rank" // default "cdf" = (L + 0.5*E)/N
 *   includeRollup?: false         // ignore __rollup by default
 * }
 */
function percentileRankStep(rows, cfg = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // normalize fields map
  let fieldMap = {};
  if (Array.isArray(cfg.fields)) {
    const suffix = typeof cfg.asSuffix === "string" ? cfg.asSuffix : "_pr";
    for (const f of cfg.fields) fieldMap[f] = `${f}${suffix}`;
  } else if (cfg.fields && typeof cfg.fields === "object") {
    fieldMap = { ...cfg.fields };
  } else {
    console.warn("[percentileRank] cfg.fields is required. Skipping.");
    return rows;
  }

  const by = Array.isArray(cfg.by) ? cfg.by : [];
  const includeRollup = !!cfg.includeRollup;
  const method = (cfg.method || "cdf").toLowerCase();

  // 1) collect values per partition+field
  const buckets = new Map(); // key -> { field -> sorted array }
  for (const r of rows) {
    if (!includeRollup && r && r.__rollup) continue;
    const dims = extractDims(r, by);
    const key = stableKey(dims);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = {}; buckets.set(key, bucket); }
    for (const src of Object.keys(fieldMap)) {
      const v = Number(getAtPath(r, src));
      if (Number.isFinite(v)) (bucket[src] || (bucket[src] = [])).push(v);
    }
  }
  // sort each bucket list
  for (const b of buckets.values()) {
    for (const f of Object.keys(b)) b[f].sort((a,b)=>a-b);
  }

  // 2) attach percentile rank
  return rows.map(r => {
    const out = Array.isArray(r) ? [...r] : { ...r };
    const key = stableKey(extractDims(r, by));
    const b = buckets.get(key) || {};
    for (const [src, as] of Object.entries(fieldMap)) {
      const arr = b[src] || [];
      const n = arr.length;
      const v = Number(getAtPath(r, src));
      let pr = null;
      if (Number.isFinite(v) && n > 0) {
        if (method === "average_rank") {
          // avg rank among equals: ((lb+1) + ub) / 2 / n
          const lb = lowerBound(arr, v);
          const ub = upperBound(arr, v);
          const avgRank = ((lb + 1) + ub) / 2; // 1-based
          pr = avgRank / n;
        } else {
          // cdf with ties: (L + 0.5*E)/N
          const lb = lowerBound(arr, v);
          const ub = upperBound(arr, v);
          const L = lb, E = ub - lb;
          pr = (L + 0.5 * E) / n;
        }
      }
      setAtPath(out, as, pr);
    }
    return out;
  });
}

module.exports = { percentileRankStep };