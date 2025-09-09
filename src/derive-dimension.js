// derive-dimension.js
function getAtPath(obj, path) {
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
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

function normalizeFlags(flags) {
  // Allow e.g. "i", "gi", or undefined
  return typeof flags === "string" ? flags : "";
}

function matchOne(cond, row) {
  if (!cond || typeof cond !== "object") return false;

  // Regex: { regex: { field, pattern, flags? } }
  if (cond.regex) {
    const { field, pattern, flags } = cond.regex;
    const v = String(getAtPath(row, field) ?? "");
    try {
      const re = new RegExp(pattern, normalizeFlags(flags));
      return re.test(v);
    } catch {
      return false;
    }
  }

  // Contains (substring): { contains: { field, value, flags? } }
  if (cond.contains) {
    const { field, value, flags } = cond.contains;
    const v = String(getAtPath(row, field) ?? "");
    return flags && flags.includes("i")
      ? v.toLowerCase().includes(String(value).toLowerCase())
      : v.includes(String(value));
  }

  // Starts/Ends with
  if (cond.startsWith) {
    const { field, value, flags } = cond.startsWith;
    const v = String(getAtPath(row, field) ?? "");
    const vv = flags && flags.includes("i") ? v.toLowerCase() : v;
    const val = flags && flags.includes("i") ? String(value).toLowerCase() : String(value);
    return vv.startsWith(val);
  }
  if (cond.endsWith) {
    const { field, value, flags } = cond.endsWith;
    const v = String(getAtPath(row, field) ?? "");
    const vv = flags && flags.includes("i") ? v.toLowerCase() : v;
    const val = flags && flags.includes("i") ? String(value).toLowerCase() : String(value);
    return vv.endsWith(val);
  }

  // Equality / IN
  if (cond.eq) {
    const { field, value } = cond.eq;
    return getAtPath(row, field) === value;
  }
  if (cond.in) {
    const { field, values } = cond.in;
    const v = getAtPath(row, field);
    return Array.isArray(values) && values.some(x => x === v);
  }

  return false;
}

function matchRule(rule, row) {
  // { if: [cond, cond, ...], logic?: "AND"|"OR" }
  const arr = Array.isArray(rule.if) ? rule.if : [];
  const logic = (rule.logic || "AND").toUpperCase();
  if (arr.length === 0) return false;
  if (logic === "OR") return arr.some(c => matchOne(c, row));
  return arr.every(c => matchOne(c, row));
}

/**
 * cfg:
 * {
 *   as: "program",          // required; path to write
 *   rules: [
 *     { if: [ { regex: { field:"campaign.name", pattern:"pmax|performance\\s*max", flags:"i" } } ], then: "PMAX" },
 *     { if: [ { in: { field:"campaign.advertising_channel_type", values:["SEARCH"] } } ], then: "Search" },
 *     { if: [ { contains: { field:"campaign.name", value:"desk", flags:"i" } } ], then: "Desks" }
 *   ],
 *   default: "Other"        // optional fallback when no rule matches
 * }
 */
function deriveDimensionStep(rows, cfg = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const as = cfg.as;
  if (!as) {
    console.warn("[deriveDimension] cfg.as is required. Skipping.");
    return rows;
  }
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const fallback = cfg.default;

  return rows.map(r => {
    const out = Array.isArray(r) ? [...r] : { ...r };
    let assigned = false;
    for (const rule of rules) {
      if (matchRule(rule, r)) {
        setAtPath(out, as, typeof rule.then === "function" ? rule.then(r) : rule.then);
        assigned = true;
        break;
      }
    }
    if (!assigned && "default" in cfg) setAtPath(out, as, typeof fallback === "function" ? fallback(r) : fallback);
    return out;
  });
}

module.exports = { deriveDimensionStep };