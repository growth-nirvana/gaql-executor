// src/fb/filter-actions.js
// Filter action columns based on includeActions config

function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

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

function deleteAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur == null || typeof cur !== "object") return;
    cur = cur[p];
  }
  if (cur != null && typeof cur === "object") {
    delete cur[parts[parts.length - 1]];
  }
}

/**
 * Filter action columns based on includeActions config
 * 
 * cfg = {
 *   includeActions: ["purchase", "add_to_cart", "_total"],  // null/undefined = include all
 *   actionPaths: [                                           // paths to filter
 *     "metrics.actions_by_type",
 *     "metrics.action_values_by_type",
 *     "metrics.conversions_by_type",
 *     "metrics.conversion_values_by_type"
 *   ]
 * }
 */
function filterActionsRows(rows, cfg = {}) {
  const { includeActions, actionPaths = [
    "metrics.actions_by_type",
    "metrics.action_values_by_type",
    "metrics.conversions_by_type",
    "metrics.conversion_values_by_type"
  ] } = cfg;

  // If no filter specified, include all actions
  if (!includeActions || !Array.isArray(includeActions) || includeActions.length === 0) {
    return rows;
  }

  // Normalize action names to match what actionsToColumns produces
  const normalizedInclude = new Set(
    includeActions.map(action => {
      if (action === "_total" || action === "_total_value") return action;
      return String(action)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    })
  );

  return rows.map((row) => {
    const out = Array.isArray(row) ? [...row] : { ...row };

    for (const actionPath of actionPaths) {
      const actionObj = getAtPath(out, actionPath);
      if (!actionObj || typeof actionObj !== "object") continue;

      // Get all keys in the action object
      const keys = Object.keys(actionObj);
      const filteredObj = {};

      for (const key of keys) {
        // Always keep _total and _total_value
        if (key === "_total" || key === "_total_value") {
          filteredObj[key] = actionObj[key];
        } else if (normalizedInclude.has(key)) {
          // Keep if in include list
          filteredObj[key] = actionObj[key];
        }
        // Otherwise, skip (don't include in filteredObj)
      }

      // Replace the action object with filtered version
      setAtPath(out, actionPath, filteredObj);
    }

    return out;
  });
}

module.exports = { filterActionsRows };


