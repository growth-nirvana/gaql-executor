/**
 * GAQL Library - A library for working with Google Ads Query Language
 */

const { GAQLExecutor } = require('./gaql-executor');
const { FacebookExecutor } = require('./fb/fb-executor');
const { FacebookCampaignTemplate } = require('./templates/Facebook-Campaign-Template');
const { GoogleAdsCampaignTemplate } = require('./templates/GoogleAds-Campaign-Template');
const { GoogleAdsKeywordTemplate } = require('./templates/GoogleAds-Keyword-Template');
const { GoogleAdsAdTemplate } = require('./templates/GoogleAds-Ad-Template');

// Main library entry point
module.exports = {
  GAQLExecutor,
  FacebookExecutor,
  FacebookCampaignTemplate,
  GoogleAdsCampaignTemplate,
  GoogleAdsKeywordTemplate,
  GoogleAdsAdTemplate,
};