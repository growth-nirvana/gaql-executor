// src/actions-to-columns.js

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

// Very conservative sanitizer: "offsite_conversion.purchase" → "offsite_conversion_purchase"
function sanitizeKey(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * Flatten actions arrays into numeric columns under `to` path.
 *
 * cfg = {
 *   // Single source (shorthand) OR use `sources` for multiple.
 *   from: "metrics.actions",          // array of {action_type, value}
 *   to:   "metrics.actions",          // where to emit: e.g. metrics.actions.purchase = 123
 *   totalAs: "_total",                // create metrics.actions._total
 *   keepRaw: false,                   // keep original array at `from`
 *   map: {                            // optional canonicalization
 *     purchase: ["offsite_conversion.purchase","purchase"],
 *     add_to_cart: ["add_to_cart"]
 *   },
 *
 *   // OR multiple:
 *   sources: [
 *     { from: "metrics.actions", to: "metrics.actions", totalAs: "_total", map: {...}, keepRaw: false },
 *     { from: "metrics.action_values", to: "metrics.action_values", totalAs: "_total_value" }
 *   ]
 * }
 */
function actionsToColumnsRows(rows, cfg = {}, ctx = {}) {
  const sources = Array.isArray(cfg.sources) && cfg.sources.length
    ? cfg.sources
    : [{
        from: cfg.from || "metrics.actions",
        to: cfg.to || (cfg.from || "metrics.actions"),
        totalAs: cfg.totalAs || "_total",
        map: cfg.map || {},
        keepRaw: !!cfg.keepRaw,
      }];

  const customMap = ctx?.state?.customConversionTypeMap || null;
  const debug = cfg.debug === true || (cfg.debug === undefined && process.env.DEBUG_CUSTOM_CONVERSIONS === "1");
  let debugLoggedMissingActionValues = false;
  let debugLoggedRawActionValues = false;
  let debugLoggedTotals = false;
  let debugLoggedActionTotals = false;

  // Build reverse map for quick canonicalization
  function buildReverse(map) {
    const rev = new Map();
    for (const [canon, arr] of Object.entries(map || {})) {
      if (!Array.isArray(arr)) continue;
      for (const raw of arr) rev.set(String(raw).toLowerCase(), canon);
    }
    return rev;
  }

  return rows.map((row) => {
    const out = Array.isArray(row) ? [...row] : { ...row };

    for (const src of sources) {
      const { from, to, totalAs = "_total", map = {}, keepRaw = false } = src;
      const rev = buildReverse(map);
      const arr = getAtPath(out, from);
      const isActionValuesSource = typeof from === "string" && from.includes("action_values");

      if (!Array.isArray(arr)) {
        if (debug && isActionValuesSource && !debugLoggedMissingActionValues) {
          console.info("[actionsToColumns] action_values source missing or not array", {
            from,
            hasValue: arr != null,
            type: arr == null ? "undefined" : typeof arr,
          });
          debugLoggedMissingActionValues = true;
        }
        continue;
      }

      if (debug && isActionValuesSource && !debugLoggedRawActionValues) {
        console.info("[actionsToColumns] raw action_values sample", arr.slice(0, 5));
        debugLoggedRawActionValues = true;
      }

      // Sum by action_type
      const totals = Object.create(null);
      let grand = 0;

      for (const it of arr) {
        if (!it || typeof it !== "object") continue;
        const rawType = (it.action_type ?? it.actionType ?? "").toString();
        const valRaw = it.value;
        const val = Number(valRaw);
        if (!Number.isFinite(val)) continue;

        const canon = resolveCanonicalAction(rawType, rev, customMap);
        totals[canon] = (totals[canon] || 0) + val;
        grand += val;
      }

      // Emit as nested numbers
      for (const [k, v] of Object.entries(totals)) {
        setAtPath(out, `${to}.${k}`, v);
      }
      if (totalAs) {
        setAtPath(out, `${to}.${totalAs}`, grand);
      }

      if (debug) {
        if (isActionValuesSource && !debugLoggedTotals) {
          console.info("[actionsToColumns] aggregated action values", {
            to,
            keys: Object.keys(totals),
            grand,
          });
          debugLoggedTotals = true;
        }

        if (!isActionValuesSource && !debugLoggedActionTotals) {
          console.info("[actionsToColumns] aggregated actions", {
            to,
            keys: Object.keys(totals),
            grand,
          });
          debugLoggedActionTotals = true;
        }
      }

      if (!keepRaw) {
        // Optionally remove the original array to keep rows clean
        setAtPath(out, from, undefined);
      }
    }

    return out;
  });
}

function resolveCanonicalAction(rawType, reverseMap, customConversionMap) {
  const lower = rawType.toLowerCase();

  if (reverseMap.has(lower)) {
    return sanitizeKey(reverseMap.get(lower));
  }

  if (customConversionMap) {
    const mapped =
      customConversionMap[lower] ||
      customConversionMap[rawType] ||
      customConversionMap[stripNonDigits(rawType)] ||
      null;
    if (mapped) {
      return sanitizeKey(mapped);
    }
  }

  return sanitizeKey(rawType);
}

function stripNonDigits(value) {
  if (value == null) return "";
  const digits = String(value).match(/\d+/g);
  return digits ? digits.join("") : String(value);
}

module.exports = { actionsToColumnsRows };
