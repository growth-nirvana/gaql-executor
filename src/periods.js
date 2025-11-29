// periods.js

// ---------- tiny date utils ----------
function parseYmd(s) {
  if (typeof s !== "string") return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d)); // UTC midnight
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
function endOfMonthUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}
function startOfMonthUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function getPreviousFullMonth(fromDate) {
  // Get the month of the from_date, go back one month, return full month range
  const from = parseYmd(fromDate);
  if (!from) return null;
  
  // Go back one month
  const prevMonth = shiftMonthClamp(from, -1);
  const prevYear = prevMonth.getUTCFullYear();
  const prevMonthIndex = prevMonth.getUTCMonth();
  
  // Get first and last day of that month
  const firstDay = new Date(Date.UTC(prevYear, prevMonthIndex, 1));
  const lastDay = endOfMonthUTC(firstDay);
  
  return {
    from_date: formatYmd(firstDay),
    to_date: formatYmd(lastDay)
  };
}
function shiftYearClamp(d, dy) {
  const y = d.getUTCFullYear() + dy;
  const m = d.getUTCMonth();
  const dom = d.getUTCDate();
  const safeDom = Math.min(dom, lastDomUTC(y, m));
  return new Date(Date.UTC(y, m, safeDom));
}
function shiftMonthClamp(d, dm) {
  // Move months while clamping day-of-month to target month length
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const targetY = y + Math.floor((m + dm) / 12);
  const targetM = (m + dm + 1200) % 12;
  const dom = d.getUTCDate();
  const safeDom = Math.min(dom, lastDomUTC(targetY, targetM));
  return new Date(Date.UTC(targetY, targetM, safeDom));
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

// ---------- main step ----------
/**
 * cfg:
 * {
 *   baseline?: {
 *     mode?: "previous_period" | "previous_year" | "yoy" | "previous_month_same_span" | "previous_full_month"
 *   },
 *   granularity?: "daily" | "weekly" | "monthly" // Optional: time granularity for trends
 * }
 */
function periodsStep(rows, cfg = {}, ctx) {
  const report = ctx?.options?.report || {};
  const fromIso = report.from_date;
  const toIso = report.to_date;

  if (!fromIso || !toIso) {
    console.warn("[periods] report.from_date/to_date required to compute periods. Skipping.");
    return rows;
  }

  const f = parseYmd(fromIso);
  const t = parseYmd(toIso);
  const L = lenDaysIncl(f, t);

  const mode = (cfg.baseline?.mode || "previous_period").toLowerCase();

  let baseFrom, baseTo;

  if (mode === "previous_year" || mode === "yoy") {
    // Same calendar span, minus one year (clamped for Feb 29)
    baseFrom = shiftYearClamp(f, -1);
    baseTo   = shiftYearClamp(t, -1);

  } else if (mode === "previous_month_same_span") {
    // Same day-of-month as current.from, previous month, for L days (clamped to that month's end)
    baseFrom = shiftMonthClamp(f, -1);
    const candidateEnd = new Date(baseFrom.getTime() + (L - 1) * 86400000);
    const monthEnd = endOfMonthUTC(baseFrom);
    baseTo = candidateEnd <= monthEnd ? candidateEnd : monthEnd;

  } else if (mode === "previous_full_month") {
    // Full previous calendar month (1st through last day of previous month)
    const prevMonth = getPreviousFullMonth(fromIso);
    if (prevMonth) {
      baseFrom = parseYmd(prevMonth.from_date);
      baseTo = parseYmd(prevMonth.to_date);
    } else {
      // Fallback to previous_period if date parsing fails
      const prevTo = new Date(f.getTime() - 86400000);
      baseTo = prevTo;
      baseFrom = new Date(prevTo.getTime() - (L - 1) * 86400000);
    }

  } else {
    // previous_period (default): same length ending the day before current.from
    const prevTo = new Date(f.getTime() - 86400000);
    baseTo = prevTo;
    baseFrom = new Date(prevTo.getTime() - (L - 1) * 86400000);
  }

  const currentLen = L;
  const baseLen = lenDaysIncl(baseFrom, baseTo);

  const periods = {
    mode,
    current: {
      from_date: formatYmd(f),
      to_date:   formatYmd(t),
      length_days: currentLen,
      label: labelRange(formatYmd(f), formatYmd(t)),
      partial: false // set this yourself if you want to mark MTD
    },
    baseline: {
      from_date: formatYmd(baseFrom),
      to_date:   formatYmd(baseTo),
      length_days: baseLen,
      label: labelRange(formatYmd(baseFrom), formatYmd(baseTo)),
      relation: mode
    },
    alignment: {
      // strategy is informational; consumers can rely on matched_upto_day for equality
      strategy:
        mode === "previous_year" || mode === "yoy" ? "calendar" :
        mode === "previous_full_month" ? "full_month" :
        mode === "previous_month_same_span" ? (baseLen === currentLen ? "same_length" : "calendar_slice") :
                                               "same_length",
      matched_upto_day: baseLen === currentLen,
      timezone: "UTC"
    }
  };

  ctx.state.periods = periods;
  
  // Store granularity metadata if provided (for trends)
  if (cfg.granularity && ctx?.state) {
    ctx.state.envelopeData ||= {};
    ctx.state.envelopeData.granularity = {
      type: cfg.granularity,
      date_field: "segments.date",
      description: cfg.granularity === 'daily' 
        ? "Daily data - segments.date represents each calendar day"
        : cfg.granularity === 'weekly'
        ? "Weekly data - segments.date represents the start of each week (Monday)"
        : "Monthly data - segments.date represents the first day of each month"
    };
  }
  
  return rows; // no shape change
}

module.exports = { periodsStep };