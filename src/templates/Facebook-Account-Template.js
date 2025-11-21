const { BaseTemplate } = require('./BaseTemplate');
const { normalizeActionList } = require('../fb/action-utils');
const { DEFAULT_FIELDS: CUSTOM_CONVERSION_FIELDS } = require('../fb/custom-conversions');

class FacebookAccountTemplate extends BaseTemplate {
  static getBaseReport() {
    return this.getBaseAccountReport();
  }

  static getBaseAccountReport() {
    return {
      entity: 'account',
      attributes: ['account.id', 'account.name'],
      metrics: [
        'metrics.spend',
        'metrics.impressions',
        'metrics.clicks',
        'metrics.reach',
        'metrics.frequency',
        'metrics.actions',
        'metrics.action_values',
        'metrics.conversions_api',  // API conversions field (will be parsed and exploded)
        'metrics.conversion_values_api',  // API conversion_values field (will be parsed and exploded)
      ],
      segments: [],
      breakdowns: [],
    };
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseAccountReport(),
      from_date: fromDate,
      to_date: toDate,
    };

    const conversionActions = normalizeActionList(
      config.conversionAction,
      '_total'
    );

    const conversionValueActions = normalizeActionList(
      config.conversionValueAction !== undefined
        ? config.conversionValueAction
        : config.conversionAction,
      '_total_value'
    );

    const conversionAggregates = {};
    // Build aggregates for conversions (sum multiple action types if array provided)
    // Can include both actions_by_type and conversions_by_type fields
    if (
      conversionActions.length === 0 ||
      (conversionActions.length === 1 && conversionActions[0] === '_total')
    ) {
      // Default: use _total from both sources
      conversionAggregates['metrics.conversions'] = {
        fn: 'SUM_EXPR',
        sources: [
          'metrics.actions_by_type._total',
          'metrics.conversions_by_type._total'
        ],
        as: 'metrics.conversions',
      };
    } else {
      // Sum specific action types from both actions_by_type and conversions_by_type
      conversionAggregates['metrics.conversions'] = {
        fn: 'SUM_EXPR',
        sources: conversionActions.flatMap((action) => {
          if (action === '_total') {
            return [
              'metrics.actions_by_type._total',
              'metrics.conversions_by_type._total'
            ];
          }
          // Try both sources - if field doesn't exist, it will be treated as 0
          return [
            `metrics.actions_by_type.${action}`,
            `metrics.conversions_by_type.${action}`
          ];
        }).filter(Boolean),
        as: 'metrics.conversions',
      };
    }

    // Build aggregates for conversion values
    // Can include both action_values_by_type and conversion_values_by_type fields
    const conversionValueAggregates = {};
    if (
      conversionValueActions.length === 0 ||
      (conversionValueActions.length === 1 && conversionValueActions[0] === '_total_value')
    ) {
      // Default: use _total_value from both sources
      conversionValueAggregates['metrics.conversions_value'] = {
        fn: 'SUM_EXPR',
        sources: [
          'metrics.action_values_by_type._total_value',
          'metrics.conversion_values_by_type._total_value'
        ],
        as: 'metrics.conversions_value',
      };
    } else {
      // Sum specific action value types from both action_values_by_type and conversion_values_by_type
      conversionValueAggregates['metrics.conversions_value'] = {
        fn: 'SUM_EXPR',
        sources: conversionValueActions.flatMap((action) => {
          if (action === '_total_value') {
            return [
              'metrics.action_values_by_type._total_value',
              'metrics.conversion_values_by_type._total_value'
            ];
          }
          // Try both sources - if field doesn't exist, it will be treated as 0
          return [
            `metrics.action_values_by_type.${action}`,
            `metrics.conversion_values_by_type.${action}`
          ];
        }).filter(Boolean),
        as: 'metrics.conversions_value',
      };
    }

    const attributes =
      Array.isArray(config.attributes) && config.attributes.length
        ? config.attributes
        : ['account.id', 'account.name'];

    const filterConfig = this.calculateFilters(config);

