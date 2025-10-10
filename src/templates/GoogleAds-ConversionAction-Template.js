const { BaseTemplate } = require('./BaseTemplate');

class GoogleAdsConversionActionTemplate extends BaseTemplate {
  
  static getBaseReport() {
    return {
      entity: 'conversion_action',
      attributes: [
        'customer.id',
        'customer.descriptive_name',
        'conversion_action.id',
        'conversion_action.name',
        'conversion_action.status',
        'conversion_action.type',
        'conversion_action.category',
        'conversion_action.origin',
        'conversion_action.primary_for_goal',
        'conversion_action.counting_type',
        'conversion_action.include_in_conversions_metric',
        'conversion_action.click_through_lookback_window_days',
        'conversion_action.view_through_lookback_window_days',
        'conversion_action.value_settings.default_value',
        'conversion_action.value_settings.default_currency_code',
        'conversion_action.value_settings.always_use_default_value',
        'conversion_action.attribution_model_settings.attribution_model',
        'conversion_action.attribution_model_settings.data_driven_model_status',
        'conversion_action.app_id',
        'conversion_action.mobile_app_vendor',
        'conversion_action.firebase_settings.project_id',
        'conversion_action.firebase_settings.property_id',
        'conversion_action.firebase_settings.property_name',
        'conversion_action.firebase_settings.event_name',
        'conversion_action.google_analytics_4_settings.property_id',
        'conversion_action.google_analytics_4_settings.property_name',
        'conversion_action.google_analytics_4_settings.event_name',
        'conversion_action.third_party_app_analytics_settings.provider_name',
        'conversion_action.third_party_app_analytics_settings.event_name',
        'conversion_action.phone_call_duration_seconds',
        'conversion_action.owner_customer',
        'conversion_action.resource_name',
      ],
      metrics: [
        'metrics.all_conversions',
        'metrics.all_conversions_value',
      ],
    } 
  }

  static getBasePipeline(config = {}) {
    return [
      { use: "periods", baseline: { mode: "previous_month_same_span" } },
      { use: "statusesReadable" },
      { 
        use: "group", 
        by: [
          ...this.calculateGroupByAttributes(config),
        ],
        aggregates: {
          "metrics.all_conversions": { fn: "SUM", as: "metrics.all_conversions" },
          "metrics.all_conversions_value": { fn: "SUM", as: "metrics.all_conversions_value" },
          // derived metrics
          "avg_conv_value": { fn: "RATIO", num: "metrics.all_conversions_value", den: "metrics.all_conversions", as: "metrics.avg_conv_value" },
          "conv_rate": { fn: "RATIO", num: "metrics.all_conversions", den: "metrics.all_conversions", as: "metrics.conv_rate" }, // placeholder - would need impression data
        },
        rollup: true,
        nulls: "include",
        orderBy: [{ field: "conversion_action.name", dir: "ASC" }],
      },
      {
        use: "stats",
        fields: ["metrics.all_conversions", "metrics.all_conversions_value", "metrics.avg_conv_value"],
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
          { field: "metrics.all_conversions", kind: "absolute" },
          { field: "metrics.all_conversions_value", kind: "absolute" },
          { field: "metrics.avg_conv_value", kind: "ratio", num: "metrics.all_conversions_value", den: "metrics.all_conversions" },
        ],
        emit: {
          previous: "metrics_prev",
          delta_abs: "metrics_delta",
          delta_pct: "metrics_delta_pct"
        },
        policies: { pctOnZero: "null" }
      },
      {
        use: "topN",
        by: ["conversion_action.id", "conversion_action.name"],
        metric: "metrics.all_conversions",
        n: 10,
        include: ["metrics.all_conversions_value", "metrics.avg_conv_value"],
        excludeRollup: true,
        as: "top_conversion_actions"
      },
      {
        use: "topN",
        by: ["conversion_action.id", "conversion_action.name"],
        metric: "metrics.all_conversions_value",
        n: 10,
        include: ["metrics.all_conversions", "metrics.avg_conv_value"],
        excludeRollup: true,
        as: "top_conversion_actions_by_value"
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
}

module.exports = { GoogleAdsConversionActionTemplate };
