const { makeStatusesReadable } = require("./enum-normalizer");
const { formatMicrosRows } = require("./format-micros");
const { groupRows } = require("./group-by");
const { deltaAugment } = require("./delta");
const { periodsStep } = require("./periods");
const { attachPeriodsMetaStep } = require("./attach-periods-meta");
const { shareOfStep } = require("./share-of");
const { statsStep } = require("./stats");
const { deriveDimensionStep } = require("./derive-dimension");
const { actionsToColumnsRows } = require("./fb/actions-to-columns");
const { topNStep } = require("./top-n");


function withTraits(fn, traits) {
  fn.traits = traits;
  return fn;
}

const STEPS = {
  // NEW: compute & record periods
  periods: withTraits(
    (rows, cfg, ctx) => periodsStep(rows, cfg, ctx),
    { phase: "pre", changesCardinality: false }
  ),
  deriveDimension: withTraits((rows, cfg) => deriveDimensionStep(rows, cfg), { phase: "pre", changesCardinality: false }),
  statusesReadable: withTraits(
    (rows /*, cfg, ctx */) => makeStatusesReadable(rows),
    { phase: "pre", changesCardinality: false }
  ),
  formatMicros: withTraits(
    (rows, cfg /*, ctx */) => formatMicrosRows(rows, cfg),
    { phase: "pre", changesCardinality: false }
  ),
  filter: withTraits((rows, cfg) => filterStep(rows, cfg), {
    phase: "pre",
    changesCardinality: false
  }),
  group: withTraits(
    (rows, cfg, ctx) => {
      // record the config so later steps (e.g., delta) can reuse it
      if (ctx && ctx.state) ctx.state.lastGroupCfg = cfg;
      return groupRows(rows, cfg);
    },
    { changesCardinality: true, phase: "aggregate" }
  ),

  delta: withTraits(
    async (rows, cfg, ctx) => deltaAugment(rows, cfg, ctx),
    { phase: "post", changesCardinality: false }
  ),

  attachPeriodsMeta: withTraits(
    (rows, cfg, ctx) => attachPeriodsMetaStep(rows, cfg, ctx),
    { phase: "post", changesCardinality: false }
  ),
  actionsToColumns: withTraits(
    (rows, cfg) => actionsToColumnsRows(rows, cfg), { phase: "post", changesCardinality: false }
  ),
  shareOf: withTraits((rows, cfg) => shareOfStep(rows, cfg), { phase: "post", changesCardinality: false }),
  stats:   withTraits((rows, cfg) => statsStep(rows, cfg),   { phase: "post", changesCardinality: false }),
  percentileRank: withTraits((rows, cfg) => percentileRankStep(rows, cfg), { phase: "post", changesCardinality: false }),
  zScore: withTraits((rows, cfg) => zScoreStep(rows, cfg), { phase: "post", changesCardinality: false }),
  having: withTraits((rows, cfg) => havingStep(rows, cfg), { phase: "post", changesCardinality: false }),
  topN: withTraits((rows, cfg, ctx) => topNStep(rows, cfg, ctx), { phase: "post", changesCardinality: false }),
};

module.exports = { STEPS };
