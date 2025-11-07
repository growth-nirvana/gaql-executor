function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(value) {
  if (!value) return null;
  // stat_time_day is usually YYYY-MM-DD; ensure it stays that way
  return String(value).slice(0, 10);
}

function shapeAccountRows(list = [], options = {}) {
  const {
    advertiserId,
    advertiserName,
  } = options;

  return list.map((item = {}) => {
    const metrics = item.metrics || {};
    const dimensions = item.dimensions || {};

    const cost = toNumber(metrics.spend ?? metrics.cost);
    const impressions = toNumber(metrics.impressions);
    const clicks = toNumber(metrics.clicks);
    const conversions = toNumber(
      metrics.conversion ??
      metrics.complete_payment ??
      metrics.total_complete_payment ??
      metrics.result ??
      metrics.total_actions
    );
    const conversionsValue = toNumber(
      metrics.total_complete_payment_value ??
      metrics.purchase_value ??
      metrics.result_value
    );
    const result = toNumber(metrics.result);
    const reach = toNumber(metrics.reach);
    const frequency = toNumber(metrics.frequency);
    const roas = toNumber(
      metrics.complete_payment_roas ??
      metrics.onsite_purchases_roas ??
      (cost ? conversionsValue / cost : 0)
    );

    const statDate = normalizeDate(dimensions.stat_time_day);

    return {
      account: {
        id: String(advertiserId ?? item.advertiser_id ?? ""),
        name: item.advertiser_name || advertiserName || null,
      },
      segments: statDate ? { date: statDate } : undefined,
      metrics: {
        cost,
        spend: cost,
        impressions,
        clicks,
        conversions,
        conversions_value: conversionsValue,
        result,
        reach,
        frequency,
        roas,
      },
      raw: item,
    };
  });
}

function shapeCampaignRows(list = []) {
  return list.map((item = {}) => ({
    campaign: {
      campaign_id: item.campaign_id ? String(item.campaign_id) : null,
      campaign_name: item.campaign_name || null,
      campaign_status: item.operation_status || item.secondary_status || null,
      operation_status: item.operation_status || null,
      secondary_status: item.secondary_status || null,
      objective_type: item.objective_type || null,
      buying_type: item.sales_destination || null,
    },
    raw: item,
  }));
}

module.exports = {
  shapeAccountRows,
  shapeCampaignRows,
  toNumber,
};

