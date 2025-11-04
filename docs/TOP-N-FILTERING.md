# TopN Filtering Configuration Guide

## Overview

The Facebook Ad, Campaign, and AdSet templates support configurable TopN filtering to help you identify the most impactful changes and highest-performing (or lowest-performing) entities in your advertising data. TopN filtering allows you to focus on specific metrics or calculated impact measures.

## Configuration Format

The `config.topN` parameter accepts two formats:

### Format 1: Simple Array (Enable Specific TopN Steps)

```javascript
{
  topN: ['cpa_worseners', 'roas_improvers', 'cost']
}
```

### Format 2: Object with `enabled` and `n` (Full Control)

```javascript
{
  topN: {
    enabled: ['cpa_worseners', 'roas_improvers', 'cost'],
    n: 10  // Number of top results per step (default: 20)
  }
}
```

**Note:** If `enabled` is `null` or not provided, all TopN steps are enabled by default.

## Available TopN Options

### Impact-Based TopN Steps

These steps identify entities with the largest **impact** on performance metrics, calculated by comparing current period to previous period:

1. **`cpa_worseners`** - Ads/Campaigns/AdSets with the largest negative impact on CPA (Cost Per Acquisition)
   - Metric: `cpa_worsen_impact`
   - Calculates: Cost impact when CPA increases compared to previous period

2. **`cpa_improvers`** - Ads/Campaigns/AdSets with the largest positive impact on CPA
   - Metric: `cpa_improve_impact`
   - Calculates: Cost impact when CPA decreases compared to previous period

3. **`cvr_drops`** - Ads/Campaigns/AdSets with the largest negative impact on CVR (Conversion Rate)
   - Metric: `cvr_drop_impact`
   - Calculates: Click impact when CVR decreases compared to previous period

4. **`cvr_improvers`** - Ads/Campaigns/AdSets with the largest positive impact on CVR
   - Metric: `cvr_improve_impact`
   - Calculates: Click impact when CVR increases compared to previous period

5. **`cpc_rises`** - Ads/Campaigns/AdSets with the largest negative impact on CPC (Cost Per Click)
   - Metric: `cpc_rise_impact`
   - Calculates: Click impact when CPC increases compared to previous period

6. **`cpc_falls`** - Ads/Campaigns/AdSets with the largest positive impact on CPC
   - Metric: `cpc_fall_impact`
   - Calculates: Click impact when CPC decreases compared to previous period

7. **`roas_worseners`** - Ads/Campaigns/AdSets with the largest negative impact on ROAS (Return On Ad Spend)
   - Metric: `roas_worsen_impact`
   - Calculates: Lost revenue opportunity when ROAS decreases compared to previous period

8. **`roas_improvers`** - Ads/Campaigns/AdSets with the largest positive impact on ROAS
   - Metric: `roas_improve_impact`
   - Calculates: Gained revenue opportunity when ROAS increases compared to previous period

### Metric-Based TopN Steps

These steps identify entities with the highest (or lowest) absolute values for specific metrics:

9. **`cost`** - Top N by total spend/cost
   - Metric: `metrics.cost`
   - Sorted: Descending (highest cost first)

10. **`impressions`** - Top N by total impressions
    - Metric: `metrics.impressions`
    - Sorted: Descending (highest impressions first)

11. **`clicks`** - Top N by total clicks
    - Metric: `metrics.clicks`
    - Sorted: Descending (highest clicks first)

12. **`cpa`** - Top N by CPA (Cost Per Acquisition)
    - Metric: `metrics.cpa`
    - Sorted: Descending (highest CPA first - typically you want to see worst performers)

13. **`roas`** - Top N by ROAS (Return On Ad Spend)
    - Metric: `metrics.roas`
    - Sorted: Descending (highest ROAS first - best performers)

## Output Structure

Each TopN step generates a separate array in the output envelope with the format:

```javascript
{
  meta: {
    top_n_cpa_worseners_by_impact: [...],  // Top N CPA worseners
    top_n_roas_improvers_by_impact: [...],  // Top N ROAS improvers
    top_n_by_cost: [...],  // Top N by cost
    // ... other configured TopN arrays
    account_rollup: {...},
  }
  meta: {...}
}
```

