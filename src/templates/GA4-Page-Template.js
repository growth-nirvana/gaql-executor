const { GA4BaseTemplate } = require('./GA4-Base-Template');

class GA4PageTemplate extends GA4BaseTemplate {
  
  static getBaseReport() {
    return {
      dimensions: [
        'pagePath',
        'pageTitle',
      ],
      metrics: [
        'screenPageViews',
        'sessions',
        'totalUsers',
        'averageSessionDuration',
        'bounceRate',
        'conversions',
      ],
    };
  }

  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}) {
    const defaultOrderBys = [
      { metric: 'screenPageViews', desc: true }
    ];
    return super.forPerformanceAnalysis(credentials, fromDate, toDate, config, defaultOrderBys);
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
    
    // Allow overriding dimensions and metrics
    const baseDimensions = config.dimensions || baseReport.dimensions;
    const metrics = config.metrics || baseReport.metrics;
    
    // For trends, always include date dimension
    const dimensions = ['date', ...baseDimensions];

    const report = {
      dimensions,
      metrics,
      from_date: formatDate(from),
      to_date: formatDate(to),
      orderBys: config.orderBys || [
        { dimension: 'date', desc: false },
        { metric: 'screenPageViews', desc: true }
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
      metrics.forEach(metric => {
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

    // Note: Filters are applied at API level (dimensionFilter/metricFilter)
    // Post-processing filters can be added here if needed for additional filtering
    // after grouping, but API-level filters are more efficient

    // Add pruneRows by default for trends (unless explicitly disabled)
    if (config.prune !== false && config.pruneRows !== false) {
      pipeline.push({ use: "pruneRows", mode: "empty", as: "rows_meta" });
    }

    return new this({
      credentials,
      report,
      filters: config.filters || [],
      filterLogic: config.filterLogic || 'AND',
      pipeline,
      output: {
        mode: config.outputMode || "envelope",
        include: config.include || ["periods"],
      }
    });
  }
}

module.exports = { GA4PageTemplate };

