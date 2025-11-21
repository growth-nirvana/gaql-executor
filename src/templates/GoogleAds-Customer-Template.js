const { BaseTemplate } = require('./BaseTemplate');

class GoogleAdsCustomerTemplate extends BaseTemplate {
  
  static getBaseReport() {
    return {
      entity: 'customer',
      attributes: [
        'customer.id',
        'customer.descriptive_name',
        'customer.currency_code',
        'customer.time_zone',
        'customer.auto_tagging_enabled',
        'customer.test_account',
        'customer.manager',
        'customer.optimization_score',
        'customer.optimization_score_weight',
      ],
      metrics: [
        'metrics.cost_micros',
        'metrics.clicks',
        'metrics.impressions',
        'metrics.conversions',
        'metrics.conversions_value',
        'metrics.all_conversions',
        'metrics.all_conversions_value',
        'metrics.view_through_conversions',
        'metrics.interactions',
        'metrics.interaction_rate',
      ],
      constraints: [
        { key: "metrics.impressions", op: ">", val: 0 }
      ],
    } 
  }

  static getBasePipeline(config = {}) {
    return [
      { use: "periods", baseline: { mode: "previous_month_same_span" } },
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros"] },
      { 
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
          "metrics.all_conversions": { fn: "SUM", as: "metrics.all_conversions" },
          "metrics.all_conversions_value": { fn: "SUM", as: "metrics.all_conversions_value" },
          "metrics.view_through_conversions": { fn: "SUM", as: "metrics.view_through_conversions" },
          "metrics.interactions": { fn: "SUM", as: "metrics.interactions" },
          // derived metrics
          "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
          "ctr":  { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
          "cpc":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.clicks",      as: "metrics.cpc" },
          "cvr":  { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
          "cpa":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.conversions", as: "metrics.cpa" },
          "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
          "avg_conv_value": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.conversions", as: "metrics.avg_conv_value" },
        },
        rollup: true,
        nulls: "include",
        orderBy: [{ field: "customer.descriptive_name", dir: "ASC" }],
      },
      {
        use: "stats",
        fields: ["metrics.cpc", "metrics.ctr", "metrics.cpa", "metrics.roas"],
        include: ["mean", "median", "p"],
        percentiles: [90],
        naming: "flat",
        includeRollup: false,
      },
      {
        use: "delta",
        baseline: { mode: "previous_period" },
        partial:  { policy: "match_upto_day" }, 
        measures: [
          { field: "metrics.cost", kind: "absolute" },
          { field: "metrics.clicks", kind: "absolute" },
          { field: "metrics.impressions", kind: "absolute" },
          { field: "metrics.conversions", kind: "absolute" },
          { field: "metrics.conversions_value", kind: "absolute" },
          { field: "metrics.all_conversions", kind: "absolute" },
          { field: "metrics.all_conversions_value", kind: "absolute" },
          { field: "metrics.view_through_conversions", kind: "absolute" },
          { field: "metrics.interactions", kind: "absolute" },
          { field: "metrics.ctr", kind: "ratio", num: "metrics.clicks", den: "metrics.impressions" },
          { field: "metrics.cpc", kind: "ratio", num: "metrics.cost",   den: "metrics.clicks" },
          { field: "metrics.cvr", kind: "ratio", num: "metrics.conversions", den: "metrics.clicks" },
          { field: "metrics.cpa", kind: "ratio", num: "metrics.cost",   den: "metrics.conversions" },
          { field: "metrics.roas", kind: "ratio", num: "metrics.conversions_value", den: "metrics.cost" },
          { field: "metrics.avg_conv_value", kind: "ratio", num: "metrics.conversions_value", den: "metrics.conversions" },
        ],
        emit: {
          previous: "metrics_prev",
          delta_abs: "metrics_delta",
          delta_pct: "metrics_delta_pct"
        },
        policies: { pctOnZero: "null" }
      },
    ];
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

  /**
   * Trends analysis method - optimized for LLM consumption with smart granularity
   * See GoogleAdsCampaignTemplate.forTrends() for detailed documentation
   */
  static forTrends(credentials, fromDate, toDate, config = {}) {
    const parseDate = (str) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };
    const from = parseDate(fromDate);
    const to = parseDate(toDate);
    const daysDiff = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    
    const baseReport = this.getBaseReport();
    const report = {
      ...baseReport,
      from_date: fromDate,
      to_date: toDate,
      ...(config.constraints && { constraints: config.constraints }),
      segments: ['segments.date', ...(baseReport.segments || [])],
    };

    const defaultAttributes = [
      'customer.id',
      'customer.descriptive_name',
    ];
    const attributes = config.attributes && config.attributes.length > 0
      ? config.attributes
      : defaultAttributes;

    const filterConfig = this.calculateFilters(config);
    const baselineMode = config.baselineMode || "previous_period";

    const pipeline = [
      { use: "periods", baseline: { mode: baselineMode } },
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros"] },
    ];

    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    pipeline.push({ 
      use: "group", 
      by: [
        ...attributes,
        'segments.date',
      ],
      aggregates: {
        "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
        "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
        "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
        "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
        "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
        "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
        "ctr": { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
        "cpc": { fn: "RATIO", num: "metrics.cost", den: "metrics.clicks", as: "metrics.cpc" },
        "cvr": { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
        "cpa": { fn: "RATIO", num: "metrics.cost", den: "metrics.conversions", as: "metrics.cpa" },
        "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
      },
      rollup: false,
      nulls: "include",
      orderBy: [
        { field: "segments.date", dir: "ASC" },
        { field: "customer.descriptive_name", dir: "ASC" },
      ],
    });

    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    if (config.includeTimePeriodDigest !== false) {
      pipeline.push({
        use: "timePeriodDigest",
        by: ['segments.date'], // Customer level - just group by date
        aggregates: {
          "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
          "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
          "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
          "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
          "ctr": { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
          "cpc": { fn: "RATIO", num: "metrics.cost", den: "metrics.clicks", as: "metrics.cpc" },
          "cvr": { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
          "cpa": { fn: "RATIO", num: "metrics.cost", den: "metrics.conversions", as: "metrics.cpa" },
          "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
        },
        orderBy: [
          { field: "segments.date", dir: "ASC" },
        ],
      });
    }

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: "envelope",
        include: ["periods", "time_period_digest"],
      }
    });
  }
}

module.exports = { GoogleAdsCustomerTemplate };
