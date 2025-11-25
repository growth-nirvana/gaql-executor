const { GA4BaseTemplate } = require('./GA4-Base-Template');

class GA4TrafficTemplate extends GA4BaseTemplate {
  
  static getBaseReport() {
    return {
      dimensions: [
        'source',
        'medium',
        'campaign',
      ],
      metrics: [
        'sessions',
        'totalUsers',
        'newUsers',
        'screenPageViews',
        'averageSessionDuration',
        'bounceRate',
        'conversions',
        'totalRevenue',
      ],
    };
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const baseReport = this.getBaseReport();
    
    const dateRanges = [{
      startDate: fromDate,
      endDate: toDate,
    }];

    // Allow filtering by specific sources/mediums/campaigns
    let dimensionFilter = config.dimensionFilter || null;
    if (config.sources || config.mediums || config.campaigns) {
      const expressions = [];
      
      if (config.sources && Array.isArray(config.sources) && config.sources.length > 0) {
        expressions.push({
          field: 'source',
          op: 'IN',
          value: config.sources.join(','),
        });
      }
      
      if (config.mediums && Array.isArray(config.mediums) && config.mediums.length > 0) {
        expressions.push({
          field: 'medium',
          op: 'IN',
          value: config.mediums.join(','),
        });
      }
      
      if (config.campaigns && Array.isArray(config.campaigns) && config.campaigns.length > 0) {
        expressions.push({
          field: 'campaign',
          op: 'IN',
          value: config.campaigns.join(','),
        });
      }

      if (expressions.length > 0) {
        dimensionFilter = { expressions };
      }
    }

    const report = {
      ...baseReport,
      dateRanges,
      dimensionFilter,
      metricFilter: config.metricFilter || null,
      orderBys: config.orderBys || [
        { metric: 'sessions', desc: true }
      ],
      limit: config.limit || null,
      offset: config.offset || null,
    };

    return new this({
      credentials,
      report,
      pipeline: this.getBasePipeline(config),
      output: {
        mode: config.outputMode || "envelope",
        include: config.include || ["periods"],
      }
    });
  }

  static forTrends(credentials, fromDate, toDate, config = {}) {
    const parseDate = (str) => {
      // Handle relative dates like '30daysAgo' or 'today'
      if (str === 'today') return new Date();
      if (str === 'yesterday') {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d;
      }
      if (str.endsWith('daysAgo')) {
        const days = parseInt(str);
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d;
      }
      // Handle YYYY-MM-DD format
      const [y, m, d] = str.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d));
    };

    const formatDate = (date) => {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    let from = parseDate(fromDate);
    let to = parseDate(toDate);
    const daysDiff = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;

    // Determine granularity
    const granularity = config.granularity || (daysDiff <= 7 ? 'daily' : 'weekly');
    
    // For monthly granularity, normalize date range to full calendar months
    if (granularity === 'monthly') {
      from = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      const lastDayOfMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0));
      to = lastDayOfMonth;
    }

    const baseReport = this.getBaseReport();
    
    // For trends, always include date dimension
    const dimensions = ['date', ...baseReport.dimensions];

    const dateRanges = [{
      startDate: formatDate(from),
      endDate: formatDate(to),
    }];

    // Allow filtering by specific sources/mediums/campaigns
    let dimensionFilter = config.dimensionFilter || null;
    if (config.sources || config.mediums || config.campaigns) {
      const expressions = [];
      
      if (config.sources && Array.isArray(config.sources) && config.sources.length > 0) {
        expressions.push({
          field: 'source',
          op: 'IN',
          value: config.sources.join(','),
        });
      }
      
      if (config.mediums && Array.isArray(config.mediums) && config.mediums.length > 0) {
        expressions.push({
          field: 'medium',
          op: 'IN',
          value: config.mediums.join(','),
        });
      }
      
      if (config.campaigns && Array.isArray(config.campaigns) && config.campaigns.length > 0) {
        expressions.push({
          field: 'campaign',
          op: 'IN',
          value: config.campaigns.join(','),
        });
      }

      if (expressions.length > 0) {
        dimensionFilter = { expressions };
      }
    }

    const report = {
      ...baseReport,
      dimensions,
      dateRanges,
      dimensionFilter,
      metricFilter: config.metricFilter || null,
      orderBys: config.orderBys || [
        { dimension: 'date', desc: false },
        { metric: 'sessions', desc: true }
      ],
      limit: config.limit || null,
      offset: config.offset || null,
    };

    // Build pipeline for trends
    const pipeline = [
      { use: "periods", baseline: { mode: config.baselineMode || "previous_period" }, granularity: granularity },
    ];

    // Add grouping step
    const groupByAttributes = this.calculateGroupByAttributes(config);
    if (groupByAttributes.length > 0 || dimensions.length > 0) {
      const aggregates = {};
      baseReport.metrics.forEach(metric => {
        aggregates[metric] = { fn: "SUM", as: metric };
      });

      pipeline.push({ 
        use: "group", 
        by: dimensions.length > 0 ? dimensions : groupByAttributes,
        aggregates,
        rollup: false,
        nulls: "include",
        orderBy: config.orderBy || [{ field: 'date', dir: "ASC" }],
      });
    }

    // Add filter step if filters are configured
    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    // Add pruneRows by default for trends (unless explicitly disabled)
    if (config.prune !== false && config.pruneRows !== false) {
      pipeline.push({ use: "pruneRows", mode: "empty", as: "rows_meta" });
    }

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: config.outputMode || "envelope",
        include: config.include || ["periods"],
      }
    });
  }
}

module.exports = { GA4TrafficTemplate };

