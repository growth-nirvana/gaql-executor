/**
 * GA4 Translate - Converts report options to GA4 Data API requests
 */

/**
 * Map dimension names to GA4 API dimension names
 */
const DIMENSION_MAP = {
  'date': 'date',
  'year': 'year',
  'month': 'month',
  'week': 'week',
  'day': 'day',
  'hour': 'hour',
  'pagePath': 'pagePath',
  'pageTitle': 'pageTitle',
  'pageLocation': 'pageLocation',
  'source': 'source',
  'medium': 'medium',
  'campaign': 'campaignName',
  'sessionSource': 'sessionSource',
  'sessionMedium': 'sessionMedium',
  'sessionCampaign': 'sessionCampaign',
  'deviceCategory': 'deviceCategory',
  'country': 'country',
  'city': 'city',
  'browser': 'browser',
  'operatingSystem': 'operatingSystem',
  'eventName': 'eventName',
  'unifiedPagePathScreen': 'unifiedPagePathScreen',
  'unifiedPageScreen': 'unifiedPageScreen',
};

/**
 * Map metric names to GA4 API metric names
 */
const METRIC_MAP = {
  'sessions': 'sessions',
  'users': 'totalUsers',
  'newUsers': 'newUsers',
  'activeUsers': 'activeUsers',
  'screenPageViews': 'screenPageViews',
  'eventCount': 'eventCount',
  'conversions': 'conversions',
  'totalRevenue': 'totalRevenue',
  'purchaseRevenue': 'purchaseRevenue',
  'engagementRate': 'engagementRate',
  'averageSessionDuration': 'averageSessionDuration',
  'bounceRate': 'bounceRate',
  'sessionsPerUser': 'sessionsPerUser',
  'screenPageViewsPerSession': 'screenPageViewsPerSession',
  'conversionsPerUser': 'conversionsPerUser',
  'conversionRate': 'conversionRate',
};

/**
 * Build GA4 Data API request from report options
 * @param {Object} report - Report configuration
 * @param {string} propertyId - GA4 property ID
 * @returns {Object} - GA4 Data API request object
 */
function buildGA4Request(report, propertyId) {
  const {
    dimensions = [],
    metrics = [],
    dateRanges = [],
    dimensionFilter = null,
    metricFilter = null,
    orderBys = [],
    limit = null,
    offset = null,
    keepEmptyRows = false,
  } = report;

  // Map dimensions to GA4 API format
  const ga4Dimensions = dimensions.map(dim => {
    const mapped = DIMENSION_MAP[dim] || dim;
    return { name: mapped };
  });

  // Map metrics to GA4 API format
  const ga4Metrics = metrics.map(metric => {
    const mapped = METRIC_MAP[metric] || metric;
    return { name: mapped };
  });

  // Build date ranges (default to last 30 days if not provided)
  const ga4DateRanges = dateRanges.length > 0
    ? dateRanges.map(range => {
        // GA4 accepts dates in YYYY-MM-DD format or relative dates like '30daysAgo', 'today'
        const startDate = range.startDate || range.from_date || '30daysAgo';
        const endDate = range.endDate || range.to_date || 'today';
        return {
          startDate,
          endDate,
          ...(range.name && { name: range.name }),
        };
      })
    : [{ startDate: '30daysAgo', endDate: 'today' }];

  // Build request
  const request = {
    property: `properties/${propertyId}`,
    dateRanges: ga4DateRanges,
    dimensions: ga4Dimensions,
    metrics: ga4Metrics,
  };

  // Add filters if provided
  if (dimensionFilter) {
    request.dimensionFilter = buildFilterExpression(dimensionFilter);
  }

  if (metricFilter) {
    request.metricFilter = buildFilterExpression(metricFilter);
  }

  // Add ordering
  if (orderBys && orderBys.length > 0) {
    request.orderBys = orderBys.map(order => {
      if (order.dimension) {
        return {
          dimension: {
            dimensionName: DIMENSION_MAP[order.dimension] || order.dimension,
            orderType: order.orderType || 'ALPHANUMERIC',
          },
          desc: order.desc || false,
        };
      } else if (order.metric) {
        return {
          metric: {
            metricName: METRIC_MAP[order.metric] || order.metric,
          },
          desc: order.desc || false,
        };
      }
      return order;
    });
  }

  // Add limit and offset
  if (limit !== null) {
    request.limit = limit;
  }

  if (offset !== null) {
    request.offset = offset;
  }

  // Keep empty rows
  if (keepEmptyRows) {
    request.keepEmptyRows = keepEmptyRows;
  }

  return request;
}

/**
 * Build GA4 filter expression from filter config
 * @param {Object} filter - Filter configuration
 * @returns {Object} - GA4 filter expression
 */
