/**
 * GAQL Executor class for executing Google Ads Query Language queries
 */
const { STEPS } = require("./step-registry");
const { GoogleAdsApi } = require('google-ads-api');

class GAQLExecutor {
  constructor(options = {}) {
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
        limit: options.report?.limit
      },
      credentials: {
        developerToken: options.credentials?.developerToken,
        refreshToken: options.credentials?.refreshToken,
        clientId: options.credentials?.clientId,
        clientSecret: options.credentials?.clientSecret,
        customerId: options.credentials?.customerId,
        loginCustomerId: options.credentials?.loginCustomerId
      },
      pipeline: Array.isArray(options.pipeline) ? options.pipeline : []
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

  runPipeline(rows) {
    const { pipeline = [] } = this.options;
    console.log('🔍 Pipeline:', pipeline);
    if (!Array.isArray(pipeline) || pipeline.length === 0) return rows;
  
    let out = rows;
    for (const step of pipeline) {
      const fn = step && step.use && STEPS[step.use];
      if (typeof fn === "function") {
        out = fn(out, step, { options: this.options });
      }
    }
    return out;
  }
  

  /**
   * Create a customer instance with serialization hook
   * @returns {Object} - The customer instance
   */
  createCustomer() {
    const { credentials: { customerId, loginCustomerId, refreshToken } } = this.options;
    
    if (!customerId) {
      throw new Error('Customer ID is required in options.credentials.customerId');
    }

    // Hook for automatic serialization
    const onQueryEnd = ({ response, resolve }) => {
      
      try {
        const processed = this.runPipeline(response);  // ← pipeline here
        resolve(processed);
      } catch (err) {
        console.warn("Pipeline failed, returning raw:", err.message);
        resolve(response);
      }
    };

    const customer = this.client.Customer({
      customer_id: customerId,
      refresh_token: refreshToken,
      login_customer_id: loginCustomerId || undefined
    }, { onQueryEnd });

    return customer;
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
    
    // Create customer instance with serialization hook
    const customer = this.createCustomer();
    
    try {
      // Check if we have report options (preferred method)
      if (this.options.report.entity) {
        return await customer.report(this.options.report);
      }
      
      // Fall back to GAQL query if no report options
      const gaqlQuery = this.options.query.gaql;
      if (!gaqlQuery) {
        throw new Error('Either report options or GAQL query is required');
      }
      
      return await customer.query(gaqlQuery);
    } catch (error) {
      console.error('Full error object:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      throw new Error(`Google Ads API Error: ${error.message || error.toString()}`);
    }
  }
}

module.exports = { GAQLExecutor };
