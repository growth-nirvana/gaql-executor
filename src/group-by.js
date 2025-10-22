// group-by.js

const { getAtPath, setAtPath } = require('./utils');

// ---------- date bucketing ----------
function parseDateLike(s) {
  // Accepts 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM:SS', or Date
  if (s instanceof Date) return new Date(s.getTime());
  if (typeof s !== "string") return null;
  const t = s.replace(" ", "T"); // crude but effective for UTC-ish strings
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfWeek(d, weekStartsOn = 1) {
  // weekStartsOn: 0=Sun, 1=Mon (default)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diff = (day - weekStartsOn + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date;
}

function startOfMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfQuarter(d) {
  const q = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), q, 1));
}

function startOfYear(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

function bucketDate(dateLike, granularity = "WEEK", opts = {}) {
  const d = parseDateLike(dateLike);
  if (!d) return null;
  let s;
  switch (granularity) {
    case "DAY":
      s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      break;
    case "WEEK":
      s = startOfWeek(d, opts.weekStartsOn ?? 1); // default Monday
      break;
    case "MONTH":
      s = startOfMonth(d);
      break;
    case "QUARTER":
      s = startOfQuarter(d);
      break;
    case "YEAR":
      s = startOfYear(d);
      break;
    default:
      s = startOfWeek(d, 1);
  }
  // ISO date string (YYYY-MM-DD) for readability/stability
  return s.toISOString().slice(0, 10);
}

// ---------- math helpers ----------
function safeDivide(n, d, onZero = 0) {
  const nn = Number(n);
  const dd = Number(d);
  if (!Number.isFinite(nn) || !Number.isFinite(dd) || dd === 0) return onZero;
  return nn / dd;
}

// ---------- filter helpers ----------
function testCond(value, op, expected) {
  switch (op) {
    case ">":  return Number(value) >  Number(expected);
    case ">=": return Number(value) >= Number(expected);
    case "<":  return Number(value) <  Number(expected);
    case "<=": return Number(value) <= Number(expected);
    case "==": return value === expected;
    case "!=": return value !== expected;
    case "IN": {
      const set = Array.isArray(expected) ? expected : [expected];
      return set.some(v => v === value);
    }
    case "NOT IN": {
      const set = Array.isArray(expected) ? expected : [expected];
      return !set.some(v => v === value);
    }
    default:   return true;
  }
}

function applyWhere(rows, where) {
  if (!Array.isArray(where) || where.length === 0) return rows;
  return rows.filter(r =>
    where.every(c => testCond(getAtPath(r, c.field), c.op, c.value))
  );
}

// ---------- aggregate core ----------
function initAccumulator(fn) {
  switch (fn) {
    case "SUM":
    case "AVG":    return { sum: 0, count: 0 };
    case "MIN":    return { min: undefined };
    case "MAX":    return { max: undefined };
    case "COUNT":  return { count: 0 };
    case "COUNT_DISTINCT": return { set: new Set() };
    default:       return {};
  }
}

function stepAccumulator(acc, fn, value) {
  switch (fn) {
    case "SUM":
    case "AVG":
      if (value != null && value !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) {
          acc.sum += n;
          acc.count += 1;
        }
      }
      break;
    case "MIN":
      if (value != null && (acc.min === undefined || value < acc.min)) acc.min = value;
      break;
    case "MAX":
      if (value != null && (acc.max === undefined || value > acc.max)) acc.max = value;
      break;
    case "COUNT":
      acc.count += 1;
      break;
    case "COUNT_DISTINCT":
      acc.set.add(value);
      break;
  }
}

function finalizeAccumulator(acc, fn) {
  switch (fn) {
    case "SUM":   return acc.sum;
    case "AVG":   return acc.count ? acc.sum / acc.count : 0;
    case "MIN":   return acc.min;
    case "MAX":   return acc.max;
    case "COUNT": return acc.count;
    case "COUNT_DISTINCT": return acc.set.size;
    default: return null;
  }
}

