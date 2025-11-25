const { GA4Executor } = require('../ga4/ga4-executor');

class GA4BaseTemplate {
  constructor(config) {
    this.credentials = config.credentials;
    this.config = {
      credentials: this.credentials,
      report: config.report || {},
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
  static calculateGroupByAttributes(config) {
    const baseReport = this.getBaseReport();
    const allowedDimensions = baseReport.dimensions || [];
    
    if (config.attributes && config.attributes.length > 0) {
      return config.attributes.filter(attr => allowedDimensions.includes(attr));
    } else {
      return allowedDimensions;
    }
  }

  // Base pipeline for exploration queries
  static getBasePipeline(config = {}) {
    const pipeline = [];

    // Add grouping step if dimensions are specified
    const groupByAttributes = this.calculateGroupByAttributes(config);
    if (groupByAttributes.length > 0) {
      const baseReport = this.getBaseReport();
      const metrics = baseReport.metrics || [];
      
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

    // Add filter step if filters are configured
    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    return pipeline;
  }


  // Execute the template
  async execute() {
    const executor = new GA4Executor(this.config);
    return await executor.execute();
  }
}

module.exports = { GA4BaseTemplate };

