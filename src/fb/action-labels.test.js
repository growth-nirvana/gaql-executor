const { getActionLabel, resolveActionKey } = require('./action-labels');
const { normalizeActionList } = require('./action-utils');

describe('Facebook action label mapping', () => {
  it('labels pixel purchases as web (Pixel/CAPI)', () => {
    const label = getActionLabel('offsite_conversion_fb_pixel_purchase');
    expect(label).toBe('Purchases — Web (Pixel/CAPI)');
  });

  it('labels mobile app purchases correctly', () => {
    const label = getActionLabel('app_custom_event_fb_mobile_purchase');
    expect(label).toBe('Mobile App Purchases — Mobile App');
  });

  it('labels on-facebook purchases correctly', () => {
    const label = getActionLabel('onsite_conversion_purchase');
    expect(label).toBe('On-Facebook Purchases — On-Facebook');
  });

  it('labels omni purchases as grouped', () => {
    const label = getActionLabel('omni_purchase');
    expect(label).toBe('Purchases — Omni (Grouped)');
  });

  it('resolves label back to canonical action key', () => {
    const key = resolveActionKey('Leads — Web (Pixel/CAPI)');
    expect(key).toBe('offsite_conversion_fb_pixel_lead');
  });

  it('normalizes human label to canonical action key', () => {
    const actions = normalizeActionList('Leads — Web (Pixel/CAPI)');
    expect(actions).toEqual(['offsite_conversion_fb_pixel_lead']);
  });
});

