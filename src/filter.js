// filter.js
const { getAtPath } = require('./utils');

function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function likeToRegExp(pat) {
  // SQL LIKE: % → .*, _ → .
  const esc = escapeRegExp(String(pat)).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${esc}$`);
}
function toLowerIf(s, ci){ return ci ? String(s).toLowerCase() : String(s); }

/**
 * Raw condition tester (kept for parity with your original code).
 * Note: for performance we compile per-rule predicates below instead of calling this per-row.
 */
function testCond(value, op, expected, flags) {
  const ci = typeof flags === "string" && flags.includes("i");

  switch ((op || "").toUpperCase()) {
    case "=":  return value === expected;
    case "!=": return value !== expected;
    case ">":  return Number(value) >  Number(expected);
    case ">=": return Number(value) >= Number(expected);
    case "<":  return Number(value) <  Number(expected);
    case "<=": return Number(value) <= Number(expected);

    case "IN": {
      const arr = Array.isArray(expected) ? expected : [expected];
      return arr.some(v => v === value);
    }
    case "NOT IN": {
      const arr = Array.isArray(expected) ? expected : [expected];
      return !arr.some(v => v === value);
    }

    case "CONTAINS": {
      const a = toLowerIf(value ?? "", ci);
      const b = toLowerIf(expected ?? "", ci);
      return a.includes(b);
    }
    case "NOT CONTAINS": {
      const a = toLowerIf(value ?? "", ci);
      const b = toLowerIf(expected ?? "", ci);
      return !a.includes(b);
    }

    case "STARTS_WITH": {
      const a = toLowerIf(value ?? "", ci);
      const b = toLowerIf(expected ?? "", ci);
      return a.startsWith(b);
    }
    case "ENDS_WITH": {
      const a = toLowerIf(value ?? "", ci);
      const b = toLowerIf(expected ?? "", ci);
      return a.endsWith(b);
    }

    case "LIKE": {
      const re = likeToRegExp(expected);
      return re.test(String(value ?? ""));
    }
    case "NOT LIKE": {
      const re = likeToRegExp(expected);
      return !re.test(String(value ?? ""));
    }

    case "REGEXP":
    case "~": {
      const re = new RegExp(String(expected), flags || "");
      return re.test(String(value ?? ""));
    }
    case "NOT REGEXP": {
      const re = new RegExp(String(expected), flags || "");
      return !re.test(String(value ?? ""));
    }

    case "IS NULL":     return value == null;
    case "IS NOT NULL": return value != null;

    default: return true; // unknown op -> pass-through
  }
}

/**
 * Compile a single rule into a fast predicate.
 * Supports all ops you already had; precompiles regex/LIKE and normalizes case once.
 */
function compileRule(rule) {
  const field = rule.field;
  const OP = (rule.op || "").toUpperCase();
  const flags = rule.flags || "";
  const ci = typeof flags === "string" && flags.includes("i");
  const expected = rule.value;

  // Precompute artifacts per operator
  let re = null;
  let likeRe = null;
  let normExpected = expected;

  switch (OP) {
    case "LIKE":
    case "NOT LIKE":
      likeRe = likeToRegExp(expected);
      break;
    case "REGEXP":
    case "~":
    case "NOT REGEXP":
      re = new RegExp(String(expected), flags || "");
      break;
    case "CONTAINS":
    case "NOT CONTAINS":
    case "STARTS_WITH":
    case "ENDS_WITH":
      normExpected = toLowerIf(expected ?? "", ci);
      break;
    case "IN":
    case "NOT IN":
      // Normalize IN sets once
      if (!Array.isArray(normExpected)) normExpected = [normExpected];
      break;
    default:
      // others use as-is
      break;
  }

  return function predicate(row) {
    const value = getAtPath(row, field);

    switch (OP) {
      case "=":  return value === expected;
      case "!=": return value !== expected;
      case ">":  return Number(value) >  Number(expected);
      case ">=": return Number(value) >= Number(expected);
      case "<":  return Number(value) <  Number(expected);
      case "<=": return Number(value) <= Number(expected);

      case "IN":       return normExpected.some(v => v === value);
      case "NOT IN":   return !normExpected.some(v => v === value);

      case "CONTAINS": {
        const a = toLowerIf(value ?? "", ci);
        return String(a).includes(normExpected);
      }
      case "NOT CONTAINS": {
        const a = toLowerIf(value ?? "", ci);
        return !String(a).includes(normExpected);
      }
      case "STARTS_WITH": {
        const a = toLowerIf(value ?? "", ci);
        return String(a).startsWith(normExpected);
      }
      case "ENDS_WITH": {
        const a = toLowerIf(value ?? "", ci);
        return String(a).endsWith(normExpected);
      }

      case "LIKE":      return likeRe.test(String(value ?? ""));
      case "NOT LIKE":  return !likeRe.test(String(value ?? ""));

      case "REGEXP":
      case "~":         return re.test(String(value ?? ""));
      case "NOT REGEXP":return !re.test(String(value ?? ""));

      case "IS NULL":     return value == null;
      case "IS NOT NULL": return value != null;

      default:
        // Unknown op: keep row
        return true;
    }
  };
}

/**
 * Build a single composite predicate for a cfg.
 * cfg:
 * {
 *   where: [{ field, op, value, flags }],
 *   logic: "AND" | "OR",
 *   excludeRollup?: boolean   // optional; if true, drop rows with meta.rollup_key
 * }
 */
function createFilterPredicate(cfg = {}) {
  const rules = Array.isArray(cfg.where) ? cfg.where : [];
  const logic = (cfg.logic || "AND").toUpperCase();
  const excludeRollup = !!cfg.excludeRollup;

  if (!rules.length && !excludeRollup) {
    // No rules and no rollup exclusion — return a tautology
    return (row) => true;
  }

  const preds = rules.map(compileRule);

  return function composite(row) {
    if (excludeRollup && row?.meta?.rollup_key) return false;
    if (!preds.length) return true;
    if (logic === "OR") return preds.some((p) => p(row));
    // default AND
    return preds.every((p) => p(row));
  };
}

/**
 * Step function (now supports optional ctx to persist the compiled predicate)
 *
 * @param {Array<object>} rows
 * @param {object} cfg
 * @param {object} [ctx] - pipeline context; if provided, we stash predicate in ctx.state
 *
 * cfg:
 * {
 *   where: [
 *     { field: "campaign.name", op: "CONTAINS", value: "LSE-DA", flags: "i" },
 *     { field: "metrics.impressions", op: ">", value: 0 }
 *   ],
 *   logic: "AND" | "OR",
 *   excludeRollup?: boolean
 * }
 */
function filterStep(rows, cfg = {}, ctx) {
  if (!Array.isArray(rows) || rows.length === 0) {
    // still persist predicate so delta can reuse consistent logic
    if (ctx?.state) {
      const fn = createFilterPredicate(cfg);
      ctx.state.lastFilterCfg = cfg;
      ctx.state.lastFilterFn = fn;
      ctx.state.excludeRollup = !!cfg.excludeRollup;
    }
    return rows;
  }

  const fn = createFilterPredicate(cfg);

  // Persist for downstream steps (e.g., delta to apply same filter to baseline)
  if (ctx?.state) {
    ctx.state.lastFilterCfg = cfg;
    ctx.state.lastFilterFn = fn;
    ctx.state.excludeRollup = !!cfg.excludeRollup;
    return rows.filter(fn);
  }

  return rows.filter(fn);
}

module.exports = {
  filterStep,
  createFilterPredicate, // exported in case you want direct reuse in tests or other steps
  // keeping testCond exported is optional; it’s unused by the compiled predicate path
  testCond
};
