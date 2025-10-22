class BaseTemplate {
  constructor(config) {
    this.credentials = config.credentials;
    this.config = {
      credentials: this.credentials,
      report: config.report || {},
      pipeline: config.pipeline || [],
      output: config.output || { mode: 'envelope', include: ["periods"] },
    }
  }

  getConfig() {
    return this.config;
  }

  static getBaseReport() {
    throw new Error('getBaseReport() must be implemented by subclass');
  }

  // Generic method that works for all subclasses
  static calculateGroupByAttributes(config) {
    const baseReport = this.getBaseReport();
    const allowedAttributes = baseReport.attributes;
    
    if (config.attributes && config.attributes.length > 0) {
      return config.attributes.filter(attr => allowedAttributes.includes(attr));
    } else {
      return allowedAttributes;
    }
  }

  // Generic method to get baseline mode from config with default
  static calculateBaselineMode(config) {
    return config.baselineMode || "previous_period";
  }

  // Generic method to get filter configuration from config
  static calculateFilters(config) {
    // Default: no filters (returns null so the filter step can be conditionally added)
    if (!config.filters || !Array.isArray(config.filters) || config.filters.length === 0) {
      return null;
    }
    
    return {
      where: config.filters,
      logic: config.filterLogic || "AND"
    };
  }

  // Generic method to get derived dimensions configuration from config
  static calculateDerivedDimensions(config) {
    // Default: no derived dimensions (returns null so the step can be conditionally added)
    if (!config.derivedDimensions || !Array.isArray(config.derivedDimensions) || config.derivedDimensions.length === 0) {
      return null;
    }
    
    // Return array of deriveDimension configurations
    return config.derivedDimensions;
  }

  // Override this method in subclasses to customize the pipeline
  static getBasePipeline(config = {}) {
    const pipeline = [
      { use: "periods", baseline: { mode: this.calculateBaselineMode(config) } },
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros", "campaign_budget.amount_micros", "campaign_budget.recommended_budget_amount_micros"] },
    ];

    // Add derived dimension steps if configured (before grouping)
    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    // Add grouping step
    pipeline.push({ 
        use: "group", 
        by: [
          ...this.calculateGroupByAttributes(config),
        ],
        aggregates: {
          "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
          "metrics.clicks":      { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
          "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
          // derived
          "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
          "ctr":  { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
          "cpc":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.clicks",      as: "metrics.cpc" },
          "cvr":  { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
          "cpa":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.conversions", as: "metrics.cpa" },
        },
        rollup: true,
        nulls: "include",
        orderBy: [{ field: "campaign.name", dir: "ASC" }],
      });

    // Add remaining pipeline steps
    pipeline.push(
      { use: "shareOf", fields: ["metrics.cost"], includeRollup: false, },
      {
        use: "stats",
        fields: ["metrics.cpc", "metrics.ctr", "metrics.cpa"],
        include: ["mean", "median", "p"],   // mean, median, percentiles
        percentiles: [90],                   // add p90
        naming: "flat",                       // writes metrics.cpc_mean, metrics.cpc_median, metrics.cpc_p90, …
        includeRollup: false,
      },
      {
        use: "delta",
        baseline: { mode: this.calculateBaselineMode(config) },
        partial:  { policy: "match_upto_day" }, 
        measures: [
          { field: "metrics.cost", kind: "absolute" },
          { field: "metrics.clicks", kind: "absolute" },
          { field: "metrics.impressions", kind: "absolute" },
          { field: "metrics.conversions", kind: "absolute" },
          { field: "metrics.conversions_value", kind: "absolute" },
          { field: "metrics.ctr", kind: "ratio", num: "metrics.clicks", den: "metrics.impressions" },
          { field: "metrics.cpc", kind: "ratio", num: "metrics.cost",   den: "metrics.clicks" },
          { field: "metrics.cvr", kind: "ratio", num: "metrics.conversions", den: "metrics.clicks" },
          { field: "metrics.cpa", kind: "ratio", num: "metrics.cost",   den: "metrics.conversions" },
          { field: "metrics.cost_share", kind: "absolute" },
        ],
        emit: {
          previous: "metrics_prev",
          delta_abs: "metrics_delta",
          delta_pct: "metrics_delta_pct"
        },
        policies: { pctOnZero: "null" }
      }
    );

    // Add filter step if filters are configured
    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    return pipeline;
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseReport(),
      from_date: fromDate,
      to_date: toDate,
      ...(config.constraints && { constraints: config.constraints }),
    };

    return new this({
      credentials,
      report,
      pipeline: this.getBasePipeline(config),
      output: {
        mode: "envelope",
        include: ["periods"],
      }
    });
  }

  // Simplified method for looking up entities (campaigns, keywords, etc.)
  // Use this to get a list of items before doing deeper analysis
  // Example: Get all campaign names and IDs, then analyze specific campaigns
  static forLookup(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseReport(),
      from_date: fromDate,
      to_date: toDate,
      ...(config.constraints && { constraints: config.constraints }),
    };

    // Simplified pipeline - just basic grouping and metrics, no periods/delta
    const pipeline = [
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros", "campaign_budget.amount_micros", "campaign_budget.recommended_budget_amount_micros"] },
    ];

    // Add derived dimension steps if configured (before grouping)
    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    // Add grouping step
    pipeline.push({ 
        use: "group", 
        by: [
          ...this.calculateGroupByAttributes(config),
        ],
        aggregates: {
          "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
          "metrics.clicks":      { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
          "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
          // derived
          "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
          "ctr":  { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
          "cpc":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.clicks",      as: "metrics.cpc" },
          "cvr":  { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
          "cpa":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.conversions", as: "metrics.cpa" },
        },
        rollup: false, // No rollup for lookups
        nulls: "include",
        orderBy: [{ field: "metrics.cost_micros", dir: "DESC" }], // Order by cost descending
      });

    // Add filter step if filters are configured
    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: "flat", // Flat output for easier processing
      }
    });
  }
}

module.exports = { BaseTemplate };