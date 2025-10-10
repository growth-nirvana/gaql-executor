/**
 * GAQL Library - A library for working with Google Ads Query Language
 */

const { GAQLExecutor } = require('./gaql-executor');
const { FacebookExecutor } = require('./fb/fb-executor');
const { FacebookCampaignTemplate } = require('./templates/Facebook-Campaign-Template');
const { GoogleAdsCampaignTemplate } = require('./templates/GoogleAds-Campaign-Template');
const { GoogleAdsKeywordTemplate } = require('./templates/GoogleAds-Keyword-Template');
const { GoogleAdsAdTemplate } = require('./templates/GoogleAds-Ad-Template');
const { GoogleAdsCustomerTemplate } = require('./templates/GoogleAds-Customer-Template');
const { GoogleAdsConversionActionTemplate } = require('./templates/GoogleAds-ConversionAction-Template');
const { toCsv, resultsToCsv, writeCsv, flattenObject } = require('./utils/csv-exporter');

// Main library entry point
module.exports = {
  GAQLExecutor,
  FacebookExecutor,
  FacebookCampaignTemplate,
  GoogleAdsCampaignTemplate,
  GoogleAdsKeywordTemplate,
  GoogleAdsAdTemplate,
  GoogleAdsCustomerTemplate,
  GoogleAdsConversionActionTemplate,
  // CSV utilities
  toCsv,
  resultsToCsv,
  writeCsv,
  flattenObject,
};