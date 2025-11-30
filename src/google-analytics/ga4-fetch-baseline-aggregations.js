/**
 * ga4FetchBaselineAggregationsStep
 * 
 * Fetches baseline period aggregations from GA4 API and stores them in ctx.state
 * for use by ga4RollupEnvelope step.
 * 
 * This step is GA4-specific and leverages the API's metricAggregations feature
 * to get accurate totals without needing to group rows.
 * 
 * cfg:
 * {
 *   // Optional: if not provided, reads baseline dates from ctx.state.periods.baseline
 *   baseline: {
 *     from_date: "2024-10-01",
 *     to_date: "2024-10-31"
 *   }
 * }
 * 
 * Stores result in: ctx.state.ga4BaselineAggregations
 * Format: Array of { propertyId, totals, maximums, minimums }
 */
async function ga4FetchBaselineAggregationsStep(rows, cfg = {}, ctx) {
  // Check if metricAggregations was requested in the original report
  const report = ctx?.options?.report || {};
  const metricAggregations = report.metricAggregations;
  
  if (!metricAggregations || !Array.isArray(metricAggregations) || metricAggregations.length === 0) {
    // No aggregations requested, skip this step
    return rows;
  }
  
  // Get baseline dates
  let baseline = cfg.baseline;
  if (!baseline && ctx?.state?.periods?.baseline) {
    baseline = ctx.state.periods.baseline;
  }
  
  if (!baseline || !baseline.from_date || !baseline.to_date) {
    console.warn("[ga4FetchBaselineAggregations] No baseline dates available. Skipping.");
    return rows;
  }
  
  // Fetch baseline data using ctx.fetch()
  // ctx.fetch() returns { rows, aggregations } for GA4, or just rows for other platforms
  const baselineResult = await ctx.fetch({
    from_date: baseline.from_date,
    to_date: baseline.to_date,
    // Preserve metricAggregations request
    metricAggregations: metricAggregations,
  }, "baseline");
  
  // Store baseline aggregations in context state
  // Handle both GA4 format ({ rows, aggregations }) and legacy format (just rows)
  if (ctx && ctx.state) {
    if (baselineResult && typeof baselineResult === 'object' && 'aggregations' in baselineResult) {
      // GA4 format
      ctx.state.ga4BaselineAggregations = baselineResult.aggregations || null;
    } else {
      // Legacy format or no aggregations
      ctx.state.ga4BaselineAggregations = null;
    }
  }
  
  return rows; // Don't modify the flowing dataset
}

module.exports = { ga4FetchBaselineAggregationsStep };

