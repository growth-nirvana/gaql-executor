// steps/rollup-envelope.js
const { getAtPath, setAtPath } = require('./utils');

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * rollupEnvelopeStep
 *
 * Computes a summary object from the current rows and stores it in ctx.state.envelopeData[as].
 *
 * cfg:
 * {
 *   as: "account_rollup",                // envelope key (required)
 *   rollupKey: "meta.rollup_key",        // optional path to set a rollup identifier
 *   rollupValue: "ACCOUNT",              // optional value for rollupKey (default "ALL")
 *   mark: true,                          // set __rollup: true on the summary object
 *
 *   // Sum these numeric fields across rows:
 *   sum: [
 *     "metrics.cost", "metrics.clicks", "metrics.impressions",
 *     "metrics.conversions", "metrics.conversions_value",
 *     "metrics_prev.cost", "metrics_prev.clicks", "metrics_prev.impressions", "metrics_prev.conversions"
 *   ],
 *
 *   // Compute ratios on top of the summed totals:
 *   ratios: [
 *     { as: "metrics.ctr", num: "metrics.clicks", den: "metrics.impressions" },
 *     { as: "metrics.cpc", num: "metrics.cost",   den: "metrics.clicks" },
 *     { as: "metrics.cvr", num: "metrics.conversions", den: "metrics.clicks" },
 *     { as: "metrics.cpa", num: "metrics.cost",   den: "metrics.conversions" },
 *     // previous-period ratios if you want them in the rollup too:
 *     { as: "metrics_prev.ctr", num: "metrics_prev.clicks", den: "metrics_prev.impressions" },
 *     { as: "metrics_prev.cpc", num: "metrics_prev.cost",   den: "metrics_prev.clicks" },
 *     { as: "metrics_prev.cvr", num: "metrics_prev.conversions", den: "metrics_prev.clicks" },
 *     { as: "metrics_prev.cpa", num: "metrics_prev.cost",   den: "metrics_prev.conversions" },
 *   ],
 *
 *   // Optional additional computed fields (row-independent):
 *   expressions: {                        // evaluated after sums & ratios
 *     "metrics_delta.cost": (s) => (s.metrics?.cost ?? 0) - (s.metrics_prev?.cost ?? 0),
 *     "metrics_delta.conversions": (s) => (s.metrics?.conversions ?? 0) - (s.metrics_prev?.conversions ?? 0),
 *   },
 *
 *   // If you want to include a few identifier fields from context or first row:
 *   copyFromFirst: ["customer.id", "customer.descriptive_name"],  // optional
 *
 *   // If you want to exclude rows (e.g., drop __rollup grand total rows that may already exist):
 *   excludeRollupRows: true
 * }
 */
