// having.js
const { filterStep } = require("./filter"); // reuse the same evaluator

function havingStep(rows, cfg = {}) {
  // identical to filter, just marked post in traits
  return filterStep(rows, cfg);
}

module.exports = { havingStep };