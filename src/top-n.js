const { getAtPath, setAtPath } = require('./utils');


/**
 * cfg:
 * {
 *   where: [
 *     { field: "campaign.name", op: "CONTAINS", value: "LSE-DA", flags: "i" },
 *     { field: "metrics.impressions", op: ">", value: 0 }
 *   ],
 *   logic: "AND" | "OR"   // default "AND"
 * }

      config = {
        by: ["campaign.id", "campaign.name"],
        metric: "metrics.cost_share",
        n: 2,
        include: ["metrics.cost", "metrics.clicks", "metrics.impressions"],
        excludeRollup: true,
        direction: "desc",  // "desc" for top N (default), "asc" for bottom N
        as: "top_campaigns"
      };
 */


function topNStep(rows, config, ctx) {
  const {
    by = [],
    metric,
    n = 10,
    include = [],
    excludeRollup = true,
    direction = "desc",  // "desc" = top, "asc" = bottom
    as,
    includeNulls = false // optional: set true to copy null/undefined too
  } = config;

  // 1) filter (optionally drop rollups)
  const filteredRows = excludeRollup ? rows.filter(r => !r.__rollup) : rows;

  // 2) sort by metric without mutating original order
  const sorted = [...filteredRows].sort((a, b) => {
    const aVal = getAtPath(a, metric) ?? 0;
    const bVal = getAtPath(b, metric) ?? 0;
    return direction === "asc" ? aVal - bVal : bVal - aVal;
  });

  // 3) build selection list (dedup) with wildcard expansion
  const fieldsToCopy = new Set([...by, metric]);
  
  // Expand wildcards in include array (e.g., "metrics.actions_by_type.*")
  for (const path of include) {
    if (path.endsWith(".*")) {
      // Wildcard pattern - discover all fields under this path
      const basePath = path.slice(0, -2); // Remove ".*"
      const discovered = new Set();
      
      // Scan rows to find all keys under the base path
      for (const row of filteredRows) {
        const baseObj = getAtPath(row, basePath);
        if (baseObj && typeof baseObj === "object" && !Array.isArray(baseObj)) {
          for (const key of Object.keys(baseObj)) {
            if (key !== "__proto__") {
              discovered.add(`${basePath}.${key}`);
            }
          }
        }
      }
      
      // Add all discovered fields
      for (const fullPath of discovered) {
        fieldsToCopy.add(fullPath);
      }
    } else {
      fieldsToCopy.add(path);
    }
  }
  
  // Always include conversion_actions_prev if filtering is enabled (needed for override logic)
  if (config.filteredConversionActions && Array.isArray(config.filteredConversionActions) && config.filteredConversionActions.length > 0) {
    fieldsToCopy.add('conversion_actions_prev');
  }

  // 4) If filtering is enabled, override metrics_prev.conversions with filtered totals from conversion_actions_prev
  // Do this BEFORE copying so we can use the original rows and the override will be copied
  const filteredActions = config.filteredConversionActions || null;
  if (filteredActions && Array.isArray(filteredActions) && filteredActions.length > 0) {
    const normalizeActionName = (name) => String(name).toLowerCase().trim();
    const normalizedFilteredActions = filteredActions.map(normalizeActionName);
    
    // Apply override to the top N rows BEFORE copying
    for (let i = 0; i < Math.min(n, sorted.length); i++) {
      const row = sorted[i];
      const convActionsPrev = getAtPath(row, 'conversion_actions_prev');
      
      if (convActionsPrev && convActionsPrev.conversion_actions && Array.isArray(convActionsPrev.conversion_actions)) {
        // Sum conversions from filtered actions only
        let filteredConversions = 0;
        let filteredConversionsValue = 0;
        
        for (const action of convActionsPrev.conversion_actions) {
          const normalizedActionName = normalizeActionName(action.name);
          if (normalizedFilteredActions.includes(normalizedActionName)) {
            filteredConversions += Number(action.conversions || 0);
            filteredConversionsValue += Number(action.conversions_value || 0);
          }
        }
        
        // Override metrics_prev.conversions/conversions_value with filtered totals
        if (filteredConversions > 0 || filteredConversionsValue > 0) {
          const metricsPrev = getAtPath(row, 'metrics_prev');
          
          if (metricsPrev) {
            metricsPrev.conversions = filteredConversions;
            metricsPrev.conversions_value = filteredConversionsValue;
          } else {
            setAtPath(row, 'metrics_prev.conversions', filteredConversions);
            setAtPath(row, 'metrics_prev.conversions_value', filteredConversionsValue);
          }
        }
      }
    }
  }

  // 4b) slice & project (after override so filtered values are copied)
  const topN = sorted.slice(0, n).map(row => {
    const out = {};
    for (const path of fieldsToCopy) {
      const val = getAtPath(row, path);
      if (includeNulls || val !== undefined) {
        setAtPath(out, path, val);
      }
    }
    return out;
  });

  // 5) stash for envelope
  if (ctx && ctx.state) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData[as || "topN"] = topN;
  }

  return rows; // keep main stream unchanged
}

module.exports = { topNStep };