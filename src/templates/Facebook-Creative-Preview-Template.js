const { BaseTemplate } = require('./BaseTemplate');

class FacebookCreativePreviewTemplate extends BaseTemplate {
  
  static getBaseReport() {
    // This template doesn't use the standard report structure
    // Instead, it fetches creative previews for given ad IDs
    return {
      entity: 'creative_preview',
      attributes: [],
      metrics: [],
      segments: [],
    };
  }

  /**
   * Get creative previews for a list of ad IDs
   * @param {Object} credentials - Facebook API credentials
   * @param {Array<string>} adIds - Array of ad IDs (e.g., ['123456789', '987654321'])
   * @param {Object} config - Configuration options
   * @param {string} config.adFormat - Preview format (e.g., 'DESKTOP_FEED', 'MOBILE_FEED', 'INSTAGRAM_STORY', etc.)
   * @param {boolean} config.async - Use async API (default: true)
   * @param {boolean} config.includeThumbnails - Also fetch thumbnail URLs from AdCreative objects (default: true)
   */
  static forPreviews(credentials, adIds, config = {}) {
    if (!Array.isArray(adIds) || adIds.length === 0) {
      throw new Error('adIds must be a non-empty array');
    }

    // Default to async and include thumbnails
    const useAsync = config.async !== false;
    const includeThumbnails = config.includeThumbnails !== false;
    const adFormat = config.adFormat || 'DESKTOP_FEED_STANDARD';

    return new FacebookCreativePreviewTemplate({
      credentials,
      report: {
        entity: 'creative_preview',
        adIds: adIds,
        adFormat: adFormat,
        async: useAsync,
        includeThumbnails: includeThumbnails,
      },
      pipeline: [],
      output: {
        mode: 'envelope',
        include: [],
      }
    });
  }

  /**
   * Get creative data (thumbnails) from AdCreative objects
   * This is faster than preview API and works for getting thumbnail URLs
   */
  static forCreativeThumbnails(credentials, creativeIds, config = {}) {
    if (!Array.isArray(creativeIds) || creativeIds.length === 0) {
      throw new Error('creativeIds must be a non-empty array');
    }

    return new FacebookCreativePreviewTemplate({
      credentials,
      report: {
        entity: 'creative_data',
        creativeIds: creativeIds,
      },
      pipeline: [],
      output: {
        mode: 'envelope',
        include: [],
      }
    });
  }

  getConfig() {
    return this.config;
  }
}

module.exports = { FacebookCreativePreviewTemplate };

