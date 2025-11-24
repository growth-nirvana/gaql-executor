const { BaseTemplate } = require('./BaseTemplate');
const { normalizeActionList } = require('../fb/action-utils');
const { DEFAULT_FIELDS: CUSTOM_CONVERSION_FIELDS } = require('../fb/custom-conversions');

class FacebookCampaignTemplate extends BaseTemplate {
  
  static getBaseReport() {
    // Alias for getBaseCampaignReport to work with BaseTemplate
    return this.getBaseCampaignReport();
  }

  static getBaseCampaignReport() {
    return {
      entity: 'campaign',
      attributes: [
        'account.id',
        'account.name',
        'campaign.id',
        'campaign.name',
        'campaign.objective',
      ],
      metrics: [
        'metrics.spend',
        'metrics.clicks',
        'metrics.impressions',
        'metrics.reach',
        'metrics.frequency',
        "metrics.actions",
        "metrics.action_values",
        "metrics.conversions_api",  // API conversions field (will be parsed and exploded)
        "metrics.conversion_values_api",  // API conversion_values field (will be parsed and exploded)
      ],
      segments: [],
      breakdowns: [],
    } 
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseCampaignReport(),
      from_date: fromDate,
      to_date: toDate,
    };

    // Allow configurable conversion action types (defaults to _total)
    // Examples:
    //   config.conversionAction = "purchase"
    //   config.conversionAction = ["purchase", "offsite_conversion_fb_pixel_purchase"]
    //   config.conversionValueAction = ["purchase", "onsite_web_purchase"]
    //
    // Action names are automatically normalised to lowercase snake_case so you can
    // pass either Meta's raw action name or the already-normalised key.
    const conversionActions = normalizeActionList(
      config.conversionAction,
      "_total"
    );
    
    // Allow configurable action filtering (which actions to include in output)
    // Examples:
    //   config.includeActions = ["purchase", "add_to_cart", "lead"]  // Include only these actions
    //   config.includeActions = null or undefined                    // Include all actions (default)
    //   config.includeActions = ["*"]                                 // Include all actions (explicit)
    //
    // Action names are automatically normalized. Always includes "_total" and "_total_value".
    // If not specified or empty array, all actions are included.
    const includeActions = config.includeActions && Array.isArray(config.includeActions) && config.includeActions.length > 0
      ? config.includeActions.filter(action => action !== "*")  // Remove wildcard if present
      : null;  // null = include all
    const conversionValueActions = normalizeActionList(
      config.conversionValueAction !== undefined
        ? config.conversionValueAction
        : config.conversionAction,
      "_total_value"
    );
    
    // Build aggregates for conversions (sum multiple action types if array provided)
    // Can include both actions_by_type and conversions_by_type fields
    const conversionAggregates = {};
    if (conversionActions.length === 0 || (conversionActions.length === 1 && conversionActions[0] === "_total")) {
      // Default: use _total from both sources
      conversionAggregates["metrics.conversions"] = {
        fn: "SUM_EXPR",
        sources: [
          "metrics.actions_by_type._total",
          "metrics.conversions_by_type._total"
        ],
        as: "metrics.conversions"
      };
    } else {
      // Sum specific action types from both actions_by_type and conversions_by_type
      conversionAggregates["metrics.conversions"] = {
        fn: "SUM_EXPR",
        sources: conversionActions.flatMap(action => {
          if (action === "_total") {
            return [
              "metrics.actions_by_type._total",
              "metrics.conversions_by_type._total"
            ];
          }
          // Try both sources - if field doesn't exist, it will be treated as 0
          return [
            `metrics.actions_by_type.${action}`,
            `metrics.conversions_by_type.${action}`
          ];
        }).filter(Boolean),
        as: "metrics.conversions"
      };
    }
    
