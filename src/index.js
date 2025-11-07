/**
 * GAQL Library - A library for working with Google Ads Query Language
 */

const { GAQLExecutor } = require('./gaql-executor');
const { FacebookExecutor } = require('./fb/fb-executor');
const { FacebookCampaignTemplate } = require('./templates/Facebook-Campaign-Template');
const { FacebookAccountTemplate } = require('./templates/Facebook-Account-Template');
const { FacebookAdSetTemplate } = require('./templates/Facebook-AdSet-Template');
const { FacebookAdTemplate } = require('./templates/Facebook-Ad-Template');
const { FacebookCreativePreviewTemplate } = require('./templates/Facebook-Creative-Preview-Template');
const { GoogleAdsCampaignTemplate } = require('./templates/GoogleAds-Campaign-Template');
const { GoogleAdsKeywordTemplate } = require('./templates/GoogleAds-Keyword-Template');
const { GoogleAdsSearchTermTemplate } = require('./templates/GoogleAds-SearchTerm-Template');
const { GoogleAdsAdTemplate } = require('./templates/GoogleAds-Ad-Template');
const { GoogleAdsAssetTemplate } = require('./templates/GoogleAds-Asset-Template');
const { GoogleAdsCustomerTemplate } = require('./templates/GoogleAds-Customer-Template');
const { GoogleAdsConversionActionTemplate } = require('./templates/GoogleAds-ConversionAction-Template');
const { TikTokClient } = require('./tiktok/client');
const { TikTokExecutor } = require('./tiktok/executor');
const { TikTokAccountTemplate } = require('./templates/TikTok-Account-Template');
const { TikTokCampaignTemplate } = require('./templates/TikTok-Campaign-Template');
const { GoogleAdsChangeEventTemplate } = require('./templates/GoogleAds-ChangeEvent-Template');
const { toCsv, resultsToCsv, writeCsv, flattenObject } = require('./utils/csv-exporter');

// Main library entry point
module.exports = {
  GAQLExecutor,
  FacebookExecutor,
  FacebookCampaignTemplate,
  FacebookAdSetTemplate,
  FacebookAdTemplate,
  FacebookCreativePreviewTemplate,
  FacebookAccountTemplate,
  GoogleAdsCampaignTemplate,
  GoogleAdsKeywordTemplate,
  GoogleAdsSearchTermTemplate,
  GoogleAdsAdTemplate,
  GoogleAdsAssetTemplate,
  GoogleAdsCustomerTemplate,
  GoogleAdsConversionActionTemplate,
  GoogleAdsChangeEventTemplate,
  TikTokClient,
  TikTokExecutor,
  TikTokAccountTemplate,
  TikTokCampaignTemplate,
  // CSV utilities
  toCsv,
  resultsToCsv,
  writeCsv,
  flattenObject,
};