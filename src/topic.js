// The conversation's topic: the Category, Product Area and Outcome
// conversation attributes. Intercom names them per team or product, for
// example "Category (Support)" or "Product Area (Horizon)", so a name matches
// with or without a suffix in brackets. The first filled one wins.

const TOPIC_ATTRIBUTES = { category: "Category", product_area: "Product Area", outcome: "Outcome" };

function attribute(attrs, name) {
  for (const [key, value] of Object.entries(attrs)) {
    if (key !== name && !key.startsWith(`${name} (`)) continue;
    const text = Array.isArray(value) ? value.join(", ") : typeof value === "string" ? value : "";
    if (text.trim()) return text.trim();
  }
  return null;
}

// Returns { category, product_area, outcome }, each a string or null.
function topicFields(conversation) {
  const attrs = conversation?.custom_attributes || {};
  return Object.fromEntries(Object.entries(TOPIC_ATTRIBUTES).map(([column, name]) => [column, attribute(attrs, name)]));
}

const hasTopic = (t) => Boolean(t.category || t.product_area || t.outcome);

module.exports = { topicFields, hasTopic };
