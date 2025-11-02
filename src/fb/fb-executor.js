// src/fb-executor.js
const bizSdk = require("facebook-nodejs-business-sdk");
const { buildInsightsQuery, shapeRow } = require("./fb-translate");
const { STEPS } = require("../step-registry"); // reuse your pipeline
const { FacebookAdsApi, AdAccount } = bizSdk;

class FacebookExecutor {
  constructor(options = {}) {
    this.options = {
      report: {
        entity: options.report?.entity,        // account|campaign|ad_set|ad
        attributes: options.report?.attributes || [],
        metrics: options.report?.metrics || [],
        segments: options.report?.segments || [],
        constraints: options.report?.constraints || [],
        from_date: options.report?.from_date,
        to_date: options.report?.to_date,
        limit: options.report?.limit,
        order: options.report?.order,
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

    const pageAll = !!report.parameters?.page_all;
    const maxPages = Number.isFinite(report.parameters?.max_pages) ? report.parameters.max_pages : 10;

    const runCursor = async (p) => {
      let cursor = await account.getInsights(fields, p);
      const collected = [];
      let pages = 1;

      collected.push(...cursor.map((r) => r._data || r));

      if (pageAll) {
        while (cursor.hasNext() && pages < maxPages) {
          cursor = await cursor.next();
          collected.push(...cursor.map((r) => r._data || r));
          pages++;
        }
      }
      return collected;
    };

    const run = async (p) => {
      const res = await account.getInsights(fields, p);
      return res.map((r) => r._data || r);
    };

    let raw;
    try {
      raw = await runCursor(params);
    } catch (e) {
      const msg = String(e?.message || "");
      const isInvalidCombo =
        e?.status === 400 &&
        msg.includes("action_type") &&
        msg.includes("platform_position");

      // Retry once without action_breakdowns if that specific combo fails
      if (isInvalidCombo && Array.isArray(params.action_breakdowns) && params.action_breakdowns.length) {
        const retryParams = { ...params, action_breakdowns: [] };
        raw = await runCursor(retryParams);
      } else {
        throw e;
      }
    }

    const rows = raw.map((row) => shapeRow(row, report));
    return { rows, raw, level, params };
  }

  async execute() {
    try {
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
