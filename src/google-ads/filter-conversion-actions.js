// src/google-ads/filter-conversion-actions.js
const { makeStatusesReadable } = require("../enum-normalizer");

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
  // Use config from ctx.state if available (stored by storeConversionActionsCfg before delta)
  // Otherwise use cfg passed directly (from pipeline step)
  const filterCfg = ctx?.state?.conversionActionFilterCfg || cfg;
  
  if (!filterCfg.conversionActions || !Array.isArray(filterCfg.conversionActions) || filterCfg.conversionActions.length === 0) {
    return rows;
  }

  if (!filterCfg.groupByAttributes || !filterCfg.report) {
    console.warn('[filterConversionActions] Missing required config: groupByAttributes, report');
    return rows;
  }

  // Use dates from stored config first (delta stores baseline dates here for previous period)
  // Then fall back to cfg dates, then ctx.options.report dates
  // This avoids needing to mutate ctx.options.report which affects other steps
  const fromDate = filterCfg.fromDate || cfg.fromDate || ctx?.options?.report?.from_date;
  const toDate = filterCfg.toDate || cfg.toDate || ctx?.options?.report?.to_date;
  
  // Ensure we have valid dates
  if (!fromDate || !toDate) {
    console.warn('[filterConversionActions] Missing dates - cannot fetch conversion actions');
    return rows;
  }

  // Store config in ctx.state on first run (current period) if not already stored
  // This ensures it's available when runPre processes previous period
  if (ctx && ctx.state && cfg.conversionActions && !ctx.state.conversionActionFilterCfg) {
    ctx.state.conversionActionFilterCfg = {
      conversionActions: cfg.conversionActions,
      conversionValueActions: cfg.conversionValueActions || cfg.conversionActions,
      groupByAttributes: cfg.groupByAttributes,
      report: cfg.report,
      fromDate: fromDate, // Store dates so delta can update them for previous period
      toDate: toDate
    };
  }

  // Normalize conversion action names (case-insensitive, handle variations)
  const normalizeActionName = (name) => {
    return String(name).toLowerCase().trim();
  };

  const normalizedConversionActions = filterCfg.conversionActions.map(normalizeActionName);
  const normalizedConversionValueActions = (filterCfg.conversionValueActions || filterCfg.conversionActions).map(normalizeActionName);

  // Build conversion action report - use same attributes/segments as main query
  // Include any segments from the main report so grouping matches correctly
  const mainSegments = filterCfg.report.segments || [];
  
  // Filter out segments that are incompatible with segments.conversion_action_name
  // Compatible segments include: date, month, device, ad_network_type, click_type, etc.
  // Incompatible segments are typically those that require other metrics (like impressions)
  const compatibleSegments = mainSegments.filter(seg => {
    // Exclude conversion_action_name itself (we're adding it separately)
    if (seg === 'segments.conversion_action_name') return false;
    // Include all other segments - they should be compatible with conversion metrics
    return true;
  });
  
  // For matching, we use all groupByAttributes (now that enums are normalized)
  // The conversion data is normalized with makeStatusesReadable to match main query format
  const matchingFields = filterCfg.groupByAttributes.filter(attr => !attr.startsWith('segments.'));
  
  // For the conversion report, we can include segments for more granular data
  // But when matching back to rows, we only use attributes
  const allGroupingFields = [
    ...matchingFields,
    ...mainSegments.filter(s => 
      s !== 'segments.conversion_action_name' && 
      !matchingFields.includes(s)
    )
  ];
  
  // Build conversion report - when using segments.conversion_action_name, 
  // we can ONLY use conversion metrics (conversions, conversions_value, all_conversions, all_conversions_value)
  // We cannot use impressions, clicks, cost, or any other metrics
  // We also cannot use constraints that reference incompatible metrics
  // So we remove ALL constraints to be safe
  
  const conversionReport = {
    entity: filterCfg.report.entity,
    segments: [
      'segments.conversion_action_name',
      ...compatibleSegments  // Include compatible segments from main query
    ],
    // Keep same attributes for grouping (segments are handled separately)
    attributes: filterCfg.groupByAttributes.filter(attr => !attr.startsWith('segments.')),
    // ONLY these 4 metrics are compatible with segments.conversion_action_name
    metrics: [
      'metrics.conversions',
      'metrics.conversions_value',
      'metrics.all_conversions',
      'metrics.all_conversions_value'
    ],
    from_date: fromDate,
    to_date: toDate,
    constraints: [], // Empty constraints - cannot use any constraints with conversion_action_name
    // Only include limit if it's a valid positive integer
    ...(filterCfg.report.limit && Number.isInteger(filterCfg.report.limit) && filterCfg.report.limit > 0 ? { limit: filterCfg.report.limit } : {})
  };

  // Fetch conversion action data for the specified date range
  // CRITICAL: When called by delta step, fromDate/toDate are previous period dates
  // We must ensure these dates override baseReport dates in ctx.fetch
  // Pass conversionReport as overrides - overrideReportOptions will replace baseReport fields
  const conversionDataRaw = await ctx.fetch(conversionReport, 'conversion_actions');
  
  // Normalize enums in conversion data to match main query format (enum names, not IDs)
  // This ensures matching works correctly (e.g., "MAXIMIZE_CONVERSION_VALUE" not 11)
  const conversionData = makeStatusesReadable(conversionDataRaw);

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
    const keyParts = allGroupingFields.reduce((acc, field) => {
      const value = getAtPath(convRow, field);
      acc[field] = value;
      return acc;
    }, {});
    const key = JSON.stringify(keyParts);

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
  const filteredRows = rows.map((row, idx) => {
    const out = Array.isArray(row) ? [...row] : { ...row };

    // Build key from matching fields (attributes only) to match conversion data
    // We aggregate conversion data by allGroupingFields (attributes + segments),
    // but match rows by attributes only (matchingFields)
    const keyParts = matchingFields.reduce((acc, field) => {
      const value = getAtPath(row, field);
      acc[field] = value;
      return acc;
    }, {});
    
    // Find matching conversion data by aggregating all conversion rows that match these attributes
    // (ignoring segments in the match)
    let matchedConversions = 0;
    let matchedConversionsValue = 0;
    let matchedAllConversions = 0;
    let matchedAllConversionsValue = 0;
    
    for (const [convKey, convData] of conversionIndex.entries()) {
      const convKeyParts = JSON.parse(convKey);
      // Check if attributes match (ignore segments)
      const attributesMatch = matchingFields.every(field => {
        const rowValue = getAtPath(row, field);
        const convValue = convKeyParts[field];
        return rowValue === convValue || (rowValue == null && convValue == null);
      });
      
      if (attributesMatch) {
        matchedConversions += convData.conversions;
        matchedConversionsValue += convData.conversions_value;
        matchedAllConversions += convData.all_conversions;
        matchedAllConversionsValue += convData.all_conversions_value;
      }
    }
    
    const key = JSON.stringify(keyParts);

    // Use matched values (aggregated across all segments for these attributes)
    if (matchedConversions > 0 || matchedConversionsValue > 0) {
      // Overwrite conversions/conversions_value with filtered values
      if (!out.metrics) out.metrics = {};
      const oldConversions = out.metrics.conversions;
      out.metrics.conversions = matchedConversions;
      out.metrics.conversions_value = matchedConversionsValue;
      // Also store all_conversions for reference
      out.metrics.all_conversions = matchedAllConversions;
      out.metrics.all_conversions_value = matchedAllConversionsValue;
    } else {
      // No matching conversion actions - set to 0
      if (!out.metrics) out.metrics = {};
      out.metrics.conversions = 0;
      out.metrics.conversions_value = 0;
    }

    return out;
  });
  
  return filteredRows;
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