    // Build aggregates for conversion values
    // Can include both action_values_by_type and conversion_values_by_type fields
    const conversionValueAggregates = {};
    if (conversionValueActions.length === 0 || (conversionValueActions.length === 1 && conversionValueActions[0] === "_total_value")) {
      // Default: use _total_value from both sources
      conversionValueAggregates["metrics.conversions_value"] = {
        fn: "SUM_EXPR",
        sources: [
          "metrics.action_values_by_type._total_value",
          "metrics.conversion_values_by_type._total_value"
        ],
        as: "metrics.conversions_value"
      };
    } else {
      // Sum specific action value types from both action_values_by_type and conversion_values_by_type
      conversionValueAggregates["metrics.conversions_value"] = {
        fn: "SUM_EXPR",
        sources: conversionValueActions.flatMap(action => {
          if (action === "_total_value") {
            return [
              "metrics.action_values_by_type._total_value",
              "metrics.conversion_values_by_type._total_value"
            ];
          }
          // Try both sources - if field doesn't exist, it will be treated as 0
          return [
            `metrics.action_values_by_type.${action}`,
            `metrics.conversion_values_by_type.${action}`
          ];
        }).filter(Boolean),
        as: "metrics.conversions_value"
      };
    }

    // Helper function to get standard include fields for topN
    const getTopNInclude = () => [
      "metrics.cost",
      "metrics.clicks",
      "metrics.impressions",
      "metrics.reach",
      "metrics.frequency",
      "metrics.conversions",
      "metrics.conversions_value",
      "metrics.ctr",
      "metrics.cpc",
      "metrics.cvr",
      "metrics.cpa",
      "metrics.roas",
      "metrics.cost_share",
      "metrics_prev.cost",
      "metrics_prev.clicks",
      "metrics_prev.impressions",
      "metrics_prev.reach",
      "metrics_prev.frequency",
      "metrics_prev.conversions",
      "metrics_prev.conversions_value",
      "metrics_prev.ctr",
      "metrics_prev.cpc",
      "metrics_prev.cvr",
      "metrics_prev.cpa",
      "metrics_prev.roas",
      "metrics_prev.cost_share",
      // Auto-include all action types dynamically
      "metrics.actions_by_type.*",
      "metrics.action_values_by_type.*",
      // Auto-include conversions and conversion_values from API
      "metrics.conversions_by_type.*",
      "metrics.conversion_values_by_type.*",
    ];

    // Configuration for topN steps
    // config.topN can be:
    //   - Array of strings: ['cost', 'impressions', 'cpa_worseners', ...] - only include these
    //   - Object: { enabled: [...], n: 20 } - specify enabled and n
    //   - undefined/null: include all (default)
    const topNConfig = config.topN || {};
    const topNEnabled = Array.isArray(topNConfig) 
      ? topNConfig 
      : (topNConfig.enabled || null); // null = all enabled
    const topNN = topNConfig.n || 20;
    
    const isTopNEnabled = (name) => topNEnabled === null || topNEnabled.includes(name);

    // Build topN steps array
    const topNSteps = [];

