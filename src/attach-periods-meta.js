// attach-periods-meta.js
function setAtPath(obj, path, value) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
}

/**
 * cfg: { as?: "meta.periods" }  // default "meta.periods"
 */
function attachPeriodsMetaStep(rows, cfg = {}, ctx) {
  const as = cfg.as || "meta.periods";
  const periods = ctx?.state?.periods;
  if (!periods) return rows;

  return rows.map((r) => {
    const row = Array.isArray(r) ? [...r] : { ...r };
    setAtPath(row, as, periods);
    return row;
  });
}

module.exports = { attachPeriodsMetaStep };