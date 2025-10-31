const { BaseTemplate } = require('./BaseTemplate');

class GoogleAdsChangeEventTemplate extends BaseTemplate {
  
  static getBaseReport() {
    return {
      entity: 'change_event',
      attributes: [
        'customer.id',
        'customer.descriptive_name',
        'change_event.resource_name',
        'change_event.change_date_time',
        'change_event.change_resource_type',
        'change_event.resource_change_operation',
        'change_event.user_email',
        'change_event.client_type',
        'change_event.changed_fields',
        'change_event.change_resource_name',
        'change_event.new_resource',
        'change_event.old_resource',
        // Attributed resources (only one will be populated based on change_resource_type)
        'campaign.id',
        'campaign.name',
        'ad_group.id',
        'ad_group.name',
        'change_event.asset',
      ],
      // No metrics for change events
      constraints: [],
      limit: 5000,
    }
  }

  // Simplified lookup method for change events
  // Change events track modifications to resources (campaigns, ad groups, assets, customers)
  // No metrics - just event data about what changed
  static forLookup(credentials, fromDate, toDate, config = {}) {
    const baseReport = this.getBaseReport();
    
    // Change events require a bounded date range filter on change_event.change_date_time
    // Default to 28 days ago if no dates provided (change events only track last 30 days)
    let effectiveFromDate = fromDate;
    let effectiveToDate = toDate;
    
    if (!effectiveFromDate || !effectiveToDate) {
      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today
      effectiveToDate = effectiveToDate || today.toISOString().split('T')[0]; // YYYY-MM-DD
      
      if (!effectiveFromDate) {
        const twentyEightDaysAgo = new Date(today);
        twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
        effectiveFromDate = twentyEightDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    }
    
    // For change events, don't use from_date/to_date in report (they trigger segments.date which isn't supported)
    // Instead, add date constraints using change_event.change_date_time
    // Change events REQUIRE a bounded date range, so always include these constraints
    const dateConstraints = [
      { key: 'change_event.change_date_time', op: '>=', val: effectiveFromDate },
      { key: 'change_event.change_date_time', op: '<=', val: effectiveToDate }
    ];
    
    const allConstraints = [
      ...dateConstraints,
      ...(config.constraints || [])
    ];
    
    const report = {
      ...baseReport,
      // Explicitly set from_date/to_date to undefined to prevent automatic segments.date addition
      from_date: undefined,
      to_date: undefined,
      // Always include date constraints for change_event (required by API)
      constraints: allConstraints,
      // Change events don't support date segments - explicitly set to empty array
      segments: config.segments !== undefined ? config.segments : [],
    };

    // Simplified pipeline - just grouping, no metrics/stats/delta
    const pipeline = [
      { use: "statusesReadable" },
      { use: "formatMicros", fields: [
          "change_event.new_resource.campaign_budget.amount_micros",
          "change_event.old_resource.campaign_budget.amount_micros"
        ],
      },
    ];

    // Add derived dimension steps if configured (before grouping)
    const derivedDimensions = this.calculateDerivedDimensions(config);
    if (derivedDimensions) {
      for (const derivedDim of derivedDimensions) {
        pipeline.push({ use: "deriveDimension", ...derivedDim });
      }
    }

    // Group by selected attributes
    // Note: change events don't have metrics, so no aggregates needed
    pipeline.push({ 
      use: "group", 
      by: [
        ...this.calculateGroupByAttributes(config),
      ],
      aggregates: {}, // No metrics to aggregate
      rollup: false,
      nulls: "include",
      // Order by change date time (most recent first) or by resource type
      orderBy: [
        { field: "change_event.change_date_time", dir: "DESC" },
        { field: "change_event.change_resource_type", dir: "ASC" },
      ],
    });

    // Add filter step if filters are configured
    const filterConfig = this.calculateFilters(config);
    if (filterConfig) {
      pipeline.push({ use: "filter", ...filterConfig });
    }

    return new this({
      credentials,
      report,
      pipeline,
      output: {
        mode: "flat", // Flat output for easier processing
      }
    });
  }
}

module.exports = { GoogleAdsChangeEventTemplate };

