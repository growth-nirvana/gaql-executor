/**
 * CSV Exporter Utility
 * Flattens nested objects and exports to CSV format
 * Works with any data structure (Google Ads, Facebook, etc.)
 */

/**
 * Flatten a nested object into dot notation
 * @param {Object} obj - Object to flatten
 * @param {string} prefix - Prefix for nested keys
 * @param {Object} result - Accumulator for flattened result
 * @returns {Object} - Flattened object
 */
function flattenObject(obj, prefix = '', result = {}) {
  if (obj === null || obj === undefined) {
    return result;
  }

  // Handle primitives
  if (typeof obj !== 'object' || obj instanceof Date) {
    result[prefix] = obj;
    return result;
  }

  // Handle arrays - stringify them
  if (Array.isArray(obj)) {
    result[prefix] = JSON.stringify(obj);
    return result;
  }

  // Handle objects - recurse
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value === null || value === undefined) {
      result[newKey] = value;
    } else if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      flattenObject(value, newKey, result);
    } else if (Array.isArray(value)) {
      // Stringify arrays
      result[newKey] = JSON.stringify(value);
    } else {
      result[newKey] = value;
    }
  }

  return result;
}

/**
 * Escape a CSV field value
 * @param {any} value - Value to escape
 * @returns {string} - Escaped CSV value
 */
function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  // Convert to string
  let str = String(value);

  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }

  return str;
}

/**
 * Get all unique fields from an array of objects
 * @param {Array} data - Array of objects
 * @param {Object} options - Options
 * @returns {Array} - Array of field names
 */
function getAllFields(data, options = {}) {
  const { flatten = true } = options;
  const fieldsSet = new Set();

  for (const row of data) {
    const obj = flatten ? flattenObject(row) : row;
    for (const key of Object.keys(obj)) {
      fieldsSet.add(key);
    }
  }

  return Array.from(fieldsSet).sort();
}

/**
 * Convert array of objects to CSV string
 * @param {Array} data - Array of objects to convert
 * @param {Object} options - Conversion options
 * @returns {string} - CSV string
 */
function toCsv(data, options = {}) {
  if (!Array.isArray(data) || data.length === 0) {
    return '';
  }

  const {
    flatten = true,
    fields = null, // Array of field names to include (in order)
    headers = null, // Object mapping field names to custom headers
    includeHeaders = true,
  } = options;

  // Flatten all rows if requested
  const flatData = flatten ? data.map(row => flattenObject(row)) : data;

  // Determine which fields to include
  let selectedFields;
  if (fields && Array.isArray(fields)) {
    selectedFields = fields;
  } else {
    // Get all unique fields from the data
    selectedFields = getAllFields(data, { flatten });
  }

  const lines = [];

  // Add header row
  if (includeHeaders) {
    const headerRow = selectedFields.map(field => {
      const headerName = headers && headers[field] ? headers[field] : field;
      return escapeCsvValue(headerName);
    });
    lines.push(headerRow.join(','));
  }

  // Add data rows
  for (const row of flatData) {
    const values = selectedFields.map(field => {
      const value = row[field];
      return escapeCsvValue(value);
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Convert results object (with meta and results) to CSV
 * Handles both envelope mode and plain array results
 * @param {Object|Array} results - Results object or array
 * @param {Object} options - Conversion options
 * @returns {string} - CSV string
 */
function resultsToCsv(results, options = {}) {
  // Handle envelope mode
  if (results && typeof results === 'object' && results.results) {
    return toCsv(results.results, options);
  }
  
  // Handle plain array
  if (Array.isArray(results)) {
    return toCsv(results, options);
  }

  // Can't convert
  throw new Error('Invalid results format. Expected array or object with results property.');
}

/**
 * Write CSV to file (Node.js only)
 * @param {Array|Object} data - Data to write
 * @param {string} filePath - Path to output file
 * @param {Object} options - Conversion options
 */
function writeCsv(data, filePath, options = {}) {
  const fs = require('fs');
  const csv = resultsToCsv(data, options);
  fs.writeFileSync(filePath, csv, 'utf8');
}

module.exports = {
  flattenObject,
  toCsv,
  resultsToCsv,
  writeCsv,
  escapeCsvValue,
  getAllFields,
};






