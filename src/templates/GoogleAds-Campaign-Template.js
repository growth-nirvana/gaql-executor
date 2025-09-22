class GoogleAdsCampaignTemplate {
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
  
  static getBaseCampaignReport() {
    return {
      entity: 'campaign',
      attributes: [
        'customer.id',
        'customer.descriptive_name',
        'campaign.id',
        'campaign.name',
        'campaign.bidding_strategy_type',
        "campaign.advertising_channel_type",
        "campaign_budget.amount_micros",
        "campaign_budget.recommended_budget_amount_micros"
      ],
      metrics: [
        'metrics.cost_micros',
        'metrics.clicks',
        'metrics.impressions',
        'metrics.conversions',
        'metrics.conversions_value'
      ],
      // segments: [],
      constraints: [
        { key: "metrics.impressions", op: ">", val: 0 }
      ],
      limit: 1000,
    } 
  }

  static calculateGroupByAttributes(config) {
    // Get the allowed attributes from the base report
    const baseReport = this.getBaseCampaignReport();
    const allowedAttributes = baseReport.attributes;
    
    if (config.attributes && config.attributes.length > 0) {
      // User provided specific attributes - filter to only valid ones
      return config.attributes.filter(attr => allowedAttributes.includes(attr));
    } else {
      // User provided no attributes - use all base report attributes
      return allowedAttributes;
    }
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseCampaignReport(),
      from_date: fromDate,
      to_date: toDate,
    };

    return new GoogleAdsCampaignTemplate({
      credentials,
      report,
      pipeline: [
        { use: "periods", baseline: { mode: "previous_month_same_span" } },
        { use: "statusesReadable" },
        { use: "formatMicros", fields: ["metrics.cost_micros", "campaign_budget.amount_micros", "campaign_budget.recommended_budget_amount_micros"] },
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
        },
        { use: "shareOf", fields: ["metrics.cost"], includeRollup: false, },
        {
          use: "stats",
          fields: ["metrics.cpc", "metrics.ctr", "metrics.cpa"],
          include: ["mean", "median", "p"],   // mean, median, percentiles
          percentiles: [90],                   // add p90
          naming: "flat",                       // writes metrics.cpc_mean, metrics.cpc_median, metrics.cpc_p90, …
          includeRollup: false,
          // (By default rollup rows are ignored in my implementation; if you added an includeRollup flag, leave it false)
        },
        {
          use: "delta",
          // Optional: if omitted, it will compute previous range from report.from_date/to_date
          // baseline: { from_date: "2025-08-01", to_date: "2025-08-31" },
          // Optional: explicit keys; otherwise derived from prior group (by + timeBucket)
          // keys: ["campaign.bidding_strategy_type"],
          baseline: { mode: "previous_period" },
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
        },
      ],
      output: {
        mode: "envelope",
        include: ["periods"],
      }
    });
  }
}

module.exports = { GoogleAdsCampaignTemplate };
