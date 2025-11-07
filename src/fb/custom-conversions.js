const bizSdk = require("facebook-nodejs-business-sdk");

const { FacebookAdsApi, AdAccount } = bizSdk;

const DEFAULT_FIELDS = [
  "account_id",
  "id",
  "creation_time",
  "name",
  "business",
  "is_archived",
  "is_unavailable",
  "last_fired_time",
];

async function fetchCustomConversions({ accessToken, accountId, fields = DEFAULT_FIELDS, limit = 500, maxPages = 25 }) {
  if (!accessToken) throw new Error("Meta accessToken is required to fetch custom conversions");
  if (!accountId) throw new Error("Meta accountId is required to fetch custom conversions");

  // Initialize SDK if not already initialised by caller.
  FacebookAdsApi.init(accessToken);

  const account = new AdAccount(`act_${accountId}`);
  let cursor = await account.getCustomConversions(fields, { limit });
  const collected = [];
  let pages = 1;

  collected.push(...cursor.map((c) => c._data || c));

  while (cursor.hasNext() && pages < maxPages) {
    cursor = await cursor.next();
    collected.push(...cursor.map((c) => c._data || c));
    pages += 1;
  }

  return collected;
}

function buildCustomConversionMap(conversions = []) {
  const map = Object.create(null);

  for (const conversion of conversions) {
    if (!conversion || !conversion.id) continue;

    const id = String(conversion.id);
    const sanitizedName = sanitizeKey(conversion.name);
    const canonicalBase = sanitizedName ? `custom_conversion_${sanitizedName}` : null;
    const canonical = canonicalBase ? `${canonicalBase}_${id}` : `offsite_conversion_custom_${id}`;

    map[id] = canonical;
    map[id.toLowerCase()] = canonical;
    map[canonical] = canonical;
    map[canonical.toLowerCase()] = canonical;

    if (sanitizedName) {
      map[sanitizedName] = canonical;
      map[`custom_conversion_${sanitizedName}`] = canonical;
      map[`offsite_conversion_custom_${sanitizedName}`] = canonical;
      map[`custom_${sanitizedName}`] = canonical;
    }
  }

  return map;
}

function sanitizeKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

module.exports = {
  DEFAULT_FIELDS,
  fetchCustomConversions,
  buildCustomConversionMap,
};

