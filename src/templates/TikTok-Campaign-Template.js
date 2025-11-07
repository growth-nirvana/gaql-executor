const { BaseTemplate } = require('./BaseTemplate');

class TikTokCampaignTemplate extends BaseTemplate {
  static getBaseCampaignReport() {
    return {
      entity: 'tiktok_campaigns',
      attributes: ['campaign.campaign_id', 'campaign.campaign_name', 'campaign.campaign_status', 'campaign.objective_type', 'campaign.buying_type'],
      metrics: [],
      segments: [],
      constraints: [],
    };
  }

  static forDimension(credentials, fromDate, toDate, config = {}) {
    if (!credentials) {
      throw new Error('TikTokCampaignTemplate.forDimension requires credentials');
    }

    const report = this.getBaseCampaignReport();

    const parameterOverrides = config.parameters || {};

    report.parameters = Object.fromEntries(
      Object.entries({
        page_size: config.pageSize || parameterOverrides.page_size || 50,
        filtering: config.filtering || parameterOverrides.filtering,
        fields: config.fields || parameterOverrides.fields,
        status: config.status || parameterOverrides.status,
        search_word: config.searchWord || parameterOverrides.search_word,
        advertiser_ids: config.advertiserIds || parameterOverrides.advertiser_ids,
        campaign_ids: config.campaignIds || parameterOverrides.campaign_ids,
        sort_field: config.sortField || parameterOverrides.sort_field,
        sort_type: config.sortType || parameterOverrides.sort_type,
      }).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );

    const attributes = Array.isArray(config.attributes) && config.attributes.length
      ? config.attributes
      : [
        'campaign.campaign_id',
        'campaign.campaign_name',
        'campaign.campaign_status',
        'campaign.objective_type',
        'campaign.buying_type',
      ];

    report.attributes = attributes;

    const pipeline = [];

    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: 'deriveDimension', ...derivedDim });
      }
    }

    pipeline.push({
      use: 'group',
      by: attributes,
        aggregates: {},
        rollup: false,
        nulls: 'include',
        orderBy: config.orderBy || [{ field: 'campaign.campaign_name', dir: 'ASC', nulls: 'last' }],
    });

    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: 'filter', ...filterConfig });
    }

    return new TikTokCampaignTemplate({
      credentials,
      report,
      pipeline,
      output: config.output || { mode: 'flat' },
    });
  }
}

module.exports = {
  TikTokCampaignTemplate,
};


