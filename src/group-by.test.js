const { groupRows } = require('./group-by');

describe('groupRows', () => {
  const createTestResults = () => [
    { 
      campaign: {
        name: "Campaign A",
        id: 1,
        advertising_channel_type: "SEARCH"
      }, 
      metrics: {
        clicks: 100,
        impressions: 1000,
        cost_micros: 50
      }
    },
    {
      campaign: {
        name: "Campaign B",
        id: 2,
        advertising_channel_type: "DISPLAY"
      },
      metrics: {
        clicks: 150,
        impressions: 1200,
        cost_micros: 75
      }
    },
    {
      campaign: {
        name: "Campaign C",
        id: 3,
        advertising_channel_type: "SEARCH"
      },
      metrics: {
        clicks: 200,
        impressions: 2000,
        cost_micros: 100
      }
    }
  ];

  describe('group by without aggregates', () => {
    it('should group by the dimension fields and no aggregates', () => {
      const grouped = groupRows(createTestResults(), {
        by: [ "campaign.advertising_channel_type" ]
      });
  
      expect(grouped).toEqual([
        {
          campaign: { advertising_channel_type: "SEARCH" },
        },
        {
          campaign: { advertising_channel_type: "DISPLAY" },
        }
      ]);
    });

    it('should group by multiple dimension fields', () => {
      const grouped = groupRows(createTestResults(), {
        by: [ "campaign.advertising_channel_type", "campaign.name" ]
      });
  
      expect(grouped).toEqual([
        {
          campaign: { advertising_channel_type: "SEARCH", name: "Campaign A" },
        },
        {
          campaign: { advertising_channel_type: "DISPLAY", name: "Campaign B" },
        },
        {
          campaign: { advertising_channel_type: "SEARCH", name: "Campaign C" },
        }
      ]);
    });
  });
  describe('group by with aggregates', () => {
    it('should group by the dimension fields and aggregates', () => {
      const grouped = groupRows(createTestResults(), {
        by: [ "campaign.advertising_channel_type" ],
        aggregates: {
          "metrics.clicks": { fn: "SUM", as: "metrics.clicks" },
          "metrics.impressions": { fn: "SUM", as: "metrics.impressions" },
          "metrics.cost_micros": { fn: "SUM", as: "metrics.cost_micros" }
        }
      });

      expect(grouped).toEqual([
        {
          campaign: { advertising_channel_type: "SEARCH" },
          metrics: { clicks: 300, impressions: 3000, cost_micros: 150 }
        },
        {
          campaign: { advertising_channel_type: "DISPLAY" },
          metrics: { clicks: 150, impressions: 1200, cost_micros: 75 }
        }
      ]);
    });
  });
});