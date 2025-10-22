class FacebookCampaignTemplate {
  constructor(config) {
    this.credentials = config.credentials;
    this.config = {
      credentials: this.credentials,
      report: config.report || {},
      pipeline: config.pipeline || [],
      output: config.output || { mode: 'envelope', include: [] },
    }
  }

  getConfig() {
    return this.config;
  }
  
  static getBaseCampaignReport() {
    return {
      entity: 'campaign',
      attributes: [
        'account.id',
        'account.name',
        'campaign.id',
        'campaign.name',
        'campaign.objective',
      ],
      metrics: [
        'metrics.spend',
        'metrics.clicks',
        'metrics.impressions',
        "metrics.actions",
        "metrics.action_values",
      ],
      segments: [],
      breakdowns: [],
    } 
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate) {
    const report = {
      ...this.getBaseCampaignReport(),
      from_date: fromDate,
      to_date: toDate,
    };

    return new FacebookCampaignTemplate({
      credentials,
      report,
      pipeline: [
        { 
          use: 'actionsToColumns',
          sources: [
            { from: 'metrics.actions', to: 'metrics.actions_by_type', totalAs: '_total', keepRaw: true },
            { from: 'metrics.action_values', to: 'metrics.action_values_by_type', totalAs: '_total_value', keepRaw: true },
          ]
        },
      ]
    });
  }
}

module.exports = { FacebookCampaignTemplate };
