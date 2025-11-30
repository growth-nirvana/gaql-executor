// delta.js
const { groupRows } = require("./group-by");
const { applyActionLabelsStep } = require("./fb/apply-action-labels-step");
const { filterConversionActions } = require("./google-ads/filter-conversion-actions");
const { enrichWithConversionActions } = require("./google-ads/conversion-actions-enricher");

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
  // ctx.fetch() may return { rows, aggregations } (GA4) or just rows (other platforms)
  const prevRawResult = await ctx.fetch({ from_date: baseline.from_date, to_date: baseline.to_date }, "previous");
  const prevRaw = prevRawResult && typeof prevRawResult === 'object' && 'rows' in prevRawResult 
    ? prevRawResult.rows 
    : prevRawResult; // Backward compatibility: if not GA4 format, use directly
  
  // CRITICAL: Update stored filterConversionActions config with baseline dates
  // This ensures filterConversionActions (which runs in runPre) uses the correct previous period dates
  // WITHOUT mutating ctx.options.report which would affect other steps like periods
  const originalFilterDates = {
    fromDate: ctx?.state?.conversionActionFilterCfg?.fromDate,
    toDate: ctx?.state?.conversionActionFilterCfg?.toDate
  };
  
  if (ctx?.state?.conversionActionFilterCfg) {
    ctx.state.conversionActionFilterCfg.fromDate = baseline.from_date;
    ctx.state.conversionActionFilterCfg.toDate = baseline.to_date;
  }
  
  const prevNorm     = await ctx.runPre(prevRaw);
  
  // Restore original dates in stored config (for next iteration if any)
  if (ctx?.state?.conversionActionFilterCfg && originalFilterDates.fromDate && originalFilterDates.toDate) {
    ctx.state.conversionActionFilterCfg.fromDate = originalFilterDates.fromDate;
    ctx.state.conversionActionFilterCfg.toDate = originalFilterDates.toDate;
  }
  
  // filterConversionActions runs automatically in runPre (it's in "pre" phase)
  // Since we set report dates to baseline before runPre, it will filter previous period correctly
  // No need to manually call it here - runPre already did it
  const prevWithConversionFilter = prevNorm;
  
  // Apply conversion actions enricher to previous period if it was applied to current period
  // This creates conversion_actions_prev for the previous period breakdown
  const conversionActionsEnricherCfg = ctx?.state?.conversionActionsEnricherCfg;
  
  let prevWithConversionActions = prevWithConversionFilter;
  if (conversionActionsEnricherCfg) {
    // Apply the same conversion actions enrichment but with previous period dates
    // Store as conversion_actions_prev instead of conversion_actions
    prevWithConversionActions = await enrichWithConversionActions(prevWithConversionFilter, {
      report: conversionActionsEnricherCfg.report,
      joinKeys: conversionActionsEnricherCfg.joinKeys,
      outputPath: 'conversion_actions_prev', // Store as _prev for previous period
      aggregate: conversionActionsEnricherCfg.aggregate,
      fromDate: baseline.from_date,
      toDate: baseline.to_date
    }, ctx);
  }
  
  // Group previous period rows (after filtering, so grouped metrics.conversions will be filtered)
  let prevGrouped = gcfg ? groupRows(prevWithConversionActions, gcfg) : prevWithConversionActions;
  
  // After grouping, aggregate conversion_actions_prev from ungrouped rows
  // because grouping doesn't preserve non-aggregated object fields
  if (gcfg && prevWithConversionActions.length > 0 && prevWithConversionActions.some(r => r.conversion_actions_prev)) {
    // Use grouping config keys (gcfg.by) instead of delta keys for matching ungrouped rows
    const groupKeys = Array.isArray(gcfg.by) ? gcfg.by : [];
    if (gcfg.timeBucket && gcfg.timeBucket.field) {
      const tbKey = gcfg.timeBucket.as || "timeBucket";
      groupKeys.push(tbKey);
    }
    
    // Group ungrouped rows by grouping config keys to aggregate conversion_actions_prev
    const prevActionsByGroup = new Map();
    
    for (const row of prevWithConversionActions) {
      if (!row.conversion_actions_prev) continue;
      
      // Use grouping keys, not delta keys, to match ungrouped rows
      const groupKey = keyFromRow(row, groupKeys);
      if (!prevActionsByGroup.has(groupKey)) {
        prevActionsByGroup.set(groupKey, {
          actionMap: new Map(),
          totalConversions: 0,
          totalConversionsValue: 0,
          totalAllConversions: 0,
          totalAllConversionsValue: 0
        });
      }
      
      const group = prevActionsByGroup.get(groupKey);
      const convActions = row.conversion_actions_prev.conversion_actions || [];
      
      for (const action of convActions) {
        const actionName = action.name;
        if (!group.actionMap.has(actionName)) {
          group.actionMap.set(actionName, {
            name: actionName,
            conversions: 0,
            conversions_value: 0,
            all_conversions: 0,
            all_conversions_value: 0
          });
        }
        const agg = group.actionMap.get(actionName);
        agg.conversions += Number(action.conversions || 0);
        agg.conversions_value += Number(action.conversions_value || 0);
        agg.all_conversions += Number(action.all_conversions || 0);
        agg.all_conversions_value += Number(action.all_conversions_value || 0);
      }
      
      group.totalConversions += Number(row.conversion_actions_prev.total_conversions || 0);
      group.totalConversionsValue += Number(row.conversion_actions_prev.total_conversions_value || 0);
      group.totalAllConversions += Number(row.conversion_actions_prev.total_all_conversions || 0);
      group.totalAllConversionsValue += Number(row.conversion_actions_prev.total_all_conversions_value || 0);
    }
    
    // Attach aggregated conversion_actions_prev to grouped rows using delta keys for matching
    prevGrouped = prevGrouped.map(row => {
      const groupKey = keyFromRow(row, groupKeys); // Use same keys as ungrouped rows
      const group = prevActionsByGroup.get(groupKey);
      if (group && (group.actionMap.size > 0 || group.totalConversions > 0)) {
        return {
          ...row,
          conversion_actions_prev: {
            total_conversions: group.totalConversions,
            total_conversions_value: group.totalConversionsValue,
            total_all_conversions: group.totalAllConversions,
            total_all_conversions_value: group.totalAllConversionsValue,
            conversion_actions: Array.from(group.actionMap.values()).sort((a, b) => b.conversions - a.conversions)
          }
        };
      }
      return row;
    });
    
    // Enrich any grouped rows that don't have conversion_actions_prev
    // (this can happen if grouping keys don't match or if enrichment failed)
    // CRITICAL: Use groupKeys (not joinKeys) to match grouped rows, since grouped rows
    // are keyed by the group step's 'by' fields, not the enricher's joinKeys
    const conversionActionsEnricherCfg = ctx?.state?.conversionActionsEnricherCfg;
    if (conversionActionsEnricherCfg && groupKeys.length > 0) {
      const rowsNeedingEnrichment = prevGrouped.filter(r => !r.conversion_actions_prev);
      if (rowsNeedingEnrichment.length > 0) {
        const enriched = await enrichWithConversionActions(rowsNeedingEnrichment, {
          report: conversionActionsEnricherCfg.report,
          joinKeys: conversionActionsEnricherCfg.joinKeys,
          outputPath: 'conversion_actions_prev',
          aggregate: conversionActionsEnricherCfg.aggregate,
          fromDate: baseline.from_date,
          toDate: baseline.to_date
        }, ctx);
        
        // Map enriched rows back to prevGrouped using groupKeys (the actual grouping keys)
        // This ensures we match grouped rows correctly, even if joinKeys differ from groupKeys
        const enrichedMap = new Map();
        for (const row of enriched) {
          const key = keyFromRow(row, groupKeys);
          enrichedMap.set(key, row);
        }
        
        prevGrouped = prevGrouped.map(row => {
          const key = keyFromRow(row, groupKeys);
          const enrichedRow = enrichedMap.get(key);
          if (enrichedRow && enrichedRow.conversion_actions_prev) {
            return { ...row, conversion_actions_prev: enrichedRow.conversion_actions_prev };
          }
          return row;
        });
      }
    }
  }
  // Apply action labels to previous period data (since applyActionLabels runs after group in pipeline,
  // it's not included in runPre, so we need to apply it manually here)
  const prevWithLabels = await applyActionLabelsStep(prevGrouped, {}, ctx);

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
  const prevFiltered = filterIfNeeded(prevWithLabels, "prev");

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
    // Deep copy all fields from previous row to preserve all dimensions (not just keys)
    const stub = prevRow ? JSON.parse(JSON.stringify(prevRow)) : {};
    
    // Build a set of metric field paths to zero out
    const metricFields = new Set();
    for (const m of measures) {
      if (m.kind === "absolute") {
        metricFields.add(m.field);
      }
      // For ratios, zero out the numerator and denominator fields
      if (m.kind === "ratio") {
        metricFields.add(m.num);
        metricFields.add(m.den);
      }
    }
    
    // Zero out all metric fields (absolute measures and ratio components)
    for (const field of metricFields) {
      setAtPath(stub, field, 0);
    }
    
    // Also zero out any ratio metrics that were computed in previous period
    for (const m of measures) {
      if (m.kind === "ratio") {
        setAtPath(stub, m.field, null); // Ratios become null when denominator is 0
      }
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

    // Copy conversion_actions_prev from previous period row if it exists
    if (prev && prev.conversion_actions_prev) {
      curr.conversion_actions_prev = prev.conversion_actions_prev;
    }

    for (const m of measures) {
      if (m.kind === "absolute") {
        const currVal = Number(getAtPath(curr, m.field));
        const prevVal = prev != null ? Number(getAtPath(prev, m.field)) : 0;

        const name = leaf(m.field);
        const prevValToStore = Number.isFinite(prevVal) ? prevVal : null;
        setAtPath(curr, `${nsPrev}.${name}`, prevValToStore);

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
