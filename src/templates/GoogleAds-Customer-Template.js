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

  static getBasePipeline(config = {}, fromDate, toDate) {
    const groupByAttributes = this.calculateGroupByAttributes(config);
    return [
      { use: "periods", baseline: { mode: "previous_month_same_span" } },
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros"] },
      // Preserve API values (like Facebook preserves conversions_api)
      {
        use: "derive",
        add: {
          // Always preserve original API values (rename from API response)
          "metrics.conversions_api": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value_api": (r) => r.metrics?.conversions_value ?? 0,
          // Use API values as regular conversions (will be filtered from conversion_actions after enrichment)
          "metrics.conversions": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value": (r) => r.metrics?.conversions_value ?? 0
        }
      },
      { 
        use: "group", 
        by: [
          ...groupByAttributes,
        ],
        aggregates: {
          "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
          "metrics.clicks":      { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.conversions_api": { fn: "SUM", as: "metrics.conversions_api" },
          "metrics.conversions_value_api": { fn: "SUM", as: "metrics.conversions_value_api" },
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
      // Always add conversionActionsEnricher to show breakdown of all conversion actions
      // (like Facebook - shows all actions in breakdown)
      {
        use: "conversionActionsEnricher",
        report: {
          entity: 'customer',
          // Use the same attributes as the main query for proper joining
          attributes: groupByAttributes,
          segments: ['segments.conversion_action_name'],
          metrics: ['metrics.conversions', 'metrics.conversions_value', 'metrics.all_conversions', 'metrics.all_conversions_value'],
          from_date: fromDate,
          to_date: toDate,
          constraints: config.constraints || []
        },
        // Use customer.id as primary join key
        joinKeys: ['customer.id'],
        outputPath: 'conversion_actions',
        aggregate: true
      },
      // Filter conversions from conversion_actions (like Facebook - uses conversionAggregates during grouping)
      // Filter after enrichment so we have the breakdown, then set filtered values and recalculate derived metrics
      ...(config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
        ? [{
            use: "derive",
            add: {
              // Sum filtered conversions from conversion_actions (like Facebook's SUM_EXPR)
              "metrics.conversions": (r) => {
                const convActions = r.conversion_actions;
                if (convActions && convActions.conversion_actions && Array.isArray(convActions.conversion_actions)) {
                  const normalizeActionName = (name) => String(name).toLowerCase().trim();
                  const normalizedFilteredActions = config.conversionAction.map(normalizeActionName);
                  return convActions.conversion_actions
                    .filter(action => normalizedFilteredActions.includes(normalizeActionName(action.name)))
                    .reduce((sum, action) => sum + (Number(action.conversions) || 0), 0);
                }
                return r.metrics?.conversions ?? 0;
              },
              "metrics.conversions_value": (r) => {
                const convActions = r.conversion_actions;
                if (convActions && convActions.conversion_actions && Array.isArray(convActions.conversion_actions)) {
                  const normalizeActionName = (name) => String(name).toLowerCase().trim();
                  const normalizedFilteredActions = (config.conversionValueAction || config.conversionAction).map(normalizeActionName);
                  return convActions.conversion_actions
                    .filter(action => normalizedFilteredActions.includes(normalizeActionName(action.name)))
                    .reduce((sum, action) => sum + (Number(action.conversions_value) || 0), 0);
                }
                return r.metrics?.conversions_value ?? 0;
              },
              // Recalculate derived metrics with filtered conversions (like Facebook)
              "metrics.cvr": (r) => {
                const clicks = r.metrics?.clicks ?? 0;
                const conversions = r.metrics?.conversions ?? 0;
                return clicks > 0 ? conversions / clicks : null;
              },
              "metrics.cpa": (r) => {
                const cost = r.metrics?.cost ?? 0;
                const conversions = r.metrics?.conversions ?? 0;
                return conversions > 0 ? cost / conversions : null;
              },
              "metrics.roas": (r) => {
                const cost = r.metrics?.cost ?? 0;
                const conversionsValue = r.metrics?.conversions_value ?? 0;
                return cost > 0 ? conversionsValue / cost : null;
              }
            }
          }]
        : []),
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
      pipeline: this.getBasePipeline(config, fromDate, toDate),
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
    const formatDate = (date) => {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    
    let from = parseDate(fromDate);
    let to = parseDate(toDate);
    const daysDiff = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    
    // For monthly granularity, normalize date range to full calendar months
    if (config.granularity === 'monthly') {
      from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      const lastDayOfMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
      to = lastDayOfMonth;
    }
    
    // Determine granularity and select appropriate segment
    const granularity = config.granularity || (daysDiff <= 7 ? 'daily' : 'weekly');
    const dateSegment = granularity === 'monthly' ? 'segments.month' : 'segments.date';
    const useTimeBucket = granularity === 'weekly';
    
    const baseReport = this.getBaseReport();
    const report = {
      ...baseReport,
      from_date: formatDate(from),
      to_date: formatDate(to),
      ...(config.constraints && { constraints: config.constraints }),
      segments: [dateSegment, ...(baseReport.segments || [])],
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

    const groupByAttributes = attributes;
    const pipeline = [
      { use: "periods", baseline: { mode: baselineMode }, granularity: granularity },
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros"] },
      // Preserve API values (like Facebook preserves conversions_api)
      {
        use: "derive",
        add: {
          // Always preserve original API values (rename from API response)
          "metrics.conversions_api": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value_api": (r) => r.metrics?.conversions_value ?? 0,
          // Use API values as regular conversions (will be filtered from conversion_actions after enrichment)
          "metrics.conversions": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value": (r) => r.metrics?.conversions_value ?? 0
        }
      },
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
        ...(useTimeBucket ? [] : [dateSegment]), // Include dateSegment if not using timeBucket
      ],
      ...(useTimeBucket ? {
        timeBucket: {
          field: "segments.date",
          granularity: "WEEK",
          as: "segments.date" // Overwrite segments.date with week-bucketed date
        }
      } : {}),
      aggregates: {
        "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
        "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
        "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
        "metrics.conversions_api": { fn: "SUM", as: "metrics.conversions_api" },
        "metrics.conversions_value_api": { fn: "SUM", as: "metrics.conversions_value_api" },
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
        { field: dateSegment, dir: "ASC" },
        { field: "customer.descriptive_name", dir: "ASC" },
      ],
    });

    // Normalize segments.month to segments.date for consistent output across all granularities
    // This ensures segments.date always represents the start/anchor date of the period
    if (granularity === 'monthly') {
      pipeline.push({
        use: "deriveDimension",
        as: "segments.date",
        rules: [], // No rules - always use default
        default: (row) => {
          // Copy segments.month to segments.date for consistent output
          return row.segments?.month || null;
        }
      });
    }

    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    // Always add conversionActionsEnricher to show breakdown of all conversion actions
    // (like Facebook - shows all actions in breakdown)
    pipeline.push({
      use: "conversionActionsEnricher",
      report: {
        entity: 'customer',
        // Use the same attributes as the main query for proper joining
        attributes: groupByAttributes,
        segments: ['segments.conversion_action_name', ...(granularity === 'monthly' ? ['segments.month'] : ['segments.date'])],
        metrics: ['metrics.conversions', 'metrics.conversions_value', 'metrics.all_conversions', 'metrics.all_conversions_value'],
        from_date: formatDate(from),
        to_date: formatDate(to),
        constraints: config.constraints || []
      },
      // Use customer.id and date segment as primary join keys
      joinKeys: ['customer.id', dateSegment],
      outputPath: 'conversion_actions',
      aggregate: true
    });

    // Filter conversions from conversion_actions (like Facebook - uses conversionAggregates during grouping)
    // Filter after enrichment so we have the breakdown, then set filtered values and recalculate derived metrics
    if (config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0) {
      pipeline.push({
        use: "derive",
        add: {
          // Sum filtered conversions from conversion_actions (like Facebook's SUM_EXPR)
          "metrics.conversions": (r) => {
            const convActions = r.conversion_actions;
            if (convActions && convActions.conversion_actions && Array.isArray(convActions.conversion_actions)) {
              const normalizeActionName = (name) => String(name).toLowerCase().trim();
              const normalizedFilteredActions = config.conversionAction.map(normalizeActionName);
              return convActions.conversion_actions
                .filter(action => normalizedFilteredActions.includes(normalizeActionName(action.name)))
                .reduce((sum, action) => sum + (Number(action.conversions) || 0), 0);
            }
            return r.metrics?.conversions ?? 0;
          },
          "metrics.conversions_value": (r) => {
            const convActions = r.conversion_actions;
            if (convActions && convActions.conversion_actions && Array.isArray(convActions.conversion_actions)) {
              const normalizeActionName = (name) => String(name).toLowerCase().trim();
              const normalizedFilteredActions = (config.conversionValueAction || config.conversionAction).map(normalizeActionName);
              return convActions.conversion_actions
                .filter(action => normalizedFilteredActions.includes(normalizeActionName(action.name)))
                .reduce((sum, action) => sum + (Number(action.conversions_value) || 0), 0);
            }
            return r.metrics?.conversions_value ?? 0;
          },
          // Recalculate derived metrics with filtered conversions (like Facebook)
          "metrics.cvr": (r) => {
            const clicks = r.metrics?.clicks ?? 0;
            const conversions = r.metrics?.conversions ?? 0;
            return clicks > 0 ? conversions / clicks : null;
          },
          "metrics.cpa": (r) => {
            const cost = r.metrics?.cost ?? 0;
            const conversions = r.metrics?.conversions ?? 0;
            return conversions > 0 ? cost / conversions : null;
          },
          "metrics.roas": (r) => {
            const cost = r.metrics?.cost ?? 0;
            const conversionsValue = r.metrics?.conversions_value ?? 0;
            return cost > 0 ? conversionsValue / cost : null;
          }
        }
      });
    }

    if (config.includeTimePeriodDigest !== false) {
      pipeline.push({
        use: "timePeriodDigest",
        by: [
          'segments.date', // Always use segments.date for consistent output (normalized from segments.month if monthly)
          // Include customer.id and customer.descriptive_name for customer-level digest
          ...(attributes.includes('customer.id') ? ['customer.id', 'customer.descriptive_name'] : []),
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
        orderBy: [
          { field: dateSegment, dir: "ASC" },
        ],
      });
    }

    // Prune rows by default - users can set prune: false or pruneRows: false to see full results
    if (config.prune !== false && config.pruneRows !== false) {
      pipeline.push({ use: "pruneRows", mode: "empty", as: "rows_meta" });
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
