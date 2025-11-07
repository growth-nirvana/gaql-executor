const DEFAULT_BASE_URL = 'https://business-api.tiktok.com';
const INTEGRATED_REPORT_ENDPOINT = 'open_api/v1.3/report/integrated/get/';
const CAMPAIGN_GET_ENDPOINT = 'open_api/v1.3/campaign/get/';

const {
  DEFAULT_ACCOUNT_METRICS,
  DEFAULT_ACCOUNT_DIMENSIONS,
  ALLOWED_ACCOUNT_METRICS,
  BASIC_DIMENSIONS,
} = require('./constants');

class TikTokClient {
  constructor(options = {}) {
    const {
      accessToken,
      advertiserId,
      appId,
      secret,
      baseUrl = DEFAULT_BASE_URL,
      timeout = 30000,
    } = options;

    if (!accessToken) throw new Error('TikTokClient requires accessToken');
    if (!advertiserId) throw new Error('TikTokClient requires advertiserId');
    if (!appId) throw new Error('TikTokClient requires appId');
    if (!secret) throw new Error('TikTokClient requires secret');

    this.accessToken = accessToken;
    this.advertiserId = advertiserId;
    this.appId = appId;
    this.secret = secret;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.timeout = timeout;
  }

  buildHeaders() {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Access-Token': this.accessToken,
      'X-Client-App-Id': this.appId,
    };
  }

  buildUrl(endpoint, query) {
    const url = new URL(endpoint.replace(/^\/+/, ''), this.baseUrl);
    if (query && typeof query === 'object') {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        const encoded = typeof value === 'object' ? JSON.stringify(value) : String(value);
        url.searchParams.append(key, encoded);
      }
    }
    return url;
  }

  async request(method, endpoint, options = {}) {
    const {
      query,
      body,
      signal,
      timeout = this.timeout,
    } = options;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const url = this.buildUrl(endpoint, query);
    const payload = body ? { advertiser_id: this.advertiserId, ...body } : undefined;
    const upperMethod = String(method || 'GET').toUpperCase();
    try {
      const logPayload = upperMethod === 'GET' ? query : payload;
      console.log('[TikTokClient] Request', {
        method: upperMethod,
        url: url.toString(),
        headers: this.buildHeaders(),
        payload: logPayload,
      });

      const response = await fetch(url, {
        method: upperMethod,
        headers: this.buildHeaders(),
        body: upperMethod === 'GET' ? undefined : payload ? JSON.stringify(payload) : undefined,
        signal: signal || controller.signal,
      });

      clearTimeout(timer);

      const text = await response.text();
      console.log('[TikTokClient] Response', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bodyPreview: text.slice(0, 1000),
      });
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch (err) {
        throw new Error(`TikTok API returned invalid JSON: ${text}`);
      }

      if (!response.ok) {
        const message = json?.message || json?.error || response.statusText;
        const error = new Error(`TikTok API error ${response.status}: ${message}`);
        error.status = response.status;
        error.details = json;
        throw error;
      }

      if (json?.code && json.code !== 0) {
        const error = new Error(`TikTok API error ${json.code}: ${json.message || 'Unknown error'}`);
        error.code = json.code;
        error.message_cn = json?.message_cn;
        error.request_id = json?.request_id || response.headers.get('x-tt-logid');
        error.details = json;
        throw error;
      }

      return {
        data: json?.data ?? null,
        requestId: json?.request_id || response.headers.get('x-tt-logid'),
        raw: json,
        headers: response.headers,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('TikTok API request timed out');
      }
      throw err;
    }
  }

  async post(endpoint, body, options = {}) {
    return this.request('POST', endpoint, { ...options, body });
  }

  async get(endpoint, query, options = {}) {
    return this.request('GET', endpoint, { ...options, query });
  }

  async getIntegratedReport(params = {}) {
    const {
      start_date,
      end_date,
      report_type = 'BASIC',
      service_type = 'AUCTION',
      data_level = 'AUCTION_ADVERTISER',
      dimensions = ['stat_time_day'],
      metrics = ['spend', 'impressions'],
      filtering,
      page_size = 200,
      page = 1,
      time_granularity = 'STAT_GRANULARITY_DAILY',
      order_type,
      order_field,
      order,
      field,
      enable_total_metrics,
      ...rest
    } = params;

    if (!start_date || !end_date) {
      throw new Error('getIntegratedReport requires start_date and end_date (YYYY-MM-DD)');
    }

    const query = {
      advertiser_id: this.advertiserId,
      report_type,
      service_type,
      data_level,
      dimensions,
      metrics,
      start_date,
      end_date,
      page_size,
      page,
      time_granularity,
      enable_total_metrics,
      ...rest,
    };

    if (filtering) query.filtering = filtering;
    if (order_type || order) query.order_type = order_type || order;
    if (order_field || field) query.order_field = order_field || field;

    return this.request('GET', INTEGRATED_REPORT_ENDPOINT, { query });
  }

  async getAccountPerformance(params = {}) {
    const {
      metrics,
      dimensions,
      filtering,
      page_size,
      page,
      time_granularity,
      order,
      field,
      ...rest
    } = params;

    const requestedMetrics = Array.isArray(metrics) && metrics.length
      ? metrics
      : DEFAULT_ACCOUNT_METRICS;

    const invalidMetrics = requestedMetrics.filter((m) => !ALLOWED_ACCOUNT_METRICS.includes(m));
    if (invalidMetrics.length) {
      throw new Error(`TikTok getAccountPerformance received unsupported metrics: ${invalidMetrics.join(', ')}`);
    }

    const requestedDimensions = Array.isArray(dimensions) && dimensions.length
      ? dimensions
      : DEFAULT_ACCOUNT_DIMENSIONS;

    const invalidDimensions = requestedDimensions.filter((d) => !BASIC_DIMENSIONS.includes(d));
    if (invalidDimensions.length) {
      throw new Error(`TikTok getAccountPerformance received unsupported dimensions: ${invalidDimensions.join(', ')}`);
    }

    const payload = {
      report_type: 'BASIC',
      service_type: 'AUCTION',
      data_level: 'AUCTION_ADVERTISER',
      start_date: params.start_date,
      end_date: params.end_date,
      metrics: requestedMetrics,
      dimensions: requestedDimensions,
      filtering,
      page_size,
      page,
      time_granularity,
      order_type: order,
      order_field: field,
      ...rest,
    };

    return this.getIntegratedReport(payload);
  }

  async getCampaigns(params = {}) {
    const {
      page = 1,
      page_size = 50,
      filtering,
      fields,
      advertiser_ids,
      search_word,
      status,
      campaign_ids,
      sort_type,
      sort_field,
      ...rest
    } = params;

    const query = {
      advertiser_id: this.advertiserId,
      page,
      page_size,
      filtering,
      fields,
      advertiser_ids,
      search_word,
      status,
      campaign_ids,
      sort_type,
      sort_field,
      ...rest,
    };

    return this.get(CAMPAIGN_GET_ENDPOINT, query);
  }
}

module.exports = {
  TikTokClient,
  DEFAULT_BASE_URL,
};

