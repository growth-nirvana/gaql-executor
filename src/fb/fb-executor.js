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
        accountId: options.credentials?.accountId, // e.g. 1234567890 (we’ll prefix act_)
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

  // Same async-aware pipeline runner you use elsewhere
  async runPipeline(rows, ctx = {}) {
    const pipe = Array.isArray(this.options.pipeline) ? this.options.pipeline : [];
    if (pipe.length === 0) return rows;

    let out = rows;
    for (const step of pipe) {
      const fn = step && step.use && STEPS[step.use];
      if (typeof fn === "function") {
        out = await fn(out, step, ctx);
      }
    }
    return out;
  }

  // Build ctx enough for steps that need fetch (e.g., delta)
  buildContext() {
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
      cache,
      runPre: async (rows) => rows,
      fetch: async (overrides = {}, tag = "default") => {
        // Allow steps (like delta) to fetch a different time window
        const report = { ...this.options.report, ...overrides };
        const { rows } = await this.fetchInsights(report);
        return rows;
      },
      runWithSteps,
    };
    return ctx;
  }

  async fetchInsights(report) {
    this.initializeClient();

    const accountId = this.options.credentials.accountId;
    if (!accountId) throw new Error("Meta accountId is required (e.g. 1234567890)");
    const account = new AdAccount(`act_${accountId}`);

    const { level, fields, params } = buildInsightsQuery(report);

    // SDK usage for Insights: account.getInsights(fields, params)
    // (fields can be passed as array; params holds level/breakdowns/time_range/filtering/etc.)
    // Docs: Insights overview & breakdowns. :contentReference[oaicite:2]{index=2}
    const result = await account.getInsights(fields, params);
    const raw = result.map(r => r._data || r); // normalize

    // shape rows into your cross-platform schema
    const rows = raw.map(row => shapeRow(row, report));
    return { rows, raw, level, params };
  }

  // Envelope output support (optional)
  makeEnvelope(rows, meta = {}) {
    const include = Array.isArray(this.options.output?.include)
      ? this.options.output.include
      : [];

    const out = { meta: {}, results: rows };
    if (include.includes("periods") && meta.periods) {
      out.meta.periods = meta.periods;
    }
    return out;
  }

  async execute() {
    try {
      const { rows } = await this.fetchInsights(this.options.report);
      const ctx = this.buildContext();
      const processed = await this.runPipeline(rows, ctx);

      if (this.options.output?.mode === "envelope") {
        return this.makeEnvelope(processed, { /* add periods if you run periods step */ });
      }
      return processed;
    } catch (err) {
      console.error("Meta Executor error:", err && err.stack || err);
      throw err;
    }
  }
}

module.exports = { FacebookExecutor };