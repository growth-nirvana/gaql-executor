// https://developers.google.com/analytics/devguides/reporting/data/v1/rest
const { GA4Executor } = require('../ga4/ga4-executor');
const { convertFiltersToGA4 } = require('../ga4/ga4-filter');
const { DIMENSION_MAP, METRIC_MAP } = require('../ga4/ga4-translate');

class GA4BaseTemplate {
  constructor(config) {
    this.credentials = config.credentials;
    
    // Convert standard filters to GA4 format if present
    let report = config.report || {};
    if (config.filters && Array.isArray(config.filters) && config.filters.length > 0) {
      const filterConfig = {
        where: config.filters,
        logic: config.filterLogic || 'AND',
      };
      
      const ga4Filters = convertFiltersToGA4(filterConfig);
      
      // GA4 API requires dimensions used in dimensionFilter to be in the dimensions list
      // So we automatically add any filtered dimensions to the dimensions array
      // This abstracts away the API limitation so users can filter on any dimension
      if (ga4Filters.dimensionFilter) {
        const existingDimensions = new Set(report.dimensions || []);
        
        // Extract dimension fields from filters
        config.filters.forEach(filter => {
          if (filter && filter.field) {
            // Check if it's a dimension (not a metric)
            const isMetric = METRIC_MAP.hasOwnProperty(filter.field);
            
            if (!isMetric) {
              // Add the dimension field name (not the mapped GA4 name) to dimensions list
              // The mapping happens in ga4-translate when building the API request
              if (!existingDimensions.has(filter.field)) {
                existingDimensions.add(filter.field);
              }
            }
          }
        });
        
        // Update report with expanded dimensions list
        report = {
          ...report,
          dimensions: Array.from(existingDimensions),
        };
      }
      
      // Merge GA4 filters with any existing filters in report
      report = {
        ...report,
        dimensionFilter: ga4Filters.dimensionFilter || report.dimensionFilter || null,
        metricFilter: ga4Filters.metricFilter || report.metricFilter || null,
      };
    }
    
    this.config = {
      credentials: this.credentials,
      report,
      pipeline: config.pipeline || [],
      output: config.output || { mode: 'envelope', include: ["periods"] },
    }
  }

  getConfig() {
    return this.config;
  }

  static getBaseReport() {
    throw new Error('getBaseReport() must be implemented by subclass');
  }

  /**
   * Normalize date string to YYYY-MM-DD format for periods step
   * GA4 API accepts both relative dates ('30daysAgo', 'today') and YYYY-MM-DD
   * @param {string} dateStr - Date string (relative or YYYY-MM-DD)
   * @returns {string} - Normalized date in YYYY-MM-DD format
   */
  static normalizeDate(dateStr) {
    if (dateStr === 'today') {
      const d = new Date();
      return d.toISOString().split('T')[0];
    }
    if (dateStr === 'yesterday') {
      const d = new Date(Date.now() - 86400000);
      return d.toISOString().split('T')[0];
    }
    if (typeof dateStr === 'string' && dateStr.endsWith('daysAgo')) {
      const days = parseInt(dateStr);
      const d = new Date();
      d.setDate(d.getDate() - days);
      return d.toISOString().split('T')[0];
    }
    // Assume already YYYY-MM-DD format
    return dateStr;
  }

  /**
   * Build report object for performance analysis
   * @param {Object} config - Configuration object
   * @param {string} fromDate - Start date
   * @param {string} toDate - End date
   * @param {Array} defaultOrderBys - Default orderBys for this template
   * @returns {Object} - Report configuration object
   */
  static buildReportForPerformanceAnalysis(config, fromDate, toDate, defaultOrderBys = null) {
    const baseReport = this.getBaseReport();
    
    // Allow overriding dimensions and metrics
    const dimensions = config.dimensions || baseReport.dimensions;
    const metrics = config.metrics || baseReport.metrics;

    // Normalize dates for periods step
    const normalizedFromDate = this.normalizeDate(fromDate);
    const normalizedToDate = this.normalizeDate(toDate);

    const report = {
      dimensions,
      metrics,
      from_date: normalizedFromDate,
      to_date: normalizedToDate,
      orderBys: config.orderBys || defaultOrderBys || null,
      limit: config.limit || null,
      offset: config.offset || null,
    };

    // GA4-specific: Always request metric aggregations for account rollup
    report.metricAggregations = ['TOTAL', 'MAXIMUM', 'MINIMUM'];

    return report;
  }

