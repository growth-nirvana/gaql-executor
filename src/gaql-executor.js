/**
 * GAQL Executor class for executing Google Ads Query Language queries
 */
const { STEPS } = require("./step-registry");
const { GoogleAdsApi } = require('google-ads-api');

class GAQLExecutor {
  constructor(options = {}) {
    // Normalize customerIds to always be an array
    let customerIds = [];
    if (options.credentials?.customerIds && Array.isArray(options.credentials.customerIds)) {
      customerIds = options.credentials.customerIds;
    } else if (options.credentials?.customerId) {
      customerIds = [options.credentials.customerId];
    }

    this.options = {
      // Support both GAQL queries and report options
      query: {
        gaql: options.query?.gaql
      },
      report: {
        entity: options.report?.entity,
        attributes: options.report?.attributes,
        metrics: options.report?.metrics,
        segments: options.report?.segments,
        constraints: options.report?.constraints,
        from_date: options.report?.from_date,
        to_date: options.report?.to_date,
        limit: options.report?.limit,
        order: options.report?.order,
        parameters: options.report?.parameters,
        search_settings: options.report?.search_settings
      },
      credentials: {
        developerToken: options.credentials?.developerToken,
        refreshToken: options.credentials?.refreshToken,
        clientId: options.credentials?.clientId,
        clientSecret: options.credentials?.clientSecret,
        customerIds: customerIds,
        loginCustomerId: options.credentials?.loginCustomerId
      },
      pipeline: Array.isArray(options.pipeline) ? options.pipeline : [],
      output: {
        mode: (options.output && options.output.mode) || "rows",
        include: (options.output && options.output.include) || ["periods"]
      }
    };
    this.client = null;
  }

