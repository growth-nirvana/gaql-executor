const { makeStatusesReadable } = require("./enum-normalizer");
const { formatMicrosRows } = require("./format-micros");
const { groupRows } = require("./group-by");

const STEPS = {
  statusesReadable(rows /*, cfg, ctx */) {
    console.log('🔍 rows before statusesReadable', rows);
    return makeStatusesReadable(rows);
  },
  formatMicros(rows, cfg /*, ctx */) {
    console.log('🔍 rows before formatMicros', rows);
    return formatMicrosRows(rows, cfg);
  },
  group(rows, cfg /*, ctx */) {
    console.log('🔍 rows before group', rows);
    return groupRows(rows, cfg);
  },
};

module.exports = { STEPS };