// ---------- public: groupRows ----------
/**
 * rows: array of objects (GAQL result rows)
 * cfg = {
 *   by: [ "campaign.bidding_strategy_type", ... ],
 *   timeBucket: { field: "segments.date", granularity: "WEEK", weekStartsOn?: 1, as?: "timeBucket" },
 *   aggregates: {
 *      "metrics.cost_micros": { fn: "SUM", as: "cost_micros" },
 *      "metrics.clicks":      { fn: "SUM", as: "clicks" },
 *      "metrics.impressions": { fn: "SUM", as: "impressions" },
 *      "cost": { fn: "MICROS_TO_UNITS", src: "cost_micros", currency: "USD", as: "cost" },
 *      "ctr":  { fn: "RATIO", num: "clicks", den: "impressions", as: "ctr" },
 *      "cpc":  { fn: "RATIO", num: "cost",   den: "clicks",      as: "cpc" },
 *   },
 *   where:  [{ field, op, value }],
 *   having: [{ field, op, value }],
 *   orderBy: [{ field, dir: "ASC"|"DESC" }],
 *   limit: 50,
 *   rollup: false,
 *   nulls: "exclude" | "include"
 * }
 */
function groupRows(rows, cfg = {}) {
  const {
    by = [],
    timeBucket,
    aggregates = {},
    where = [],
    having = [],
    orderBy = [],
    limit,
    rollup = false,
    nulls = "exclude",
    expressions = {},
  } = cfg;

  if (!Array.isArray(rows) || rows.length === 0) return [];

  // 1) pre-filter
  const filtered = applyWhere(rows, where);

  // 2) Prepare dimension extractor
  const dimPaths = Array.isArray(by) ? [...by] : [];
  let timeBucketKey = null;
  if (timeBucket && timeBucket.field) {
    timeBucketKey = timeBucket.as || "timeBucket";
  }

  function extractDims(row) {
    const dims = {};
    for (const p of dimPaths) {
      const v = getAtPath(row, p);
      if ((v == null || v === "") && nulls === "exclude") return null;
      setAtPath(dims, p, v ?? null);
    }
    if (timeBucket && timeBucket.field) {
      const dt = getAtPath(row, timeBucket.field);
      const b = bucketDate(dt, timeBucket.granularity || "WEEK", {
        weekStartsOn: timeBucket.weekStartsOn ?? 1,
      });
      if ((b == null || b === "") && nulls === "exclude") return null;
      dims[timeBucketKey] = b;
    }
    return dims;
  }

  function stableStringify(obj) {
    if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
    const keys = Object.keys(obj).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
  }
  
  function dimsKey(dims) {
    return stableStringify(dims);
  }

  // 3) Split aggregate configs into base vs derived
  const baseAggs = [];
  const derivedAggs = [];
  for (const [fieldOrAlias, spec] of Object.entries(aggregates)) {
    const fn = String(spec.fn || "").toUpperCase();
    const as = spec.as || inferAlias(fieldOrAlias, fn);
    const entry = { fieldOrAlias, fn, as, spec };
    if (fn === "RATIO" || fn === "MICROS_TO_UNITS") derivedAggs.push(entry);
    else baseAggs.push(entry);
  }

  function inferAlias(fieldPath, fn) {
    // Default alias: last segment + _fn (for bases), or field name for derived
    const last = String(fieldPath).split(".").pop();
    if (fn === "RATIO" || fn === "MICROS_TO_UNITS") return last;
    return `${last}_${fn.toLowerCase()}`;
  }

  // 4) Build groups and step accumulators
  const groups = new Map(); // key -> { dims, acc: { as: accumulator } }
  for (const row of filtered) {
    const dims = extractDims(row);
    if (!dims) continue; // excluded null group
    const key = dimsKey(dims);
    let g = groups.get(key);
    if (!g) {
      g = { dims, acc: {} };
      for (const b of baseAggs) {
        g.acc[b.as] = initAccumulator(b.fn);
      }
      groups.set(key, g);
    }
    // step accumulators
    for (const b of baseAggs) {
      let val;
      if (b.fn === "COUNT") {
        val = 1;
      } else {
        val = getAtPath(row, b.fieldOrAlias);
      }
      stepAccumulator(g.acc[b.as], b.fn, val);
    }
  }

  // 5) Finalize groups (base → values), compute derived on top
  const out = [];
  for (const { dims, acc } of groups.values()) {
    const row = { ...dims };

    for (const b of baseAggs) {
      const value = finalizeAccumulator(acc[b.as], b.fn);
      if (String(b.as).includes(".")) setAtPath(row, b.as, value);
      else row[b.as] = value;
    }

    for (const d of derivedAggs) {
      let value = null;
    
      if (d.fn === "RATIO") {
        const num = getAtPath(row, d.spec.num);
        const den = getAtPath(row, d.spec.den);
        value = safeDivide(num, den, 0);
      } else if (d.fn === "MICROS_TO_UNITS") {
        const src = getAtPath(row, d.spec.src);
        const n = Number(src);
        value = Number.isFinite(n) ? n / 1_000_000 : null;
      }
    
      if (String(d.as).includes(".")) setAtPath(row, d.as, value);
      else row[d.as] = value;
    }
    
    // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
    // NEW: post-compute expressions mixing current, previous, delta
    if (expressions && typeof expressions === "object") {
      for (const [path, fn] of Object.entries(expressions)) {
        const val = typeof fn === "function" ? fn(row) : fn;
        setAtPath(row, path, val);
      }
    }
    // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

    out.push(row);
  }

  // 6) rollup (grand total)
  if (rollup && out.length) {
    const total = {};
  
    for (const b of baseAggs) {
      const asPath = b.as;
      const fn = b.fn;
  
      if (["SUM", "COUNT"].includes(fn)) {
        const sum = out.reduce((s, r) => s + (Number(getAtPath(r, asPath)) || 0), 0);
        if (String(asPath).includes(".")) setAtPath(total, asPath, sum);
        else total[asPath] = sum;
      } else if (fn === "MIN") {
        const min = out.reduce((m, r) => {
          const v = getAtPath(r, asPath);
          return m == null || v < m ? v : m;
        }, null);
        String(asPath).includes(".") ? setAtPath(total, asPath, min) : (total[asPath] = min);
      } else if (fn === "MAX") {
        const max = out.reduce((m, r) => {
          const v = getAtPath(r, asPath);
          return m == null || v > m ? v : m;
        }, null);
        String(asPath).includes(".") ? setAtPath(total, asPath, max) : (total[asPath] = max);
      } else {
        // AVG etc. – leave null by default or implement weighted logic
        String(asPath).includes(".") ? setAtPath(total, asPath, null) : (total[asPath] = null);
      }
    }
  
    // derived on rollup
    for (const d of derivedAggs) {
      let value = null;
      if (d.fn === "RATIO") {
        value = safeDivide(getAtPath(total, d.spec.num), getAtPath(total, d.spec.den), 0);
      } else if (d.fn === "MICROS_TO_UNITS") {
        const n = Number(getAtPath(total, d.spec.src));
        value = Number.isFinite(n) ? n / 1_000_000 : null;
      }
      String(d.as).includes(".") ? setAtPath(total, d.as, value) : (total[d.as] = value);
    }
    out.push({ ...(timeBucket ? { [timeBucketKey]: "ALL" } : {}), ...total, __rollup: true });
  }

  // 7) having
  const afterHaving = applyWhere(out, having);

  // 8) orderBy
  const ordered = [...afterHaving];
  if (Array.isArray(orderBy) && orderBy.length > 0) {
    ordered.sort((a, b) => {
      for (const ob of orderBy) {
        const dir = (ob.dir || "ASC").toUpperCase();
        const av = getAtPath(a, ob.field);
        const bv = getAtPath(b, ob.field);
        if (av == null && bv == null) continue;
        if (av == null) return dir === "ASC" ? 1 : -1;
        if (bv == null) return dir === "ASC" ? -1 : 1;
        if (av < bv) return dir === "ASC" ? -1 : 1;
        if (av > bv) return dir === "ASC" ? 1 : -1;
      }
      return 0;
    });
  }

  // 9) limit
  return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
}

module.exports = { groupRows };