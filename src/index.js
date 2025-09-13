/**
 * GAQL Library - A library for working with Google Ads Query Language
 */

const { GAQLExecutor } = require('./gaql-executor');
const { FacebookExecutor } = require('./fb/fb-executor');

// Main library entry point
module.exports = {
  GAQLExecutor,
  FacebookExecutor,
};