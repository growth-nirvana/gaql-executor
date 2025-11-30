/**
 * ga4RollupEnvelopeStep
 * 
 * Creates an account-level rollup using GA4 API aggregations instead of grouping rows.
 * This is more accurate for GA4 since grouping doesn't always roll up correctly.
 * 
 * Uses aggregations from:
 * - Current period: result.aggregations (from executor)
 * - Baseline period: ctx.state.ga4BaselineAggregations (from ga4FetchBaselineAggregations step)
 * 
 * cfg:
 * {
 *   as: "account_rollup",              // envelope key (required)
 *   metrics: ["sessions", "totalUsers", ...],  // Metric names in order (matches aggregations.metricValues)
 *   propertyId: null,                    // null = aggregate across all properties
 *   ratios: [                            // Optional: compute ratios
 *     { as: "metrics.bounceRate", num: "metrics.bounces", den: "metrics.sessions" }
 *   ],
 *   copyFromFirst: ["property.id"],     // Optional: copy identifiers
 * }
 * 
 * Output structure:
 * {
 *   dimensions: {},                      // Empty for account rollup
 *   metrics: { sessions: 3487, ... },
 *   metrics_prev: { sessions: 3000, ... },
 *   metrics_delta: { sessions: 487, ... },
 *   metrics_delta_pct: { sessions: 0.1623, ... }
 * }
 */

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

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

/**
 * Extract metrics from GA4 aggregations format
 * @param {Array} aggregations - Array of { propertyId, totals, maximums, minimums }
 * @param {Array} metricNames - Array of metric names in order
 * @param {string} type - 'totals', 'maximums', or 'minimums'
 * @returns {Object} - Object with metric names as keys
 */
function extractMetricsFromAggregations(aggregations, metricNames, type = 'totals') {
  if (!aggregations || !Array.isArray(aggregations) || aggregations.length === 0) {
    return {};
  }
  
  const metrics = {};
  
  // Aggregate across all properties
  for (const agg of aggregations) {
    const typeArray = agg[type];
    if (!typeArray || !Array.isArray(typeArray) || typeArray.length === 0) {
      continue;
    }
    
    // GA4 returns one row per aggregation type (TOTAL, MAXIMUM, MINIMUM)
    // We want the first one (TOTAL) for totals, or the appropriate one for max/min
    const aggRow = typeArray[0];
    if (!aggRow || !aggRow.metricValues || !Array.isArray(aggRow.metricValues)) {
      continue;
    }
    
    // Map metricValues array to metric names
    aggRow.metricValues.forEach((metricValue, index) => {
      const metricName = metricNames[index];
      if (metricName) {
        const value = safeNumber(metricValue.value);
        // Sum across properties for totals, take max for maximums, take min for minimums
        if (type === 'totals') {
          metrics[metricName] = (metrics[metricName] || 0) + value;
        } else if (type === 'maximums') {
          metrics[metricName] = Math.max(metrics[metricName] || -Infinity, value);
        } else if (type === 'minimums') {
          metrics[metricName] = Math.min(metrics[metricName] || Infinity, value);
        }
      }
    });
  }
  
  // Clean up Infinity values
  for (const key in metrics) {
    if (metrics[key] === Infinity || metrics[key] === -Infinity) {
      delete metrics[key];
    }
  }
  
  return metrics;
}

