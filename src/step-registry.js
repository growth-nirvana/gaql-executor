const { makeStatusesReadable } = require("./enum-normalizer");
const { formatMicrosRows } = require("./format-micros");
const { groupRows } = require("./group-by");
const { deltaAugment } = require("./delta");
const { periodsStep } = require("./periods");
const { attachPeriodsMetaStep } = require("./attach-periods-meta");

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
  statusesReadable: withTraits(
    (rows /*, cfg, ctx */) => makeStatusesReadable(rows),
    { phase: "pre", changesCardinality: false }
  ),
  formatMicros: withTraits(
    (rows, cfg /*, ctx */) => formatMicrosRows(rows, cfg),
    { phase: "pre", changesCardinality: false }
  ),
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
  )
};

module.exports = { STEPS };
