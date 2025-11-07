class TikTokAccountTemplate {
  constructor(options = {}) {
    const {
      credentials,
      report,
      pipeline,
      output,
    } = options;

    this.credentials = credentials;
    this.options = {
      credentials,
      report,
      pipeline,
      output: output || {
        mode: 'envelope',
        include: ['periods', 'report', 'group'],
      },
    };
  }

  getConfig() {
    return {
      credentials: this.credentials,
      report: this.options.report,
      pipeline: this.options.pipeline,
      output: this.options.output,
    };
  }

  static buildGroupAggregates() {
    return {
      'metrics.cost': { fn: 'SUM', as: 'metrics.cost' },
      'metrics.spend': { fn: 'SUM', as: 'metrics.spend' },
      'metrics.impressions': { fn: 'SUM', as: 'metrics.impressions' },
      'metrics.clicks': { fn: 'SUM', as: 'metrics.clicks' },
      'metrics.reach': { fn: 'SUM', as: 'metrics.reach' },
      'metrics.conversions': { fn: 'SUM', as: 'metrics.conversions' },
      'metrics.conversions_value': { fn: 'SUM', as: 'metrics.conversions_value' },
      'metrics.ctr': {
        fn: 'RATIO',
        num: 'metrics.clicks',
        den: 'metrics.impressions',
        as: 'metrics.ctr',
      },
      'metrics.cpc': {
        fn: 'RATIO',
        num: 'metrics.cost',
        den: 'metrics.clicks',
        as: 'metrics.cpc',
      },
      'metrics.cvr': {
        fn: 'RATIO',
        num: 'metrics.conversions',
        den: 'metrics.clicks',
        as: 'metrics.cvr',
      },
      'metrics.cpa': {
        fn: 'RATIO',
        num: 'metrics.cost',
        den: 'metrics.conversions',
        as: 'metrics.cpa',
      },
      'metrics.frequency': {
        fn: 'RATIO',
        num: 'metrics.impressions',
        den: 'metrics.reach',
        as: 'metrics.frequency',
      },
      'metrics.roas': {
        fn: 'RATIO',
        num: 'metrics.conversions_value',
        den: 'metrics.cost',
        as: 'metrics.roas',
      },
    };
  }

  static buildDeltaMeasures() {
    return [
      { field: 'metrics.cost', kind: 'absolute' },
      { field: 'metrics.spend', kind: 'absolute' },
      { field: 'metrics.impressions', kind: 'absolute' },
      { field: 'metrics.clicks', kind: 'absolute' },
      { field: 'metrics.reach', kind: 'absolute' },
      { field: 'metrics.conversions', kind: 'absolute' },
      { field: 'metrics.conversions_value', kind: 'absolute' },
      {
        field: 'metrics.ctr',
        kind: 'ratio',
        num: 'metrics.clicks',
        den: 'metrics.impressions',
      },
      {
        field: 'metrics.cpc',
        kind: 'ratio',
        num: 'metrics.cost',
        den: 'metrics.clicks',
      },
      {
        field: 'metrics.cvr',
        kind: 'ratio',
        num: 'metrics.conversions',
        den: 'metrics.clicks',
      },
      {
        field: 'metrics.cpa',
        kind: 'ratio',
        num: 'metrics.cost',
        den: 'metrics.conversions',
      },
      {
        field: 'metrics.frequency',
        kind: 'ratio',
        num: 'metrics.impressions',
        den: 'metrics.reach',
      },
      {
        field: 'metrics.roas',
        kind: 'ratio',
        num: 'metrics.conversions_value',
        den: 'metrics.cost',
      },
    ];
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    if (!credentials) {
      throw new Error('TikTokAccountTemplate.forPerformanceAnalysis requires credentials');
    }

    const baselineMode = config.periodsBaselineMode || 'previous_period';

    const report = {
      entity: 'tiktok_account',
      from_date: fromDate,
      to_date: toDate,
      metrics: config.metrics,
      dimensions: config.dimensions,
      filtering: config.filtering || config.filters,
      parameters: config.parameters,
    };

    const attributes = Array.isArray(config.attributes) && config.attributes.length
      ? config.attributes
      : ['account.id', 'account.name'];

    const deltaKeys = Array.isArray(config.deltaKeys) && config.deltaKeys.length
      ? config.deltaKeys
      : ['account.id'];

    const pipeline = [
      {
        use: 'periods',
        baseline: { mode: baselineMode },
      },
      {
        use: 'group',
        by: attributes,
        aggregates: this.buildGroupAggregates(),
        rollup: true,
        nulls: 'include',
        orderBy: [
          { field: 'metrics.cost', dir: 'DESC', nulls: 'last' },
        ],
      },
      {
        use: 'delta',
        baseline: { mode: baselineMode },
        partial: { policy: 'match_upto_day' },
        keys: deltaKeys,
        measures: this.buildDeltaMeasures(),
        emit: {
          previous: 'metrics_prev',
          delta_abs: 'metrics_delta',
          delta_pct: 'metrics_delta_pct',
        },
        policies: {
          pctOnZero: 'null',
        },
      },
      {
        use: 'rollupEnvelope',
        as: 'account_rollup',
        rollupKey: 'meta.rollup_key',
        rollupValue: 'ACCOUNT',
        copyFromFirst: attributes,
        sum: [
          'metrics.cost',
          'metrics.spend',
          'metrics.impressions',
          'metrics.clicks',
          'metrics.conversions',
          'metrics.conversions_value',
          'metrics.reach',
          'metrics_prev.cost',
          'metrics_prev.spend',
          'metrics_prev.impressions',
          'metrics_prev.clicks',
          'metrics_prev.conversions',
          'metrics_prev.conversions_value',
          'metrics_prev.reach',
        ],
        ratios: [
          { as: 'metrics.ctr', num: 'metrics.clicks', den: 'metrics.impressions' },
          { as: 'metrics.cpc', num: 'metrics.cost', den: 'metrics.clicks' },
          { as: 'metrics.cvr', num: 'metrics.conversions', den: 'metrics.clicks' },
          { as: 'metrics.cpa', num: 'metrics.cost', den: 'metrics.conversions' },
          { as: 'metrics.frequency', num: 'metrics.impressions', den: 'metrics.reach' },
          { as: 'metrics.roas', num: 'metrics.conversions_value', den: 'metrics.cost' },
          { as: 'metrics_prev.ctr', num: 'metrics_prev.clicks', den: 'metrics_prev.impressions' },
          { as: 'metrics_prev.cpc', num: 'metrics_prev.cost', den: 'metrics_prev.clicks' },
          { as: 'metrics_prev.cvr', num: 'metrics_prev.conversions', den: 'metrics_prev.clicks' },
          { as: 'metrics_prev.cpa', num: 'metrics_prev.cost', den: 'metrics_prev.conversions' },
          { as: 'metrics_prev.frequency', num: 'metrics_prev.impressions', den: 'metrics_prev.reach' },
          { as: 'metrics_prev.roas', num: 'metrics_prev.conversions_value', den: 'metrics_prev.cost' },
        ],
        expressions: {
          'metrics_delta.cost': (s) => (s.metrics?.cost ?? 0) - (s.metrics_prev?.cost ?? 0),
          'metrics_delta.spend': (s) => (s.metrics?.spend ?? 0) - (s.metrics_prev?.spend ?? 0),
          'metrics_delta.impressions': (s) => (s.metrics?.impressions ?? 0) - (s.metrics_prev?.impressions ?? 0),
          'metrics_delta.clicks': (s) => (s.metrics?.clicks ?? 0) - (s.metrics_prev?.clicks ?? 0),
          'metrics_delta.reach': (s) => (s.metrics?.reach ?? 0) - (s.metrics_prev?.reach ?? 0),
          'metrics_delta.conversions': (s) => (s.metrics?.conversions ?? 0) - (s.metrics_prev?.conversions ?? 0),
          'metrics_delta.conversions_value': (s) => (s.metrics?.conversions_value ?? 0) - (s.metrics_prev?.conversions_value ?? 0),
          'metrics_delta.ctr': (s) => {
            const cur = s.metrics?.ctr;
            const prev = s.metrics_prev?.ctr;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.cpc': (s) => {
            const cur = s.metrics?.cpc;
            const prev = s.metrics_prev?.cpc;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.cvr': (s) => {
            const cur = s.metrics?.cvr;
            const prev = s.metrics_prev?.cvr;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.cpa': (s) => {
            const cur = s.metrics?.cpa;
            const prev = s.metrics_prev?.cpa;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.frequency': (s) => {
            const cur = s.metrics?.frequency;
            const prev = s.metrics_prev?.frequency;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta.roas': (s) => {
            const cur = s.metrics?.roas;
            const prev = s.metrics_prev?.roas;
            if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
            return cur - prev;
          },
          'metrics_delta_pct.cost': (s) => {
            const prev = s.metrics_prev?.cost;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.cost ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.spend': (s) => {
            const prev = s.metrics_prev?.spend;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.spend ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.impressions': (s) => {
            const prev = s.metrics_prev?.impressions;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.impressions ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.clicks': (s) => {
            const prev = s.metrics_prev?.clicks;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.clicks ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.reach': (s) => {
            const prev = s.metrics_prev?.reach;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.reach ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.conversions': (s) => {
            const prev = s.metrics_prev?.conversions;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.conversions ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.conversions_value': (s) => {
            const prev = s.metrics_prev?.conversions_value;
            if (!Number.isFinite(prev) || prev === 0) return null;
            return ((s.metrics?.conversions_value ?? 0) - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.ctr': (s) => {
            const prev = s.metrics_prev?.ctr;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.ctr;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.cpc': (s) => {
            const prev = s.metrics_prev?.cpc;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.cpc;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.cvr': (s) => {
            const prev = s.metrics_prev?.cvr;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.cvr;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.cpa': (s) => {
            const prev = s.metrics_prev?.cpa;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.cpa;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.frequency': (s) => {
            const prev = s.metrics_prev?.frequency;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.frequency;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
          'metrics_delta_pct.roas': (s) => {
            const prev = s.metrics_prev?.roas;
            if (!Number.isFinite(prev) || prev === 0) return null;
            const cur = s.metrics?.roas;
            if (!Number.isFinite(cur)) return null;
            return (cur - prev) / Math.abs(prev);
          },
        },
      },
    ];

    return new TikTokAccountTemplate({
      credentials,
      report,
      pipeline,
      output: config.output,
    });
  }
}

module.exports = {
  TikTokAccountTemplate,
};

