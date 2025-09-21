// filter.js
function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}
function escapeRegExp(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function likeToRegExp(pat) {
  // SQL LIKE: % → .*, _ → .
  const esc = escapeRegExp(String(pat)).replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${esc}$`);
}
function toLowerIf(s, ci){ return ci ? String(s).toLowerCase() : String(s); }

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
 * cfg:
 * {
 *   where: [
 *     { field: "campaign.name", op: "CONTAINS", value: "LSE-DA", flags: "i" },
 *     { field: "metrics.impressions", op: ">", value: 0 }
 *   ],
 *   logic: "AND" | "OR"   // default "AND"
 * }
 */
function filterStep(rows, cfg = {}) {
  const rules = Array.isArray(cfg.where) ? cfg.where : [];
  const logic = (cfg.logic || "AND").toUpperCase();

  if (!rules.length || !Array.isArray(rows) || rows.length === 0) return rows;

  return rows.filter(r => {
    const results = rules.map(cond => {
      const v = getAtPath(r, cond.field);
      
      return testCond(v, cond.op, cond.value, cond.flags);
    });
    return logic === "OR" ? results.some(Boolean) : results.every(Boolean);
  });
}

module.exports = { filterStep };