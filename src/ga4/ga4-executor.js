// src/ga4/ga4-executor.js
const {BetaAnalyticsDataClient} = require('@google-analytics/data');
const {GoogleAuth} = require('google-auth-library');
const { buildGA4Request, shapeRow } = require('./ga4-translate');
const { STEPS } = require('../step-registry');

class GA4Executor {
  constructor(options = {}) {
    // Normalize propertyIds to always be an array
    let propertyIds = [];
    if (options.credentials?.propertyIds && Array.isArray(options.credentials.propertyIds)) {
      propertyIds = options.credentials.propertyIds;
    } else if (options.credentials?.propertyId) {
      propertyIds = [options.credentials.propertyId];
    }

    this.options = {
      report: {
        dimensions: options.report?.dimensions || [],
        metrics: options.report?.metrics || [],
        // Support standard from_date/to_date interface (like Google Ads)
        from_date: options.report?.from_date,
        to_date: options.report?.to_date,
        // Also support legacy dateRanges format
        dateRanges: options.report?.dateRanges || [],
        dimensionFilter: options.report?.dimensionFilter || null,
        metricFilter: options.report?.metricFilter || null,
        orderBys: options.report?.orderBys || [],
        limit: options.report?.limit || null,
        offset: options.report?.offset || null,
        keepEmptyRows: options.report?.keepEmptyRows || false,
        // GA4-specific: metric aggregations
        metricAggregations: options.report?.metricAggregations || null,
      },
      credentials: {
        propertyIds: propertyIds,
        refreshToken: options.credentials?.refreshToken,
        clientId: options.credentials?.clientId,
        clientSecret: options.credentials?.clientSecret,
      },
      pipeline: Array.isArray(options.pipeline) ? options.pipeline : [],
      output: {
        mode: (options.output && options.output.mode) || "rows",
        include: (options.output && options.output.include) || ["periods"]
      }
    };
    this.analyticsDataClient = null;
  }

