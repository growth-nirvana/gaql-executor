function sanitizeKey(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const RAW_ACTION_LABELS = {
  "app_custom_event.fb_mobile_achievement_unlocked": "Mobile App Feature Unlocks",
  "app_custom_event.fb_mobile_activate_app": "Mobile App Starts",
  "app_custom_event.fb_mobile_add_payment_info": "Mobile App Payment Details",
  "app_custom_event.fb_mobile_add_to_cart": "Mobile App Adds To Cart",
  "app_custom_event.fb_mobile_add_to_wishlist": "Mobile App Adds to Wishlist",
  "app_custom_event.fb_mobile_complete_registration": "Mobile App Registrations",
  "app_custom_event.fb_mobile_content_view": "Mobile App Content Views",
  "app_custom_event.fb_mobile_initiated_checkout": "Mobile App Checkouts",
  "app_custom_event.fb_mobile_level_achieved": "Mobile App Achievements",
  "app_custom_event.fb_mobile_purchase": "Mobile App Purchases",
  "app_custom_event.fb_mobile_rate": "Mobile App Ratings",
  "app_custom_event.fb_mobile_search": "Mobile App Searches",
  "app_custom_event.fb_mobile_spent_credits": "Mobile App Credit Spends",
  "app_custom_event.fb_mobile_tutorial_completion": "Mobile App Tutorial Completions",
  "app_custom_event.other": "Other Mobile App Actions",

  "app_install": "App Installs",
  "app_use": "App Uses",
  "checkin": "Check-ins",
  "comment": "Post Comments",
  "credit_spent": "Credit Spends",
  "games.plays": "Game Plays",
  "landing_page_view": "Landing Page Views",
  "like": "Page Likes",
  "link_click": "Link Clicks",
  "mobile_app_install": "Mobile App Installs",

  "offsite_conversion.custom": "Custom Conversions",
  "offsite_conversion.fb_pixel_add_payment_info": "Adds Payment Info",
  "offsite_conversion.fb_pixel_add_to_cart": "Adds To Cart",
  "offsite_conversion.fb_pixel_add_to_wishlist": "Adds To Wishlist",
  "offsite_conversion.fb_pixel_complete_registration": "Completed Registration",
  "offsite_conversion.fb_pixel_custom": "Custom Pixel Events",
  "offsite_conversion.fb_pixel_initiate_checkout": "Initiates Checkout",
  "offsite_conversion.fb_pixel_lead": "Leads",
  "offsite_conversion.fb_pixel_purchase": "Purchases",
  "offsite_conversion.fb_pixel_search": "Searches",
  "offsite_conversion.fb_pixel_view_content": "Views Content",

  "onsite_conversion.flow_complete": "On-Facebook Workflow Completions",
  "onsite_conversion.messaging_block": "Blocked Messaging Conversations",
  "onsite_conversion.messaging_conversation_started_7d": "Messaging Conversations Started",
  "onsite_conversion.messaging_first_reply": "New Messaging Conversations",
  "onsite_conversion.messaging_user_subscribed": "Messaging Subscriptions",
  "onsite_conversion.post_save": "Post Saves",
  "onsite_conversion.purchase": "On-Facebook Purchases",

  "outbound_click": "Outbound Clicks",
  "photo_view": "Page Photo Views",
  "post": "Post Shares",
  "post_reaction": "Post Reactions",
  "rsvp": "Event Responses",
  "video_view": "3-Second Video Views",
  "contact_total": "Contacts",
  "contact_website": "Website Contacts",
  "contact_mobile_app": "Mobile App Contacts",
  "contact_offline": "Offline Contacts",
  "customize_product_total": "Products Customized",
  "customize_product_website": "Website Products Customized",
  "customize_product_mobile_app": "Mobile App Products Customized",
  "customize_product_offline": "Offline Products Customized",
  "donate_total": "Donations",
  "donate_website": "Website Donations",
  "donate_on_facebook": "On Facebook Donations",
  "donate_mobile_app": "Mobile App Donations",
  "donate_offline": "Offline Donations",
  "find_location_total": "Location Searches",
  "find_location_website": "Website Location Searches",
  "find_location_mobile_app": "Mobile App Location Searches",
  "find_location_offline": "Offline App Location Searches",
  "schedule_total": "Appointments Scheduled",
  "schedule_website": "Website Appointments Scheduled",
  "schedule_mobile_app": "Mobile App Appointments Scheduled",
  "schedule_offline": "Offline App Appointments Scheduled",
  "start_trial_total": "Trials Started",
  "start_trial_website": "Website Trials Started",
  "start_trial_mobile_app": "Mobile App Trials Started",
  "start_trial_offline": "Offline Trials Started",
  "submit_application_total": "Applications Submitted",
  "submit_application_website": "Website Applications Submitted",
  "submit_application_mobile_app": "Mobile App Applications Submitted",
  "submit_application_offline": "Offline Applications Submitted",
  "submit_application_on_facebook": "On Facebook Applications Submitted",
  "subscribe_total": "Subscriptions",
  "subscribe_website": "Website Subscriptions",
  "subscribe_mobile_app": "Mobile App Subscriptions",
  "subscribe_offline": "Offline Subscriptions",
  "recurring_subscription_payment_total": "Recurring Subscription Payments",
  "recurring_subscription_payment_website": "Website Recurring Subscription Payments",
  "recurring_subscription_payment_mobile_app": "Mobile App Recurring Subscription Payments",
  "recurring_subscription_payment_offline": "Offline Recurring Subscription Payments",
  "cancel_subscription_total": "Canceled Subscriptions",
  "cancel_subscription_website": "Website Canceled Subscriptions",
  "cancel_subscription_mobile_app": "Mobile App Canceled Subscriptions",
  "cancel_subscription_offline": "Offline Canceled Subscriptions",

  "ad_click_mobile_app": "In-App Ad Clicks",
  "ad_impression_mobile_app": "In-App Ad Impressions",
  "click_to_call_call_confirm": "Estimated Call Confirmation Clicks",
  "click_to_call_native_call_placed": "Calls Placed",
  "click_to_call_native_20s_call_connect": "20s Calls Placed",
  "click_to_call_native_60s_call_connect": "60s Calls Placed",

  "page_engagement": "Page Engagement",
  "post_engagement": "Post Engagement",
  "onsite_conversion.lead_grouped": "All On-Facebook Leads",
  "lead": "Leads",
  "leadgen_grouped": "On-Facebook Leads (Messenger & Instant Forms)",
  "omni_app_install": "App Installs",
  "omni_purchase": "Purchases",
  "omni_add_to_cart": "Adds to Cart",
  "omni_complete_registration": "Registrations Completed",
  "omni_view_content": "Content Views",
  "omni_search": "Searches",
  "omni_initiated_checkout": "Checkouts Initiated",
  "omni_achievement_unlocked": "Achievements Unlocked",
  "omni_activate_app": "App Activations",
  "omni_level_achieved": "Levels Achieved",
  "omni_rate": "Ratings Submitted",
  "omni_spend_credits": "Credit Spends",
  "omni_tutorial_completion": "Tutorials Completed",
  "omni_custom": "Custom Events",

  "contact": "Contacts",
  "customize_product": "Products Customized",
  "donate": "Donations",
  "find_location": "Location Searches",
  "schedule": "Appointments Scheduled",
  "start_trial": "Trials Started",
  "submit_application": "Applications Submitted",
  "subscribe": "Subscriptions",
  "recurring_subscription_payment": "Recurring Subscription Payments",
  "cancel_subscription": "Canceled Subscriptions",
};

function buildCanonicalMap(rawLabels) {
  const map = {};
  for (const [raw, label] of Object.entries(rawLabels)) {
    const canon = sanitizeKey(raw);
    map[canon] = label;
  }
  return map;
}

const ACTION_LABELS = buildCanonicalMap(RAW_ACTION_LABELS);

function toTitleCase(str) {
  return String(str || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getActionLabel(canonicalKey, ctx) {
  if (ctx && ctx.state) {
    const { customConversionLabelMap } = ctx.state;
    if (customConversionLabelMap && customConversionLabelMap[canonicalKey]) {
      return customConversionLabelMap[canonicalKey];
    }
  }
  if (ACTION_LABELS[canonicalKey]) {
    return ACTION_LABELS[canonicalKey];
  }
  if (canonicalKey === "_total" || canonicalKey === "total") {
    return "Total";
  }
  return toTitleCase(canonicalKey);
}

module.exports = {
  ACTION_LABELS,
  getActionLabel,
  toTitleCase,
};

