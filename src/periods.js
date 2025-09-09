// periods.js
function parseYmd(s) {
  if (typeof s !== "string") return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}
function formatYmd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function lastDomUTC(year, monthIndex0) {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}
function shiftYearClamp(d, dy) {
  const y = d.getUTCFullYear() + dy;
  const m = d.getUTCMonth();
  const dom = d.getUTCDate();
  const safe = Math.min(dom, lastDomUTC(y, m));
  return new Date(Date.UTC(y, m, safe));
}
function lenDaysIncl(a, b) {
  return Math.round((b - a) / 86400000) + 1;
}
function labelRange(fromIso, toIso) {
  const f = parseYmd(fromIso), t = parseYmd(toIso);
  const fmt = (d) => {
    const yyyy = d.getUTCFullYear();
    const m = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${m} ${dd}, ${yyyy}`;
  };
  return `${fmt(f)} – ${fmt(t)}`;
}

/**
 * cfg:
 * {
 *   baseline?: { mode: "previous_period"|"previous_year"|"yoy" },
 *   partial?:  { policy: "match_upto_day"|"allow_mismatch" } // (reserved for future)
 * }
 */
function periodsStep(rows, cfg = {}, ctx) {
  const report = ctx?.options?.report || {};
  const from = report.from_date;
  const to = report.to_date;

  if (!from || !to) {
    console.warn("[periods] report.from_date/to_date required to compute periods. Skipping.");
    return rows;
  }

  // current
  const f = parseYmd(from);
  const t = parseYmd(to);
  const L = lenDaysIncl(f, t);

  // baseline mode
  const mode = (cfg.baseline?.mode || "previous_period").toLowerCase();

  let baseFrom, baseTo;
  if (mode === "previous_year" || mode === "yoy") {
    baseFrom = shiftYearClamp(f, -1);
    baseTo   = shiftYearClamp(t, -1);
  } else {
    // previous_period: same length ending day before current.from
    baseTo   = new Date(f.getTime() - 86400000);
    baseFrom = new Date(baseTo.getTime() - (L - 1) * 86400000);
  }

  const periods = {
    mode,
    current: {
      from_date: formatYmd(f),
      to_date:   formatYmd(t),
      length_days: L,
      label: labelRange(formatYmd(f), formatYmd(t)),
      partial: false // you can set this yourself if you pass MTD explicitly
    },
    baseline: {
      from_date: formatYmd(baseFrom),
      to_date:   formatYmd(baseTo),
      length_days: L,
      label: labelRange(formatYmd(baseFrom), formatYmd(baseTo)),
      relation: mode
    },
    alignment: {
      strategy: mode === "previous_year" || mode === "yoy" ? "calendar" : "same_length",
      matched_upto_day: true,
      timezone: "UTC"
    }
  };

  ctx.state.periods = periods;
  return rows; // no shape change
}

module.exports = { periodsStep };