  /**
   * Build pipeline for performance analysis
   * @param {Object} config - Configuration object
   * @returns {Array} - Pipeline steps array
   */
  static buildPerformanceAnalysisPipeline(config) {
    const baseReport = this.getBaseReport();
    const metrics = config.metrics || baseReport.metrics || [];
    const baselineMode = config.periodsBaselineMode || "previous_period";
    
    const pipeline = [
      { use: "periods", baseline: { mode: baselineMode } },
      ...this.getBasePipeline(config),
    ];
    
    // Add delta step automatically (like Google Ads and Facebook)
    // This computes metrics_prev, metrics_delta, and metrics_delta_pct for each row
    const groupByAttributes = this.calculateGroupByAttributes(config);
    if (groupByAttributes.length > 0 && metrics.length > 0) {
      // Build measures from metrics - all are absolute (GA4 metrics are already aggregated)
      // GA4 rows have metrics as direct fields (e.g., "sessions", "totalUsers"), not "metrics.sessions"
      const measures = metrics.map(metric => ({
        field: metric,
        kind: "absolute"
      }));
      
      pipeline.push({
        use: "delta",
        baseline: { mode: baselineMode },
        partial: { policy: "match_upto_day" },
        keys: groupByAttributes,
        measures: measures,
        emit: {
          previous: "metrics_prev",
          delta_abs: "metrics_delta",
          delta_pct: "metrics_delta_pct"
        },
        policies: { pctOnZero: "null" }
      });
    }
    
    // Always add GA4 rollup steps (metricAggregations are always enabled)
    // Fetch baseline aggregations
    pipeline.push({
      use: "ga4FetchBaselineAggregations",
    });
    
    // Create account rollup using aggregations
    pipeline.push({
      use: "ga4RollupEnvelope",
      as: "account_rollup",
      metrics: metrics, // Pass metric names in order
      ratios: config.rollupRatios || [], // Optional: allow configurable ratios
    });
    
    return pipeline;
  }

  /**
   * Create template instance for performance analysis
   * @param {Object} credentials - GA4 credentials
   * @param {string} fromDate - Start date
   * @param {string} toDate - End date
   * @param {Object} config - Configuration object
   * @param {Array} defaultOrderBys - Default orderBys for this template
   * @returns {GA4BaseTemplate} - Template instance
   */
  static forPerformanceAnalysis(credentials, fromDate, toDate, config = {}, defaultOrderBys = null) {
    const report = this.buildReportForPerformanceAnalysis(config, fromDate, toDate, defaultOrderBys);
    const pipeline = this.buildPerformanceAnalysisPipeline(config);

    return new this({
      credentials,
      report,
      filters: config.filters || [],
      filterLogic: config.filterLogic || 'AND',
      pipeline,
      output: {
        mode: config.outputMode || "envelope",
        include: config.include || ["periods", "account_rollup"],
      }
    });
  }

  // Generic method to get filter configuration from config
  static calculateFilters(config) {
    if (!config.filters || !Array.isArray(config.filters) || config.filters.length === 0) {
      return null;
    }

    const where = config.filters
      .filter((f) => f)
      .map((f) => {
        const { field, op, value, flags } = f;
        if (typeof field !== "string" || !field.length) return null;
        const operator = typeof op === "string" ? op.toUpperCase() : "=";

        return {
          field,
          op: operator,
          value,
          flags,
        };
      })
      .filter(Boolean);

    if (where.length === 0) return null;

    return {
      where,
      logic: config.filterLogic || "AND",
    };
  }

  // Generic method to get group by attributes from config
  // Supports both config.attributes (for filtering) and config.dimensions (for overriding)
  static calculateGroupByAttributes(config) {
    const baseReport = this.getBaseReport();
    // If dimensions are explicitly provided, use those; otherwise use base dimensions
    const availableDimensions = config.dimensions || baseReport.dimensions || [];
    
    if (config.attributes && config.attributes.length > 0) {
      // Filter attributes against available dimensions
      return config.attributes.filter(attr => availableDimensions.includes(attr));
    } else {
      return availableDimensions;
    }
  }

  // Base pipeline for exploration queries
  static getBasePipeline(config = {}) {
    const pipeline = [];

    // Add grouping step if dimensions are specified
    const groupByAttributes = this.calculateGroupByAttributes(config);
    if (groupByAttributes.length > 0) {
      const baseReport = this.getBaseReport();
      // Allow overriding metrics
      const metrics = config.metrics || baseReport.metrics || [];
      
      // Build aggregates for metrics
      const aggregates = {};
      metrics.forEach(metric => {
        aggregates[metric] = { fn: "SUM", as: metric };
      });

      pipeline.push({ 
        use: "group", 
        by: groupByAttributes,
        aggregates,
        rollup: false,
        nulls: "include",
        orderBy: config.orderBy || [{ field: metrics[0] || 'date', dir: "DESC" }],
      });
    }

    // Note: Filters are applied at API level (dimensionFilter/metricFilter)
    // Post-processing filters can be added here if needed for additional filtering
    // after grouping, but API-level filters are more efficient
    
    return pipeline;
  }


  // Execute the template
  async execute() {
    const executor = new GA4Executor(this.config);
    return await executor.execute();
  }
}

module.exports = { GA4BaseTemplate };

