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
  const { accessToken, accountId } = credentials;

  if (!accessToken || !accountId) {
    return rows;
  }

  const cacheKey = `customConversions:${accountId}`;
  const now = Date.now();

  if (ctx.cache && ctx.cache.has(cacheKey)) {
    const cached = ctx.cache.get(cacheKey);
    if (cached && (!cached.expiresAt || cached.expiresAt > now)) {
      ctx.state.customConversionTypeMap = cached.map;
      return rows;
    }
  }

  const fields = Array.isArray(cfg.fields) && cfg.fields.length ? cfg.fields : DEFAULT_FIELDS;

  if (cfg.log !== false) {
    console.info("[loadCustomConversions] fetching custom conversions", {
      accountId,
      fields,
      limit: cfg.limit,
      maxPages: cfg.maxPages,
    });
  }

  const conversions = await fetchCustomConversions({
    accessToken,
    accountId,
    fields,
    limit: cfg.limit,
    maxPages: cfg.maxPages,
  });

  if (cfg.log !== false) {
    const count = Array.isArray(conversions) ? conversions.length : 0;
    console.info("[loadCustomConversions] fetched custom conversions", {
      accountId,
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

  ctx.state.customConversionTypeMap = map;

  if (ctx.cache) {
    ctx.cache.set(cacheKey, {
      map,
      expiresAt: now + (cfg.cacheTtlMs || DEFAULT_CACHE_TTL_MS),
    });
  }

  return rows;
}

module.exports = { loadCustomConversionsStep };

