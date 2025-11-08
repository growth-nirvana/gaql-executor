function sanitizeActionKey(action) {
  if (action == null) return null;
  if (action === "_total" || action === "_total_value") return action;
  return String(action)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeActionList(rawValue, fallbackValue = "_total") {
  const source = rawValue !== undefined ? rawValue : fallbackValue;
  const arr = Array.isArray(source) ? source : [source];
  const normalised = arr
    .map((action) => sanitizeActionKey(action))
    .filter((action) => typeof action === "string" && action.length > 0);

  if (normalised.length === 0 && fallbackValue !== undefined) {
    const fallback = sanitizeActionKey(fallbackValue);
    if (fallback) normalised.push(fallback);
  }

  return normalised;
}

module.exports = {
  sanitizeActionKey,
  normalizeActionList,
};


