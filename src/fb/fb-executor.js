// src/fb-executor.js
const bizSdk = require("facebook-nodejs-business-sdk");
const { buildInsightsQuery, shapeRow } = require("./fb-translate");
const { STEPS } = require("../step-registry"); // reuse your pipeline
const { FacebookAdsApi, AdAccount } = bizSdk;

class FacebookExecutor {
  constructor(options = {}) {
    // For standard reports, extract specific fields
    // For custom reports (like creative_preview), preserve all fields
    const report = options.report || {};
    const isCustomReport = report.entity === 'creative_preview' || report.entity === 'creative_data';
    
    this.options = {
      report: isCustomReport 
        ? { ...report } // Preserve all fields for custom reports
        : {
            entity: report.entity,        // account|campaign|ad_set|ad
            attributes: report.attributes || [],
            metrics: report.metrics || [],
            segments: report.segments || [],
            constraints: report.constraints || [],
            from_date: report.from_date,
            to_date: report.to_date,
            limit: report.limit,
            order: report.order,
            parameters: report.parameters, // Preserve parameters for async, page_all, etc.
          },
      credentials: {
        accessToken: options.credentials?.accessToken,
        accountId: options.credentials?.accountId, // e.g. 1234567890 (we'll prefix act_)
        appId: options.credentials?.appId,
        appSecret: options.credentials?.appSecret,
      },
      pipeline: Array.isArray(options.pipeline) ? options.pipeline : [],
      output: options.output || { mode: "rows" },
    };

    this.clientInit = false;
  }

  initializeClient() {
    if (this.clientInit) return;
    const { accessToken } = this.options.credentials;
    if (!accessToken) throw new Error("Meta accessToken is required");

    FacebookAdsApi.init(accessToken);
    this.clientInit = true;
  }

  isCardinalityChanging(name) {
    const fn = name && STEPS[name];
    return !!(fn && fn.traits && fn.traits.changesCardinality);
  }

  // Async aware pipeline with pre-steps tracking
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

