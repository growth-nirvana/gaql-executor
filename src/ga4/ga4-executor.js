// src/ga4/ga4-executor.js
const { google } = require('googleapis');
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
        dateRanges: options.report?.dateRanges || [],
        dimensionFilter: options.report?.dimensionFilter || null,
        metricFilter: options.report?.metricFilter || null,
        orderBys: options.report?.orderBys || [],
        limit: options.report?.limit || null,
        offset: options.report?.offset || null,
        keepEmptyRows: options.report?.keepEmptyRows || false,
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
    this.client = null;
    this.analyticsData = null;
  }

  /**
   * Initialize the Google Analytics Data API client
   * @returns {Object} - The Analytics Data API client instance
   */
  initializeClient() {
    if (this.client) {
      return this.client;
    }

    const { credentials: { refreshToken, clientId, clientSecret } } = this.options;
    
    const requiredCreds = ['refreshToken', 'clientId', 'clientSecret'];
    const missing = requiredCreds.filter(key => !this.options.credentials[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required credentials: ${missing.join(', ')}`);
    }

    // Create OAuth2 client
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob' // Redirect URI for installed apps
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    // Create Analytics Data API client
    this.analyticsData = google.analyticsdata('v1beta');
    this.client = oauth2Client;

    return this.client;
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
        const { rows } = await this.fetchReport(report);
        return rows;
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
        for (const propertyInstance of propertyInstances) {
          const finalReport = this.overrideReportOptions(baseReport, overrides);
          const { rows } = await this.fetchReportForProperty(finalReport, propertyInstance.propertyId);
          allRows.push(...rows);
        }
        return allRows;
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
    const maxRetries = 5;
    const baseBackoff = 2; // seconds
    const maxBackoff = 300; // 5 minutes max
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        const response = await this.analyticsData.properties.runReport({
          auth: this.client,
          ...request,
        });

        raw = response.data.rows || [];
        break; // Success, exit retry loop
      } catch (e) {
        const msg = String(e?.message || "");
        const isRateLimit = e?.code === 429 || msg.includes("rate limit") || msg.includes("too many requests");
        const isQuotaExceeded = e?.code === 429 || msg.includes("quota") || msg.includes("QuotaExceeded");

        if ((isRateLimit || isQuotaExceeded) && retryCount < maxRetries) {
          retryCount++;
          const backoffSeconds = Math.min(baseBackoff ** retryCount, maxBackoff);
          await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
        } else if ((isRateLimit || isQuotaExceeded) && retryCount >= maxRetries) {
          throw new Error(`Rate limit/quota error after ${maxRetries} retries: ${msg}`);
        } else {
          throw e;
        }
      }
    }

    // Shape rows to our standard format
    const rows = raw.map((row) => shapeRow(row, dimensions, metrics));
    return { rows, raw };
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
    const propertyInstances = [];
    const propertyResults = {
      succeeded: [],
      failed: []
    };

    for (const propertyId of propertyIds) {
      try {
        const { rows } = await this.fetchReportForProperty(this.options.report, propertyId);
        allRows.push(...rows);
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
    
    const processed = await this.runPipeline(allRows, ctx);

    // Format output
    const { output } = this.options || {};
    if (output && output.mode === "envelope") {
      const meta = this.collectMeta(ctx, output);
      const result = { 
        meta, 
        results: processed
      };
      
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


