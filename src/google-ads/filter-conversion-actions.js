// src/google-ads/filter-conversion-actions.js

/**
 * Filters conversion actions and aggregates conversions/conversions_value
 * based on specified conversionAction config.
 * 
 * This step automatically:
 * 1. Fetches conversion action data using the same attributes/segments as the main query
 * 2. Filters to only specified conversion actions
 * 3. Aggregates conversions/conversions_value by the same grouping keys
 * 4. Merges the filtered values back into the main rows
 * 
 * cfg = {
 *   conversionActions: ['Purchase', 'Sign-up'], // Array of conversion action names to include
 *   conversionValueActions: ['Purchase'],      // Optional: different actions for values
 *   groupByAttributes: ['customer.id', 'campaign.id'], // Attributes to group by (from main query)
 *   report: { ... }, // Base report config (will be modified to include segments.conversion_action_name)
 *   fromDate: '2025-01-01',
 *   toDate: '2025-01-31'
 * }
 */
async function filterConversionActions(rows, cfg = {}, ctx) {
  if (!cfg.conversionActions || !Array.isArray(cfg.conversionActions) || cfg.conversionActions.length === 0) {
    // No filtering needed - return rows as-is
    return rows;
  }

  if (!cfg.groupByAttributes || !cfg.report) {
    console.warn('[filterConversionActions] Missing required config: groupByAttributes, report');
    return rows;
  }

  // Normalize conversion action names (case-insensitive, handle variations)
  const normalizeActionName = (name) => {
    return String(name).toLowerCase().trim();
  };

  const normalizedConversionActions = cfg.conversionActions.map(normalizeActionName);
  const normalizedConversionValueActions = (cfg.conversionValueActions || cfg.conversionActions).map(normalizeActionName);

  // Build conversion action report - use same attributes/segments as main query
  // Include any segments from the main report so grouping matches correctly
  const mainSegments = cfg.report.segments || [];
  
  // Filter out segments that are incompatible with segments.conversion_action_name
  // Compatible segments include: date, month, device, ad_network_type, click_type, etc.
  // Incompatible segments are typically those that require other metrics (like impressions)
  const compatibleSegments = mainSegments.filter(seg => {
    // Exclude conversion_action_name itself (we're adding it separately)
    if (seg === 'segments.conversion_action_name') return false;
    // Include all other segments - they should be compatible with conversion metrics
    return true;
  });
  
  // Combine groupByAttributes with segments from report for complete grouping key
  // Exclude conversion_action_name from grouping fields since main rows don't have it
  const allGroupingFields = [
    ...cfg.groupByAttributes, 
    ...mainSegments.filter(s => 
      s !== 'segments.conversion_action_name' && 
      !cfg.groupByAttributes.includes(s)
    )
  ];
  
  // Build conversion report - when using segments.conversion_action_name, 
  // we can ONLY use conversion metrics (conversions, conversions_value, all_conversions, all_conversions_value)
  // We cannot use impressions, clicks, cost, or any other metrics
  // We also cannot use constraints that reference incompatible metrics
  // So we remove ALL constraints to be safe
  
  const conversionReport = {
    entity: cfg.report.entity,
    segments: [
      'segments.conversion_action_name',
      ...compatibleSegments  // Include compatible segments from main query
    ],
    // Keep same attributes for grouping (segments are handled separately)
    attributes: cfg.groupByAttributes.filter(attr => !attr.startsWith('segments.')),
    // ONLY these 4 metrics are compatible with segments.conversion_action_name
    metrics: [
      'metrics.conversions',
      'metrics.conversions_value',
      'metrics.all_conversions',
      'metrics.all_conversions_value'
    ],
    from_date: cfg.fromDate,
    to_date: cfg.toDate,
    constraints: [], // Empty constraints - cannot use any constraints with conversion_action_name
    limit: cfg.report.limit || null
  };

  // Fetch conversion action data
  // Pass the entire report object, not just overrides, to ensure clean report
  const conversionData = await ctx.fetch(conversionReport, 'conversion_actions');

  // Filter to only specified conversion actions
  const filteredConversionData = conversionData.filter(row => {
    const actionName = row.segments?.conversion_action_name;
    if (!actionName) return false;
    return normalizedConversionActions.includes(normalizeActionName(actionName));
  });

  // Group conversion data by the same keys as main query
  // Use allGroupingFields which includes both attributes and segments
  const conversionIndex = new Map();
  
  for (const convRow of filteredConversionData) {
    // Build key from all grouping fields (attributes + segments)
    const key = JSON.stringify(
      allGroupingFields.reduce((acc, field) => {
        const value = getAtPath(convRow, field);
        acc[field] = value;
        return acc;
      }, {})
    );

    if (!conversionIndex.has(key)) {
      conversionIndex.set(key, {
        conversions: 0,
        conversions_value: 0,
        all_conversions: 0,
        all_conversions_value: 0
      });
    }

    const aggregated = conversionIndex.get(key);
    const actionName = convRow.segments?.conversion_action_name;
    const isValueAction = normalizedConversionValueActions.includes(normalizeActionName(actionName));

    aggregated.conversions += Number(convRow.metrics?.conversions || 0);
    aggregated.all_conversions += Number(convRow.metrics?.all_conversions || 0);

    if (isValueAction) {
      aggregated.conversions_value += Number(convRow.metrics?.conversions_value || 0);
      aggregated.all_conversions_value += Number(convRow.metrics?.all_conversions_value || 0);
    }
  }

  // At this point, rows haven't been grouped yet - they're raw API responses
  // We need to group the conversion data by the same keys, then merge it
  // But since rows aren't grouped yet, we'll store the filtered conversions in a way
  // that the group step can use them
  
  // Merge filtered conversion data into main rows
  // Since rows aren't grouped yet, we need to match each row to aggregated conversion data
  return rows.map(row => {
    const out = Array.isArray(row) ? [...row] : { ...row };

    // Build key from all grouping fields (attributes + segments) to match conversion data
    const key = JSON.stringify(
      allGroupingFields.reduce((acc, field) => {
        const value = getAtPath(row, field);
        acc[field] = value;
        return acc;
      }, {})
    );

    const aggregated = conversionIndex.get(key);
    
    if (aggregated) {
      // Overwrite conversions/conversions_value with filtered values
      if (!out.metrics) out.metrics = {};
      out.metrics.conversions = aggregated.conversions;
      out.metrics.conversions_value = aggregated.conversions_value;
      // Also store all_conversions for reference
      out.metrics.all_conversions = aggregated.all_conversions;
      out.metrics.all_conversions_value = aggregated.all_conversions_value;
    } else {
      // No matching conversion actions - set to 0
      if (!out.metrics) out.metrics = {};
      out.metrics.conversions = 0;
      out.metrics.conversions_value = 0;
    }

    return out;
  });
}

function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

module.exports = { filterConversionActions };

