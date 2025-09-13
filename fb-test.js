const { GAQLExecutor, FacebookExecutor } = require('./dist/index');

const META_ACCESS_TOKEN = "EAAKso6oOyYsBPEmZB8V54ZCPPThSl9XGWOSzm6apvbEuqjJrfRIr1lWstqZADKexQGWpz7Vf4JiHEdZBRpKi83oLZC6skZAk1e1ZA7ZCTFYG8goaPcpbNt8JatfGCoqtMGZCtLqzhk6eRqeqSUtZA1HMKtPHvTkDUlZAJGyLeAsFZAKikWKUwEU5t9mw21C0YOXNenUV"
const META_AD_ACCOUNT_ID = "111291765"

const executor = new FacebookExecutor({
  report: {
    entity: 'campaign',                 // account|campaign|ad_set|ad
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
      'metrics.ctr',
      'metrics.cpc',
      'metrics.cpm'
    ],
    segments: [
      // 'segments.date',              // uncomment for daily rows
      // 'segments.country',
      // 'segments.device_platform'
      'segments.platform_position'
    ],
    constraints: [
      // { key: 'campaign.name', op: 'CONTAINS', val: 'LSE-DA' },
      // { key: 'metrics.impressions', op: '>', val: 0 },
    ],
    from_date: '2025-08-01',
    to_date:   '2025-08-15',
    limit: 50,
  },
  credentials: {
    accessToken: META_ACCESS_TOKEN,
    accountId:   META_AD_ACCOUNT_ID,  // 1234567890 (we’ll prefix act_)
  },
  pipeline: [
    // You can reuse your existing steps (group, delta, stats, addDimensions, etc.)
    { use: 'group', 
      by: [
        'campaign.id',
        'campaign.name',
        'account.id',
        'account.name',
        'campaign.objective',
        'segments.platform_position',
      ],
      aggregates: {
      'metrics.spend':       { fn: 'SUM', as: 'metrics.spend' },
      'metrics.clicks':      { fn: 'SUM', as: 'metrics.clicks' },
      'metrics.impressions': { fn: 'SUM', as: 'metrics.impressions' },
      'ctr': { fn: 'RATIO', num: 'metrics.clicks', den: 'metrics.impressions', as: 'metrics.ctr' },
      'cpc': { fn: 'RATIO', num: 'metrics.spend', den: 'metrics.clicks',      as: 'metrics.cpc' },
    }},
  ],
  output: { mode: 'envelope', include: [] }
});

executor.execute().then((result) => console.log(JSON.stringify(result, null, 2))).catch(console.error);