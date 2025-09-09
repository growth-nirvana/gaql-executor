// stats.js
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
function percentile(sortedNums, p) {
  if (!sortedNums.length) return null;
  const idx = (p/100) * (sortedNums.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedNums[lo];
  const w = idx - lo;
  return sortedNums[lo]*(1-w) + sortedNums[hi]*w;
}

/**
 * cfg:
 * {
 *   fields: ["metrics.cpc","metrics.ctr"],     // numeric fields
 *   by?: ["campaign.bidding_strategy_type"],   // optional partition
 *   include?: ["mean","median","stddev","p"],  // which stats to attach (default ["mean","median"])
 *   percentiles?: [50, 90],                    // only if "p" included (defaults [50])
 *   naming?: "flat"|"nested",                  // "flat" → metrics.cpc_mean ; "nested" → stats.metrics.cpc.mean
 *   nestRoot?: "stats"                         // used when naming="nested"
 * }
 */
function statsStep(rows, cfg = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
  if (fields.length === 0) {
    console.warn("[stats] cfg.fields required. Skipping.");
    return rows;
  }

  const by = Array.isArray(cfg.by) ? cfg.by : [];
  const include = Array.isArray(cfg.include) && cfg.include.length ? cfg.include : ["mean","median"];
  const wantMean = include.includes("mean");
  const wantMedian = include.includes("median");
  const wantStd = include.includes("stddev");
  const wantP = include.includes("p");
  const percentiles = (Array.isArray(cfg.percentiles) && cfg.percentiles.length) ? cfg.percentiles : [50];

  const naming = cfg.naming === "nested" ? "nested" : "flat";
  const nestRoot = cfg.nestRoot || "stats";

  // 1) Collect values per partition+field
  const buckets = new Map(); // key -> { field -> [values] }
  for (const r of rows) {
    const dims = extractDims(r, by);
    const key = stableKey(dims);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = {}; buckets.set(key, bucket); }
    for (const f of fields) {
      const v = Number(getAtPath(r, f));
      if (Number.isFinite(v)) {
        (bucket[f] || (bucket[f] = [])).push(v);
      }
    }
  }

  // 2) Precompute stats per partition+field
  const stats = new Map(); // key -> { field -> { mean, median, stddev, pXX } }
  for (const [key, valsByField] of buckets.entries()) {
    const s = {};
    for (const f of Object.keys(valsByField)) {
      const arr = valsByField[f].slice().sort((a,b)=>a-b);
      const n = arr.length;
      const out = {};

      if (wantMean || wantStd) {
        const mean = arr.reduce((a,b)=>a+b,0) / Math.max(n,1);
        if (wantMean) out.mean = mean;
        if (wantStd) {
          const variance = arr.reduce((a,b)=>a+(b-mean)*(b-mean),0) / Math.max(n,1);
          out.stddev = Math.sqrt(variance);
        }
      }
      if (wantMedian) out.median = percentile(arr, 50);
      if (wantP) {
        for (const p of percentiles) {
          out[`p${p}`] = percentile(arr, p);
        }
      }
      s[f] = out;
    }
    stats.set(key, s);
  }

  // 3) Attach to rows
  return rows.map(r => {
    const out = Array.isArray(r) ? [...r] : { ...r };
    const dims = extractDims(r, by);
    const key = stableKey(dims);
    const s = stats.get(key) || {};

    for (const f of fields) {
      const st = s[f] || {};
      if (naming === "flat") {
        if ("mean" in st)    setAtPath(out, `${f}_mean`, st.mean);
        if ("median" in st)  setAtPath(out, `${f}_median`, st.median);
        if ("stddev" in st)  setAtPath(out, `${f}_stddev`, st.stddev);
        for (const p of percentiles) {
          if (st[`p${p}`] != null) setAtPath(out, `${f}_p${p}`, st[`p${p}`]);
        }
      } else {
        // nested
        const base = `${nestRoot}.${f}`;
        if ("mean" in st)    setAtPath(out, `${base}.mean`, st.mean);
        if ("median" in st)  setAtPath(out, `${base}.median`, st.median);
        if ("stddev" in st)  setAtPath(out, `${base}.stddev`, st.stddev);
        for (const p of percentiles) {
          if (st[`p${p}`] != null) setAtPath(out, `${base}.p${p}`, st[`p${p}`]);
        }
      }
    }
    return out;
  });
}

module.exports = { statsStep };