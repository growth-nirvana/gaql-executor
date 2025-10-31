/**
 * GAQL Library - A library for working with Google Ads Query Language
 */

const { GAQLExecutor } = require('./gaql-executor');
const { FacebookExecutor } = require('./fb/fb-executor');
const { FacebookCampaignTemplate } = require('./templates/Facebook-Campaign-Template');
const { GoogleAdsCampaignTemplate } = require('./templates/GoogleAds-Campaign-Template');
const { GoogleAdsKeywordTemplate } = require('./templates/GoogleAds-Keyword-Template');
const { GoogleAdsSearchTermTemplate } = require('./templates/GoogleAds-SearchTerm-Template');
const { GoogleAdsAdTemplate } = require('./templates/GoogleAds-Ad-Template');
const { GoogleAdsAssetTemplate } = require('./templates/GoogleAds-Asset-Template');
const { GoogleAdsCustomerTemplate } = require('./templates/GoogleAds-Customer-Template');
const { GoogleAdsConversionActionTemplate } = require('./templates/GoogleAds-ConversionAction-Template');
const { GoogleAdsChangeEventTemplate } = require('./templates/GoogleAds-ChangeEvent-Template');
const { toCsv, resultsToCsv, writeCsv, flattenObject } = require('./utils/csv-exporter');

// Main library entry point
module.exports = {
  GAQLExecutor,
  FacebookExecutor,
  FacebookCampaignTemplate,
  GoogleAdsCampaignTemplate,
  GoogleAdsKeywordTemplate,
  GoogleAdsSearchTermTemplate,
  GoogleAdsAdTemplate,
  GoogleAdsAssetTemplate,
  GoogleAdsCustomerTemplate,
  GoogleAdsConversionActionTemplate,
  GoogleAdsChangeEventTemplate,
  // CSV utilities
  toCsv,
  resultsToCsv,
  writeCsv,
  flattenObject,
};