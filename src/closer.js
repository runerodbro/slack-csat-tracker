// Who closed the conversation, which is what makes Intercom ask for a rating.
// Only ratings on conversations closed by a human count; Fin, renamed AI
// agents, chatbots and workflows close as author type "bot".

// Returns "human", "bot", "unknown" (no close found), or undefined when the
// conversation was loaded without its parts (search results).
function closedBy(conversation) {
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (!Array.isArray(parts)) return undefined;
  const ratedAt = conversation.conversation_rating?.created_at ?? Infinity;
  const closes = parts.filter((p) => p.part_type === "close");
  // If the conversation was reopened, the last close before the rating counts.
  const close = closes.filter((p) => p.created_at <= ratedAt).at(-1) || closes.at(-1);
  if (!close) return "unknown";
  return close.author?.type === "admin" ? "human" : "bot";
}

// SQL condition for ratings that count. Unknown and older rows count as human;
// only a clear bot close is left out.
const COUNTS_SQL = "COALESCE(closed_by, 'human') <> 'bot'";

module.exports = { closedBy, COUNTS_SQL };
