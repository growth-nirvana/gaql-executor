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

// ----- date helpers -----
function parseYmd(s) {
  if (typeof s !== "string") return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)); // UTC midnight
}
function formatYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function lastDayOfMonthUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}
function shiftYearClamp(d, deltaYears) {
  const y = d.getUTCFullYear() + deltaYears;
  const m = d.getUTCMonth();
  const dom = d.getUTCDate();
  const maxDom = lastDayOfMonthUTC(y, m);
  const safeDom = Math.min(dom, maxDom);
  return new Date(Date.UTC(y, m, safeDom));
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
function prevYearSameSpan(from_date, to_date) {
  const from = parseYmd(from_date);
  const to = parseYmd(to_date);
  if (!from || !to) return null;
  const pf = shiftYearClamp(from, -1);
  const pt = shiftYearClamp(to, -1);
  return { from_date: formatYmd(pf), to_date: formatYmd(pt) };
}

// Decide baseline window based on cfg + report dates
function resolveBaseline(report, cfg) {
  const explicit = cfg?.baseline;
  if (explicit?.from_date && explicit?.to_date) {
    return { from_date: explicit.from_date, to_date: explicit.to_date };
  }

  const mode = (explicit?.mode || "previous_period").toLowerCase();
  const from = report?.from_date;
  const to = report?.to_date;

  if (!from || !to) return null;

  if (mode === "previous_year" || mode === "yoy") {
    return prevYearSameSpan(from, to);
  }
  // default
  return prevRangeSameLength(from, to);
}

/**
 * cfg:
 * {
 *   baseline?: { mode?: "previous_period"|"previous_year"|"yoy", from_date?:string, to_date?:string },
 *   keys?: string[],            // else inferred from prior group step (by + timeBucket)
 *   measures: [
 *     { field:"metrics.cost", kind:"absolute" }, ...,
 *     { field:"metrics.cpc",  kind:"ratio", num:"metrics.cost", den:"metrics.clicks" }
 *   ],
 *   emit?:   { previous?: "metrics_prev", delta_abs?: "metrics_delta", delta_pct?: "metrics_delta_pct" },
 *   policies?: { pctOnZero?: "null" | "0" | "inf" },
 *   filterMode?: "both" | "current_only" | "previous_only" | "none"   // default "both"
 * }
 */
async function deltaAugment(rows, cfg = {}, ctx) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  // 1) keys
  let keys = Array.isArray(cfg.keys) && cfg.keys.length ? cfg.keys.slice() : null;
  const gcfg = ctx?.state?.lastGroupCfg || null;
  if (!keys) {
    if (!gcfg) {
      throw new Error('delta step needs "keys" or a prior "group" step (ctx.state.lastGroupCfg missing)');
    }
    keys = Array.isArray(gcfg.by) ? gcfg.by.slice() : [];
    if (gcfg.timeBucket && gcfg.timeBucket.field) {
      const tbKey = gcfg.timeBucket.as || "timeBucket"; // group emits the bucket at this key
      keys.push(tbKey);
    }
  }

  // 2) baseline
  let baseline =
    (ctx?.state?.periods && ctx.state.periods.baseline) ||
    resolveBaseline(ctx?.options?.report, cfg);

  if (!baseline || !baseline.from_date || !baseline.to_date) {
    console.warn("[delta] Missing baseline; provide cfg.baseline or report.from_date/to_date. Skipping delta.");
    return rows;
  }

  // 3) fetch & group previous
  const prevRaw      = await ctx.fetch({ from_date: baseline.from_date, to_date: baseline.to_date }, "previous");
  const prevNorm     = await ctx.runPre(prevRaw);
  const prevGrouped  = gcfg ? groupRows(prevNorm, gcfg) : prevNorm;

  // 3b) apply the SAME filter to baseline if requested
  const filterMode   = cfg.filterMode || "both";
  const filterFn     = ctx?.state?.lastFilterFn;
  const excludeRoll  = !!ctx?.state?.excludeRollup;


  const filterIfNeeded = (arr, side) => {
    if (!Array.isArray(arr)) return arr;
    if (!filterFn) return arr;
    if (filterMode === "none") return arr;
    if (filterMode === "previous_only" && side !== "prev") return arr;
    if (filterMode === "current_only"  && side !== "curr") return arr;
    return arr.filter(filterFn);
  };

  const rowsFiltered = filterIfNeeded(rows, "curr");
  const prevFiltered = filterIfNeeded(prevGrouped, "prev");

  // 4) index both sides by keys + UNION of keys
  
  const prevIdx = new Map();
  for (const pr of prevFiltered) {
    if (excludeRoll && pr?.meta?.rollup_key) continue;
    const key = keyFromRow(pr, keys);
    prevIdx.set(key, pr);
  }

  const currIdx = new Map();
  for (const cr of rowsFiltered) {
    if (excludeRoll && cr?.meta?.rollup_key) continue;
    const key = keyFromRow(cr, keys);
    currIdx.set(key, cr);
  }

  const allKeys = new Set([...currIdx.keys(), ...prevIdx.keys()]);

  // 5) compute deltas
  const nsPrev = (cfg.emit && cfg.emit.previous)   || "metrics_prev";
  const nsDAbs = (cfg.emit && cfg.emit.delta_abs)  || "metrics_delta";
  const nsDPct = (cfg.emit && cfg.emit.delta_pct)  || "metrics_delta_pct";
  const pctPolicy = (cfg.policies && cfg.policies.pctOnZero) || "null";
  const measures = Array.isArray(cfg.measures) ? cfg.measures : [];

  function pctDelta(cur, prev) {
    if (prev == null || prev === 0) {
      return pctPolicy === "0" ? 0 : pctPolicy === "inf" ? Infinity : null;
    }
    return (cur - prev) / prev;
  }

  if (!measures.length) {
    console.warn("[delta] No measures provided; nothing to compute. Skipping.");
    return rowsFiltered;
  }

  function synthesizeCurrentRowFrom(prevRow) {
    const stub = {};
    // copy grouping keys so the row is identifiable/reportable
    for (const k of keys) setAtPath(stub, k, getAtPath(prevRow, k));
    // initialize absolute bases to zero; ratios will compute to null
    for (const m of measures) {
      if (m.kind === "absolute") setAtPath(stub, m.field, 0);
    }
    return stub;
  }

  const out = [];
  for (const k of allKeys) {
    const currOrig = currIdx.get(k);
    const prev     = prevIdx.get(k);


    const curr = currOrig
      ? (Array.isArray(currOrig) ? [...currOrig] : { ...currOrig })
      : synthesizeCurrentRowFrom(prev);

    for (const m of measures) {
      if (m.kind === "absolute") {
        const currVal = Number(getAtPath(curr, m.field));
        const prevVal = prev != null ? Number(getAtPath(prev, m.field)) : 0;

        const name = leaf(m.field);
        setAtPath(curr, `${nsPrev}.${name}`, Number.isFinite(prevVal) ? prevVal : null);

        const abs = (Number.isFinite(currVal) ? currVal : 0) - (Number.isFinite(prevVal) ? prevVal : 0);
        setAtPath(curr, `${nsDAbs}.${name}`, Number.isFinite(abs) ? abs : null);

        const pct = pctDelta(currVal, prevVal);
        setAtPath(curr, `${nsDPct}.${name}`, pct);

      } else if (m.kind === "ratio") {
        const cNum = Number(getAtPath(curr, m.num));
        const cDen = Number(getAtPath(curr, m.den));
        const pNum = prev != null ? Number(getAtPath(prev, m.num)) : 0;
        const pDen = prev != null ? Number(getAtPath(prev, m.den)) : 0;

        const currRatio = safeDivide(cNum, cDen, null);
        const prevRatio = safeDivide(pNum, pDen, null);

        const name = leaf(m.field);
        setAtPath(curr, `${nsPrev}.${name}`, prevRatio);

        const abs = currRatio == null || prevRatio == null ? null : currRatio - prevRatio;
        setAtPath(curr, `${nsDAbs}.${name}`, abs);

        const pct =
          prevRatio == null
            ? (pctPolicy === "0" ? 0 : pctPolicy === "inf" ? Infinity : null)
            : safeDivide(abs, prevRatio, pctPolicy === "0" ? 0 : pctPolicy === "inf" ? Infinity : null);
        setAtPath(curr, `${nsDPct}.${name}`, pct);
      }
    }

    out.push(curr);
  }

  return out;
}

module.exports = { deltaAugment };