    const loadCustomConversionsStep = config.loadCustomConversions === false ? [] : [{
      use: 'loadCustomConversions',
      fields: config.customConversionFields || CUSTOM_CONVERSION_FIELDS,
      cacheTtlMs: config.customConversionCacheTtlMs,
      limit: config.customConversionLimit,
      maxPages: config.customConversionMaxPages,
    }];

    const pipeline = [
      {
        use: 'periods',
        baseline: { mode: config.periodsBaselineMode || 'previous_period' },
      },
      ...loadCustomConversionsStep,
      {
        use: 'actionsToColumns',
        debug: config.debugCustomConversions !== false,
        sources: [
          {
            from: 'metrics.actions',
            to: 'metrics.actions_by_type',
            totalAs: '_total',
            keepRaw: true,
          },
          {
            from: 'metrics.action_values',
            to: 'metrics.action_values_by_type',
            totalAs: '_total_value',
            keepRaw: true,
          },
          {
            from: 'metrics.conversions_api',
            to: 'metrics.conversions_by_type',
            totalAs: '_total',
            keepRaw: true,
          },
          {
            from: 'metrics.conversion_values_api',
            to: 'metrics.conversion_values_by_type',
            totalAs: '_total_value',
            keepRaw: true,
          },
        ],
      },
      {
        use: 'group',
        by: [...attributes],
        aggregates: {
          'metrics.spend': { fn: 'SUM', as: 'metrics.cost' },
          'metrics.clicks': { fn: 'SUM', as: 'metrics.clicks' },
          'metrics.impressions': { fn: 'SUM', as: 'metrics.impressions' },
          'metrics.reach': { fn: 'SUM', as: 'metrics.reach' },
          ...conversionAggregates,
          ...conversionValueAggregates,
          'metrics.actions_by_type.*': { fn: 'SUM' },
          'metrics.action_values_by_type.*': { fn: 'SUM' },
          // Auto-aggregate conversions and conversion_values from API
          'metrics.conversions_by_type.*': { fn: 'SUM' },
          'metrics.conversion_values_by_type.*': { fn: 'SUM' },
          ctr: {
            fn: 'RATIO',
            num: 'metrics.clicks',
            den: 'metrics.impressions',
            as: 'metrics.ctr',
          },
          cpc: {
            fn: 'RATIO',
            num: 'metrics.cost',
            den: 'metrics.clicks',
            as: 'metrics.cpc',
          },
          cvr: {
            fn: 'RATIO',
            num: 'metrics.conversions',
            den: 'metrics.clicks',
            as: 'metrics.cvr',
          },
          cpa: {
            fn: 'RATIO',
            num: 'metrics.cost',
            den: 'metrics.conversions',
            as: 'metrics.cpa',
          },
          roas: {
            fn: 'RATIO',
            num: 'metrics.conversions_value',
            den: 'metrics.cost',
            as: 'metrics.roas',
          },
          frequency: {
            fn: 'RATIO',
            num: 'metrics.impressions',
            den: 'metrics.reach',
            as: 'metrics.frequency',
          },
        },
        rollup: true,
        nulls: 'include',
        orderBy: [{ field: 'account.name', dir: 'ASC', nulls: 'last' }],
      },
      ...(filterConfig ? [{ use: 'filter', ...filterConfig }] : []),
      { use: 'applyActionLabels' },
      { use: 'shareOf', fields: ['metrics.cost'], includeRollup: false },
      {
        use: 'delta',
        baseline: { mode: config.periodsBaselineMode || 'previous_period' },
        partial: { policy: 'match_upto_day' },
        keys: ['account.id'],
        measures: [
          { field: 'metrics.cost', kind: 'absolute' },
          { field: 'metrics.impressions', kind: 'absolute' },
          { field: 'metrics.clicks', kind: 'absolute' },
          { field: 'metrics.reach', kind: 'absolute' },
          { field: 'metrics.conversions', kind: 'absolute' },
          { field: 'metrics.conversions_value', kind: 'absolute' },
          { field: 'metrics.ctr', kind: 'ratio', num: 'metrics.clicks', den: 'metrics.impressions' },
          { field: 'metrics.cpc', kind: 'ratio', num: 'metrics.cost', den: 'metrics.clicks' },
          { field: 'metrics.cvr', kind: 'ratio', num: 'metrics.conversions', den: 'metrics.clicks' },
          { field: 'metrics.cpa', kind: 'ratio', num: 'metrics.cost', den: 'metrics.conversions' },
          { field: 'metrics.roas', kind: 'ratio', num: 'metrics.conversions_value', den: 'metrics.cost' },
          { field: 'metrics.cost_share', kind: 'absolute' },
          { field: 'metrics.frequency', kind: 'ratio', num: 'metrics.impressions', den: 'metrics.reach' },
        ],
        emit: {
          previous: 'metrics_prev',
          delta_abs: 'metrics_delta',
          delta_pct: 'metrics_delta_pct',
        },
        policies: { pctOnZero: 'null' },
      },
      {
        use: 'rollupEnvelope',
        as: 'account_rollup',
        rollupKey: 'meta.rollup_key',
        rollupValue: 'ACCOUNT',
        copyFromFirst: attributes,
        sum: [
          'metrics.cost',
          'metrics.impressions',
          'metrics.clicks',
          'metrics.reach',
          'metrics.conversions',
          'metrics.conversions_value',
          'metrics_prev.cost',
          'metrics_prev.impressions',
          'metrics_prev.clicks',
          'metrics_prev.reach',
          'metrics_prev.conversions',
          'metrics_prev.conversions_value',
          'metrics.actions_by_type.*',
          'metrics.action_values_by_type.*',
          // Auto-sum conversions and conversion_values from API
          'metrics.conversions_by_type.*',
          'metrics.conversion_values_by_type.*',
        ],
        ratios: [
          { as: 'metrics.ctr', num: 'metrics.clicks', den: 'metrics.impressions' },
          { as: 'metrics.cpc', num: 'metrics.cost', den: 'metrics.clicks' },
          { as: 'metrics.cvr', num: 'metrics.conversions', den: 'metrics.clicks' },
          { as: 'metrics.cpa', num: 'metrics.cost', den: 'metrics.conversions' },
          { as: 'metrics.roas', num: 'metrics.conversions_value', den: 'metrics.cost' },
          { as: 'metrics.frequency', num: 'metrics.impressions', den: 'metrics.reach' },
          { as: 'metrics_prev.ctr', num: 'metrics_prev.clicks', den: 'metrics_prev.impressions' },
          { as: 'metrics_prev.cpc', num: 'metrics_prev.cost', den: 'metrics_prev.clicks' },
          { as: 'metrics_prev.cvr', num: 'metrics_prev.conversions', den: 'metrics_prev.clicks' },
          { as: 'metrics_prev.cpa', num: 'metrics_prev.cost', den: 'metrics_prev.conversions' },
          { as: 'metrics_prev.roas', num: 'metrics_prev.conversions_value', den: 'metrics_prev.cost' },
          { as: 'metrics_prev.frequency', num: 'metrics_prev.impressions', den: 'metrics_prev.reach' },
        ],
        expressions: {
          'metrics_delta.cost': (s) => (s.metrics?.cost ?? 0) - (s.metrics_prev?.cost ?? 0),
          'metrics_delta.impressions': (s) =>
            (s.metrics?.impressions ?? 0) - (s.metrics_prev?.impressions ?? 0),
          'metrics_delta.clicks': (s) =>
            (s.metrics?.clicks ?? 0) - (s.metrics_prev?.clicks ?? 0),
          'metrics_delta.reach': (s) => (s.metrics?.reach ?? 0) - (s.metrics_prev?.reach ?? 0),
          'metrics_delta.conversions': (s) =>
            (s.metrics?.conversions ?? 0) - (s.metrics_prev?.conversions ?? 0),
          'metrics_delta.conversions_value': (s) =>
            (s.metrics?.conversions_value ?? 0) - (s.metrics_prev?.conversions_value ?? 0),
          'metrics_delta.ctr': (s) => {
            const cur = s.metrics?.ctr;
            const prev = s.metrics_prev?.ctr;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.cpc': (s) => {
            const cur = s.metrics?.cpc;
            const prev = s.metrics_prev?.cpc;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.cvr': (s) => {
            const cur = s.metrics?.cvr;
            const prev = s.metrics_prev?.cvr;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.cpa': (s) => {
            const cur = s.metrics?.cpa;
            const prev = s.metrics_prev?.cpa;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.roas': (s) => {
            const cur = s.metrics?.roas;
            const prev = s.metrics_prev?.roas;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.frequency': (s) => {
            const cur = s.metrics?.frequency;
            const prev = s.metrics_prev?.frequency;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta_pct.cost': (s) => {
            const prev = s.metrics_prev?.cost;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.cost ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.impressions': (s) => {
            const prev = s.metrics_prev?.impressions;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.impressions ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.clicks': (s) => {
            const prev = s.metrics_prev?.clicks;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.clicks ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.reach': (s) => {
            const prev = s.metrics_prev?.reach;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.reach ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.conversions': (s) => {
            const prev = s.metrics_prev?.conversions;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.conversions ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.conversions_value': (s) => {
            const prev = s.metrics_prev?.conversions_value;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return (
              (s.metrics?.conversions_value ?? 0) - prev
            ) / Math.abs(prev);
          },
          'metrics_delta_pct.ctr': (s) => {
            const prev = s.metrics_prev?.ctr;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.ctr;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.cpc': (s) => {
            const prev = s.metrics_prev?.cpc;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.cpc;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.cvr': (s) => {
            const prev = s.metrics_prev?.cvr;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.cvr;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.cpa': (s) => {
            const prev = s.metrics_prev?.cpa;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.cpa;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.roas': (s) => {
            const prev = s.metrics_prev?.roas;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.roas;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.frequency': (s) => {
            const prev = s.metrics_prev?.frequency;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.frequency;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
        },
      },
    ];

    return new FacebookAccountTemplate({
      credentials,
      report,
      pipeline,
      output: config.output || { mode: 'envelope', include: ['periods', 'report', 'account_rollup'] },
    });
  }