    // Impact-based topN (existing)
    if (isTopNEnabled('cpa_worseners')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.cpa_worsen_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_cpa_worseners_by_impact",
      });
    }

    if (isTopNEnabled('cpa_improvers')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.cpa_improve_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_cpa_improvers_by_impact",
      });
    }

    if (isTopNEnabled('cvr_drops')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.cvr_drop_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_cvr_drops_by_impact",
      });
    }

    if (isTopNEnabled('cvr_improvers')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.cvr_improve_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_cvr_improvers_by_impact",
      });
    }

    if (isTopNEnabled('cpc_rises')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.cpc_rise_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_cpc_rises_by_impact",
      });
    }

    if (isTopNEnabled('cpc_falls')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.cpc_fall_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_cpc_falls_by_impact",
      });
    }

    if (isTopNEnabled('roas_worseners')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.roas_worsen_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_roas_worseners_by_impact",
      });
    }

    if (isTopNEnabled('roas_improvers')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "diagnostics.roas_improve_impact",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_roas_improvers_by_impact",
      });
    }

    // Metric-based topN (new)
    if (isTopNEnabled('cost')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "metrics.cost",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_by_cost",
      });
    }

    if (isTopNEnabled('impressions')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "metrics.impressions",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_by_impressions",
      });
    }

    if (isTopNEnabled('clicks')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "metrics.clicks",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_by_clicks",
      });
    }

    if (isTopNEnabled('cpa')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "metrics.cpa",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_by_cpa",
        direction: "asc", // Lower CPA is better
      });
    }

    if (isTopNEnabled('roas')) {
      topNSteps.push({
        use: "topN",
        by: [...this.calculateGroupByAttributes(config)],
        metric: "metrics.roas",
        n: topNN,
        include: getTopNInclude(),
        excludeRollup: true,
        as: "top_n_by_roas",
        direction: "desc", // Higher ROAS is better
      });
    }

    const loadCustomConversionsStep = config.loadCustomConversions === false ? [] : [{
      use: "loadCustomConversions",
      fields: config.customConversionFields || CUSTOM_CONVERSION_FIELDS,
      cacheTtlMs: config.customConversionCacheTtlMs,
      limit: config.customConversionLimit,
      maxPages: config.customConversionMaxPages,
    }];

    const filterConfig = this.calculateFilters(config);

    return new FacebookCampaignTemplate({
      credentials,
      report,
      pipeline: [
        { use: "periods", baseline: { mode: config.periodsBaselineMode || "previous_period" } },
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
        // Filter actions if includeActions is specified
        ...(includeActions ? [{
          use: 'filterActions',
          includeActions: includeActions,
        }] : []),
        { 
          use: "group", 
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          aggregates: {
            "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
            "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
            "metrics.reach": { fn: "SUM", as: "metrics.reach" },
            "metrics.frequency": { fn: "SUM", as: "metrics.frequency" },
            ...conversionAggregates,
            ...conversionValueAggregates,
            // Sum spend and alias as cost for consistency with Google Ads templates
            "metrics.spend": { fn: "SUM", as: "metrics.cost" },
            // Auto-aggregate all action types dynamically (e.g., purchase, add_to_cart, etc.)
            "metrics.actions_by_type.*": { fn: "SUM" },
            "metrics.action_values_by_type.*": { fn: "SUM" },
            // Auto-aggregate conversions and conversion_values from API
            "metrics.conversions_by_type.*": { fn: "SUM" },
            "metrics.conversion_values_by_type.*": { fn: "SUM" },
            // derived metrics
            "ctr": { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
            "cpc": { fn: "RATIO", num: "metrics.cost", den: "metrics.clicks", as: "metrics.cpc" },
            "cvr": { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
            "cpa": { fn: "RATIO", num: "metrics.cost", den: "metrics.conversions", as: "metrics.cpa" },
            "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
            // Calculate frequency from impressions/reach (recalculated after aggregation)
            "frequency_recalc": { fn: "RATIO", num: "metrics.impressions", den: "metrics.reach", as: "metrics.frequency_recalc" },
          },
          rollup: true,
          nulls: "include",
          orderBy: [{ field: "campaign.name", dir: "ASC" }],
        },
        ...(filterConfig ? [{ use: "filter", ...filterConfig }] : []),
        { use: "applyActionLabels" },
        { use: "shareOf", fields: ["metrics.cost"], includeRollup: false, },
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
          partial: { policy: "match_upto_day" },
          keys: [
            'account.id',
            'campaign.id',
          ],
          measures: [
            { field: "metrics.cost", kind: "absolute" },
            { field: "metrics.clicks", kind: "absolute" },
            { field: "metrics.impressions", kind: "absolute" },
            { field: "metrics.reach", kind: "absolute" },
            { field: "metrics.frequency", kind: "absolute" },
            { field: "metrics.conversions", kind: "absolute" },
            { field: "metrics.conversions_value", kind: "absolute" },
            { field: "metrics.ctr", kind: "ratio", num: "metrics.clicks", den: "metrics.impressions" },
            { field: "metrics.cpc", kind: "ratio", num: "metrics.cost", den: "metrics.clicks" },
            { field: "metrics.cvr", kind: "ratio", num: "metrics.conversions", den: "metrics.clicks" },
            { field: "metrics.cpa", kind: "ratio", num: "metrics.cost", den: "metrics.conversions" },
            { field: "metrics.roas", kind: "ratio", num: "metrics.conversions_value", den: "metrics.cost" },
            { field: "metrics.cost_share", kind: "absolute" },
          ],
          emit: {
            previous: "metrics_prev",
            delta_abs: "metrics_delta",
            delta_pct: "metrics_delta_pct"
          },
          policies: { pctOnZero: "null" }
        },
        {
          use: "derive",
          prefix: "diagnostics",
          add: {
            // Basic deltas
            "cpa_delta": (r, H) => (r.metrics?.cpa ?? null) - (r.metrics_prev?.cpa ?? null),
            "cvr_delta": (r, H) => (r.metrics?.cvr ?? null) - (r.metrics_prev?.cvr ?? null),
            "cpc_delta": (r, H) => (r.metrics?.cpc ?? null) - (r.metrics_prev?.cpc ?? null),
      
            // Impact scores
            "cpa_worsen_impact": (r, H) => {
              const costCur = r.metrics?.cost ?? 0;
              const convCur = r.metrics?.conversions ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;
              const convPre = r.metrics_prev?.conversions ?? 0;

              const hasCur = convCur > 0;
              const hasPre = convPre > 0;

              const cpaCur = hasCur ? costCur / convCur : null;
              const cpaPre = hasPre ? costPre / convPre : null;

              if (hasCur && hasPre) {
                return H.pos(cpaCur - cpaPre) * costCur;
              }

              if (!hasPre && hasCur) {
                return 0;
              }

              if (hasPre && !hasCur) {
                return costCur;
              }

              return 0;
            },

            "cpa_improve_impact": (r, H) => {
              const costCur = r.metrics?.cost ?? 0;
              const convCur = r.metrics?.conversions ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;
              const convPre = r.metrics_prev?.conversions ?? 0;

              const hasCur = convCur > 0;
              const hasPre = convPre > 0;

              const cpaCur = hasCur ? costCur / convCur : null;
              const cpaPre = hasPre ? costPre / convPre : null;

              if (hasCur && hasPre) {
                return H.pos((cpaPre ?? 0) - (cpaCur ?? 0)) * costCur;
              }

              if (!hasPre && hasCur) {
                return costCur;
              }

              return 0;
            },

            "cvr_drop_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const convCur = r.metrics?.conversions ?? 0;
              const convPre = r.metrics_prev?.conversions ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              const cvrCur = hasCur ? H.clamp(convCur / clicksCur, 0, 1) : null;
              const cvrPre = hasPre ? H.clamp(convPre / clicksPre, 0, 1) : null;

              if (hasCur && hasPre) {
                const drop = H.pos((cvrPre ?? 0) - (cvrCur ?? 0));
                return drop * clicksCur;
              }

              if (!hasCur) return 0;
              if (hasCur && !hasPre) return 0;

              return 0;
            },

            "cvr_improve_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const convCur = r.metrics?.conversions ?? 0;
              const convPre = r.metrics_prev?.conversions ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              const cvrCur = hasCur ? H.clamp(convCur / clicksCur, 0, 1) : null;
              const cvrPre = hasPre ? H.clamp(convPre / clicksPre, 0, 1) : null;

              if (hasCur && hasPre) {
                const gain = H.pos((cvrCur ?? 0) - (cvrPre ?? 0));
                return gain * clicksCur;
              }

              if (hasCur && !hasPre && cvrCur != null) {
                return cvrCur * clicksCur;
              }

              if (!hasCur && hasPre) return 0;

              return 0;
            },

            "cpc_rise_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const costCur = r.metrics?.cost ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              const cpcCur = hasCur ? Math.max(costCur / clicksCur, 0) : null;
              const cpcPre = hasPre ? Math.max(costPre / clicksPre, 0) : null;

              if (hasCur && hasPre) {
                const rise = H.pos((cpcCur ?? 0) - (cpcPre ?? 0));
                return rise * clicksCur;
              }

              if (!hasCur) return 0;
              if (hasCur && !hasPre) return 0;

              return 0;
            },

            "cpc_fall_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const costCur = r.metrics?.cost ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              const cpcCur = hasCur ? Math.max(costCur / clicksCur, 0) : null;
              const cpcPre = hasPre ? Math.max(costPre / clicksPre, 0) : null;

              if (hasCur && hasPre) {
                const fall = H.pos((cpcPre ?? 0) - (cpcCur ?? 0));
                return fall * clicksCur;
              }
              if (!hasCur) return 0;
              if (hasCur && !hasPre) return 0;
              return 0;
            },

            "roas_worsen_impact": (r, H) => {
              const costCur = r.metrics?.cost ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;
              const valueCur = r.metrics?.conversions_value ?? 0;
              const valuePre = r.metrics_prev?.conversions_value ?? 0;

              const hasCur = costCur > 0;
              const hasPre = costPre > 0;

              const roasCur = hasCur ? (valueCur / costCur) : null;
              const roasPre = hasPre ? (valuePre / costPre) : null;

              if (hasCur && hasPre) {
                // ROAS worsened: calculate lost revenue opportunity
                const worsen = H.pos((roasPre ?? 0) - (roasCur ?? 0));
                return worsen * costCur;
              }

              if (!hasPre && hasCur) {
                // No previous period: no impact to measure
                return 0;
              }

              if (hasPre && !hasCur) {
                // Had ROAS before, now no spend: lost opportunity
                return (roasPre ?? 0) * costCur;
              }

              return 0;
            },

            "roas_improve_impact": (r, H) => {
              const costCur = r.metrics?.cost ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;
              const valueCur = r.metrics?.conversions_value ?? 0;
              const valuePre = r.metrics_prev?.conversions_value ?? 0;

              const hasCur = costCur > 0;
              const hasPre = costPre > 0;

              const roasCur = hasCur ? (valueCur / costCur) : null;
              const roasPre = hasPre ? (valuePre / costPre) : null;

              if (hasCur && hasPre) {
                // ROAS improved: calculate gained revenue opportunity
                const improve = H.pos((roasCur ?? 0) - (roasPre ?? 0));
                return improve * costCur;
              }

              if (!hasPre && hasCur && roasCur != null) {
                // No previous period but has current ROAS: full value
                return roasCur * costCur;
              }

              if (!hasCur && hasPre) {
                // Had ROAS before, now no spend: no improvement
                return 0;
              }

              return 0;
            },
      
            "volume_loss_conv": (r, H) => H.pos((r.metrics_prev?.clicks ?? 0) - (r.metrics?.clicks ?? 0)) * (r.metrics_prev?.cvr ?? 0),
            "zero_conv_waste": (r, H) => ((r.metrics?.conversions ?? 0) === 0 && (r.metrics?.clicks ?? 0) >= 20) ? 1 : 0,
            "volume_gain_conv": (r, H) => H.pos((r.metrics?.clicks ?? 0) - (r.metrics_prev?.clicks ?? 0)) * (r.metrics_prev?.cvr ?? 0),
          },
        },
        // Add all configured topN steps
        ...topNSteps,
        {
          use: "rollupEnvelope",
          as: "account_rollup",
          rollupKey: "meta.rollup_key",
          rollupValue: "ACCOUNT",
          copyFromFirst: ["account.id", "account.name"],
        
          // 1) Sum bases for current + previous (with wildcard support for actions)
          sum: [
            "metrics.cost","metrics.clicks","metrics.impressions","metrics.conversions","metrics.conversions_value",
            "metrics_prev.cost","metrics_prev.clicks","metrics_prev.impressions","metrics_prev.conversions","metrics_prev.conversions_value",
            // Auto-sum all action types dynamically
            "metrics.actions_by_type.*",
            "metrics.action_values_by_type.*",
            // Auto-sum conversions and conversion_values from API
            "metrics.conversions_by_type.*",
            "metrics.conversion_values_by_type.*"
          ],
        
          // 2) Compute ratios from summed bases (never average ratios)
          ratios: [
            { as: "metrics.ctr", num: "metrics.clicks", den: "metrics.impressions" },
            { as: "metrics.cpc", num: "metrics.cost", den: "metrics.clicks" },
            { as: "metrics.cvr", num: "metrics.conversions", den: "metrics.clicks" },
            { as: "metrics.cpa", num: "metrics.cost", den: "metrics.conversions" },
            { as: "metrics.roas", num: "metrics.conversions_value", den: "metrics.cost" },
        
            { as: "metrics_prev.ctr", num: "metrics_prev.clicks", den: "metrics_prev.impressions" },
            { as: "metrics_prev.cpc", num: "metrics_prev.cost", den: "metrics_prev.clicks" },
            { as: "metrics_prev.cvr", num: "metrics_prev.conversions", den: "metrics_prev.clicks" },
            { as: "metrics_prev.cpa", num: "metrics_prev.cost", den: "metrics_prev.conversions" },
            { as: "metrics_prev.roas", num: "metrics_prev.conversions_value", den: "metrics_prev.cost" },
          ],
        
          // 3) Deltas + pct deltas (pctOnZero => null)
          expressions: {
            // helpers
            "_util.safe": (s) => ({
              num: (x) => Number.isFinite(+x) ? +x : 0,
              pct: (cur, prev) => (prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev)),
              diff: (cur, prev) => ((Number.isFinite(+cur) ? +cur : 0) - (Number.isFinite(+prev) ? +prev : 0)),
            }),
        
            // absolute deltas (bases)
            "metrics_delta.cost": (s) => s._util?.safe.diff(s.metrics?.cost, s.metrics_prev?.cost),
            "metrics_delta.clicks": (s) => s._util?.safe.diff(s.metrics?.clicks, s.metrics_prev?.clicks),
            "metrics_delta.impressions": (s) => s._util?.safe.diff(s.metrics?.impressions, s.metrics_prev?.impressions),
            "metrics_delta.conversions": (s) => s._util?.safe.diff(s.metrics?.conversions, s.metrics_prev?.conversions),
            "metrics_delta.conversions_value": (s) => s._util?.safe.diff(s.metrics?.conversions_value, s.metrics_prev?.conversions_value),
        
            // absolute deltas (ratios)
            "metrics_delta.ctr": (s) => s._util?.safe.diff(s.metrics?.ctr, s.metrics_prev?.ctr),
            "metrics_delta.cpc": (s) => s._util?.safe.diff(s.metrics?.cpc, s.metrics_prev?.cpc),
            "metrics_delta.cvr": (s) => s._util?.safe.diff(s.metrics?.cvr, s.metrics_prev?.cvr),
            "metrics_delta.cpa": (s) => s._util?.safe.diff(s.metrics?.cpa, s.metrics_prev?.cpa),
            "metrics_delta.roas": (s) => s._util?.safe.diff(s.metrics?.roas, s.metrics_prev?.roas),
        
            // percent deltas (bases)
            "metrics_delta_pct.cost": (s) => s._util?.safe.pct(s.metrics?.cost, s.metrics_prev?.cost),
            "metrics_delta_pct.clicks": (s) => s._util?.safe.pct(s.metrics?.clicks, s.metrics_prev?.clicks),
            "metrics_delta_pct.impressions": (s) => s._util?.safe.pct(s.metrics?.impressions, s.metrics_prev?.impressions),
            "metrics_delta_pct.conversions": (s) => s._util?.safe.pct(s.metrics?.conversions, s.metrics_prev?.conversions),
            "metrics_delta_pct.conversions_value": (s) => s._util?.safe.pct(s.metrics?.conversions_value, s.metrics_prev?.conversions_value),
        
            // percent deltas (ratios)
            "metrics_delta_pct.ctr": (s) => s._util?.safe.pct(s.metrics?.ctr, s.metrics_prev?.ctr),
            "metrics_delta_pct.cpc": (s) => s._util?.safe.pct(s.metrics?.cpc, s.metrics_prev?.cpc),
            "metrics_delta_pct.cvr": (s) => s._util?.safe.pct(s.metrics?.cvr, s.metrics_prev?.cvr),
            "metrics_delta_pct.cpa": (s) => s._util?.safe.pct(s.metrics?.cpa, s.metrics_prev?.cpa),
            "metrics_delta_pct.roas": (s) => s._util?.safe.pct(s.metrics?.roas, s.metrics_prev?.roas),
          }
        },
        { use: "pruneRows", when: { maxRows: 50 }, mode: "empty", as: "rows_meta" }
      ],
      output: {
        mode: "envelope",
        include: ["periods"],
      }
    });
  }

  static forDimension(credentials, fromDate, toDate, config = {}) {
    // Default campaign entity attributes (all available fields from /campaigns endpoint)
    const defaultCampaignAttributes = [
      'account.id',
      'campaign.id',
      'campaign.name',
      'campaign.objective',
      'campaign.status',
      'campaign.configured_status',
      'campaign.effective_status',
      'campaign.buying_type',
      'campaign.budget_remaining',
      'campaign.daily_budget',
      'campaign.lifetime_budget',
      'campaign.spend_cap',
      'campaign.start_time',
      'campaign.stop_time',
      'campaign.created_time',
      'campaign.updated_time',
      'campaign.bid_strategy',
      'campaign.pacing_type',
      'campaign.special_ad_categories',
      'campaign.special_ad_category',
      'campaign.special_ad_category_country',
      'campaign.source_campaign_id',
      'campaign.boosted_object_id',
      'campaign.topline_id',
      'campaign.can_create_brand_lift_study',
      'campaign.can_use_spend_cap',
      'campaign.has_secondary_skadnetwork_reporting',
      'campaign.is_skadnetwork_attribution',
      'campaign.smart_promotion_type',
      'campaign.budget_rebalance_flag',
      'campaign.last_budget_toggling_time',
      'campaign.primary_attribution',
    ];

    // If no attributes specified, use all default campaign entity attributes
    // This ensures both the report and grouping use all attributes
    const finalConfig = {
      ...config,
      attributes: config.attributes && config.attributes.length > 0 
        ? config.attributes 
        : defaultCampaignAttributes,
    };

    const baseReport = this.getBaseCampaignReport();
    const report = {
      ...baseReport,
      // Use attributes from config (which now defaults to all campaign entity attributes)
      attributes: finalConfig.attributes,
      // Remove metrics for dimension queries - this triggers use of /campaigns endpoint
      metrics: [],
      from_date: fromDate,
      to_date: toDate,
      ...(finalConfig.constraints && { constraints: finalConfig.constraints }),
      segments: finalConfig.segments !== undefined ? finalConfig.segments : (baseReport.segments || []),
    };

    // Simplified pipeline - similar to change event template
    // No metrics, just grouping for dimensions
    const pipeline = [
      { use: "statusesReadable" },
    ];

    // Add derived dimension steps if configured (before grouping)
    // This allows creating new dimensions from existing attributes
    const derivedDimensions = this.calculateDerivedDimensions(finalConfig);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    // Group by selected attributes (no aggregates - just dimension values)
    // For dimension queries, include ALL attributes in the 'by' array so they're preserved in output
    // Use report.attributes (which includes all defaults) rather than just calculateGroupByAttributes
    const groupByAttributes = finalConfig.attributes && finalConfig.attributes.length > 0
      ? finalConfig.attributes  // Use all requested attributes
      : report.attributes;       // Fallback to report attributes (which includes defaults)
    
    pipeline.push({ 
      use: "group", 
      by: groupByAttributes,
      aggregates: {}, // No metrics - just grouping for dimensions
      rollup: false,
      nulls: "include",
      // Default ordering by campaign name
      orderBy: finalConfig.orderBy || [{ field: "campaign.name", dir: "ASC" }],
    });

    // Add filter step if filters are configured
    const filterConfig = this.calculateFilters(finalConfig);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: "flat", // Flat output - just the results array
      }
    });
  }

  /**
   * Trends analysis method - optimized for LLM consumption with smart granularity
   * 
   * Features:
   * - Smart granularity: daily for <=7 days, weekly for >7 days (keeps token footprint small)
   * - Time-series data: returns chronological rows showing how metrics change over time
   * - Time period digest: optional rollup per time increment (one row per date) for compact LLM consumption
   * - Period context: includes periods meta for baseline reference (no delta calculations)
   * - Date ordering: chronological order for trend visibility
   * 
   * Use cases:
   * - Pinpoint when something happened (e.g., "CPA spiked on Jan 15")
   * - Identify trends and patterns over time
   * - Seasonality detection (weekly patterns)
   * - Day-by-day or week-by-week performance analysis
   * 
   * Note: This method focuses on time-series data, not period-over-period comparisons.
   * For period comparisons, use forPerformanceAnalysis() instead.
   * 
   * @param {Object} credentials - Facebook API credentials
   * @param {string} fromDate - Start date (YYYY-MM-DD)
   * @param {string} toDate - End date (YYYY-MM-DD)
   * @param {Object} config - Configuration options
   * @param {string[]} config.attributes - Attributes to group by (default: campaign.id, campaign.name)
   * @param {string} config.granularity - Override auto granularity: 'daily' | 'weekly'
   * @param {string} config.baselineMode - Period context mode (for meta.periods only): 'previous_period' | 'previous_month_same_span' | 'previous_year' | 'none' (default: 'previous_period')
   * @param {boolean} config.includeTimePeriodDigest - Include time period digest in meta (default: true). Digest aggregates all campaigns per date for compact LLM consumption.
   * @param {Array} config.constraints - Query-level constraints
   * @param {Array} config.filters - Post-processing filters (applied before digest calculation)
   */
  static forTrends(credentials, fromDate, toDate, config = {}) {
    // Calculate date range length to determine granularity
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
    
    // Smart granularity: daily for short periods, weekly for medium/long periods
    let timeIncrement = 1; // default daily
    let granularityLabel = 'daily';
    
    if (config.granularity) {
      // Explicit override
      if (config.granularity === 'daily') {
        timeIncrement = 1;
        granularityLabel = 'daily';
      } else if (config.granularity === 'weekly') {
        timeIncrement = 7;
        granularityLabel = 'weekly';
      } else if (config.granularity === 'monthly') {
        // Facebook API supports time_increment: 'monthly' which handles calendar months correctly
        // Normalize date range to full calendar months for accurate monthly aggregation
        // Start of first month
        from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
        // End of last month (get last day of month)
        const lastDayOfMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
        to = lastDayOfMonth;
        timeIncrement = 'monthly';
        granularityLabel = 'monthly';
      }
    } else {
      // Auto-determine based on date range
      if (daysDiff <= 7) {
        timeIncrement = 1; // daily
        granularityLabel = 'daily';
      } else {
        // For periods > 7 days, use weekly to keep footprint small
        timeIncrement = 7; // weekly
        granularityLabel = 'weekly';
      }
    }

    const baseReport = this.getBaseCampaignReport();
    const report = {
      ...baseReport,
      from_date: formatDate(from),
      to_date: formatDate(to),
      ...(config.constraints && { constraints: config.constraints }),
      // Always include date segment for trends
      segments: ['segments.date', ...(baseReport.segments || [])],
      // Configure time increment for granularity
      parameters: {
        ...(baseReport.parameters || {}),
        time_increment: timeIncrement,
      },
    };

    // Minimal metrics for trends - keep footprint small
    const trendMetrics = [
      'metrics.spend',
      'metrics.clicks',
      'metrics.impressions',
      'metrics.actions',
      'metrics.action_values',
    ];

    // Use minimal attributes if not specified
    const defaultAttributes = [
      'account.id',
      'account.name',
      'campaign.id',
      'campaign.name',
    ];
    const attributes = config.attributes && config.attributes.length > 0
      ? config.attributes
      : defaultAttributes;

    // Build aggregates - minimal set for trends
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
    
    // Build conversion aggregates (simplified for trends)
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

    // Simplified pipeline for trends - focus on time-series data
    const pipeline = [
      { use: "periods", baseline: { mode: baselineMode }, granularity: granularityLabel },
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
      // Filter actions if includeActions is specified
      ...(includeActions ? [{
        use: 'filterActions',
        includeActions: includeActions,
      }] : []),
      { 
        use: "group", 
        by: [
          ...attributes,
          'segments.date', // Always group by date for trends (Facebook returns monthly dates when time_increment='monthly')
        ],
        aggregates: {
          "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          ...conversionAggregates,
          ...conversionValueAggregates,
          "metrics.spend": { fn: "SUM", as: "metrics.cost" },
          // Minimal derived metrics for trends
          "ctr": { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
          "cpc": { fn: "RATIO", num: "metrics.cost", den: "metrics.clicks", as: "metrics.cpc" },
          "cvr": { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
          "cpa": { fn: "RATIO", num: "metrics.cost", den: "metrics.conversions", as: "metrics.cpa" },
          "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
        },
        rollup: false, // No rollup - we want individual time periods
        nulls: "include",
        // Order by date first (chronological), then by campaign name
        orderBy: [
          { field: "segments.date", dir: "ASC" },
          { field: "campaign.name", dir: "ASC" },
        ],
      },
      ...(filterConfig ? [{ use: "filter", ...filterConfig }] : []),
      { use: "applyActionLabels" },
      // Optional: Time period digest - rollup per time increment for compact LLM consumption
      // This creates one row per date with all campaigns aggregated together
      // Stored in meta.time_period_digest, doesn't modify main results
      ...(config.includeTimePeriodDigest !== false ? [{
        use: "timePeriodDigest",
        by: [
          'segments.date', // Group by date only for digest
          // Include account.id and account.name if we have multiple accounts (preserve account dimension)
          ...(attributes.includes('account.id') ? ['account.id', 'account.name'] : []),
        ],
        aggregates: {
          "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
          "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
          "metrics.cost": { fn: "SUM", as: "metrics.cost" },
          // Recalculate ratios from summed totals
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
      // Prune rows by default - users can set prune: false or pruneRows: false to see full results
      ...(config.prune !== false && config.pruneRows !== false ? [{ use: "pruneRows", mode: "empty", as: "rows_meta" }] : []),
      // Note: No delta step for trends - this is intentional
      // Trends focus on time-series progression, not period-over-period comparisons
      // The meta.periods object provides baseline context if needed, but we don't calculate
      // deltas at each time point to keep the data clean and focused on the trend itself
    ];

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: "envelope", // Include periods meta and time period digest
        include: ["periods", "time_period_digest"], // Include digest in envelope
      }
    });
  }
}

module.exports = { FacebookCampaignTemplate };
