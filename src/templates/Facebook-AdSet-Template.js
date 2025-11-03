const { BaseTemplate } = require('./BaseTemplate');

class FacebookAdSetTemplate extends BaseTemplate {
  
  static getBaseReport() {
    // Alias for getBaseAdSetReport to work with BaseTemplate
    return this.getBaseAdSetReport();
  }
  
  static getBaseAdSetReport() {
    return {
      entity: 'ad_set',
      attributes: [
        'account.id',
        'account.name',
        'campaign.id',
        'campaign.name',
        'campaign.objective',
        'adset.id',
        'adset.name',
      ],
      metrics: [
        'metrics.spend',
        'metrics.clicks',
        'metrics.impressions',
        "metrics.actions",
        "metrics.action_values",
      ],
      segments: [],
      breakdowns: [],
    } 
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const report = {
      ...this.getBaseAdSetReport(),
      from_date: fromDate,
      to_date: toDate,
    };

    return new FacebookAdSetTemplate({
      credentials,
      report,
      pipeline: [
        { use: "periods", baseline: { mode: config.periodsBaselineMode || "previous_period" } },
        { 
          use: 'actionsToColumns',
          sources: [
            { from: 'metrics.actions', to: 'metrics.actions_by_type', totalAs: '_total', keepRaw: true },
            { from: 'metrics.action_values', to: 'metrics.action_values_by_type', totalAs: '_total_value', keepRaw: true },
          ]
        },
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
            "metrics.actions._total": { fn: "SUM", as: "metrics.conversions" },
            "metrics.action_values._total_value": { fn: "SUM", as: "metrics.conversions_value" },
            // Sum spend and alias as cost for consistency with Google Ads templates
            "metrics.spend": { fn: "SUM", as: "metrics.cost" },
            // Auto-aggregate all action types dynamically (e.g., purchase, add_to_cart, etc.)
            "metrics.actions_by_type.*": { fn: "SUM" },
            "metrics.action_values_by_type.*": { fn: "SUM" },
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
          orderBy: [{ field: "adset.name", dir: "ASC" }],
        },
        ...(config.filters ? [{ use: "filter", ...config.filters }] : []),
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
            'adset.id',
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
      
            "volume_loss_conv": (r, H) => H.pos((r.metrics_prev?.clicks ?? 0) - (r.metrics?.clicks ?? 0)) * (r.metrics_prev?.cvr ?? 0),
            "zero_conv_waste": (r, H) => ((r.metrics?.conversions ?? 0) === 0 && (r.metrics?.clicks ?? 0) >= 20) ? 1 : 0,
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
          ],
          excludeRollup: true,
          as: "top_n_cpa_worseners_by_impact",
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
          ],
          excludeRollup: true,
          as: "top_n_cpa_improvers_by_impact",
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
          ],
          excludeRollup: true,
          as: "top_n_cvr_drops_by_impact",
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
          ],
          excludeRollup: true,
          as: "top_n_cvr_improvers_by_impact",
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
          ],
          excludeRollup: true,
          as: "top_n_cpc_rises_by_impact",
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
          ],
          excludeRollup: true,
          as: "top_n_cpc_falls_by_impact",
        },
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
            "metrics.action_values_by_type.*"
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
        // { use: "pruneRows", when: { maxRows: 50 }, mode: "empty", as: "rows_meta" }
      ],
      output: {
        mode: "envelope",
        include: ["periods"],
      }
    });
  }
}

module.exports = { FacebookAdSetTemplate };

