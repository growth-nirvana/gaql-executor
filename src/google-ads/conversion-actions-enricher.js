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

  // Make the API call to get conversion action data
  const conversionData = await ctx.fetch(cfg.report, 'conversion_actions');
  
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
  return rows.map(row => {
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
        
        aggregated.total_conversions += conversions;
        aggregated.total_conversions_value += conversionsValue;
        aggregated.conversion_actions.push({
          name: actionName,
          conversions,
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
}

module.exports = { enrichWithConversionActions };
