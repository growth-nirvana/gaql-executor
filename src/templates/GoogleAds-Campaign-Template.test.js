const { GoogleAdsCampaignTemplate } = require('./GoogleAds-Campaign-Template');

describe('GoogleAdsCampaignTemplate', () => {
  const getPipelineStep = (config, stepName) => {
    return config.pipeline.find(step => step.use === stepName);
  }

  const createCredentials = () => {
    return {
      developerToken: "devToken",
      refreshToken: "refreshToken",
      clientId: "clientId",
      clientSecret: "ClientSecret",
      customerId: 'customerId',
      loginCustomerId: 'loginCustomerId' // Optional
    }
  }
  describe('forPerformanceAnalysis', () => {
    it('should return the correct group by attributes when specified', () => {
      const report = GoogleAdsCampaignTemplate.forPerformanceAnalysis(
        createCredentials(),
        '2025-08-01',
        '2025-08-15'
      );
      const config = report.getConfig();
      groupByAttributes = getPipelineStep(config, 'group').by;
      expect(groupByAttributes).toEqual([
        "customer.id",
        "customer.descriptive_name",
        "campaign.id",
        "campaign.name",
        "campaign.bidding_strategy_type",
        "campaign.advertising_channel_type",
        "campaign_budget.amount_micros",
        "campaign_budget.recommended_budget_amount_micros"
      ]);
    });

    it('should return the correct group by attributes when specified', () => {
      const report = GoogleAdsCampaignTemplate.forPerformanceAnalysis(
        createCredentials(),
        '2025-08-01',
        '2025-08-15',
        {
          attributes: [
            "campaign.name"
          ]
        }
      );
      const config = report.getConfig();
      const groupByAttributes = getPipelineStep(config, 'group').by;
      expect(groupByAttributes).toEqual(["campaign.name"]);
    });
  });

});