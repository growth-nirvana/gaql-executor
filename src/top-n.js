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

  // 4) slice & project
  const topN = sorted.slice(0, n).map(row => {
    const out = {};
    for (const path of fieldsToCopy) {
      const val = getAtPath(row, path);
      if (includeNulls || val !== undefined) setAtPath(out, path, val);
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