// format-micros.js

// Replace the original field with numeric units (e.g., 1234.56)
// { use: "formatMicros", fields: ["metrics.cost_micros"], mode: "replace", output: "number" }

// // Keep original, add pretty EUR value
// { use: "formatMicros", fields: ["metrics.cost_micros"], currency: "EUR" }

// // Different suffix
// { use: "formatMicros", fields: ["metrics.cost_micros"], suffix: "_formatted" }



function toNumber(val) {
  if (val == null) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string" && /^-?\d+$/.test(val)) return Number(val);
  return Number.NaN;
}

function microsToCurrency(micros, currency) {
  const n = toNumber(micros);
  if (!Number.isFinite(n)) return null;
  const units = n / 1_000_000;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(units);
}

function getParentAndKey(obj, pathParts) {
  // returns { parent, key } where parent[key] is the target leaf
  let parent = obj;
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    if (!parent || typeof parent !== "object") return { parent: null, key: null };
    parent = parent[part];
  }
  const key = pathParts[pathParts.length - 1];
  return { parent, key };
}

/**
 * rows: array of GAQL rows
 * cfg = {
 *   fields: ["metrics.cost_micros", ...],    // required
 *   currency: "USD",                          // default "USD"
 *   mode: "add" | "replace",                  // default "add"
 *   suffix: "_pretty",                        // used when mode="add"
 *   output: "string" | "number"               // pretty currency vs numeric units; default "string"
 * }
 */
function formatMicrosRows(rows, cfg = {}) {
  const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
  if (fields.length === 0) return rows;

  const currency = cfg.currency || "USD";
  const mode = cfg.mode || "add";
  const suffix = cfg.suffix || "_pretty";
  const output = cfg.output || "string";

  return rows.map((row) => {
    // shallow clone top-level; nested objects cloned only if touched
    const out = Array.isArray(row) ? [...row] : { ...row };

    for (const path of fields) {
      const parts = path.split(".");
      const { parent, key } = getParentAndKey(out, parts);
      if (!parent || key == null) continue;

      const raw = parent[key];
      if (raw == null) continue;

      // compute formatted value
      const n = toNumber(raw);
      if (!Number.isFinite(n)) continue;

      const asUnits = n / 1_000_000;
      const formatted =
        output === "number" ? asUnits : microsToCurrency(n, currency);

      if (mode === "replace") {
        parent[key] = formatted;
      } else {
        // non-destructive: add sibling field
        parent[key + suffix] = formatted;
      }
    }

    return out;
  });
}

module.exports = { formatMicrosRows, microsToCurrency };