const BASIC_DIMENSIONS = [
  'advertiser_id',
  'campaign_id',
  'adgroup_id',
  'ad_id',
  'stat_time_day',
  'stat_time_hour',
  'country_code',
  'ad_type',
  'search_terms',
  'search_keyword',
  'match_type',
];

const DEFAULT_ACCOUNT_DIMENSIONS = ['advertiser_id'];

const BASIC_CORE_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'reach',
  'cost_per_1000_reached',
  'frequency',
  'conversion',
  'cost_per_conversion',
  'conversion_rate',
  'conversion_rate_v2',
  'result',
  'cost_per_result',
  'result_rate',
];

const WEBSITE_PURCHASE_METRICS = [
  'complete_payment',
  'cost_per_complete_payment',
  'complete_payment_rate',
  'value_per_complete_payment',
  'total_complete_payment_rate',
  'total_complete_payment_value',
  'complete_payment_roas',
];

const DEFAULT_ACCOUNT_METRICS = ['spend', 'impressions', 'clicks', 'reach', 'frequency'];

const ALLOWED_ACCOUNT_METRICS = [
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'reach',
  'frequency',
  'conversion',
  'cost_per_conversion',
  'conversion_rate',
  'result',
  'cost_per_result',
  'result_rate',
  'complete_payment',
  'cost_per_complete_payment',
  'complete_payment_rate',
  'complete_payment_roas',
  'value_per_complete_payment',
];

module.exports = {
  BASIC_DIMENSIONS,
  DEFAULT_ACCOUNT_DIMENSIONS,
  BASIC_CORE_METRICS,
  WEBSITE_PURCHASE_METRICS,
  DEFAULT_ACCOUNT_METRICS,
  ALLOWED_ACCOUNT_METRICS,
};