  /**
   * Initialize the Google Ads API client
   * @returns {Object} - The Google Ads API client instance
   */
  initializeClient() {
    if (this.client) {
      return this.client;
    }

    const { credentials: { developerToken, refreshToken, clientId, clientSecret } } = this.options;
    
    const requiredCreds = ['developerToken', 'refreshToken', 'clientId', 'clientSecret'];
    const missing = requiredCreds.filter(key => !this.options.credentials[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required credentials: ${missing.join(', ')}`);
    }

    this.client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: developerToken
    });

    return this.client;
  }

  isCardinalityChanging(name) {
    const fn = name && STEPS[name];
    return !!(fn && fn.traits && fn.traits.changesCardinality);
  }

  /**
   * Build context for execution
   * Provides fetch() that queries ALL customer accounts and combines results
   */
  buildContextMultiAccount(customerInstances) {
    const pipeline = Array.isArray(this.options.pipeline) ? this.options.pipeline : [];
    const baseReport = this.clone(this.options.report);
    const baseQuery = this.clone(this.options.query?.gaql) || null;

    const state = Object.create(null);
    const cache = new Map();

    // run a concrete list of steps (used by runPre, and available to steps)
    const runWithSteps = async (rows, steps) => {
      let out = rows;
      for (const step of steps || []) {
        const fn = step && step.use && STEPS[step.use];
        if (typeof fn === "function") {
          out = await fn(out, step, ctx);
        }
      }
      return out;
    }

    const ctx = {
      options: this.options,
      state,
      cache,
      runPre: async (rows) => {
        const pre = state.preStepsExecuted || [];
        return runWithSteps(rows, pre);
      },
      // Fetch from ALL customers and combine
      fetch: async (overrides = {}, tag = "default") => {
        // Fetch from ALL customers
        const allRows = [];
        for (const customer of customerInstances) {
          let rows;
          if(baseReport?.entity) {
            const finalReport = this.overrideReportOptions(baseReport, overrides);
            rows = await customer.report(finalReport);
          } else if (baseQuery) {
            const gaql = overrides.gaql || baseQuery;
            rows = await customer.query(gaql);
          } else {
            throw new Error("No report entity or GAQL query configured.");
          }
          allRows.push(...rows);
        }
       
        return allRows;
      },

      // expose for advanced usage (rare)
      runWithSteps
    };

    ctx._freezePre = (executedPre) => { state.preStepsExecuted = executedPre.slice(); };

    return ctx;    
  }

  collectMeta(ctx, output = {}) {
    const include = output.include || ["periods"]; // extensible
    const meta = {};
  
    if (include.includes("periods") && ctx?.state?.periods) {
      meta.periods = ctx.state.periods;
    }
    // Optional future toggles:
    if (include.includes("group") && ctx?.state?.lastGroupCfg) {
      meta.group = ctx.state.lastGroupCfg;
    }
    if (include.includes("report")) {
      const { report } = this.options || {};
      if (report) {
        // keep it light; avoid dumping entire object
        meta.report = {
          entity: report.entity,
          from_date: report.from_date,
          to_date: report.to_date,
          constraints: report.constraints,
          order: report.order
        };
      }
    }
    
    // Include envelope data from pipeline steps (like topN)
    if (ctx?.state?.envelopeData) {
      // Flatten envelopeData so each 'as' key becomes a direct property
      Object.assign(meta, ctx.state.envelopeData);
    }
    
    return meta;
  }

  // Async aware pipeline
  async runPipeline(rows, ctx) {
    const pipeline = Array.isArray(this.options.pipeline) ? this.options.pipeline : [];
    if (pipeline.length === 0) return rows;

    let out = rows;
    const executedPre = [];
    let boundaryFrozen = false;

    for (const step of pipeline) {
      const fn = step && step.use && STEPS[step.use];
      if(typeof fn !== "function") continue;

      if(!boundaryFrozen && !this.isCardinalityChanging(step.use)) {
        // still in pre phase
        executedPre.push(step);
      } else if (!boundaryFrozen && this.isCardinalityChanging(step.use)) {
        // crossing the boundary for the first time -- freeze the pre list
        ctx._freezePre(executedPre);
        boundaryFrozen = true;
      }

      out = await fn(out, step, ctx); // supports async steps
    }

    
    // last check -- if we didn’t freeze the pre list, do it now
    if (!boundaryFrozen) ctx._freezePre(executedPre);
    
    // console.log("pre steps executed:", (ctx.state.preStepsExecuted || []).map(s => s.use));
    return out;
  }

  /**
   * Create a customer instance with serialization hook
   * @param {string} customerId - The customer ID to create instance for
   * @returns {Object} - The customer instance
   */
  createCustomer(customerId) {
    const { credentials: { loginCustomerId, refreshToken } } = this.options;
    
    if (!customerId) {
      throw new Error('Customer ID is required');
    }

    // IMPORTANT: return RAW rows; pipeline runs in execute()
    const onQueryEnd = ({ response, resolve }) => resolve(response);

    const customer = this.client.Customer({
      customer_id: customerId,
      refresh_token: refreshToken,
      login_customer_id: loginCustomerId || undefined
    }, { onQueryEnd });

    return customer;
  }

  clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  mergeReportOptions(base, overrides = {}) {
    const merged = this.clone(base) || {};
    const allow = [
      "date_constant", "from_date", "to_date", "constraints",
      "limit", "order", "parameters", "search_settings", "segments",
      "attributes", "metrics"
    ]
    for (const k of allow) if (k in overrides && overrides[k] !== undefined) merged[k] = overrides[k];

    return merged;
  }

  overrideReportOptions(base, overrides = {}) {
    const result = this.clone(base) || {};
    // Completely replace specified fields instead of merging
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Convert report options to GAQL query string
   * @param {Object} reportOptions - The report options object
   * @returns {string} - GAQL query string
   */
  convertReportToGAQL(reportOptions) {
    const { entity, attributes = [], metrics = [], segments = [], constraints = {}, limit } = reportOptions;
    
    // Build SELECT clause
    const selectFields = [...attributes, ...metrics, ...segments];
    const selectClause = `SELECT ${selectFields.join(', ')}`;
    
    // Build FROM clause
    const fromClause = `FROM ${entity}`;
    
    // Build WHERE clause
    let whereClause = '';
    const whereConditions = [];
    
    Object.entries(constraints).forEach(([field, value]) => {
      if (typeof value === 'string') {
        whereConditions.push(`${field} ${value}`);
      } else {
        whereConditions.push(`${field} = ${value}`);
      }
    });
    
    if (whereConditions.length > 0) {
      whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    }
    
    // Build LIMIT clause
    const limitClause = limit ? `LIMIT ${limit}` : '';
    
    // Combine all clauses
    const queryParts = [selectClause, fromClause, whereClause, limitClause].filter(Boolean);
    return queryParts.join(' ');
  }

  /**
   * Execute a query using either GAQL or report options
   * @returns {Promise<any>} - The query results (automatically serialized)
   */
  async execute() {
    // Initialize client lazily
    this.initializeClient();

    const { customerIds } = this.options.credentials;
    
    if (!customerIds || customerIds.length === 0) {
      throw new Error('At least one customer ID is required');
    }

    // Step 1: Fetch raw data from all customers (API calls only)
    const allRawRows = [];
    const customerInstances = [];

    for (const customerId of customerIds) {
      try {
        // Create customer instance
        const customer = this.createCustomer(customerId);
        customerInstances.push(customer);
        
        // Fetch raw data ONLY
        let rawRows;
        if (this.options.report.entity) {
          rawRows = await customer.report(this.options.report);
        } else {
          const gaqlQuery = this.options.query?.gaql;
          if (!gaqlQuery) throw new Error("Either report options or GAQL query is required");
          rawRows = await customer.query(gaqlQuery);
        }
        
        // Collect raw rows
        allRawRows.push(...rawRows);
        
      } catch (error) {
        console.error(`Error for customer ID ${customerId}:`);
        console.error('Full error:', JSON.stringify(error, null, 2));
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        throw error;
      }
    }

    // Step 2: Build context with access to ALL customers
    const ctx = this.buildContextMultiAccount(customerInstances);

    // Step 3: Run pipeline ONCE on combined data
    const result = await this.runPipeline(allRawRows, ctx);

    // Step 4: Return results
    const { output } = this.options || {};
    if (output && output.mode === "envelope") {
      const meta = this.collectMeta(ctx, output);
      return { meta, results: result };
    }
    return result;
  }

}

module.exports = { GAQLExecutor };
