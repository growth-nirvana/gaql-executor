const { pruneRowsStep } = require('./prune-rows');
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
const { filterActionsRows } = require("./fb/filter-actions");
const { loadCustomConversionsStep } = require("./fb/load-custom-conversions-step");
const { applyActionLabelsStep } = require("./fb/apply-action-labels-step");
const { enrichWithConversionActions } = require("./google-ads/conversion-actions-enricher");
const { topNStep } = require("./top-n");
const { derive } = require("./derive");
const { rollupEnvelopeStep } = require("./rollup-envelope");
const { filterStep } = require("./filter");
const { timePeriodDigestStep } = require("./time-period-digest");

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
  filter: withTraits((rows, cfg, ctx) => filterStep(rows, cfg, ctx), {
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
  loadCustomConversions: withTraits(
    async (rows, cfg, ctx) => loadCustomConversionsStep(rows, cfg, ctx),
    { phase: "pre", changesCardinality: false }
  ),
  applyActionLabels: withTraits(
    (rows, cfg, ctx) => applyActionLabelsStep(rows, cfg, ctx),
    { phase: "post", changesCardinality: false }
  ),
  actionsToColumns: withTraits(
    (rows, cfg, ctx) => actionsToColumnsRows(rows, cfg, ctx), { phase: "post", changesCardinality: false }
  ),
  filterActions: withTraits(
    (rows, cfg, ctx) => filterActionsRows(rows, cfg, ctx), { phase: "post", changesCardinality: false }
  ),
  conversionActionsEnricher: withTraits(
    async (rows, cfg, ctx) => enrichWithConversionActions(rows, cfg, ctx), 
    { phase: "post", changesCardinality: false }
  ),
  shareOf: withTraits((rows, cfg) => shareOfStep(rows, cfg), { phase: "post", changesCardinality: false }),
  stats:   withTraits((rows, cfg) => statsStep(rows, cfg),   { phase: "post", changesCardinality: false }),
  percentileRank: withTraits((rows, cfg) => percentileRankStep(rows, cfg), { phase: "post", changesCardinality: false }),
  zScore: withTraits((rows, cfg) => zScoreStep(rows, cfg), { phase: "post", changesCardinality: false }),
  having: withTraits((rows, cfg) => havingStep(rows, cfg), { phase: "post", changesCardinality: false }),
  derive: withTraits((rows, cfg) => derive(rows, cfg), { phase: "post", changesCardinality: false }),
  topN: withTraits((rows, cfg, ctx) => topNStep(rows, cfg, ctx), { phase: "post", changesCardinality: false }),
  rollupEnvelope: (fn => (fn.traits = { phase: "post", changesCardinality: false }, fn))(
    (rows, cfg, ctx) => rollupEnvelopeStep(rows, cfg, ctx)
  ),
  timePeriodDigest: withTraits(
    (rows, cfg, ctx) => timePeriodDigestStep(rows, cfg, ctx),
    { phase: "post", changesCardinality: false }
  ),
  pruneRows: (fn => (fn.traits = { phase: "post", changesCardinality: true }, fn))(
    (rows, cfg, ctx) => pruneRowsStep(rows, cfg, ctx)
  ),
};

module.exports = { STEPS };
