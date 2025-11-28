/**
 * GA4 Filter - Converts standard filter format to GA4 dimensionFilter/metricFilter
 * This abstracts GA4-specific filtering to maintain consistency with other platforms
 */

const { DIMENSION_MAP, METRIC_MAP } = require('./ga4-translate');

/**
 * Convert standard filter format to GA4 filter expression
 * Standard format: { field, op, value, flags }
 * GA4 format: GA4 filter expression object
 * 
 * @param {Array} filters - Array of filter objects in standard format
 * @param {string} logic - 'AND' or 'OR' (default: 'AND')
 * @returns {Object|null} - GA4 filter expression or null if no filters
 */
function toGA4Filter(filters = [], logic = 'AND') {
  if (!Array.isArray(filters) || filters.length === 0) {
    return null;
  }

  // Filter out invalid filters
  const validFilters = filters.filter(f => 
    f && 
    typeof f.field === 'string' && 
    f.field.length > 0 &&
    f.value !== undefined
  );

  if (validFilters.length === 0) {
    return null;
  }

  // Convert each filter to GA4 format
  const expressions = validFilters.map(filter => buildGA4FilterExpression(filter));

  // If only one expression, return it directly
  if (expressions.length === 1) {
    return expressions[0];
  }

  // Multiple expressions - wrap in AND/OR group
  const upperLogic = (logic || 'AND').toUpperCase();
  if (upperLogic === 'OR') {
    return {
      orGroup: {
        expressions: expressions
      }
    };
  }

  return {
    andGroup: {
      expressions: expressions
    }
  };
}

/**
 * Build a single GA4 filter expression from a standard filter object
 * @param {Object} filter - Filter object with { field, op, value, flags }
 * @returns {Object} - GA4 filter expression
 */
function buildGA4FilterExpression(filter) {
  const { field, op, value, flags } = filter;
  
  // Determine if this is a dimension or metric filter
  // If field is explicitly in METRIC_MAP, treat as metric
  // Otherwise, treat as dimension (default for GA4 - allows filtering on any dimension)
  const isMetric = METRIC_MAP.hasOwnProperty(field);
  
  if (isMetric) {
    return buildMetricFilter(field, op, value);
  } else {
    return buildDimensionFilter(field, op, value, flags);
  }
}

/**
 * Build GA4 dimension filter expression
 * @param {string} field - Dimension field name (may be normalized)
 * @param {string} op - Operator (=, !=, IN, CONTAINS, etc.)
 * @param {any} value - Filter value
 * @param {string} flags - Optional flags (e.g., 'i' for case-insensitive)
 * @returns {Object} - GA4 dimension filter expression
 */
function buildDimensionFilter(field, op, value, flags) {
  // Map field name to GA4 API dimension name
  const fieldName = DIMENSION_MAP[field] || field;
  const matchType = mapMatchType(op);
  const caseSensitive = !(flags && typeof flags === 'string' && flags.includes('i'));

  // Handle IN and NOT IN operators
  if (matchType === 'IN_LIST' || matchType === 'NOT_IN_LIST') {
    const values = Array.isArray(value) ? value : String(value).split(',').map(v => v.trim());
    const filterObj = {
      filter: {
        fieldName: fieldName,
        inListFilter: {
          values,
          caseSensitive: caseSensitive,
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

  // Handle string filters
  return {
    filter: {
      fieldName: fieldName,
      stringFilter: {
        matchType: matchType,
        value: String(value),
        caseSensitive: caseSensitive,
      },
    },
  };
}

/**
 * Build GA4 metric filter expression
 * @param {string} field - Metric field name (may be normalized)
 * @param {string} op - Operator (=, !=, >, >=, <, <=)
 * @param {any} value - Filter value
 * @returns {Object} - GA4 metric filter expression
 */
function buildMetricFilter(field, op, value) {
  // Map field name to GA4 API metric name
  const fieldName = METRIC_MAP[field] || field;
  const operation = mapNumericOperation(op);
  const numValue = parseFloat(value);

  return {
    filter: {
      fieldName: fieldName,
      numericFilter: {
        operation,
        value: {
          doubleValue: numValue,
        },
      },
    },
  };
}

/**
 * Map operator to GA4 match type for string/dimension filters
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
    'PARTIAL_REGEXP': 'PARTIAL_REGEXP',
    'REGEXP': 'PARTIAL_REGEXP', // Alias for PARTIAL_REGEXP
    '~': 'PARTIAL_REGEXP', // Alias for PARTIAL_REGEXP
  };
  const upperOp = String(op || '=').toUpperCase();
  return map[upperOp] || map['='] || 'EXACT';
}

/**
 * Map operator to GA4 numeric operation for metric filters
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
  const upperOp = String(op || '=').toUpperCase();
  return map[upperOp] || 'EQUAL';
}

/**
 * Convert standard filter config to GA4 dimensionFilter and metricFilter
 * Standard format: { where: [{ field, op, value, flags }], logic: 'AND'|'OR' }
 * 
 * @param {Object} filterConfig - Filter configuration in standard format
 * @returns {Object} - Object with dimensionFilter and metricFilter properties
 */
function convertFiltersToGA4(filterConfig) {
  if (!filterConfig || !Array.isArray(filterConfig.where) || filterConfig.where.length === 0) {
    return {
      dimensionFilter: null,
      metricFilter: null,
    };
  }

  // Separate dimension and metric filters
  const dimensionFilters = [];
  const metricFilters = [];

  for (const filter of filterConfig.where) {
    if (!filter || typeof filter.field !== 'string') continue;
    
    // If field is explicitly in METRIC_MAP, treat as metric
    // Otherwise, treat as dimension (allows filtering on any dimension, even if not in dimensions list)
    const isMetric = METRIC_MAP.hasOwnProperty(filter.field);
    
    if (isMetric) {
      metricFilters.push(filter);
    } else {
      dimensionFilters.push(filter);
    }
  }

  const logic = filterConfig.logic || 'AND';

  return {
    dimensionFilter: toGA4Filter(dimensionFilters, logic),
    metricFilter: toGA4Filter(metricFilters, logic),
  };
}

module.exports = {
  toGA4Filter,
  buildGA4FilterExpression,
  convertFiltersToGA4,
  mapMatchType,
  mapNumericOperation,
};