  // Build ctx enough for steps that need fetch (e.g., delta)
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
        const { rows } = await this.fetchInsights(report);
        return rows;
      },
      runWithSteps,
    };

    ctx._freezePre = (executedPre) => { state.preStepsExecuted = executedPre.slice(); };

    return ctx;
  }

  async fetchInsights(report) {
    this.initializeClient();

    const accountId = this.options.credentials.accountId;
    if (!accountId) throw new Error("Meta accountId is required (e.g. 1234567890)");
    const account = new AdAccount(`act_${accountId}`);

    const { level, fields, params } = buildInsightsQuery(report);

    // Default to paging through all results unless explicitly disabled
    const pageAll = report.parameters?.page_all !== false; // Default to true
    const maxPages = Number.isFinite(report.parameters?.max_pages) ? report.parameters.max_pages : 100; // Increased default limit

    // Use sync GET requests
    const runCursor = async (p) => {
      // Sync request - regular getInsights (no async parameter)
      const syncParams = { ...p };
      delete syncParams.async; // Remove async if present
      let cursor = await account.getInsights(fields, syncParams);
      const collected = [];
      let pages = 1;

      collected.push(...cursor.map((r) => r._data || r));

      // Always page through results by default (pageAll defaults to true)
      if (pageAll && cursor.hasNext()) {
        while (cursor.hasNext() && pages < maxPages) {
          // Add delay between pages to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
          cursor = await cursor.next();
          const pageData = cursor.map((r) => r._data || r);
          collected.push(...pageData);
          pages++;
        }
      }
      return collected;
    };

    let raw;
    const maxRetries = 5;
    const baseBackoff = 2; // seconds
    const maxBackoff = 300; // 5 minutes max
    let retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        raw = await runCursor(params);
        break; // Success, exit retry loop
      } catch (e) {
        const msg = String(e?.message || "");
        const isInvalidCombo =
          e?.status === 400 &&
          msg.includes("action_type") &&
          msg.includes("platform_position");
        
        const isRateLimit = e?.status === 429 || msg.includes("rate limit") || msg.includes("too many requests");

        if (isInvalidCombo && Array.isArray(params.action_breakdowns) && params.action_breakdowns.length) {
          // Retry once without action_breakdowns if that specific combo fails
          const retryParams = { ...params, action_breakdowns: [] };
          try {
            raw = await runCursor(retryParams);
            break; // Success
          } catch (retryError) {
            throw retryError; // If retry without action_breakdowns fails, throw
          }
        } else if (isRateLimit && retryCount < maxRetries) {
          // Rate limited - exponential backoff
          retryCount++;
          const backoffSeconds = Math.min(baseBackoff ** retryCount, maxBackoff);
          await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));
          // Continue to next iteration of while loop
        } else if (isRateLimit && retryCount >= maxRetries) {
          // Max retries exceeded
          throw new Error(`Rate limit error after ${maxRetries} retries: ${msg}`);
        } else {
          // Not a rate limit error, throw immediately
          throw e;
        }
      }
    }

    const rows = raw.map((row) => shapeRow(row, report));
    return { rows, raw, level, params };
  }

  async fetchCreativePreviews(report) {
    this.initializeClient();
    const { adIds, adFormat, async: useAsync } = report;
    const bizSdk = require("facebook-nodejs-business-sdk");
    const { Ad, AdCreative } = bizSdk;

    if (!adIds || !Array.isArray(adIds) || adIds.length === 0) {
      throw new Error('adIds must be a non-empty array in report');
    }

    // Facebook requires ad_format, default to DESKTOP_FEED_STANDARD if not provided
    const format = adFormat || 'DESKTOP_FEED_STANDARD';

    const previews = [];

    // Group IDs and process in parallel (NOT using Facebook's batch API)
    // Each ad ID gets its own separate HTTP request, executed in parallel
    const batchSize = 50; // Process up to 50 requests in parallel
    const useAsyncDefault = useAsync !== false;

    for (let i = 0; i < adIds.length; i += batchSize) {
      const batch = adIds.slice(i, i + batchSize);
      
      // Execute multiple API calls in parallel using Promise.all
      // Each call is a separate HTTP request to Facebook
      await Promise.all(batch.map(async (adId) => {
        try {
          const ad = new Ad(adId);
          
          // Get previews - Facebook requires ad_format parameter
          const params = {
            ad_format: format,
          };
          
          if (useAsyncDefault) {
            params.async = true;
          }

          // This makes a separate HTTP request for each ad ID
          // NOT using Facebook's batch API - just parallel execution
          const preview = await ad.getPreviews([], params);
          
          // If async, poll for completion
          if (useAsyncDefault && preview._data?.report_run_id) {
            const reportRunId = preview._data.report_run_id;
            const Api = bizSdk;
            const reportRun = new Api.AdReportRun(reportRunId);
            
            // Poll for completion (similar to Insights)
            const pollInterval = 2000; // 2 seconds for previews
            const maxWaitTime = 60000; // 1 minute max for previews
            const startTime = Date.now();
            
            while (Date.now() - startTime < maxWaitTime) {
              await new Promise(resolve => setTimeout(resolve, pollInterval));
              await reportRun.read(['async_status']);
              const status = reportRun.async_status;
              
              if (status === 'Job Completed' || status === 'completed') {
                // Fetch the preview results
                const finalPreview = await ad.getPreviews({ report_run_id: reportRunId });
                previews.push({
                  ad_id: adId,
                  preview: finalPreview._data || finalPreview,
                });
                return;
              } else if (status === 'Job Failed' || status === 'failed') {
                throw new Error(`Preview generation failed for ad ${adId}`);
              }
            }
            throw new Error(`Preview generation timed out for ad ${adId}`);
          } else {
            // Synchronous preview
            previews.push({
              ad_id: adId,
              preview: preview._data || preview,
            });
          }
        } catch (err) {
          console.error(`Error fetching preview for ad ${adId}:`, err.message);
          previews.push({
            ad_id: adId,
            error: err.message,
          });
        }
      }));

      // Add delay between batches to avoid rate limits
      if (i + batchSize < adIds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return previews;
  }

  async fetchCreativeData(report) {
    this.initializeClient();
    const { creativeIds } = report;
    const bizSdk = require("facebook-nodejs-business-sdk");
    const { AdCreative } = bizSdk;

    if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
      throw new Error('creativeIds must be a non-empty array in report');
    }

    const creatives = [];

    // Batch requests
    const batchSize = 50;
    
    for (let i = 0; i < creativeIds.length; i += batchSize) {
      const batch = creativeIds.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (creativeId) => {
        try {
          const creative = new AdCreative(creativeId);
          await creative.read([
            'id',
            'name',
            'thumbnail_url',
            'image_url',
            'object_story_spec',
            'body',
            'title',
            'link_url',
            'call_to_action_type',
            'format',
          ]);
          
          creatives.push({
            creative_id: creativeId,
            thumbnail_url: creative.thumbnail_url,
            image_url: creative.image_url,
            name: creative.name,
            body: creative.body,
            title: creative.title,
            link_url: creative.link_url,
            call_to_action_type: creative.call_to_action_type,
            format: creative.format,
            object_story_spec: creative.object_story_spec,
          });
        } catch (err) {
          console.error(`Error fetching creative ${creativeId}:`, err.message);
          creatives.push({
            creative_id: creativeId,
            error: err.message,
          });
        }
      }));

      // Add delay between batches
      if (i + batchSize < creativeIds.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return creatives;
  }

  async execute() {
    try {
      const { report } = this.options;
      
      // Check if this is a creative preview request
      if (report && report.entity === 'creative_preview') {
        // Ensure adIds is present
        if (!report.adIds) {
          throw new Error('report.adIds is required for creative preview requests');
        }
        const previews = await this.fetchCreativePreviews(report);
        
        const { output } = this.options || {};
        if (output && output.mode === "envelope") {
          return {
            meta: {},
            results: previews
          };
        }
        return previews;
      }
      
      // Check if this is a creative data (thumbnail) request
      if (report.entity === 'creative_data') {
        const creatives = await this.fetchCreativeData(report);
        
        const { output } = this.options || {};
        if (output && output.mode === "envelope") {
          return {
            meta: {},
            results: creatives
          };
        }
        return creatives;
      }

      // Standard insights request
      const { rows } = await this.fetchInsights(this.options.report);
      const ctx = this.buildContext();
      const processed = await this.runPipeline(rows, ctx);

      const { output } = this.options || {};
      if (output && output.mode === "envelope") {
        const meta = this.collectMeta(ctx, output);
        return { 
          meta, 
          results: processed
        };
      }
      return processed;
    } catch (err) {
      console.error("Meta Executor error:", err && err.stack || err);
      throw err;
    }
  }
}

module.exports = { FacebookExecutor };
