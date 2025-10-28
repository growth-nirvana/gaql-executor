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
        'metrics.conversions',
        'metrics.conversions_value'
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

    return new this({
      credentials,
      report,
      pipeline: [
        { use: "periods", baseline: { mode: this.calculatePeriodsBaselineMode(config) } },
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
        ...(this.calculateFilters(config) ? [{ use: "filter", ...this.calculateFilters(config) }] : []),
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
        {
          use: "conversionActionsEnricher",
          report: {
            entity: 'campaign',
            attributes: ['customer.id', 'customer.descriptive_name', 'campaign.id', 'campaign.name'],
            segments: ['segments.conversion_action_name'],
            metrics: ['metrics.conversions', 'metrics.conversions_value', 'metrics.all_conversions', 'metrics.all_conversions_value'],
            from_date: fromDate,
            to_date: toDate,
            constraints: []  // Empty constraints for segment compatibility
          },
          joinKeys: ['customer.id', 'campaign.id'],
          outputPath: 'conversion_actions',
          aggregate: true
        },
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
          ],
          excludeRollup: true,
          as: "top_n_cpc_falls_by_impact",
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
        
          // 2) Compute ratios from summed bases (never average ratios)
          ratios: [
            { as: "metrics.ctr", num: "metrics.clicks",              den: "metrics.impressions" },
            { as: "metrics.cpc", num: "metrics.cost",                den: "metrics.clicks" },
            { as: "metrics.cvr", num: "metrics.conversions",         den: "metrics.clicks" },
            { as: "metrics.cpa", num: "metrics.cost",                den: "metrics.conversions" },
        
            { as: "metrics_prev.ctr", num: "metrics_prev.clicks",    den: "metrics_prev.impressions" },
            { as: "metrics_prev.cpc", num: "metrics_prev.cost",      den: "metrics_prev.clicks" },
            { as: "metrics_prev.cvr", num: "metrics_prev.conversions", den: "metrics_prev.clicks" },
            { as: "metrics_prev.cpa", num: "metrics_prev.cost",      den: "metrics_prev.conversions" },
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
        
            // cleanup: you can drop _util if your serializer ignores unknown keys
            // "meta": (s) => (delete s._util, s.meta) // optional
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
}

module.exports = { GoogleAdsCampaignTemplate };