  /**
   * Trends analysis method - optimized for LLM consumption with smart granularity
   * See FacebookCampaignTemplate.forTrends() for detailed documentation
   */
  static forTrends(credentials, fromDate, toDate, config = {}) {
    // Calculate date range length to determine granularity
    const parseDate = (str) => {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };
    const from = parseDate(fromDate);
    const to = parseDate(toDate);
    const daysDiff = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
    
    // Smart granularity: daily for short periods, weekly for medium/long periods
    let timeIncrement = 1;
    let granularityLabel = 'daily';
    
    if (config.granularity) {
      if (config.granularity === 'daily') {
        timeIncrement = 1;
        granularityLabel = 'daily';
      } else if (config.granularity === 'weekly') {
        timeIncrement = 7;
        granularityLabel = 'weekly';
      }
    } else {
      if (daysDiff <= 7) {
        timeIncrement = 1;
        granularityLabel = 'daily';
      } else {
        timeIncrement = 7;
        granularityLabel = 'weekly';
      }
    }

    const baseReport = this.getBaseAccountReport();
    const report = {
      ...baseReport,
      from_date: fromDate,
      to_date: toDate,
      ...(config.constraints && { constraints: config.constraints }),
      segments: ['segments.date', ...(baseReport.segments || [])],
      parameters: {
        ...(baseReport.parameters || {}),
        time_increment: timeIncrement,
      },
    };

    // Default attributes for account level
    const defaultAttributes = ['account.id', 'account.name'];
    const attributes = config.attributes && config.attributes.length > 0
      ? config.attributes
      : defaultAttributes;

    // Build conversion aggregates
    const conversionActions = normalizeActionList(
      config.conversionAction,
      "_total"
    );
    
    const includeActions = config.includeActions && Array.isArray(config.includeActions) && config.includeActions.length > 0
      ? config.includeActions.filter(action => action !== "*")
      : null;

    const conversionValueActions = normalizeActionList(
      config.conversionValueAction !== undefined
        ? config.conversionValueAction
        : config.conversionAction,
      "_total_value"
    );
    
    const conversionAggregates = {};
    if (conversionActions.length === 0 || (conversionActions.length === 1 && conversionActions[0] === "_total")) {
      conversionAggregates["metrics.conversions"] = {
        fn: "SUM_EXPR",
        sources: [
          "metrics.actions_by_type._total",
          "metrics.conversions_by_type._total"
        ],
        as: "metrics.conversions"
      };
    } else {
      conversionAggregates["metrics.conversions"] = {
        fn: "SUM_EXPR",
        sources: conversionActions.flatMap(action => {
          if (action === "_total") {
            return [
              "metrics.actions_by_type._total",
              "metrics.conversions_by_type._total"
            ];
          }
          return [
            `metrics.actions_by_type.${action}`,
            `metrics.conversions_by_type.${action}`
          ];
        }).filter(Boolean),
        as: "metrics.conversions"
      };
    }
    
    const conversionValueAggregates = {};
    if (conversionValueActions.length === 0 || (conversionValueActions.length === 1 && conversionValueActions[0] === "_total_value")) {
      conversionValueAggregates["metrics.conversions_value"] = {
        fn: "SUM_EXPR",
        sources: [
          "metrics.action_values_by_type._total_value",
          "metrics.conversion_values_by_type._total_value"
        ],
        as: "metrics.conversions_value"
      };
    } else {
      conversionValueAggregates["metrics.conversions_value"] = {
        fn: "SUM_EXPR",
        sources: conversionValueActions.flatMap(action => {
          if (action === "_total_value") {
            return [
              "metrics.action_values_by_type._total_value",
              "metrics.conversion_values_by_type._total_value"
            ];
          }
          return [
            `metrics.action_values_by_type.${action}`,
            `metrics.conversion_values_by_type.${action}`
          ];
        }).filter(Boolean),
        as: "metrics.conversions_value"
      };
    }

    const loadCustomConversionsStep = config.loadCustomConversions === false ? [] : [{
      use: "loadCustomConversions",
      fields: config.customConversionFields || CUSTOM_CONVERSION_FIELDS,
      cacheTtlMs: config.customConversionCacheTtlMs,
      limit: config.customConversionLimit,
      maxPages: config.customConversionMaxPages,
    }];

    const filterConfig = this.calculateFilters(config);
    const baselineMode = config.baselineMode || "previous_period";

    const pipeline = [
      { use: "periods", baseline: { mode: baselineMode } },
      ...loadCustomConversionsStep,
      { 
        use: 'actionsToColumns',
        debug: config.debugCustomConversions !== false,
        sources: [
          { from: 'metrics.actions', to: 'metrics.actions_by_type', totalAs: '_total', keepRaw: true },
          { from: 'metrics.action_values', to: 'metrics.action_values_by_type', totalAs: '_total_value', keepRaw: true },
          { from: 'metrics.conversions_api', to: 'metrics.conversions_by_type', totalAs: '_total', keepRaw: true },
          { from: 'metrics.conversion_values_api', to: 'metrics.conversion_values_by_type', totalAs: '_total_value', keepRaw: true },
        ]
      },
      ...(includeActions ? [{
        use: 'filterActions',
        includeActions: includeActions,
      }] : []),
      { 
        use: "group", 
        by: [
          ...attributes,
          'segments.date',
        ],
        aggregates: {
          "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          ...conversionAggregates,
          ...conversionValueAggregates,
          "metrics.spend": { fn: "SUM", as: "metrics.cost" },
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
          { field: "account.name", dir: "ASC" },
        ],
      },
      ...(filterConfig ? [{ use: "filter", ...filterConfig }] : []),
      { use: "applyActionLabels" },
      ...(config.includeTimePeriodDigest !== false ? [{
        use: "timePeriodDigest",
        by: ['segments.date'], // Account level - just group by date
        aggregates: {
          "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
          "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
          "metrics.cost": { fn: "SUM", as: "metrics.cost" },
          "ctr": { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
          "cpc": { fn: "RATIO", num: "metrics.cost", den: "metrics.clicks", as: "metrics.cpc" },
          "cvr": { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
          "cpa": { fn: "RATIO", num: "metrics.cost", den: "metrics.conversions", as: "metrics.cpa" },
          "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
        },
        orderBy: [
          { field: "segments.date", dir: "ASC" },
        ],
      }] : []),
    ];

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

module.exports = {
  FacebookAccountTemplate,
};


