// src/google-ads/conversion-actions-enricher.js

function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setAtPath(obj, path, value) {
  const parts = String(path).split(".");
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
 * Enriches campaign data with conversion action information by making a separate API call
 * 
 * cfg = {
 *   // Report configuration for the conversion actions query
 *   report: {
 *     entity: 'campaign',
 *     segments: ['segments.conversion_action_name'],
 *     metrics: ['metrics.conversions', 'metrics.conversions_value'],
 *     // ... other report options
 *   },
 *   // How to join the data
 *   joinKeys: ['customer.id', 'campaign.id'], // keys to match rows
 *   // Where to store the enriched data
 *   outputPath: 'conversion_actions', // e.g. row.conversion_actions = [...]
 *   // Optional: aggregate conversion actions per campaign
 *   aggregate: true, // if true, sum up all conversion actions per campaign
 * }
 */
async function enrichWithConversionActions(rows, cfg = {}, ctx) {
  if (!cfg.report || !cfg.joinKeys || !cfg.outputPath) {
    console.warn('[conversionActionsEnricher] Missing required config: report, joinKeys, outputPath');
    return rows;
  }

  // Use provided dates or fall back to report dates (for delta step usage)
  const fromDate = cfg.fromDate || cfg.report?.from_date || ctx?.options?.report?.from_date;
  const toDate = cfg.toDate || cfg.report?.to_date || ctx?.options?.report?.to_date;

  // If dates are explicitly provided and don't match report dates, this is delta calling us with previous period dates
  // Otherwise, if dates don't match report and weren't explicitly provided, skip (runPre on previous period data)
  const hasExplicitDates = cfg.fromDate && cfg.toDate;
  const datesMatchReport = ctx?.options?.report?.from_date && ctx?.options?.report?.to_date &&
    fromDate === ctx.options.report.from_date && toDate === ctx.options.report.to_date;
  
  // Skip enrichment if:
  // - Dates don't match report dates AND
  // - Dates weren't explicitly provided (meaning this is runPre using cfg dates on wrong-period data)
  // AND this is NOT the _prev version (delta will handle _prev)
  if (!hasExplicitDates && !datesMatchReport && ctx?.options?.report?.from_date && ctx?.options?.report?.to_date && cfg.outputPath === 'conversion_actions') {
    // This is previous period data being processed by runPre with current period cfg dates
    // Skip enrichment here - delta step will handle it with correct dates as conversion_actions_prev
    return rows;
  }

  // Store config in ctx.state so delta step can apply same enrichment to previous period
  if (ctx && ctx.state && cfg.outputPath === 'conversion_actions') {
    // Only store if this is the main conversion_actions (not _prev)
    ctx.state.conversionActionsEnricherCfg = {
      report: cfg.report,
      joinKeys: cfg.joinKeys,
      outputPath: cfg.outputPath,
      aggregate: cfg.aggregate,
      fromDate: cfg.fromDate || cfg.report?.from_date,
      toDate: cfg.toDate || cfg.report?.to_date
    };
  }

  // Remove all constraints from the conversion actions query
  // The join keys will naturally filter to only matching rows, and constraints
  // (especially metric constraints) can cause errors if the field isn't in the SELECT clause
  // overrideReportOptions will handle removing constraints when segments.conversion_action_name is present
  const cleanedReport = {
    ...cfg.report,
    from_date: fromDate,
    to_date: toDate,
    constraints: [] // Remove all constraints - join keys handle filtering
  };

  // Make the API call to get conversion action data
  const conversionData = await ctx.fetch(cleanedReport, 'conversion_actions');
  
  // Group conversion data by join keys
  const conversionIndex = new Map();
  for (const convRow of conversionData) {
    const key = JSON.stringify(
      cfg.joinKeys.reduce((acc, key) => {
        acc[key] = getAtPath(convRow, key);
        return acc;
      }, {})
    );
    
    if (!conversionIndex.has(key)) {
      conversionIndex.set(key, []);
    }
    conversionIndex.get(key).push(convRow);
  }

  // Enrich each row with conversion action data
  const enrichedRows = rows.map(row => {
    const out = Array.isArray(row) ? [...row] : { ...row };
    
    const key = JSON.stringify(
      cfg.joinKeys.reduce((acc, key) => {
        acc[key] = getAtPath(row, key);
        return acc;
      }, {})
    );
    
    const conversionActions = conversionIndex.get(key) || [];
    
    if (cfg.aggregate) {
      // Aggregate all conversion actions for this campaign
      const aggregated = {
        total_conversions: 0,
        total_conversions_value: 0,
        conversion_actions: []
      };
      
      for (const conv of conversionActions) {
        const actionName = getAtPath(conv, 'segments.conversion_action_name');
        const conversions = Number(getAtPath(conv, 'metrics.conversions')) || 0;
        const conversionsValue = Number(getAtPath(conv, 'metrics.conversions_value')) || 0;
        const allConversions = Number(getAtPath(conv, 'metrics.all_conversions')) || 0;
        const allConversionsValue = Number(getAtPath(conv, 'metrics.all_conversions_value')) || 0;
        
        aggregated.total_conversions += allConversions;
        aggregated.total_conversions_value += allConversionsValue;
        aggregated.conversion_actions.push({
          name: actionName,
          conversions: conversions,
          conversions_value: conversionsValue,
          all_conversions: allConversions,
          all_conversions_value: allConversionsValue
        });
      }
      
      setAtPath(out, cfg.outputPath, aggregated);
    } else {
      // Store raw conversion action data
      setAtPath(out, cfg.outputPath, conversionActions);
    }
    
    return out;
  });
  
  return enrichedRows;
}

module.exports = { enrichWithConversionActions };
