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
        as: "top_campaigns"
      };
 */


function topNStep(rows, config, ctx) {
  const { by, metric, n = 10, include = [], excludeRollup = true, as } = config;
  // console.log(JSON.stringify(config, null, 2));
  
  // Filter out rollup rows if needed
  const filteredRows = excludeRollup ? 
    rows.filter(row => !row.__rollup) : rows;
  
  // Sort by metric descending
  const sorted = filteredRows.sort((a, b) => {
    const aVal = getAtPath(a, metric) || 0;
    const bVal = getAtPath(b, metric) || 0;
    return bVal - aVal;
  });
  
  // Take top N and select only needed fields
  const topN = sorted.slice(0, n).map(row => {
    const result = {};
    by.forEach(field => {
      setAtPath(result, field, getAtPath(row, field));
    });
    setAtPath(result, metric, getAtPath(row, metric));
    return result;
  });
  // Store in context for envelope
  if (ctx && ctx.state) {
    ctx.state.envelopeData = ctx.state.envelopeData || {};
    ctx.state.envelopeData[as] = topN;
  }
  
  return rows; // Don't modify the main data
}

module.exports = { topNStep };