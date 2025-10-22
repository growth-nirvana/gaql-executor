// enum-normalizer.js
const { enums } = require("google-ads-api");

// Helper: reverse { ENABLED: 2, PAUSED: 3 } → { 2: "ENABLED", 3: "PAUSED" }
function reverse(e) {
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === "number") out[v] = k;
  }
  return out;
}

// Map GAQL-like paths → their enum reverse maps
const ENUM_MAPS = {
  "campaign.status": reverse(enums.CampaignStatus),
  "campaign.bidding_strategy_type": reverse(enums.BiddingStrategyType),
  "campaign.advertising_channel_type": reverse(enums.AdvertisingChannelType),
  "campaign_budget.period": reverse(enums.BudgetPeriod),
  "ad_group.status": reverse(enums.AdGroupStatus),
  "ad_group_criterion.status": reverse(enums.AdGroupCriterionStatus),
  "ad_group_criterion.keyword.match_type": reverse(enums.KeywordMatchType),
  "ad_group_ad.status": reverse(enums.AdGroupAdStatus),
  'ad_group_ad.ad.type': reverse(enums.AdType),
  'ad_group_ad.ad_strength': reverse(enums.AdStrength),
  "asset_link.status": reverse(enums.AssetLinkStatus),
  "asset_set_link.status": reverse(enums.AssetSetLinkStatus),
  "customer.status": reverse(enums.CustomerStatus),
  "conversion_action.category": reverse(enums.ConversionActionCategory),
  "conversion_action.type": reverse(enums.ConversionActionType),
  "conversion_action.counting_type": reverse(enums.ConversionActionCountingType),
  "conversion_action.origin": reverse(enums.ConversionOrigin),
  "conversion_action.status": reverse(enums.ConversionActionStatus),
  "conversion_action.attribution_model_settings.attribution_model": reverse(enums.AttributionModel),
  "conversion_action.attribution_model_settings.data_driven_model_status": reverse(enums.DataDrivenModelStatus),
  // Add more if you query them:
  "change_event.change_resource_type": reverse(enums.ChangeEventResourceType),
  "change_event.resource_change_operation": reverse(enums.ResourceChangeOperation),
  "change_event.client_type": reverse(enums.ChangeClientType),
  "search_term_view.status": reverse(enums.SearchTermTargetingStatus),
};

function toSnake(s) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

function maybeMapStatus(pathSnake, value) {
  const map = ENUM_MAPS[pathSnake];
  if (!map) return value;

  // already a string name
  if (typeof value === "string" && !/^\d+$/.test(value)) return value;

  const code = typeof value === "number" ? value : Number(value);
  return Number.isFinite(code) && map[code] ? map[code] : value;
}

function makeStatusesReadableRow(row) {
  const clone = Array.isArray(row) ? [...row] : { ...row };

  function walk(obj, stack) {
    for (const [k, v] of Object.entries(obj)) {
      const pathSnake = [...stack, k].map(toSnake).join(".");

      const mapped = maybeMapStatus(pathSnake, v);
      if (mapped !== v) {
        obj[k] = mapped;
        continue;
      }

      if (v && typeof v === "object") {
        obj[k] = Array.isArray(v)
          ? v.map((it) =>
              it && typeof it === "object" ? walk({ ...it }, [...stack, k]) : it
            )
          : walk({ ...v }, [...stack, k]);
      }
    }
    return obj;
  }

  return walk(clone, []);
}

function makeStatusesReadable(rows) {
  return rows.map((r) => makeStatusesReadableRow(r));
}

module.exports = { makeStatusesReadable };