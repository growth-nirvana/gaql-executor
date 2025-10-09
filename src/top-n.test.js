const { topNStep } = require('./top-n');

describe('topNStep', () => {
  // Helper function to create test data with campaigns in random order
  const createTestResults = () => [
    { 
      campaign: { id: "camp_003", name: "Campaign C" }, 
      metrics: { cost_share: 0.15, cost: 600, clicks: 200, impressions: 2000 } 
    },
    { 
      campaign: { id: "camp_001", name: "Campaign A" }, 
      metrics: { cost_share: 0.45, cost: 1800, clicks: 600, impressions: 6000 } 
    },
    { 
      campaign: { id: "camp_005", name: "Campaign E" }, 
      metrics: { cost_share: 0.05, cost: 200, clicks: 50, impressions: 500 } 
    },
    { 
      campaign: { id: "camp_002", name: "Campaign B" }, 
      metrics: { cost_share: 0.25, cost: 1000, clicks: 300, impressions: 3000 } 
    },
    { 
      campaign: { id: "camp_004", name: "Campaign D" }, 
      metrics: { cost_share: 0.10, cost: 400, clicks: 100, impressions: 1000 } 
    },
    // Add a rollup row to test excludeRollup functionality
    { 
      campaign: { id: "ALL", name: "ALL" }, 
      metrics: { cost_share: 1.0, cost: 4000, clicks: 1250, impressions: 12500 },
      __rollup: true
    }
  ];

  describe('basic functionality', () => {
    it('should return top N items sorted by metric in descending order by default', () => {
      const rows = createTestResults();
      const config = {
        by: ["campaign.id", "campaign.name"],
        metric: "metrics.cost_share",
        n: 3,
        include: ["metrics.cost", "metrics.clicks"],
        excludeRollup: true,
        as: "top_campaigns"
      };
      const ctx = { state: {} };

      const result = topNStep(rows, config, ctx);

      console.log(JSON.stringify(result, null, 2));

      // Should not modify original rows
    });

    it('should include all specified fields in the result', () => {
      const rows = createTestResults();
      const config = {
        by: ["campaign.id", "campaign.name"],
        metric: "metrics.cost_share",
        n: 2,
        include: ["metrics.cost", "metrics.clicks", "metrics.impressions"],
        excludeRollup: true,
        as: "top_campaigns"
      };
      const ctx = { state: {} };

      topNStep(rows, config, ctx);

      const topCampaigns = ctx.state.envelopeData.top_campaigns;
      expect(topCampaigns[0]).toEqual({
        campaign: { id: "camp_001", name: "Campaign A" },
        metrics: { cost_share: 0.45, cost: 1800, clicks: 600, impressions: 6000 }
      });
    });
});

  //   it('should respect the n parameter for number of results', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 2,
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
  //     expect(topCampaigns).toHaveLength(2);
  //   });
  // });

  // describe('sorting direction', () => {
  //   it('should sort in descending order by default', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 5,
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
  //     const costShares = topCampaigns.map(item => item.metrics.cost_share);
      
  //     // Should be in descending order
  //     expect(costShares).toEqual([0.45, 0.25, 0.15, 0.10, 0.05]);
  //   });

  //   it('should sort in ascending order when direction is ASC', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 5,
  //       direction: "ASC",
  //       excludeRollup: true,
  //       as: "bottom_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const bottomCampaigns = ctx.state.envelopeData.bottom_campaigns;
  //     const costShares = bottomCampaigns.map(item => item.metrics.cost_share);
      
  //     // Should be in ascending order
  //     expect(costShares).toEqual([0.05, 0.10, 0.15, 0.25, 0.45]);
  //   });

  //   it('should sort in descending order when direction is DESC', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 5,
  //       direction: "DESC",
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
  //     const costShares = topCampaigns.map(item => item.metrics.cost_share);
      
  //     // Should be in descending order
  //     expect(costShares).toEqual([0.45, 0.25, 0.15, 0.10, 0.05]);
  //   });
  // });

  // describe('rollup handling', () => {
  //   it('should exclude rollup rows when excludeRollup is true', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 10, // More than non-rollup rows
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
      
  //     // Should have 5 non-rollup campaigns, not 6 total
  //     expect(topCampaigns).toHaveLength(5);
      
  //     // Should not include the rollup row
  //     const hasRollup = topCampaigns.some(item => item.campaign.id === "ALL");
  //     expect(hasRollup).toBe(false);
  //   });

  //   it('should include rollup rows when excludeRollup is false', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 10,
  //       excludeRollup: false,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
      
  //     // Should have 6 total rows including rollup
  //     expect(topCampaigns).toHaveLength(6);
      
  //     // Should include the rollup row (which has highest cost_share)
  //     expect(topCampaigns[0].campaign.id).toBe("ALL");
  //     expect(topCampaigns[0].metrics.cost_share).toBe(1.0);
  //   });
  // });

  // describe('edge cases', () => {
  //   it('should handle empty rows array', () => {
  //     const rows = [];
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 5,
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
  //     expect(topCampaigns).toHaveLength(0);
  //   });

  //   it('should handle n larger than available rows', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 20, // More than available rows
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
  //     expect(topCampaigns).toHaveLength(5); // Only 5 non-rollup campaigns
  //   });

  //   it('should handle missing metric values', () => {
  //     const rowsWithNulls = [
  //       { campaign: { id: "camp_001", name: "Campaign A" }, metrics: { cost_share: 0.5 } },
  //       { campaign: { id: "camp_002", name: "Campaign B" }, metrics: { cost_share: null } },
  //       { campaign: { id: "camp_003", name: "Campaign C" }, metrics: { cost_share: 0.3 } },
  //       { campaign: { id: "camp_004", name: "Campaign D" }, metrics: {} }, // Missing cost_share
  //     ];
      
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 5,
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rowsWithNulls, config, ctx);

  //     const topCampaigns = ctx.state.envelopeData.top_campaigns;
  //     expect(topCampaigns).toHaveLength(4);
      
  //     // Should sort null/undefined values to the end
  //     expect(topCampaigns[0].campaign.id).toBe("camp_001"); // 0.5
  //     expect(topCampaigns[1].campaign.id).toBe("camp_003"); // 0.3
  //     expect(topCampaigns[2].campaign.id).toBe("camp_002"); // null
  //     expect(topCampaigns[3].campaign.id).toBe("camp_004"); // undefined
  //   });

  //   it('should handle missing context gracefully', () => {
  //     const rows = createTestResults();
  //     const config = {
  //       by: ["campaign.id", "campaign.name"],
  //       metric: "metrics.cost_share",
  //       n: 3,
  //       excludeRollup: true,
  //       as: "top_campaigns"
  //     };

  //     // No context provided
  //     expect(() => topNStep(rows, config)).not.toThrow();
  //   });
  // });

  // describe('multiple by fields', () => {
  //   it('should handle multiple fields in by array', () => {
  //     const rows = [
  //       { 
  //         campaign: { id: "camp_001", name: "Campaign A" },
  //         ad_group: { id: "ag_001", name: "Ad Group 1" },
  //         metrics: { cost_share: 0.4, cost: 800 }
  //       },
  //       { 
  //         campaign: { id: "camp_002", name: "Campaign B" },
  //         ad_group: { id: "ag_002", name: "Ad Group 2" },
  //         metrics: { cost_share: 0.6, cost: 1200 }
  //       }
  //     ];
      
  //     const config = {
  //       by: ["campaign.id", "campaign.name", "ad_group.id", "ad_group.name"],
  //       metric: "metrics.cost_share",
  //       n: 2,
  //       include: ["metrics.cost"],
  //       excludeRollup: true,
  //       as: "top_combinations"
  //     };
  //     const ctx = { state: {} };

  //     topNStep(rows, config, ctx);

  //     const topCombinations = ctx.state.envelopeData.top_combinations;
  //     expect(topCombinations).toHaveLength(2);
      
  //     expect(topCombinations[0]).toEqual({
  //       campaign: { id: "camp_002", name: "Campaign B" },
  //       ad_group: { id: "ag_002", name: "Ad Group 2" },
  //       metrics: { cost_share: 0.6, cost: 1200 }
  //     });
  //   });
  // });
});
