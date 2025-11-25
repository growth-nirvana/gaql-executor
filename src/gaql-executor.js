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
  createCustomer(customerId, customCredentials = null) {
    const credentials = customCredentials || this.options.credentials;
    const { loginCustomerId, refreshToken } = credentials;
    
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
    
    // Check if this is a conversion action query AFTER merging (to catch segments from either source)
    const isConversionActionQuery = 
      (result.segments && Array.isArray(result.segments) && result.segments.includes('segments.conversion_action_name'));
    
    // Special handling: if segments.conversion_action_name is present, 
    // ensure we ONLY have conversion-compatible metrics and NO constraints
    if (isConversionActionQuery) {
      const conversionMetrics = [
        'metrics.conversions',
        'metrics.conversions_value',
        'metrics.all_conversions',
        'metrics.all_conversions_value'
      ];
      // Only keep conversion-compatible metrics
      if (result.metrics && Array.isArray(result.metrics)) {
        result.metrics = result.metrics.filter(m => conversionMetrics.includes(m));
        // If no compatible metrics found, use the conversion metrics
        if (result.metrics.length === 0) {
          result.metrics = conversionMetrics;
        }
      } else {
        result.metrics = conversionMetrics;
      }
      // FORCE remove ALL constraints for conversion action queries
      // The join keys will naturally filter to only matching rows, and constraints
      // (especially metric constraints) can cause errors if the field isn't in the SELECT clause
      result.constraints = [];
      
      // Also remove order/orderBy fields that reference metrics not in SELECT
      // Google Ads API requires any field in ORDER BY to be in SELECT clause
      result.order = undefined;
      result.orderBy = undefined;
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

    // Step 1: Fetch raw data from all customers with per-account fallback
    const allRawRows = [];
    const customerInstances = [];
    const accountResults = {
      succeeded: [],
      failed: [],
      skipped: []
    };

    // Map of successful customer instances keyed by customerId to avoid duplicates
    const successfulCustomers = new Map();
    
    for (const customerId of customerIds) {
      let rawRows = null;
      let success = false;

      // Try manager access first (with loginCustomerId)
      try {
        const customer = this.createCustomer(customerId);
        
        if (this.options.report.entity) {
          rawRows = await customer.report(this.options.report);
        } else {
          const gaqlQuery = this.options.query?.gaql;
          if (!gaqlQuery) throw new Error("Either report options or GAQL query is required");
          rawRows = await customer.query(gaqlQuery);
        }
        
        success = true;
        // Only add to successful customers if not already there
        if (!successfulCustomers.has(customerId)) {
          successfulCustomers.set(customerId, customer);
          customerInstances.push(customer);
        }
        
        accountResults.succeeded.push({
          customerId,
          accessType: 'manager',
          rowCount: rawRows.length
        });
        
      } catch (managerError) {
        // Extract meaningful error message
        const errorMsg = managerError?.errors?.[0]?.message || managerError?.message || String(managerError);
        console.error(`Manager access failed for customer ID ${customerId}: ${errorMsg}`);
        
        // Try direct access (without loginCustomerId)
        try {
          // Create customer instance without loginCustomerId
          const directCredentials = {
            ...this.options.credentials,
            loginCustomerId: undefined
          };
          
          const customer = this.createCustomer(customerId, directCredentials);
          
          if (this.options.report.entity) {
            rawRows = await customer.report(this.options.report);
          } else {
            const gaqlQuery = this.options.query?.gaql;
            if (!gaqlQuery) throw new Error("Either report options or GAQL query is required");
            rawRows = await customer.query(gaqlQuery);
          }
          
          success = true;
          // Only add to successful customers if not already there
          if (!successfulCustomers.has(customerId)) {
            successfulCustomers.set(customerId, customer);
            customerInstances.push(customer);
          }
          
          accountResults.succeeded.push({
            customerId,
            accessType: 'direct',
            rowCount: rawRows.length
          });
          
        } catch (directError) {
          const managerMsg = managerError?.errors?.[0]?.message || managerError?.message || String(managerError);
          const directMsg = directError?.errors?.[0]?.message || directError?.message || String(directError);
          
          console.error(`Both manager and direct access failed for customer ID ${customerId}:`);
          console.error(`Manager error: ${managerMsg}`);
          console.error(`Direct error: ${directMsg}`);
          
          accountResults.failed.push({
            customerId,
            managerError: managerMsg,
            directError: directMsg
          });
          
          // Skip this account and continue with remaining accounts
          continue;
        }
      }

      // If we got data, add it to the collection
      if (success && rawRows) {
        allRawRows.push(...rawRows);
      }
    }

    // Check if we have any successful accounts
    if (accountResults.succeeded.length === 0) {
      throw new Error(`All accounts failed. Failed accounts: ${accountResults.failed.map(f => f.customerId).join(', ')}`);
    }

    // Log summary to stderr so it doesn't pollute JSON output
    console.error(`Account processing summary:`);
    console.error(`- Succeeded: ${accountResults.succeeded.length} accounts`);
    console.error(`- Failed: ${accountResults.failed.length} accounts`);
    if (accountResults.succeeded.length > 0) {
      console.error(`- Successful accounts: ${accountResults.succeeded.map(s => `${s.customerId}(${s.accessType})`).join(', ')}`);
    }
    if (accountResults.failed.length > 0) {
      console.error(`- Failed accounts: ${accountResults.failed.map(f => f.customerId).join(', ')}`);
    }

    // Step 2: Build context with access to ALL customers
    const ctx = this.buildContextMultiAccount(customerInstances);

    // Step 3: Run pipeline ONCE on combined data
    const result = await this.runPipeline(allRawRows, ctx);

    // Step 4: Return results
    const { output } = this.options || {};
    if (output && output.mode === "envelope") {
      const meta = this.collectMeta(ctx, output);
      return { 
        meta, 
        results: result,
        accountResults: {
          succeeded: accountResults.succeeded,
          failed: accountResults.failed,
          summary: {
            total: customerIds.length,
            succeeded: accountResults.succeeded.length,
            failed: accountResults.failed.length
          }
        }
      };
    }
    return result;
  }

}

module.exports = { GAQLExecutor };
