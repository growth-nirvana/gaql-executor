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

// Campaign entity fields (from /campaigns endpoint, not Insights)
// Maps our cross-platform path to Facebook API field names
const CAMPAIGN_ENTITY_FIELDS = {
  "campaign.id": "id",
  "campaign.name": "name",
  "campaign.objective": "objective",
  "campaign.status": "status",
  "campaign.configured_status": "configured_status",
  "campaign.effective_status": "effective_status",
  "campaign.buying_type": "buying_type",
  "campaign.budget_remaining": "budget_remaining",
  "campaign.daily_budget": "daily_budget",
  "campaign.lifetime_budget": "lifetime_budget",
  "campaign.spend_cap": "spend_cap",
  "campaign.start_time": "start_time",
  "campaign.stop_time": "stop_time",
  "campaign.created_time": "created_time",
  "campaign.updated_time": "updated_time",
  "campaign.bid_strategy": "bid_strategy",
  "campaign.pacing_type": "pacing_type",
  "campaign.special_ad_categories": "special_ad_categories",
  "campaign.special_ad_category": "special_ad_category",
  "campaign.special_ad_category_country": "special_ad_category_country",
  "campaign.source_campaign_id": "source_campaign_id",
  "campaign.boosted_object_id": "boosted_object_id",
  "campaign.topline_id": "topline_id",
  "campaign.can_create_brand_lift_study": "can_create_brand_lift_study",
  "campaign.can_use_spend_cap": "can_use_spend_cap",
  "campaign.has_secondary_skadnetwork_reporting": "has_secondary_skadnetwork_reporting",
  "campaign.is_skadnetwork_attribution": "is_skadnetwork_attribution",
  "campaign.smart_promotion_type": "smart_promotion_type",
  "campaign.budget_rebalance_flag": "budget_rebalance_flag",
  "campaign.last_budget_toggling_time": "last_budget_toggling_time",
  "campaign.primary_attribution": "primary_attribution",
  "account.id": "account_id",
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
  "metrics.frequency": "frequency",
  // Conversions on Meta are nuanced (actions, action_values arrays).
  // Start simple; extend later with action_attribution_windows, action_breakdowns, etc.

  "metrics.actions": "actions",
  "metrics.action_values": "action_values",
  "metrics.conversions_api": "conversions",  // API conversions field (stringified JSON) - different from calculated metrics.conversions
  "metrics.conversion_values_api": "conversion_values",  // API conversion_values field (stringified JSON) - different from calculated metrics.conversions_value
  "metrics.cost_per_action_type": "cost_per_action_type",
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
  CAMPAIGN_ENTITY_FIELDS,
};
