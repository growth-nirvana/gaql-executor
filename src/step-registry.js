const { makeStatusesReadable } = require("./enum-normalizer");
const { formatMicrosRows } = require("./format-micros");
const { groupRows } = require("./group-by");
const { deltaAugment } = require("./delta");

function withTraits(fn, traits) {
  fn.traits = traits;
  return fn;
}

const STEPS = {
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
  // ✅ new: delta (augment mode); does NOT change cardinality
  delta: withTraits(
    async (rows, cfg, ctx) => deltaAugment(rows, cfg, ctx),
    { phase: "post", changesCardinality: false }
  ),
};

module.exports = { STEPS };
