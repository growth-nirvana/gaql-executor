const { BaseTemplate } = require('./BaseTemplate');

class GoogleAdsAdTemplate extends BaseTemplate {

  static getBaseReport() {
    return {
      entity: 'ad_group_ad',
      attributes: [
        'ad_group_ad.resource_name',
        'ad_group_ad.ad.id',
        'ad_group_ad.ad.name',
        'ad_group_ad.status',
        'ad_group_ad.ad_strength',
        'ad_group_ad.ad.type',
        'ad_group.id',
        'ad_group.name',
        "ad_group_ad.ad.responsive_search_ad.headlines",
        'campaign.id',
        'campaign.name',
        'customer.descriptive_name',
        'customer.id',
      ],
      metrics: [
        'metrics.cost_micros',
        'metrics.clicks',
        'metrics.impressions',
        'metrics.conversions',
        'metrics.conversions_value',
      ]
    }
  }
}

module.exports = { GoogleAdsAdTemplate };