function ga4RollupEnvelopeStep(rows, cfg = {}, ctx) {
  const {
    as,
    metrics: metricNames = [],
    propertyId = null, // If specified, only create rollup for this property
    ratios = [],
    copyFromFirst = [],
  } = cfg;
  
  if (!as) {
    throw new Error("ga4RollupEnvelopeStep: 'as' (envelope key) is required.");
  }
  
  if (!metricNames || metricNames.length === 0) {
    console.warn("[ga4RollupEnvelope] No metrics provided. Skipping rollup.");
    if (ctx && ctx.state) {
      ctx.state.envelopeData ||= {};
      ctx.state.envelopeData[as] = {};
    }
    return rows;
  }
  
  // Get current period aggregations from result
  let currentAggregations = cfg.currentAggregations || ctx?.state?.ga4CurrentAggregations || null;
  
  // If not in state, try to get from result aggregations (stored by executor)
  if (!currentAggregations && ctx?.state?.envelopeData?.aggregations) {
    currentAggregations = ctx.state.envelopeData.aggregations;
  }
  
  // Get baseline aggregations from context state
  const baselineAggregations = ctx?.state?.ga4BaselineAggregations || null;
  
  // Normalize aggregations to array format
  const normalizedCurrent = currentAggregations 
    ? (Array.isArray(currentAggregations) ? currentAggregations : [currentAggregations])
    : [];
  
  const normalizedBaseline = baselineAggregations
    ? (Array.isArray(baselineAggregations) ? baselineAggregations : [baselineAggregations])
    : [];
  
  // Get unique propertyIds from current aggregations
  const propertyIds = normalizedCurrent.length > 0
    ? [...new Set(normalizedCurrent.map(agg => agg.propertyId).filter(Boolean))]
    : [];
  
  // If propertyId is specified in config, only process that property
  const propertyIdsToProcess = propertyId 
    ? (propertyIds.includes(propertyId) ? [propertyId] : [])
    : propertyIds;
  
  if (propertyIdsToProcess.length === 0) {
    console.warn("[ga4RollupEnvelope] No properties found. Skipping rollup.");
    if (ctx && ctx.state) {
      ctx.state.envelopeData ||= {};
      ctx.state.envelopeData[as] = {};
    }
    return rows;
  }
  
  // Create one rollup per propertyId
  const rollups = {};
  
  for (const propId of propertyIdsToProcess) {
    // Filter aggregations for this property
    const currentForProperty = normalizedCurrent.filter(agg => agg.propertyId === propId);
    const baselineForProperty = normalizedBaseline.filter(agg => agg.propertyId === propId);
    
    // Build rollup object for this property
    const rollup = {
      propertyId: propId,
      dimensions: {}, // Empty for account rollup
      metrics: {},
      metrics_prev: {},
      metrics_delta: {},
      metrics_delta_pct: {},
    };
    
    // Extract current metrics
    if (currentForProperty.length > 0) {
      rollup.metrics = extractMetricsFromAggregations(currentForProperty, metricNames, 'totals');
    }
    
    // Extract baseline metrics
    if (baselineForProperty.length > 0) {
      rollup.metrics_prev = extractMetricsFromAggregations(baselineForProperty, metricNames, 'totals');
    }
    
    // Compute deltas
    for (const metricName of metricNames) {
      const current = rollup.metrics[metricName] || 0;
      const previous = rollup.metrics_prev[metricName] || 0;
      
      rollup.metrics_delta[metricName] = current - previous;
      
      // Compute percentage delta (null when previous is 0 or missing)
      if (previous === 0 || previous == null) {
        rollup.metrics_delta_pct[metricName] = null;
      } else {
        rollup.metrics_delta_pct[metricName] = (current - previous) / previous;
      }
    }
    
    // Compute ratios
    for (const ratio of ratios) {
      const num = safeNumber(getAtPath(rollup, ratio.num));
      const den = safeNumber(getAtPath(rollup, ratio.den));
      const val = den === 0 ? null : num / den;
      setAtPath(rollup, ratio.as || `${ratio.num}_per_${ratio.den}`, val);
      
      // Also compute for previous period if available
      if (rollup.metrics_prev && Object.keys(rollup.metrics_prev).length > 0) {
        const numPrev = safeNumber(getAtPath(rollup, ratio.num.replace('metrics.', 'metrics_prev.')));
        const denPrev = safeNumber(getAtPath(rollup, ratio.den.replace('metrics.', 'metrics_prev.')));
        const valPrev = denPrev === 0 ? null : numPrev / denPrev;
        setAtPath(rollup, ratio.as.replace('metrics.', 'metrics_prev.'), valPrev);
      }
    }
    
    // Copy identifiers from first row matching this property if specified
    if (copyFromFirst.length && rows && rows.length > 0) {
      const firstRowForProperty = rows.find(r => r.propertyId === propId) || rows[0];
      for (const path of copyFromFirst) {
        const val = getAtPath(firstRowForProperty, path);
        if (val !== undefined) {
          setAtPath(rollup, path, val);
        }
      }
    }
    
    rollups[propId] = rollup;
  }
  
  // Store in envelope
  // Always store as object keyed by propertyId to keep properties separate
  if (ctx && ctx.state) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData[as] = rollups;
  }
  
  return rows; // Don't modify the flowing dataset
}

module.exports = { ga4RollupEnvelopeStep };

