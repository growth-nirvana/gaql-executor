const { getAtPath, setAtPath } = require("../utils");
const { getActionLabel } = require("./action-labels");

function applyActionLabelsStep(rows, cfg = {}, ctx = {}) {
  if (!Array.isArray(rows)) return rows;

  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;

    const actions = getAtPath(row, "metrics.actions_by_type");
    if (actions && typeof actions === "object") {
      const readable = {};
      const canonical = {};
      for (const [key, value] of Object.entries(actions)) {
        if (value == null) continue;
        const label = getActionLabel(key, ctx);
        if (Number.isFinite(value)) {
          readable[label] = (readable[label] || 0) + value;
        } else {
          readable[label] = value;
        }
        canonical[key] = value;
      }
      if (Object.keys(readable).length) {
        setAtPath(row, "metrics.actions_by_type_readable", readable);
        setAtPath(row, "metrics.actions_by_type", readable);
      }
      if (Object.keys(canonical).length) {
        setAtPath(row, "metrics.actions_by_type_canonical", canonical);
      }
    }

    const actionValues = getAtPath(row, "metrics.action_values_by_type");
    if (actionValues && typeof actionValues === "object") {
      const readable = {};
      const canonical = {};
      for (const [key, value] of Object.entries(actionValues)) {
        if (value == null) continue;
        const label = getActionLabel(key, ctx);
        if (Number.isFinite(value)) {
          readable[label] = (readable[label] || 0) + value;
        } else {
          readable[label] = value;
        }
        canonical[key] = value;
      }
      if (Object.keys(readable).length) {
        setAtPath(row, "metrics.action_values_by_type_readable", readable);
        setAtPath(row, "metrics.action_values_by_type", readable);
      }
      if (Object.keys(canonical).length) {
        setAtPath(row, "metrics.action_values_by_type_canonical", canonical);
      }
    }

    return row;
  });
}

module.exports = { applyActionLabelsStep };