Each TopN array contains:
- All grouping attributes (account.id, campaign.id, adset.id, ad.id, etc.)
- Current period metrics (`metrics.*`)
- Previous period metrics (`metrics_prev.*`)
- Delta metrics (`metrics_delta.*`)
- Percent delta metrics (`metrics_delta_pct.*`)
- Impact metrics (for impact-based steps)
- All action types and action values (if configured)

## Usage Examples

### Example 1: Focus on Performance Issues

```javascript
const config = {
  topN: {
    enabled: ['cpa_worseners', 'cvr_drops', 'cpc_rises'],
    n: 15
  }
};

const result = await FacebookAdTemplate.forPerformanceAnalysis(
  credentials,
  fromDate,
  toDate,
  config
);

// Access results
const worstCPAs = result.top_n_cpa_worseners_by_impact;
const worstCVRs = result.top_n_cvr_drops_by_impact;
const worstCPCs = result.top_n_cpc_rises_by_impact;
```

### Example 2: Find Top Performers

```javascript
const config = {
  topN: {
    enabled: ['roas_improvers', 'cvr_improvers', 'roas'],
    n: 10
  }
};

const result = await FacebookAdTemplate.forPerformanceAnalysis(
  credentials,
  fromDate,
  toDate,
  config
);

// Access results
const improvingROAS = result.top_n_roas_improvers_by_impact;
const improvingCVR = result.top_n_cvr_improvers_by_impact;
const bestROAS = result.top_n_by_roas;
```

### Example 3: Budget Analysis

```javascript
const config = {
  topN: ['cost', 'impressions', 'clicks']
};

const result = await FacebookAdTemplate.forPerformanceAnalysis(
  credentials,
  fromDate,
  toDate,
  config
);

// Find highest spenders
const topSpenders = result.top_n_by_cost;
const topImpressions = result.top_n_by_impressions;
const topClicks = result.top_n_by_clicks;
```

### Example 4: Enable All TopN Steps

```javascript
// Option 1: Don't specify topN (defaults to all enabled)
const config = {};

// Option 2: Explicitly set enabled to null
const config = {
  topN: {
    enabled: null,  // All enabled
    n: 20  // Default
  }
};
```

### Example 5: Custom N Value

```javascript
const config = {
  topN: {
    enabled: ['cpa_worseners', 'roas_improvers'],
    n: 5  // Only top 5 for each
  }
};
```

## Best Practices

1. **Use Impact-Based Steps for Trend Analysis**: Impact-based steps (like `cpa_worseners`, `roas_improvers`) are best for identifying entities that are changing significantly, which helps prioritize optimization efforts.

2. **Use Metric-Based Steps for Volume Analysis**: Metric-based steps (like `cost`, `impressions`) help identify your highest-volume entities, regardless of performance trends.

3. **Combine Both Types**: Use a mix of impact-based and metric-based steps to get a comprehensive view:
   ```javascript
   topN: {
     enabled: [
       'cpa_worseners',    // Impact: what's getting worse
       'roas_improvers',   // Impact: what's getting better
       'cost',             // Volume: highest spenders
       'roas'              // Performance: best ROAS
     ],
     n: 15
   }
   ```

4. **Set Appropriate N Values**: 
   - For impact-based steps: 10-20 is usually sufficient to identify the most significant changes
   - For metric-based steps: Consider your total entity count; if you have 100 ads, top 20 might be appropriate, but if you have 1000 ads, you might want top 50

5. **Focus on What Matters**: Don't enable all TopN steps unless you specifically need them. Each step adds processing time and output size.

## Available Templates

TopN filtering is available in:
- `FacebookAdTemplate` - Filter at the ad level
- `FacebookCampaignTemplate` - Filter at the campaign level  
- `FacebookAdSetTemplate` - Filter at the ad set level

All three templates support the same TopN configuration options listed above.

## Notes

- TopN steps are calculated **after** grouping and delta calculations, so they have access to both current and previous period data
- Impact calculations use weighted formulas that consider volume (cost, clicks, etc.) to prioritize changes with the most business impact
- All TopN arrays include the same attribute and metric fields as the main `rows` array for consistency
- TopN steps respect the grouping configuration (e.g., if grouping by campaign, TopN returns top campaigns)