function buildFilterExpression(filter) {
  if (!filter) {
    return null;
  }

  // Handle direct expression object
  if (filter.field && filter.op && filter.value !== undefined) {
    return buildFilter(filter);
  }

  // Handle expressions array
  if (filter.expressions && Array.isArray(filter.expressions)) {
    if (filter.expressions.length === 1) {
      return buildFilter(filter.expressions[0]);
    }

    // Handle multiple expressions with logic operator
    const logic = filter.logic || 'AND';
    if (logic.toUpperCase() === 'OR') {
      return {
        orGroup: {
          expressions: filter.expressions.map(expr => buildFilter(expr)),
        },
      };
    }
    
    return {
      andGroup: {
        expressions: filter.expressions.map(expr => buildFilter(expr)),
      },
    };
  }

  return null;
}

/**
 * Build a single filter from expression
 * @param {Object} expr - Filter expression
 * @returns {Object} - GA4 filter
 */
function buildFilter(expr) {
  if (expr.field && expr.op && expr.value !== undefined) {
    // Dimension or metric filter
    const isDimension = DIMENSION_MAP.hasOwnProperty(expr.field) || !METRIC_MAP.hasOwnProperty(expr.field);
    
    if (isDimension) {
      const fieldName = DIMENSION_MAP[expr.field] || expr.field;
      const matchType = mapMatchType(expr.op);
      const value = String(expr.value);
      
      // Handle IN and NOT IN operators
      if (matchType === 'IN_LIST' || matchType === 'NOT_IN_LIST') {
        const values = Array.isArray(expr.value) ? expr.value : value.split(',').map(v => v.trim());
        const filterObj = {
          filter: {
            fieldName,
            inListFilter: {
              values,
              caseSensitive: expr.caseSensitive || false,
            },
          },
        };
        // For NOT IN, wrap in notExpression
        if (matchType === 'NOT_IN_LIST') {
          return {
            notExpression: filterObj,
          };
        }
        return filterObj;
      }
      
      return {
        filter: {
          fieldName,
          stringFilter: {
            matchType,
            value,
            caseSensitive: expr.caseSensitive || false,
          },
        },
      };
    } else {
      // Metric filter
      const fieldName = METRIC_MAP[expr.field] || expr.field;
      const operation = mapNumericOperation(expr.op);
      const numValue = parseFloat(expr.value);
      
      return {
        filter: {
          fieldName,
          numericFilter: {
            operation,
            value: {
              doubleValue: numValue,
            },
          },
        },
      };
    }
  }

  // Handle nested expressions
  if (expr.andGroup) {
    return {
      andGroup: {
        expressions: expr.andGroup.expressions.map(e => buildFilter(e)),
      },
    };
  }

  if (expr.orGroup) {
    return {
      orGroup: {
        expressions: expr.orGroup.expressions.map(e => buildFilter(e)),
      },
    };
  }

  return expr;
}

/**
 * Map operator to GA4 match type
 */
function mapMatchType(op) {
  const map = {
    '=': 'EXACT',
    '!=': 'NOT_EXACT',
    'CONTAINS': 'CONTAINS',
    'NOT CONTAINS': 'NOT_CONTAINS',
    'STARTS_WITH': 'BEGINS_WITH',
    'NOT STARTS_WITH': 'NOT_BEGINS_WITH',
    'ENDS_WITH': 'ENDS_WITH',
    'NOT ENDS_WITH': 'NOT_ENDS_WITH',
    'IN': 'IN_LIST',
    'NOT IN': 'NOT_IN_LIST',
  };
  const upperOp = String(op).toUpperCase();
  return map[upperOp] || map[op] || 'EXACT';
}

/**
 * Map operator to GA4 numeric operation
 */
function mapNumericOperation(op) {
  const map = {
    '=': 'EQUAL',
    '!=': 'NOT_EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
  };
  return map[op] || 'EQUAL';
}

/**
 * Shape GA4 API response rows to our standard format
 * @param {Object} row - GA4 API row
 * @param {Array} dimensions - Dimension names
 * @param {Array} metrics - Metric names
 * @returns {Object} - Shaped row
 */
function shapeRow(row, dimensions = [], metrics = []) {
  const shaped = {};

  // Map dimensions
  if (row.dimensionValues) {
    row.dimensionValues.forEach((value, index) => {
      const dimName = dimensions[index] || `dimension${index}`;
      shaped[dimName] = value.value;
    });
  }

  // Map metrics
  if (row.metricValues) {
    row.metricValues.forEach((value, index) => {
      const metricName = metrics[index] || `metric${index}`;
      // Convert string values to numbers where appropriate
      const numValue = parseFloat(value.value);
      shaped[metricName] = isNaN(numValue) ? value.value : numValue;
    });
  }

  return shaped;
}

module.exports = {
  buildGA4Request,
  shapeRow,
  DIMENSION_MAP,
  METRIC_MAP,
};

