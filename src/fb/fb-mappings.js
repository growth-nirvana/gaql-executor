// src/fb-mappings.js

// Supported high-level entities → Insights "level"
const LEVEL_BY_ENTITY = {
  account: "account",
  campaign: "campaign",
  ad_set: "adset",
  adset: "adset",     // alias
  ad: "ad",
};

// Attribute/ID/name fields we can project back into nested shapes
// left = your cross-platform path; right = Insights field name
const ATTR_FIELDS = {
  "account.id": "account_id",
  "account.name": "account_name",
  "campaign.id": "campaign_id",
  "campaign.name": "campaign_name",
  "campaign.objective": "objective",
  "campaign.primary_attribution": "primary_attribution",
  "adset.id": "adset_id",
  "adset.name": "adset_name",
  "ad.id": "ad_id",
  "ad.name": "ad_name",
  // Add more as needed (objective, status, etc.)
};

// Metrics we can read directly from Insights
const METRIC_FIELDS = {
  "metrics.spend": "spend",
  "metrics.impressions": "impressions",
  "metrics.clicks": "clicks",
  "metrics.ctr": "ctr",
  "metrics.cpc": "cpc",
  "metrics.cpm": "cpm",
  "metrics.reach": "reach",
  // Conversions on Meta are nuanced (actions, action_values arrays).
  // Start simple; extend later with action_attribution_windows, action_breakdowns, etc.
};

// Segments → either a breakdown or a time control
// - "segments.date" is special (time_increment)
// - Others map to breakdowns
const SEGMENT_TO_BREAKDOWN = {
  "segments.age": "age",
  "segments.gender": "gender",
  "segments.country": "country",
  "segments.region": "region",
  "segments.publisher_platform": "publisher_platform",
  "segments.platform_position": "platform_position",
  "segments.device_platform": "device_platform",
  "segments.impression_device": "impression_device",
};

// Export
module.exports = {
  LEVEL_BY_ENTITY,
  ATTR_FIELDS,
  METRIC_FIELDS,
  SEGMENT_TO_BREAKDOWN,
};
