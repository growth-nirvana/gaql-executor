const { TikTokClient } = require('./client');
const { shapeAccountRows, shapeCampaignRows } = require('./translate');
const { STEPS } = require('../step-registry');

class TikTokExecutor {
  constructor(options = {}) {
    const { credentials = {}, report = {}, pipeline = [], output } = options;

    if (!credentials.accessToken) throw new Error('TikTokExecutor requires credentials.accessToken');
    if (!credentials.advertiserId) throw new Error('TikTokExecutor requires credentials.advertiserId');
    if (!credentials.appId) throw new Error('TikTokExecutor requires credentials.appId');
    if (!credentials.secret) throw new Error('TikTokExecutor requires credentials.secret');

    this.options = {
      credentials: {
        accessToken: credentials.accessToken,
        advertiserId: credentials.advertiserId,
        appId: credentials.appId,
        secret: credentials.secret,
      },
      report: {
        entity: report.entity || 'tiktok_account',
        from_date: report.from_date,
        to_date: report.to_date,
        metrics: Array.isArray(report.metrics) ? report.metrics.slice() : undefined,
        dimensions: Array.isArray(report.dimensions) ? report.dimensions.slice() : undefined,
        filters: report.filters,
        parameters: report.parameters,
      },
      pipeline: Array.isArray(pipeline) ? pipeline.slice() : [],
      output: output || { mode: 'rows' },
    };

    this.client = new TikTokClient({
      accessToken: credentials.accessToken,
      advertiserId: credentials.advertiserId,
      appId: credentials.appId,
      secret: credentials.secret,
      baseUrl: credentials.baseUrl,
    });
  }

  isCardinalityChanging(name) {
    const fn = name && STEPS[name];
    return !!(fn && fn.traits && fn.traits.changesCardinality);
  }

  buildContext() {
    const state = Object.create(null);
    const cache = new Map();

    const ctx = {
      options: this.options,
      state,
      cache,
      runPre: async (rows) => {
        const pre = state.preStepsExecuted || [];
        let out = rows;
        for (const step of pre) {
          const fn = step && step.use && STEPS[step.use];
          if (typeof fn === 'function') {
            out = await fn(out, step, ctx);
          }
        }
        return out;
      },
      fetch: async (overrides = {}) => {
        const report = { ...this.options.report, ...overrides };
        const { rows } = await this.fetchAccountPerformance(report);
        return rows;
      },
    };

    ctx._freezePre = (executedPre = []) => {
      state.preStepsExecuted = executedPre.slice();
    };

    return ctx;
  }

  async runPipeline(rows, ctx) {
    const pipeline = Array.isArray(this.options.pipeline) ? this.options.pipeline : [];
    if (!pipeline.length) return rows;

    let out = rows;
    const executedPre = [];
    let boundaryFrozen = false;

    for (const step of pipeline) {
      const fn = step && step.use && STEPS[step.use];
      if (typeof fn !== 'function') continue;

      if (!boundaryFrozen && !this.isCardinalityChanging(step.use)) {
        executedPre.push(step);
      } else if (!boundaryFrozen && this.isCardinalityChanging(step.use)) {
        ctx._freezePre(executedPre);
        boundaryFrozen = true;
      }

      out = await fn(out, step, ctx);
    }

    if (!boundaryFrozen) ctx._freezePre(executedPre);
    return out;
  }

  collectMeta(ctx, output = {}) {
    const include = output.include || ['periods'];
    const meta = {};

    if (include.includes('periods') && ctx?.state?.periods) {
      meta.periods = ctx.state.periods;
    }
    if (include.includes('group') && ctx?.state?.lastGroupCfg) {
      meta.group = ctx.state.lastGroupCfg;
    }
    if (include.includes('report')) {
      const { report } = this.options || {};
      if (report) {
        meta.report = {
          entity: report.entity,
          from_date: report.from_date,
          to_date: report.to_date,
          filtering: report.filtering || report.filters,
        };
      }
    }
    if (ctx?.state?.envelopeData) {
      Object.assign(meta, ctx.state.envelopeData);
    }

    return meta;
  }

  async fetchAccountPerformance(report) {
    const {
      from_date,
      to_date,
      metrics,
      dimensions,
      filters,
      filtering,
      parameters,
    } = report;

    const response = await this.client.getAccountPerformance({
      start_date: from_date,
      end_date: to_date,
      metrics,
      dimensions,
      filtering: filtering || filters,
      ...parameters,
    });

    const list = response?.data?.list || [];
    const advertiserName = response?.data?.advertiser_name || null;

    const rows = shapeAccountRows(list, {
      advertiserId: this.options.credentials.advertiserId,
      advertiserName,
    });

    console.log('[TikTokExecutor] rows count', rows.length, 'sample', rows.slice(0, 3));

    return { rows, raw: response };
  }

  async execute() {
    const reportEntity = this.options.report?.entity;
    let rows;
    let raw;

    if (reportEntity === 'tiktok_campaigns') {
      ({ rows, raw } = await this.fetchCampaigns(this.options.report));
    } else if (reportEntity === 'tiktok_account' || reportEntity === 'tiktok_account_performance') {
      ({ rows, raw } = await this.fetchAccountPerformance(this.options.report));
    } else {
      throw new Error(`Unsupported TikTok report entity: ${reportEntity}`);
    }

    const ctx = this.buildContext();
    const processed = await this.runPipeline(rows, ctx);

    const { output } = this.options;
    if (output && output.mode === 'envelope') {
      const meta = this.collectMeta(ctx, output);
      return {
        meta,
        results: processed,
      };
    }
    return processed;
  }

  async fetchCampaigns(report = {}) {
    const paramsRaw = {
      page_size: report.parameters?.page_size || 50,
      filtering: report.parameters?.filtering,
      fields: report.parameters?.fields,
      status: report.parameters?.status,
      search_word: report.parameters?.search_word,
      advertiser_ids: report.parameters?.advertiser_ids,
      campaign_ids: report.parameters?.campaign_ids,
      sort_field: report.parameters?.sort_field,
      sort_type: report.parameters?.sort_type,
    };

    const params = Object.fromEntries(
      Object.entries(paramsRaw).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );

    const list = [];
    let page = 1;
    let totalPages = 1;

    do {
      const response = await this.client.getCampaigns({ ...params, page });
      const campaigns = response?.data?.list || [];
      list.push(...campaigns);

      const pageInfo = response?.data?.page_info;
      totalPages = pageInfo?.total_page || 1;
      page += 1;
    } while (page <= totalPages);

    const rows = shapeCampaignRows(list);

    return { rows, raw: { list } };
  }
}

module.exports = {
  TikTokExecutor,
};

