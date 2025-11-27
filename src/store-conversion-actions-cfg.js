// src/store-conversion-actions-cfg.js

/**
 * Simple step that stores conversionActionsEnricher config in ctx.state
 * This allows delta step to access the config before conversionActionsEnricher runs
 * 
 * Also stores conversionActionFilterCfg if provided, so delta can filter previous period conversions
 */
function storeConversionActionsCfg(rows, cfg = {}, ctx) {
  if (ctx && ctx.state && cfg.report && cfg.joinKeys) {
    ctx.state.conversionActionsEnricherCfg = {
      report: cfg.report,
      joinKeys: cfg.joinKeys,
      outputPath: cfg.outputPath || 'conversion_actions',
      aggregate: cfg.aggregate !== false,
      fromDate: cfg.fromDate || cfg.report?.from_date,
      toDate: cfg.toDate || cfg.report?.to_date
    };
  }
  
  // Also store conversionActionFilterCfg if provided
  if (ctx && ctx.state && cfg.conversionActions && Array.isArray(cfg.conversionActions) && cfg.conversionActions.length > 0) {
    ctx.state.conversionActionFilterCfg = {
      conversionActions: cfg.conversionActions,
      conversionValueActions: cfg.conversionValueActions || cfg.conversionActions,
      groupByAttributes: cfg.groupByAttributes || [],
      report: cfg.report,
      fromDate: cfg.fromDate || cfg.report?.from_date,
      toDate: cfg.toDate || cfg.report?.to_date
    };
  }
  
  return rows; // Pass through rows unchanged
}

module.exports = { storeConversionActionsCfg };