  /**
   * Initialize the Google Analytics Data API client
   * @returns {Object} - The Analytics Data API client instance
   */
  initializeClient() {
    if (this.analyticsDataClient) {
      return this.analyticsDataClient;
    }

    const { credentials: { refreshToken, clientId, clientSecret } } = this.options;
    
    const requiredCreds = ['refreshToken', 'clientId', 'clientSecret'];
    const missing = requiredCreds.filter(key => !this.options.credentials[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required credentials: ${missing.join(', ')}`);
    }

    // Create GoogleAuth with OAuth2 credentials
    const auth = new GoogleAuth({
      credentials: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        type: 'authorized_user'
      }
    });

    // Create Analytics Data API client
    this.analyticsDataClient = new BetaAnalyticsDataClient({
      auth
    });

    return this.analyticsDataClient;
  }

  isCardinalityChanging(name) {
    const fn = name && STEPS[name];
    return !!(fn && fn.traits && fn.traits.changesCardinality);
  }

  /**
   * Build context for execution
   */
  buildContext() {
    const state = Object.create(null);
    const cache = new Map();
    
    const runWithSteps = async (rows, steps) => {
      let out = rows;
      for (const step of steps || []) {
        const fn = step && step.use && STEPS[step.use];
        if (typeof fn === "function") out = await fn(out, step, ctx);
      }
      return out;
    };

    const ctx = {
      options: this.options,
      state,
      cache,
      runPre: async (rows) => {
        const pre = state.preStepsExecuted || [];
        return runWithSteps(rows, pre);
      },
      fetch: async (overrides = {}, tag = "default") => {
        // Allow steps (like delta) to fetch a different time window
        const report = { ...this.options.report, ...overrides };
        const { rows, aggregations } = await this.fetchReport(report);
        // Return both rows and aggregations for GA4-specific steps
        return { rows, aggregations };
      },
      runWithSteps,
    };

    ctx._freezePre = (executedPre) => { state.preStepsExecuted = executedPre.slice(); };

    return ctx;
  }

  /**
   * Build context for multi-property execution
   */
  buildContextMultiProperty(propertyInstances) {
    const pipeline = Array.isArray(this.options.pipeline) ? this.options.pipeline : [];
    const baseReport = this.clone(this.options.report);

    const state = Object.create(null);
    const cache = new Map();
    
    const runWithSteps = async (rows, steps) => {
      let out = rows;
      for (const step of steps || []) {
        const fn = step && step.use && STEPS[step.use];
        if (typeof fn === "function") out = await fn(out, step, ctx);
      }
      return out;
    };

    const ctx = {
      options: this.options,
      state,
      cache,
      runPre: async (rows) => {
        const pre = state.preStepsExecuted || [];
        return runWithSteps(rows, pre);
      },
      // Fetch from ALL properties and combine
      fetch: async (overrides = {}, tag = "default") => {
        const allRows = [];
        const allAggregations = [];
        for (const propertyInstance of propertyInstances) {
          const finalReport = this.overrideReportOptions(baseReport, overrides);
          const { rows, aggregations } = await this.fetchReportForProperty(finalReport, propertyInstance.propertyId);
          allRows.push(...rows);
          if (aggregations) {
            allAggregations.push({ propertyId: propertyInstance.propertyId, ...aggregations });
          }
        }
        // Return both rows and aggregations for GA4-specific steps
        return { rows: allRows, aggregations: allAggregations };
      },
      runWithSteps,
    };

    ctx._freezePre = (executedPre) => { state.preStepsExecuted = executedPre.slice(); };

    return ctx;
  }

  clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  overrideReportOptions(base, overrides = {}) {
    const result = this.clone(base) || {};
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Fetch report data from GA4 Data API
   * @param {Object} report - Report configuration
   * @param {string} propertyId - GA4 property ID
   * @returns {Promise<Object>} - Object with rows and raw data
   */
  async fetchReportForProperty(report, propertyId) {
    this.initializeClient();

    if (!propertyId) {
      throw new Error("GA4 propertyId is required");
    }

    const request = buildGA4Request(report, propertyId);
    const { dimensions = [], metrics = [] } = report;

    let raw;
    let aggregations = null;
    const maxRetries = 5;
    const baseBackoff = 2; // seconds
    const maxBackoff = 300; // 5 minutes max
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        // Remove null/undefined values and empty arrays from request
        // BUT keep metricAggregations even if it's an array (it's a valid GA4 parameter)
        const cleanRequest = {};
        for (const [key, value] of Object.entries(request)) {
          if (value === null || value === undefined) continue;
          // Keep metricAggregations - it's a valid array parameter for GA4
          if (key === 'metricAggregations' && Array.isArray(value)) {
            cleanRequest[key] = value;
          } else if (Array.isArray(value) && value.length === 0) {
            continue;
          } else {
            cleanRequest[key] = value;
          }
        }
        
        const [response] = await this.analyticsDataClient.runReport(cleanRequest);
        raw = response.rows || [];
        
        // Store aggregated values if metricAggregations were requested
        // GA4 API returns totals, maximums, minimums arrays when metricAggregations is specified
        // These are stored separately and returned in the aggregations field
        if (cleanRequest.metricAggregations) {
          aggregations = {
            totals: response.totals || [],
            maximums: response.maximums || [],
            minimums: response.minimums || [],
          };
        }
        
        break; // Success, exit retry loop
      } catch (e) {
        const msg = String(e?.message || e?.toString() || "");
        // Extract detailed error message if available
        const errorDetails = e?.details || e?.cause?.message || "";
        const fullMsg = errorDetails ? `${msg} ${errorDetails}` : msg;
        const isRateLimit = e?.code === 429 || msg.includes("rate limit") || msg.includes("too many requests");
        const isQuotaExceeded = e?.code === 429 || msg.includes("quota") || msg.includes("QuotaExceeded");

        if ((isRateLimit || isQuotaExceeded) && retryCount < maxRetries) {
          retryCount++;
          const backoffSeconds = Math.min(baseBackoff ** retryCount, maxBackoff);
          await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
        } else if ((isRateLimit || isQuotaExceeded) && retryCount >= maxRetries) {
          throw new Error(`Rate limit/quota error after ${maxRetries} retries: ${msg}`);
        } else {
          // Include full error message
          const errorMsg = fullMsg || msg || String(e);
          throw new Error(errorMsg);
        }
      }
    }

    // Shape rows to our standard format, including propertyId
    const rows = raw.map((row) => shapeRow(row, dimensions, metrics, propertyId));
    
    return { rows, raw, aggregations };
  }

  /**
   * Fetch report data (uses first propertyId)
   */
  async fetchReport(report) {
    const propertyIds = this.options.credentials.propertyIds;
    if (!propertyIds || propertyIds.length === 0) {
      throw new Error("GA4 propertyIds array is required (e.g. propertyIds: ['123456789'])");
    }
    return this.fetchReportForProperty(report, propertyIds[0]);
  }

  /**
   * Async aware pipeline with pre-steps tracking
   */
  async runPipeline(rows, ctx) {
    const pipeline = Array.isArray(this.options.pipeline) ? this.options.pipeline : [];
    if (pipeline.length === 0) return rows;

    let out = rows;
    const executedPre = [];
    let boundaryFrozen = false;

    for (const step of pipeline) {
      const fn = step && step.use && STEPS[step.use];
      if (typeof fn !== "function") continue;

      if (!boundaryFrozen && !this.isCardinalityChanging(step.use)) {
        // still in pre phase
        executedPre.push(step);
      } else if (!boundaryFrozen && this.isCardinalityChanging(step.use)) {
        // crossing the boundary for the first time -- freeze the pre list
        ctx._freezePre(executedPre);
        boundaryFrozen = true;
      }

      out = await fn(out, step, ctx); // supports async steps
    }

    // last check -- if we didn't freeze the pre list, do it now
    if (!boundaryFrozen) ctx._freezePre(executedPre);

    return out;
  }

  collectMeta(ctx, output = {}) {
    const include = output.include || ["periods"];
    const meta = {};
  
    if (include.includes("periods") && ctx?.state?.periods) {
      meta.periods = ctx.state.periods;
    }
    
    if (include.includes("group") && ctx?.state?.lastGroupCfg) {
      meta.group = ctx.state.lastGroupCfg;
    }
    
    if (include.includes("report")) {
      const { report } = this.options || {};
      if (report) {
        meta.report = {
          dimensions: report.dimensions,
          metrics: report.metrics,
          dateRanges: report.dateRanges,
        };
      }
    }
    
    // Include envelope data from pipeline steps (like topN)
    if (ctx?.state?.envelopeData) {
      Object.assign(meta, ctx.state.envelopeData);
    }
    
    return meta;
  }

  /**
   * Execute the query and run pipeline
   * @returns {Promise<any>} - The query results
   */
  async execute() {
    this.initializeClient();

    const { propertyIds } = this.options.credentials;
    
    if (!propertyIds || propertyIds.length === 0) {
      throw new Error('At least one property ID is required');
    }

    // Fetch raw data from all properties
    const allRows = [];
    const allAggregations = [];
    const propertyInstances = [];
    const propertyResults = {
      succeeded: [],
      failed: []
    };

    for (const propertyId of propertyIds) {
      try {
        const { rows, aggregations } = await this.fetchReportForProperty(this.options.report, propertyId);
        allRows.push(...rows);
        if (aggregations) {
          allAggregations.push({ propertyId, ...aggregations });
        }
        propertyInstances.push({ propertyId });
        propertyResults.succeeded.push({
          propertyId,
          rowCount: rows.length
        });
      } catch (err) {
        const errorMsg = err?.message || String(err);
        console.error(`Failed to fetch data for property ${propertyId}: ${errorMsg}`);
        propertyResults.failed.push({
          propertyId,
          error: errorMsg
        });
      }
    }

    if (propertyResults.succeeded.length === 0) {
      throw new Error(`All properties failed. Failed properties: ${propertyResults.failed.map(f => f.propertyId).join(', ')}`);
    }

    // Run pipeline
    const ctx = propertyIds.length === 1 
      ? this.buildContext()
      : this.buildContextMultiProperty(propertyInstances);
    
    // Store current aggregations in context state for rollup step
    // Always store as array for consistency
    if (allAggregations && allAggregations.length > 0) {
      ctx.state.ga4CurrentAggregations = allAggregations;
    }
    
    const processed = await this.runPipeline(allRows, ctx);

    // Format output
    const { output } = this.options || {};
    if (output && output.mode === "envelope") {
      const meta = this.collectMeta(ctx, output);
      const result = { 
        meta, 
        results: processed
      };
      
      // Add metric aggregations if present (GA4-specific)
      // Include even if arrays are empty - the structure itself is useful
      if (allAggregations && allAggregations.length > 0) {
        result.aggregations = propertyIds.length === 1 
          ? allAggregations[0]
          : allAggregations;
      }
      
      // Add property results summary for multi-property queries
      if (propertyIds.length > 1) {
        result.propertyResults = {
          succeeded: propertyResults.succeeded,
          failed: propertyResults.failed,
          summary: {
            total: propertyIds.length,
            succeeded: propertyResults.succeeded.length,
            failed: propertyResults.failed.length
          }
        };
      }
      
      return result;
    }
    
    return processed;
  }
}

module.exports = { GA4Executor };



