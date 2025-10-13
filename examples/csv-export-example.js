/**
 * Example: Export Google Ads Campaign Performance to CSV
 * Demonstrates using the CSV exporter utility
 */

const { 
  GoogleAdsCampaignTemplate, 
  GAQLExecutor, 
  writeCsv,
  toCsv 
} = require('../dist/index');

const credentials = {
  developerToken: "YOUR_DEV_TOKEN",
  refreshToken: "YOUR_REFRESH_TOKEN",
  customerId: '1234567890',
  loginCustomerId: '9876543210',
  clientId: "YOUR_CLIENT_ID",
  clientSecret: "YOUR_CLIENT_SECRET",
};

const fromDate = '2025-09-01';
const toDate = '2025-09-22';

async function exportCampaignsToCsv() {
  // 1. Execute the query
  const template = GoogleAdsCampaignTemplate.forPerformanceAnalysis(
    credentials, 
    fromDate, 
    toDate, 
    {}
  );

  const config = template.getConfig();
  const executor = new GAQLExecutor(config);
  const result = await executor.execute();

  // 2. Export entire dataset with all fields (auto-detected)
  writeCsv(result, 'output/campaigns-full.csv', {
    flatten: true,  // Flatten nested objects (default)
  });

  // 3. Export with selected fields only
  writeCsv(result, 'output/campaigns-selected.csv', {
    flatten: true,
    fields: [
      'campaign.id',
      'campaign.name',
      'campaign.bidding_strategy_type',
      'metrics.cost',
      'metrics.clicks',
      'metrics.impressions',
      'metrics.ctr',
      'metrics.cpc',
      'metrics.conversions',
      'metrics.cpa',
    ]
  });

  // 4. Export with custom headers
  writeCsv(result, 'output/campaigns-custom-headers.csv', {
    flatten: true,
    fields: [
      'campaign.name',
      'metrics.cost',
      'metrics.clicks',
      'metrics.impressions',
    ],
    headers: {
      'campaign.name': 'Campaign Name',
      'metrics.cost': 'Total Cost',
      'metrics.clicks': 'Total Clicks',
      'metrics.impressions': 'Total Impressions',
    }
  });

  // 5. Or generate CSV string and do something else with it
  const csvString = toCsv(result.results, {
    flatten: true,
    fields: ['campaign.name', 'metrics.cost', 'metrics.clicks'],
  });
  
  console.log('CSV Preview:');
  console.log(csvString.split('\n').slice(0, 5).join('\n')); // First 5 rows
  
  console.log('\n✅ CSV files exported successfully!');
}

// Run the export
exportCampaignsToCsv()
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });



