const {
  DEFAULT_FIELDS,
  fetchCustomConversions,
  buildCustomConversionMap,
} = require("./custom-conversions");

const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadCustomConversionsStep(rows, cfg = {}, ctx = {}) {
  if (!ctx || !ctx.state) return rows;
  if (cfg && cfg.enabled === false) return rows;

  if (ctx.state.customConversionTypeMap) {
    return rows;
  }

  const { credentials = {} } = ctx.options || {};
  const { accessToken, accountIds, accountId } = credentials;
  
  // Support both accountIds array and accountId single value
  // For multi-account, use first accountId for custom conversions (account-specific)
  const targetAccountId = (accountIds && accountIds.length > 0) ? accountIds[0] : accountId;

  if (!accessToken || !targetAccountId) {
    return rows;
  }

  const cacheKey = `customConversions:${targetAccountId}`;
  const now = Date.now();

  if (ctx.cache && ctx.cache.has(cacheKey)) {
    const cached = ctx.cache.get(cacheKey);
    if (cached && (!cached.expiresAt || cached.expiresAt > now)) {
      ctx.state.customConversionTypeMap = cached.map;
      ctx.state.customConversionLabelMap = cached.labels || {};
      return rows;
    }
  }

  const fields = Array.isArray(cfg.fields) && cfg.fields.length ? cfg.fields : DEFAULT_FIELDS;

  if (cfg.log !== false) {
    console.info("[loadCustomConversions] fetching custom conversions", {
      accountId: targetAccountId,
      fields,
      limit: cfg.limit,
      maxPages: cfg.maxPages,
    });
  }

  const conversions = await fetchCustomConversions({
    accessToken,
    accountId: targetAccountId,
    fields,
    limit: cfg.limit,
    maxPages: cfg.maxPages,
  });

  if (cfg.log !== false) {
    const count = Array.isArray(conversions) ? conversions.length : 0;
    console.info("[loadCustomConversions] fetched custom conversions", {
      accountId: targetAccountId,
      count,
    });
    if (count) {
      console.info(
        "[loadCustomConversions] sample custom conversions",
        conversions.slice(0, 5).map((c) => ({
          id: c?.id,
          name: c?.name,
          last_fired_time: c?.last_fired_time,
          is_unavailable: c?.is_unavailable,
        }))
      );
    }
  }

  const map = buildCustomConversionMap(conversions);

  const labels = {};
  for (const conversion of conversions) {
    if (!conversion || !conversion.id) continue;
    const id = String(conversion.id);
    const canonical = map[id] || map[id.toLowerCase()];
    const label = conversion.name || id;
    if (canonical) {
      labels[canonical] = label;
    }
  }

  ctx.state.customConversionTypeMap = map;
  ctx.state.customConversionLabelMap = labels;

  if (ctx.cache) {
    ctx.cache.set(cacheKey, {
      map,
      labels,
      expiresAt: now + (cfg.cacheTtlMs || DEFAULT_CACHE_TTL_MS),
    });
  }

  return rows;
}

module.exports = { loadCustomConversionsStep };

