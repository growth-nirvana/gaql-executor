// src/fb-translate.js
const {
  LEVEL_BY_ENTITY,
  ATTR_FIELDS,
  METRIC_FIELDS,
  SEGMENT_TO_BREAKDOWN,
} = require("./fb-mappings");

// tiny utils
const setAtPath = (obj, path, value) => {
  const parts = String(path).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
  return obj;
};

function pickInsightsLevel(entity) {
  const level = LEVEL_BY_ENTITY[String(entity || "").toLowerCase()];
  if (!level) throw new Error(`Unsupported entity for Meta Insights: ${entity}`);
  return level;
}

function toFields(attributes = [], metrics = []) {
  const fields = new Set();

  // project attributes
  for (const a of attributes) {
    const f = ATTR_FIELDS[a];
    if (f) fields.add(f);
  }
  // metrics
  for (const m of metrics) {
    const f = METRIC_FIELDS[m];
    if (f) fields.add(f);
  }

  // Always include date_start/date_stop so we can surface segments.date if desired
  fields.add("date_start");
  fields.add("date_stop");

  return Array.from(fields);
}

function toBreakdowns(segments = []) {
  const b = [];
  for (const s of segments) {
    if (s === "segments.date") continue; // handled by time_increment
    const bd = SEGMENT_TO_BREAKDOWN[s];
    if (bd) b.push(bd);
  }
  return b;
}

function toTime(report) {
  const { from_date, to_date, segments = [] } = report || {};
  const params = {};

  if (from_date && to_date) {
    params.time_range = { since: from_date, until: to_date };
  }
  // If "segments.date" requested, ask for daily rows
  if (segments.includes("segments.date")) {
    params.time_increment = 1; // daily
  }

  return params;
}

// Map your generic constraints → Meta "filtering" param
// Docs reference: filtering is an array of { field, operator, value }. :contentReference[oaicite:1]{index=1}
const OP_MAP = {
  "=": "EQUAL",
  "!=": "NOT_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  IN: "IN",
  "NOT IN": "NOT_IN",
  CONTAINS: "CONTAIN",          // Meta uses CONTAIN (and STARTS_WITH)
  "NOT CONTAINS": "NOT_CONTAIN",
  "STARTS_WITH": "STARTS_WITH",
  "NOT STARTS_WITH": "NOT_STARTS_WITH",
};

function toFiltering(constraints = []) {
  if (!Array.isArray(constraints)) return [];
  const out = [];

  for (const c of constraints) {
    if (typeof c === "string") continue; // GAQL-like raw not supported here; skip
    if (c && c.key && c.op) {
      // Map your cross-platform field name → Insights field name if we know it
      const field =
        ATTR_FIELDS[c.key] ||
        METRIC_FIELDS[c.key] ||
        // Some filters accept decorated names like "campaign.name"
        c.key;
      const operator = OP_MAP[c.op] || "EQUAL";
      const value = c.val;
      out.push({ field, operator, value });
    } else if (c && typeof c === "object") {
      // shorthand: { "campaign.name": "Foo" }
      for (const [k, v] of Object.entries(c)) {
        const field = ATTR_FIELDS[k] || METRIC_FIELDS[k] || k;
        out.push({ field, operator: "EQUAL", value: v });
      }
    }
  }
  return out;
}

function toActionBreakdowns(report = {}) {
  // 1) Explicit override via report.parameters.action_breakdowns (array)
  const ab = report?.parameters?.action_breakdowns;
  if (Array.isArray(ab)) return [...ab];

  // 2) Shorthand: if user asks for segments.action_type, request action_type
  if (Array.isArray(report.segments) && report.segments.includes("segments.action_type")) {
    return ["action_type"];
  }

  // 3) Default: none
  return [];
}

// Build Insights params/fields from your report
function buildInsightsQuery(report) {
  const level = pickInsightsLevel(report.entity);
  const fields = toFields(report.attributes, report.metrics);
  const params = {
    level,
    fields, // SDK allows passing fields separately; we keep also in params for clarity
    breakdowns: toBreakdowns(report.segments),
    action_breakdowns: toActionBreakdowns(report),   // ← NEW: default [] unless requested
    ...toTime(report),
  };

  // Set default limit to 500 if not specified (max page size for Facebook Insights API)
  params.limit = report.limit || 500;
  if (report.constraints) {
    const filtering = toFiltering(
      Array.isArray(report.constraints) ? report.constraints : [report.constraints]
    );
    if (filtering.length) params.filtering = filtering;
  }

  // Optional pass-through: attribution windows, etc.
  if (report.parameters?.action_attribution_windows) {
    params.action_attribution_windows = report.parameters.action_attribution_windows;
  }

  return { level, fields, params };
}

// Shape one Insights row back to your nested schema
function shapeRow(row, report) {
  const out = {};

  // attributes
  for (const [path, field] of Object.entries(ATTR_FIELDS)) {
    if (row[field] != null && report.attributes?.includes(path)) {
      setAtPath(out, path, row[field]);
    }
  }

  // metrics (scalars)
  for (const [path, field] of Object.entries(METRIC_FIELDS)) {
    if (!report.metrics?.includes(path)) continue;
    const val = row[field];
    if (val == null) continue;

    // For conversions_api and conversion_values_api fields, handle arrays (coerce numeric strings in "value")
    if ((path === "metrics.conversions_api" || path === "metrics.conversion_values_api") && Array.isArray(val)) {
      const arr = val.map((it) => {
        if (it && typeof it === "object" && "value" in it) {
          const v = it.value;
          const n = typeof v === "string" && /^[\d.]+$/.test(v) ? Number(v) : v;
          return { ...it, value: n };
        }
        return it;
      });
      setAtPath(out, path, arr);
      continue;
    }

    // For action arrays, keep as-is but coerce numeric strings in "value"
    if (Array.isArray(val)) {
      const arr = val.map((it) => {
        if (it && typeof it === "object" && "value" in it) {
          const v = it.value;
          const n = typeof v === "string" && /^[\d.]+$/.test(v) ? Number(v) : v;
          return { ...it, value: n };
        }
        return it;
      });
      setAtPath(out, path, arr);
      continue;
    }

    // Otherwise coerce numeric strings
    const n = typeof val === "string" && /^[\d.]+$/.test(val) ? Number(val) : val;
    setAtPath(out, path, n);
  }

  // segments: date
  if (report.segments?.includes("segments.date")) {
    // For daily rows, Insights repeats date_start/date_stop per day
    setAtPath(out, "segments.date", row.date_start);
  }

  // segments: breakdowns we asked for
  for (const [segPath, bd] of Object.entries(SEGMENT_TO_BREAKDOWN)) {
    if (report.segments?.includes(segPath) && row[bd] != null) {
      setAtPath(out, segPath, row[bd]);
    }
  }

  return out;
}

module.exports = {
  buildInsightsQuery,
  shapeRow,
};