function rollupEnvelopeStep(rows, cfg = {}, ctx) {
  const {
    as,
    rollupKey,
    rollupValue = "ALL",
    mark = true,
    sum = [],
    ratios = [],
    expressions = {},
    copyFromFirst = [],
    excludeRollupRows = true,
    aggregateConversionActions = false,
  } = cfg;

  if (!as) throw new Error("rollupEnvelopeStep: 'as' (envelope key) is required.");
  if (!Array.isArray(rows) || rows.length === 0) {
    // still create an empty object so the envelope has a predictable key
    if (ctx && ctx.state) {
      ctx.state.envelopeData ||= {};
      ctx.state.envelopeData[as] = {};
    }
    return rows;
  }

  const scan = excludeRollupRows ? rows.filter(r => !r.__rollup) : rows;

  // 1) Start summary object
  const summary = {};

  // 2) Optional: copy identifiers from the first row
  if (copyFromFirst.length && scan.length) {
    const first = scan[0];
    for (const path of copyFromFirst) {
      const val = getAtPath(first, path);
      if (val !== undefined) setAtPath(summary, path, val);
    }
  }

  // 2b) Handle multi-customer scenarios
  if (copyFromFirst.includes("customer.id") && scan.length > 1) {
    const customerIds = new Set();
    const customerNames = new Set();
    
    for (const row of scan) {
      const customerId = getAtPath(row, "customer.id");
      const customerName = getAtPath(row, "customer.descriptive_name");
      
      if (customerId !== undefined) customerIds.add(customerId);
      if (customerName !== undefined) customerNames.add(customerName);
    }
    
    // If multiple customers, create a multi-customer summary
    if (customerIds.size > 1) {
      setAtPath(summary, "customer.id", Array.from(customerIds));
      setAtPath(summary, "customer.descriptive_name", Array.from(customerNames));
      setAtPath(summary, "customer.count", customerIds.size);
    }
  }

  // 3) Sums (with wildcard support)
  const expandedSum = [];
  for (const path of sum) {
    if (path.endsWith(".*")) {
      // Wildcard pattern - discover all fields under this path
      const basePath = path.slice(0, -2); // Remove ".*"
      const discovered = new Set();
      
      // Scan rows to find all numeric keys under the base path
      // For actions_by_type and action_values_by_type, filter out canonical keys
      // Canonical keys are typically snake_case (lowercase with underscores) and don't have spaces
      // Readable labels typically have spaces, special characters (—, etc.), or are Title Case
      // Since applyActionLabels should have replaced canonical keys with readable labels,
      // we filter out keys that look like canonical keys (snake_case without spaces)
      const isActionType = basePath === "metrics.actions_by_type" || basePath === "metrics.action_values_by_type";
      
      for (const row of scan) {
        const baseObj = getAtPath(row, basePath);
        if (baseObj && typeof baseObj === "object" && !Array.isArray(baseObj)) {
          for (const key of Object.keys(baseObj)) {
            if (key !== "__proto__" && typeof baseObj[key] === "number") {
              // Skip canonical keys for action types (they should have been replaced by applyActionLabels)
              // Canonical keys are snake_case (lowercase with underscores, no spaces)
              // Readable labels have spaces, special characters, or are Title Case
              if (isActionType) {
                // Check if key looks like canonical (snake_case: lowercase, underscores, no spaces)
                // vs readable (has spaces, special chars like —, or Title Case)
                const looksCanonical = /^[a-z_]+$/.test(key) && key.includes("_") && !key.includes(" ");
                // Also check for common canonical prefixes
                const hasCanonicalPrefix = /^(offsite_conversion|onsite_conversion|app_custom_event|custom_conversion|link_click|purchase|comment|like|post_|video_view|page_)/.test(key);
                if (looksCanonical || hasCanonicalPrefix) {
                  continue;
                }
              }
              discovered.add(key);
            }
          }
        }
      }
      
      // Expand each discovered field
      for (const key of discovered) {
        expandedSum.push(`${basePath}.${key}`);
      }
    } else {
      expandedSum.push(path);
    }
  }
  
  // Sum all fields (including expanded wildcards)
  for (const path of expandedSum) {
    let total = 0;
    for (const row of scan) total += safeNumber(getAtPath(row, path));
    setAtPath(summary, path, total);
  }

  // 4) Ratios (based on the *summed* totals)
  for (const r of ratios) {
    const num = safeNumber(getAtPath(summary, r.num));
    const den = safeNumber(getAtPath(summary, r.den));
    const val = den === 0 ? null : num / den;
    setAtPath(summary, r.as || `${r.num}_per_${r.den}`, val);
  }

  // 4b) Aggregate conversion_actions if requested
  if (aggregateConversionActions) {
    const actionMap = new Map(); // Map of action name -> aggregated metrics
    let totalConversions = 0;
    let totalConversionsValue = 0;
    let totalAllConversions = 0;
    let totalAllConversionsValue = 0;
    
    // Get filtered conversion actions from config (if any)
    const filteredActions = cfg.filteredConversionActions || null;
    const normalizeActionName = (name) => String(name).toLowerCase().trim();
    const normalizedFilteredActions = filteredActions 
      ? filteredActions.map(normalizeActionName)
      : null;

    for (const row of scan) {
      const convActions = getAtPath(row, 'conversion_actions');
      if (convActions && convActions.conversion_actions && Array.isArray(convActions.conversion_actions)) {
        // Aggregate ALL individual actions (like Facebook - show all in breakdown)
        for (const action of convActions.conversion_actions) {
          const actionName = action.name;
          const normalizedActionName = normalizeActionName(actionName);
          
          // Always include all actions in the breakdown (like Facebook)
          if (!actionMap.has(actionName)) {
            actionMap.set(actionName, {
              name: actionName,
              conversions: 0,
              conversions_value: 0,
              all_conversions: 0,
              all_conversions_value: 0
            });
          }
          const aggregated = actionMap.get(actionName);
          aggregated.conversions += safeNumber(action.conversions || 0);
          aggregated.conversions_value += safeNumber(action.conversions_value || 0);
          aggregated.all_conversions += safeNumber(action.all_conversions || 0);
          aggregated.all_conversions_value += safeNumber(action.all_conversions_value || 0);
          
          // Only accumulate totals from filtered actions (for metrics.conversions/conversions_value)
          if (!normalizedFilteredActions || normalizedFilteredActions.includes(normalizedActionName)) {
            totalConversions += safeNumber(action.conversions || 0);
            totalConversionsValue += safeNumber(action.conversions_value || 0);
          }
          
          // Always accumulate all_conversions totals
          totalAllConversions += safeNumber(action.all_conversions || 0);
          totalAllConversionsValue += safeNumber(action.all_conversions_value || 0);
        }
      }
      
      // If NO filtering, use totals from conversion_actions structure
      // (When filtering IS enabled, we already summed from conversion_actions array above, so don't double-count)
      if (!filteredActions || filteredActions.length === 0) {
        const convActions = getAtPath(row, 'conversion_actions');
        if (convActions) {
          totalConversions += safeNumber(convActions.total_conversions || 0);
          totalConversionsValue += safeNumber(convActions.total_conversions_value || 0);
        }
      }
      // When filtering is enabled, we ONLY sum from conversion_actions array (already done above)
      // Don't sum from row.metrics.conversions because those are already filtered and would double-count
    }

    if (actionMap.size > 0 || totalConversions > 0) {
      setAtPath(summary, 'conversion_actions', {
        total_conversions: totalConversions,
        total_conversions_value: totalConversionsValue,
        total_all_conversions: totalAllConversions,
        total_all_conversions_value: totalAllConversionsValue,
        conversion_actions: Array.from(actionMap.values()).sort((a, b) => b.conversions - a.conversions)
      });
    }
    
    // When filtering is enabled, override the summed metrics.conversions/conversions_value
    // with the filtered totals (like Facebook - shows all actions but uses filtered for metrics)
    if (filteredActions && filteredActions.length > 0) {
      setAtPath(summary, 'metrics.conversions', totalConversions);
      setAtPath(summary, 'metrics.conversions_value', totalConversionsValue);
    }
  }

  // 4c) Aggregate conversion_actions_prev if it exists in rows (for previous period breakdown)
  const prevActionMap = new Map(); // Map of action name -> aggregated metrics for previous period
  let prevTotalConversions = 0;
  let prevTotalConversionsValue = 0;
  let prevTotalAllConversions = 0;
  let prevTotalAllConversionsValue = 0;
  
  // Get filtered conversion actions from config (if any) - same filter applies to previous period
  const filteredActions = cfg.filteredConversionActions || null;
  const normalizeActionName = (name) => String(name).toLowerCase().trim();
  const normalizedFilteredActions = filteredActions 
    ? filteredActions.map(normalizeActionName)
    : null;

  for (const row of scan) {
    const convActionsPrev = getAtPath(row, 'conversion_actions_prev');
    if (convActionsPrev && convActionsPrev.conversion_actions && Array.isArray(convActionsPrev.conversion_actions)) {
      // Aggregate ALL individual actions from previous period
      for (const action of convActionsPrev.conversion_actions) {
        const actionName = action.name;
        const normalizedActionName = normalizeActionName(actionName);
        
        // Always include all actions in the breakdown
        if (!prevActionMap.has(actionName)) {
          prevActionMap.set(actionName, {
            name: actionName,
            conversions: 0,
            conversions_value: 0,
            all_conversions: 0,
            all_conversions_value: 0
          });
        }
        const aggregated = prevActionMap.get(actionName);
        aggregated.conversions += safeNumber(action.conversions || 0);
        aggregated.conversions_value += safeNumber(action.conversions_value || 0);
        aggregated.all_conversions += safeNumber(action.all_conversions || 0);
        aggregated.all_conversions_value += safeNumber(action.all_conversions_value || 0);
        
        // Only accumulate totals from filtered actions (for metrics_prev.conversions/conversions_value)
        if (!normalizedFilteredActions || normalizedFilteredActions.includes(normalizedActionName)) {
          prevTotalConversions += safeNumber(action.conversions || 0);
          prevTotalConversionsValue += safeNumber(action.conversions_value || 0);
        }
        
        // Always accumulate all_conversions totals
        prevTotalAllConversions += safeNumber(action.all_conversions || 0);
        prevTotalAllConversionsValue += safeNumber(action.all_conversions_value || 0);
      }
    }
    
    // If NO filtering, use totals from conversion_actions_prev structure
    if (!filteredActions || filteredActions.length === 0) {
      const convActionsPrev = getAtPath(row, 'conversion_actions_prev');
      if (convActionsPrev) {
        prevTotalConversions += safeNumber(convActionsPrev.total_conversions || 0);
        prevTotalConversionsValue += safeNumber(convActionsPrev.total_conversions_value || 0);
      }
    }
  }
  
  // If we have filtered conversion actions, override metrics_prev.conversions/conversions_value
  // with the filtered totals from conversion_actions_prev (to ensure consistency)
  if (normalizedFilteredActions && normalizedFilteredActions.length > 0 && prevTotalConversions > 0) {
    const metricsPrev = getAtPath(summary, 'metrics_prev');
    if (metricsPrev) {
      metricsPrev.conversions = prevTotalConversions;
      metricsPrev.conversions_value = prevTotalConversionsValue;
    } else {
      // Create metrics_prev if it doesn't exist
      setAtPath(summary, 'metrics_prev.conversions', prevTotalConversions);
      setAtPath(summary, 'metrics_prev.conversions_value', prevTotalConversionsValue);
    }
  }

  if (prevActionMap.size > 0 || prevTotalConversions > 0) {
    setAtPath(summary, 'conversion_actions_prev', {
      total_conversions: prevTotalConversions,
      total_conversions_value: prevTotalConversionsValue,
      total_all_conversions: prevTotalAllConversions,
      total_all_conversions_value: prevTotalAllConversionsValue,
      conversion_actions: Array.from(prevActionMap.values()).sort((a, b) => b.conversions - a.conversions)
    });
  }

  // 5) Extra expressions (post-compute on the summary object)
  if (expressions && typeof expressions === "object") {
    for (const [path, fn] of Object.entries(expressions)) {
      const v = (typeof fn === "function") ? fn(summary) : fn;
      setAtPath(summary, path, v);
    }
  }

  // 6) Rollup markers
  if (rollupKey) setAtPath(summary, rollupKey, rollupValue);
  if (mark) summary.__rollup = true;

  // 7) Store in envelope
  if (ctx && ctx.state) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData[as] = summary;
  }

  return rows; // do not modify the flowing dataset
}

module.exports = { rollupEnvelopeStep };