const { BaseTemplate } = require('./BaseTemplate');

class GoogleAdsCampaignTemplate extends BaseTemplate {
  
  static getBaseReport() {
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
        "campaign_budget.recommended_budget_amount_micros",
      ],
      metrics: [
        'metrics.cost_micros',
        'metrics.clicks',
        'metrics.impressions',
        'metrics.conversions',  // API conversions field (will be preserved as conversions_api, then filtered if needed)
        'metrics.conversions_value'  // API conversion_values field (will be preserved as conversions_value_api, then filtered if needed)
      ],
      // segments: [],  // Configure via config.segments if needed
      constraints: [
        { key: "metrics.impressions", op: ">", val: 0 }
      ],
      limit: 1000,
    } 
  }


  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseReport(),
      from_date: fromDate,
      to_date: toDate,
    };

    const filterConfig = this.calculateFilters(config);
    const groupByAttributes = this.calculateGroupByAttributes(config);

    const templateConfig = {
      credentials,
      report,
      pipeline: [
        { use: "periods", baseline: { mode: this.calculatePeriodsBaselineMode(config) } },
        { use: "statusesReadable" },
        { use: "formatMicros", fields: ["metrics.cost_micros", "campaign_budget.amount_micros", "campaign_budget.recommended_budget_amount_micros"] },
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
        // Filter conversion actions if specified (MUST run before grouping so it works in runPre)
        ...(config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
          ? [{
              use: "filterConversionActions",
              conversionActions: config.conversionAction,
              conversionValueActions: config.conversionValueAction || config.conversionAction,
              groupByAttributes: groupByAttributes,
              report: report,
              fromDate: fromDate,
              toDate: toDate
            }]
          : []),
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
            // derived
            "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
            "ctr":  { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
            "cpc":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.clicks",      as: "metrics.cpc" },
            "cvr":  { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
            "cpa":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.conversions", as: "metrics.cpa" },
            "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
          },
          rollup: true,
          nulls: "include",
          orderBy: [{ field: "campaign.name", dir: "ASC" }],
        },
        ...(filterConfig ? [{ use: "filter", ...filterConfig }] : []),
        { use: "shareOf", fields: ["metrics.cost"], includeRollup: false, },
        {
          use: "stats",
          fields: ["metrics.cpc", "metrics.ctr", "metrics.cpa", "metrics.roas"],
          include: ["mean", "median", "p"],   // mean, median, percentiles
          percentiles: [90],                   // add p90
          naming: "flat",                       // writes metrics.cpc_mean, metrics.cpc_median, metrics.cpc_p90, …
          includeRollup: false,
          // (By default rollup rows are ignored in my implementation; if you added an includeRollup flag, leave it false)
        },
        // Store conversionActionsEnricher config before delta runs (delta needs it for previous period)
        // Also store conversionActionFilterCfg if conversionAction is configured
        // The actual enrichment/filtering happens later, but delta needs the config now
        ...(groupByAttributes ? [{
          use: "storeConversionActionsCfg",
          report: {
            entity: 'campaign',
            attributes: groupByAttributes.filter(attr => !attr.startsWith('campaign_budget.')),
            segments: ['segments.conversion_action_name'],
            metrics: ['metrics.conversions', 'metrics.conversions_value', 'metrics.all_conversions', 'metrics.all_conversions_value'],
            from_date: fromDate,
            to_date: toDate,
            constraints: report.constraints || []
          },
          joinKeys: ['customer.id', 'campaign.id'],
          outputPath: 'conversion_actions',
          aggregate: true,
          fromDate: fromDate,
          toDate: toDate,
          // Also pass conversionAction config if specified
          ...(config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0 ? {
            conversionActions: config.conversionAction,
            conversionValueActions: config.conversionValueAction || config.conversionAction,
            groupByAttributes: groupByAttributes
          } : {})
        }] : []),
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
        ...(this.calculatePostDeltaFilters(config) ? [{ use: "filter", ...this.calculatePostDeltaFilters(config) }] : []),
        // Always add conversionActionsEnricher to show breakdown of all conversion actions
        // (like Facebook - shows all actions in breakdown)
        {
          use: "conversionActionsEnricher",
          report: {
            entity: 'campaign',
            // Use the same attributes as the main query for proper joining
            attributes: groupByAttributes.filter(attr => !attr.startsWith('campaign_budget.')), // Exclude budget fields that might cause join issues
            segments: ['segments.conversion_action_name'],
            metrics: ['metrics.conversions', 'metrics.conversions_value', 'metrics.all_conversions', 'metrics.all_conversions_value'],
            from_date: fromDate,
            to_date: toDate,
            constraints: report.constraints || []  // Use same constraints as main query
          },
          // Use customer.id and campaign.id as primary join keys (these are always present)
          joinKeys: ['customer.id', 'campaign.id'],
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
        {
          use: "derive",
          prefix: "diagnostics",     // everything lands under diagnostics.*
          add: {
            // Basic deltas (explicit, but you can skip if already in metrics_delta)
            "cpa_delta": (r, H) => (r.metrics?.cpa ?? null) - (r.metrics_prev?.cpa ?? null),
            "cvr_delta": (r, H) => (r.metrics?.cvr ?? null) - (r.metrics_prev?.cvr ?? null),
            "cpc_delta": (r, H) => (r.metrics?.cpc ?? null) - (r.metrics_prev?.cpc ?? null),
      
            // Impact scores (clip negatives where appropriate)
            "cpa_worsen_impact": (r, H) => {
              const costCur = r.metrics?.cost ?? 0;
              const convCur = r.metrics?.conversions ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;
              const convPre = r.metrics_prev?.conversions ?? 0;

              const hasCur = convCur > 0;
              const hasPre = convPre > 0;

              const cpaCur = hasCur ? costCur / convCur : null;
              const cpaPre = hasPre ? costPre / convPre : null;

              // Case 1: both CPAs defined → normal impact
              if (hasCur && hasPre) {
                return H.pos(cpaCur - cpaPre) * costCur;
              }

              // Case 2: prev undefined, current defined → no baseline to say it "worsened"
              // Treat as zero impact for "worseners" (it's actually an improvement vs ∞).
              if (!hasPre && hasCur) {
                return 0;
              }

              // Case 3: current undefined, prev defined → we spent money and got 0 convs.
              // Penalize by current spend (simple, stable). You could use prev CPA × expected convs
              // if you prefer a richer penalty, but cost is a solid, monotonic proxy.
              if (hasPre && !hasCur) {
                return costCur; // all spend at infinite CPA → bad
              }

              // Case 4: both undefined (0 convs in both periods)
              // Nothing to compare; flag via zero-conv waste list instead.
              return 0;
            },

            "cpa_improve_impact": (r, H) => {
              const costCur = r.metrics?.cost ?? 0;
              const convCur = r.metrics?.conversions ?? 0;
              const costPre = r.metrics_prev?.cost ?? 0;
              const convPre = r.metrics_prev?.conversions ?? 0;

              const hasCur = convCur > 0;
              const hasPre = convPre > 0;

              // CPAs when defined
              const cpaCur = hasCur ? costCur / convCur : null;
              const cpaPre = hasPre ? costPre / convPre : null;

              // Case A: both defined → improvement if CPA dropped
              if (hasCur && hasPre) {
                return H.pos((cpaPre ?? 0) - (cpaCur ?? 0)) * costCur;
              }

              // Case B: prev undefined (0 conv), current defined → large improvement
              // Use a simple, monotonic proxy (current spend now produced conversions).
              if (!hasPre && hasCur) {
                return costCur; // you could also use convCur * (account benchmark CPA)
              }

              // Case C: current undefined (0 conv) → not an improvement
              // Case D: both undefined → no improvement
              return 0;
            },
            "cvr_drop_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const convCur   = r.metrics?.conversions ?? 0;
              const convPre   = r.metrics_prev?.conversions ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              // Recompute CVR from bases; clamp to [0,1] to avoid weirdness from fractional conversions
              const cvrCur = hasCur ? H.clamp(convCur / clicksCur, 0, 1) : null;
              const cvrPre = hasPre ? H.clamp(convPre / clicksPre, 0, 1) : null;

              // If both periods have traffic → normal drop calc, weighted by current clicks
              if (hasCur && hasPre) {
                const drop = H.pos((cvrPre ?? 0) - (cvrCur ?? 0));  // only count decreases
                return drop * clicksCur;                             // ≈ lost conversions this period
              }

              // No current clicks → no CVR problem (it’s a volume issue, captured elsewhere)
              if (!hasCur) return 0;

              // Current has clicks but previous had none → no baseline to call it a drop
              if (hasCur && !hasPre) return 0;

              // Fallback
              return 0;
            },

            "cvr_improve_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const convCur   = r.metrics?.conversions ?? 0;
              const convPre   = r.metrics_prev?.conversions ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              // Recompute CVR from raw bases, clamped to [0, 1] for safety
              const cvrCur = hasCur ? H.clamp(convCur / clicksCur, 0, 1) : null;
              const cvrPre = hasPre ? H.clamp(convPre / clicksPre, 0, 1) : null;

              // ✅ Case 1: both periods have clicks
              // Improvement = CVR increased, weighted by current clicks
              if (hasCur && hasPre) {
                const gain = H.pos((cvrCur ?? 0) - (cvrPre ?? 0)); // only count increases
                return gain * clicksCur;                           // ≈ additional conversions gained
              }

              // ✅ Case 2: current period has traffic but previous didn’t
              // Treat as a major improvement (new traffic with measurable CVR)
              if (hasCur && !hasPre && cvrCur != null) {
                return cvrCur * clicksCur; // approximate conversions gained
              }

              // 🚫 Case 3: previous had traffic but current doesn’t — can’t improve if you have no clicks
              if (!hasCur && hasPre) return 0;

              // 🚫 Case 4: both have no traffic — no signal
              return 0;
            },

            "cpc_rise_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const costCur   = r.metrics?.cost ?? 0;
              const costPre   = r.metrics_prev?.cost ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              // Recompute CPC from bases; ensure non-negative
              const cpcCur = hasCur ? Math.max(costCur / clicksCur, 0) : null;
              const cpcPre = hasPre ? Math.max(costPre / clicksPre, 0) : null;

              // Case 1: both periods have clicks → normal “extra cost due to CPC rise”
              if (hasCur && hasPre) {
                const rise = H.pos((cpcCur ?? 0) - (cpcPre ?? 0)); // only count increases
                return rise * clicksCur; // $ extra cost this period from higher CPC
              }

              // Case 2: no current clicks → no CPC cost pressure this period (volume issue elsewhere)
              if (!hasCur) return 0;

              // Case 3: current has clicks, previous had none → no baseline to claim a "rise"
              if (hasCur && !hasPre) return 0;

              // Fallback
              return 0;
            },

            "cpc_fall_impact": (r, H) => {
              const clicksCur = r.metrics?.clicks ?? 0;
              const clicksPre = r.metrics_prev?.clicks ?? 0;
              const costCur   = r.metrics?.cost ?? 0;
              const costPre   = r.metrics_prev?.cost ?? 0;

              const hasCur = clicksCur > 0;
              const hasPre = clicksPre > 0;

              const cpcCur = hasCur ? Math.max(costCur / clicksCur, 0) : null;
              const cpcPre = hasPre ? Math.max(costPre / clicksPre, 0) : null;

              if (hasCur && hasPre) {
                const fall = H.pos((cpcPre ?? 0) - (cpcCur ?? 0)); // only count decreases
                return fall * clicksCur; // $ saved this period from lower CPC
              }
              if (!hasCur) return 0;
              if (hasCur && !hasPre) return 0;
              return 0;
            },
      
            // Volume-driven conversion change (clicks loss at prev CVR)
            "volume_loss_conv":  (r, H) => H.pos((r.metrics_prev?.clicks ?? 0) - (r.metrics?.clicks ?? 0)) * (r.metrics_prev?.cvr ?? 0),
            // “Zero-conv waste” flag
            "zero_conv_waste":   (r, H) => ((r.metrics?.conversions ?? 0) === 0 && (r.metrics?.clicks ?? 0) >= 20) ? 1 : 0,
            "volume_gain_conv": (r, H) => H.pos((r.metrics?.clicks ?? 0) - (r.metrics_prev?.clicks ?? 0)) * (r.metrics_prev?.cvr ?? 0),
          },
        },
        { 
          use: "topN",
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          metric: "diagnostics.cpa_worsen_impact",
          n: 20,
          include: [
            "metrics.cost",
            "metrics.clicks",
            "metrics.impressions",
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
            "metrics_prev.conversions",
            "metrics_prev.conversions_value",
            "metrics_prev.ctr",
            "metrics_prev.cpc",
            "metrics_prev.cvr",
            "metrics_prev.cpa",
            "metrics_prev.roas",
            "metrics_prev.cost_share",
            "conversion_actions", // Include conversion actions breakdown
            "conversion_actions_prev", // Include previous period conversion actions breakdown
          ],
          excludeRollup: true,
          as: "top_n_cpa_worseners_by_impact",
          // Pass filtered conversion actions so topN can override metrics_prev.conversions
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        },
        { 
          use: "topN",
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          metric: "diagnostics.cpa_improve_impact",
          n: 20,
          include: [
            "metrics.cost",
            "metrics.clicks",
            "metrics.impressions",
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
            "metrics_prev.conversions",
            "metrics_prev.conversions_value",
            "metrics_prev.ctr",
            "metrics_prev.cpc",
            "metrics_prev.cvr",
            "metrics_prev.cpa",
            "metrics_prev.roas",
            "metrics_prev.cost_share",
            "conversion_actions", // Include conversion actions breakdown
            "conversion_actions_prev", // Include previous period conversion actions breakdown
          ],
          excludeRollup: true,
          as: "top_n_cpa_improvers_by_impact",
          // Pass filtered conversion actions so topN can override metrics_prev.conversions
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        },
        { 
          use: "topN",
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          metric: "diagnostics.cvr_drop_impact",
          n: 20,
          include: [
            "metrics.cost",
            "metrics.clicks",
            "metrics.impressions",
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
            "metrics_prev.conversions",
            "metrics_prev.conversions_value",
            "metrics_prev.ctr",
            "metrics_prev.cpc",
            "metrics_prev.cvr",
            "metrics_prev.cpa",
            "metrics_prev.roas",
            "metrics_prev.cost_share",
            "conversion_actions", // Include conversion actions breakdown
            "conversion_actions_prev", // Include previous period conversion actions breakdown
          ],
          excludeRollup: true,
          as: "top_n_cvr_drops_by_impact",
          // Pass filtered conversion actions so topN can override metrics_prev.conversions
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        },
        { 
          use: "topN",
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          metric: "diagnostics.cvr_improve_impact",
          n: 20,
          include: [
            "metrics.cost",
            "metrics.clicks",
            "metrics.impressions",
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
            "metrics_prev.conversions",
            "metrics_prev.conversions_value",
            "metrics_prev.ctr",
            "metrics_prev.cpc",
            "metrics_prev.cvr",
            "metrics_prev.cpa",
            "metrics_prev.roas",
            "metrics_prev.cost_share",
            "conversion_actions", // Include conversion actions breakdown
            "conversion_actions_prev", // Include previous period conversion actions breakdown
          ],
          excludeRollup: true,
          as: "top_n_cvr_improvers_by_impact",
          // Pass filtered conversion actions so topN can override metrics_prev.conversions
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        },
        { 
          use: "topN",
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          metric: "diagnostics.cpc_rise_impact",
          n: 20,
          include: [
            "metrics.cost",
            "metrics.clicks",
            "metrics.impressions",
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
            "metrics_prev.conversions",
            "metrics_prev.conversions_value",
            "metrics_prev.ctr",
            "metrics_prev.cpc",
            "metrics_prev.cvr",
            "metrics_prev.cpa",
            "metrics_prev.roas",
            "metrics_prev.cost_share",
            "conversion_actions", // Include conversion actions breakdown
            "conversion_actions_prev", // Include previous period conversion actions breakdown
          ],
          excludeRollup: true,
          as: "top_n_cpc_rises_by_impact",
          // Pass filtered conversion actions so topN can override metrics_prev.conversions
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        },
        { 
          use: "topN",
          by: [
            ...this.calculateGroupByAttributes(config),
          ],
          metric: "diagnostics.cpc_fall_impact",
          n: 20,
          include: [
            "metrics.cost",
            "metrics.clicks",
            "metrics.impressions",
            "metrics.conversions",
            "metrics.conversions_value",
            "metrics.ctr",
            "metrics.cpc",
            "metrics.cvr",
            "metrics.cpa",
            "metrics.cost_share",
            "metrics_prev.cost",
            "metrics_prev.clicks",
            "metrics_prev.impressions",
            "metrics_prev.conversions",
            "metrics_prev.conversions_value",
            "metrics_prev.ctr",
            "metrics_prev.cpc",
            "metrics_prev.cvr",
            "metrics_prev.cpa",
            "metrics_prev.cost_share",
            "conversion_actions", // Include conversion actions breakdown
            "conversion_actions_prev", // Include previous period conversion actions breakdown
          ],
          excludeRollup: true,
          as: "top_n_cpc_falls_by_impact",
          // Pass filtered conversion actions so topN can override metrics_prev.conversions
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        },
        {
          use: "rollupEnvelope",
          as: "account_rollup",
          rollupKey: "meta.rollup_key",
          rollupValue: "ACCOUNT",
          copyFromFirst: ["customer.id", "customer.descriptive_name"],
        
          // 1) Sum bases for current + previous
          sum: [
            "metrics.cost","metrics.clicks","metrics.impressions","metrics.conversions","metrics.conversions_value",
            "metrics_prev.cost","metrics_prev.clicks","metrics_prev.impressions","metrics_prev.conversions","metrics_prev.conversions_value"
          ],
          
          // Aggregate conversion_actions across all rows
          aggregateConversionActions: true,
          // Pass filtered conversion actions to rollup so it uses filtered metrics
          filteredConversionActions: config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0
            ? config.conversionAction
            : null,
        
          // 2) Compute ratios from summed bases (never average ratios)
          ratios: [
            { as: "metrics.ctr", num: "metrics.clicks",              den: "metrics.impressions" },
            { as: "metrics.cpc", num: "metrics.cost",                den: "metrics.clicks" },
            { as: "metrics.cvr", num: "metrics.conversions",         den: "metrics.clicks" },
            { as: "metrics.cpa", num: "metrics.cost",                den: "metrics.conversions" },
            { as: "metrics.roas", num: "metrics.conversions_value",  den: "metrics.cost" },
        
            { as: "metrics_prev.ctr", num: "metrics_prev.clicks",    den: "metrics_prev.impressions" },
            { as: "metrics_prev.cpc", num: "metrics_prev.cost",      den: "metrics_prev.clicks" },
            { as: "metrics_prev.cvr", num: "metrics_prev.conversions", den: "metrics_prev.clicks" },
            { as: "metrics_prev.cpa", num: "metrics_prev.cost",      den: "metrics_prev.conversions" },
            { as: "metrics_prev.roas", num: "metrics_prev.conversions_value", den: "metrics_prev.cost" },
          ],
        
          // 3) Deltas + pct deltas (pctOnZero => null)
          expressions: {
            // helpers (inline closures are okay)
            "_util.safe":   (s) => ({
              num: (x) => Number.isFinite(+x) ? +x : 0,
              pct: (cur, prev) => (prev == null || prev === 0 ? null : (cur - prev) / Math.abs(prev)),
              diff: (cur, prev) => ( (Number.isFinite(+cur) ? +cur : 0) - (Number.isFinite(+prev) ? +prev : 0) ),
            }),
        
            // absolute deltas (bases)
            "metrics_delta.cost":               (s) => s._util?.safe.diff(s.metrics?.cost,               s.metrics_prev?.cost),
            "metrics_delta.clicks":             (s) => s._util?.safe.diff(s.metrics?.clicks,             s.metrics_prev?.clicks),
            "metrics_delta.impressions":        (s) => s._util?.safe.diff(s.metrics?.impressions,        s.metrics_prev?.impressions),
            "metrics_delta.conversions":        (s) => s._util?.safe.diff(s.metrics?.conversions,        s.metrics_prev?.conversions),
            "metrics_delta.conversions_value":  (s) => s._util?.safe.diff(s.metrics?.conversions_value,  s.metrics_prev?.conversions_value),
        
            // absolute deltas (ratios)
            "metrics_delta.ctr": (s) => s._util?.safe.diff(s.metrics?.ctr, s.metrics_prev?.ctr),
            "metrics_delta.cpc": (s) => s._util?.safe.diff(s.metrics?.cpc, s.metrics_prev?.cpc),
            "metrics_delta.cvr": (s) => s._util?.safe.diff(s.metrics?.cvr, s.metrics_prev?.cvr),
            "metrics_delta.cpa": (s) => s._util?.safe.diff(s.metrics?.cpa, s.metrics_prev?.cpa),
            "metrics_delta.roas": (s) => s._util?.safe.diff(s.metrics?.roas, s.metrics_prev?.roas),
        
            // percent deltas (bases) — null when prev == 0 or null (pctOnZero: "null")
            "metrics_delta_pct.cost":              (s) => s._util?.safe.pct(s.metrics?.cost,              s.metrics_prev?.cost),
            "metrics_delta_pct.clicks":            (s) => s._util?.safe.pct(s.metrics?.clicks,            s.metrics_prev?.clicks),
            "metrics_delta_pct.impressions":       (s) => s._util?.safe.pct(s.metrics?.impressions,       s.metrics_prev?.impressions),
            "metrics_delta_pct.conversions":       (s) => s._util?.safe.pct(s.metrics?.conversions,       s.metrics_prev?.conversions),
            "metrics_delta_pct.conversions_value": (s) => s._util?.safe.pct(s.metrics?.conversions_value, s.metrics_prev?.conversions_value),
        
            // percent deltas (ratios) — null when prev == 0 or null
            "metrics_delta_pct.ctr": (s) => s._util?.safe.pct(s.metrics?.ctr, s.metrics_prev?.ctr),
            "metrics_delta_pct.cpc": (s) => s._util?.safe.pct(s.metrics?.cpc, s.metrics_prev?.cpc),
            "metrics_delta_pct.cvr": (s) => s._util?.safe.pct(s.metrics?.cvr, s.metrics_prev?.cvr),
            "metrics_delta_pct.cpa": (s) => s._util?.safe.pct(s.metrics?.cpa, s.metrics_prev?.cpa),
            "metrics_delta_pct.roas": (s) => s._util?.safe.pct(s.metrics?.roas, s.metrics_prev?.roas),
        
            // cleanup: you can drop _util if your serializer ignores unknown keys
            // "meta": (s) => (delete s._util, s.meta) // optional
          }
        },
        { use: "pruneRows", mode: "empty", as: "rows_meta" }
      ],
      output: {
        mode: "envelope",
        include: ["periods"],
      }
    };

    return new this(templateConfig);
  }

  // Lookup method with date segments for trend analysis
  // Use this to explore a single campaign (or set of campaigns) over time to see daily trends
  // The date segment allows the LLM to see how metrics change day-by-day
  static forLookup(credentials, fromDate, toDate, config = {}) {
    const baseReport = this.getBaseReport();
    const report = {
      ...baseReport,
      from_date: fromDate,
      to_date: toDate,
      ...(config.constraints && { constraints: config.constraints }),
      // Include date segment for trend visibility
      segments: config.segments !== undefined 
        ? config.segments 
        : ['segments.date', ...(baseReport.segments || [])],
    };

    // Pipeline with date grouping to show trends
    const pipeline = [
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros", "campaign_budget.amount_micros", "campaign_budget.recommended_budget_amount_micros"] },
      // Preserve API values and copy to regular conversions fields
      {
        use: "derive",
        add: {
          "metrics.conversions_api": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value_api": (r) => r.metrics?.conversions_value ?? 0,
          "metrics.conversions": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value": (r) => r.metrics?.conversions_value ?? 0
        }
      },
    ];

    // Add derived dimension steps if configured (before grouping)
    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    // Group by campaign attributes + date segment (so we can see trends)
    pipeline.push({ 
      use: "group", 
      by: [
        ...this.calculateGroupByAttributes(config),
        // Always include date in grouping when present in segments
        ...(report.segments?.includes('segments.date') ? ['segments.date'] : []),
      ],
      aggregates: {
        "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
        "metrics.clicks":      { fn: "SUM", as: "metrics.clicks" },
        "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
        "metrics.conversions_api": { fn: "SUM", as: "metrics.conversions_api" },
        "metrics.conversions_value_api": { fn: "SUM", as: "metrics.conversions_value_api" },
        "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
        "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
        // derived metrics
        "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
        "ctr":  { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
        "cpc":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.clicks",      as: "metrics.cpc" },
        "cvr":  { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
        "cpa":  { fn: "RATIO", num: "metrics.cost",   den: "metrics.conversions", as: "metrics.cpa" },
      },
      rollup: false, // No rollup for lookups - we want individual day rows
      nulls: "include",
      // Order by date first (if present), then by campaign name, then by cost
      orderBy: [
        ...(report.segments?.includes('segments.date') ? [{ field: "segments.date", dir: "ASC" }] : []),
        { field: "campaign.name", dir: "ASC" },
        { field: "metrics.cost", dir: "DESC" },
      ],
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
        mode: "flat", // Flat output for easier processing and trend visualization
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
   * @param {Object} credentials - Google Ads API credentials
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
    
    // For monthly granularity, normalize date range to full calendar months
    if (config.granularity === 'monthly') {
      // Start of first month
      from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      // End of last month (get last day of month)
      const lastDayOfMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
      to = lastDayOfMonth;
    }
    
    // For Google Ads, we use segments.date directly (no time_increment parameter)
    // Daily vs weekly is handled by grouping/aggregation, not API parameter
    // But we can still use the granularity config to determine if we want daily or weekly grouping
    
    const baseReport = this.getBaseReport();
    
    // Determine granularity and select appropriate segment
    const granularity = config.granularity || (daysDiff <= 7 ? 'daily' : 'weekly');
    const dateSegment = granularity === 'monthly' ? 'segments.month' : 'segments.date';
    
    const report = {
      ...baseReport,
      from_date: formatDate(from),
      to_date: formatDate(to),
      ...(config.constraints && { constraints: config.constraints }),
      // Use segments.month for monthly granularity, segments.date for daily/weekly
      segments: [dateSegment, ...(baseReport.segments || [])],
    };

    // Default attributes for campaign level
    const defaultAttributes = [
      'customer.id',
      'customer.descriptive_name',
      'campaign.id',
      'campaign.name',
    ];
    const attributes = config.attributes && config.attributes.length > 0
      ? config.attributes
      : defaultAttributes;

    const filterConfig = this.calculateFilters(config);
    const baselineMode = config.baselineMode || "previous_period";

    // For weekly granularity, use timeBucket to group daily data into weeks
    // For monthly, Google Ads API returns monthly data directly via segments.month
    const useTimeBucket = granularity === 'weekly';
    const timeBucketGranularity = 'WEEK';

    // Add derived dimension steps if configured
    const derivedDimensions = this.calculateDerivedDimensions(config);

    const pipeline = [
      { use: "periods", baseline: { mode: baselineMode }, granularity: granularity },
      { use: "statusesReadable" },
      { use: "formatMicros", fields: ["metrics.cost_micros", "campaign_budget.amount_micros", "campaign_budget.recommended_budget_amount_micros"] },
      // Preserve API values and set up conversions/conversions_value based on conversionAction config
      {
        use: "derive",
        add: {
          // Always preserve original API values (rename from API response)
          "metrics.conversions_api": (r) => r.metrics?.conversions ?? 0,
          "metrics.conversions_value_api": (r) => r.metrics?.conversions_value ?? 0,
          // If conversionAction is NOT specified, use API values as regular conversions
          // If conversionAction IS specified, filterConversionActions will overwrite these
          "metrics.conversions": (r) => {
            if (config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0) {
              // Will be overwritten by filterConversionActions
              return 0;
            }
            return r.metrics?.conversions ?? 0;
          },
          "metrics.conversions_value": (r) => {
            if (config.conversionAction && Array.isArray(config.conversionAction) && config.conversionAction.length > 0) {
              // Will be overwritten by filterConversionActions
              return 0;
            }
            return r.metrics?.conversions_value ?? 0;
          }
        }
      },
    ];

    // Add derived dimension steps if configured
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    // Group by campaign attributes + date segment
    // For monthly, use segments.month directly (already monthly from API)
    // For weekly, use timeBucket to group daily segments.date into weeks
    const groupStep = { 
      use: "group", 
      by: [
        ...attributes,
        ...(useTimeBucket ? [] : [dateSegment]), // Include dateSegment (segments.date or segments.month) if not using timeBucket
      ],
      ...(useTimeBucket ? {
        timeBucket: {
          field: "segments.date",
          granularity: timeBucketGranularity,
          as: "segments.date" // Overwrite segments.date with week-bucketed date
        }
      } : {}),
      aggregates: {
        "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" },
        "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
        "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
        "metrics.conversions": { fn: "SUM", as: "metrics.conversions" },
        "metrics.conversions_value": { fn: "SUM", as: "metrics.conversions_value" },
        // Derived metrics
        "cost": { fn: "MICROS_TO_UNITS", src: "metrics.cost_micros", as: "metrics.cost" },
        "ctr": { fn: "RATIO", num: "metrics.clicks", den: "metrics.impressions", as: "metrics.ctr" },
        "cpc": { fn: "RATIO", num: "metrics.cost", den: "metrics.clicks", as: "metrics.cpc" },
        "cvr": { fn: "RATIO", num: "metrics.conversions", den: "metrics.clicks", as: "metrics.cvr" },
        "cpa": { fn: "RATIO", num: "metrics.cost", den: "metrics.conversions", as: "metrics.cpa" },
        "roas": { fn: "RATIO", num: "metrics.conversions_value", den: "metrics.cost", as: "metrics.roas" },
      },
      rollup: false, // No rollup - we want individual time periods
      nulls: "include",
      orderBy: [
        { field: dateSegment, dir: "ASC" },
        { field: "campaign.name", dir: "ASC" },
      ],
    };
    pipeline.push(groupStep);

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

    // Optional: Time period digest - rollup per time increment for compact LLM consumption
    if (config.includeTimePeriodDigest !== false) {
      pipeline.push({
      use: "timePeriodDigest",
      by: [
        'segments.date', // Always use segments.date for consistent output (normalized from segments.month if monthly)
        // Include customer.id and customer.descriptive_name if we have multiple customers (preserve customer dimension)
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

  static forDimension(credentials, fromDate, toDate, config = {}) {
    const baseReport = this.getBaseReport();
    const report = {
      ...baseReport,
      metrics: [],
      from_date: fromDate,
      to_date: toDate,
      ...(config.constraints && { constraints: config.constraints }),
      segments: config.segments !== undefined ? config.segments : (baseReport.segments || []),
    };

    const pipeline = [{ use: "statusesReadable" }];

    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    pipeline.push({
      use: "group",
      by: [
        ...this.calculateGroupByAttributes(config),
      ],
      aggregates: {},
      rollup: false,
      nulls: "include",
      orderBy: config.orderBy || [{ field: "campaign.name", dir: "ASC" }],
    });

    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: "flat",
      },
    });
  }
}

module.exports = { GoogleAdsCampaignTemplate };
