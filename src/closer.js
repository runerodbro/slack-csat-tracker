// Who closed the conversation, which is what makes Intercom ask for a rating.
// Only ratings on conversations closed by a human count; Fin, renamed AI
// agents, chatbots and workflows close as author type "bot".

// Returns "human", "bot", "unknown" (no close found), or undefined when the
// conversation was loaded without its parts (search results).
function partsOf(conversation) {
  const parts = conversation?.conversation_parts?.conversation_parts;
  return Array.isArray(parts) ? parts : undefined;
}

// The close that made Intercom ask for the rating: if the conversation was
// reopened, the last close before the rating.
function ratedClose(conversation, parts) {
  const ratedAt = conversation.conversation_rating?.created_at ?? Infinity;
  const closes = parts.filter((p) => p.part_type === "close");
  return closes.filter((p) => p.created_at <= ratedAt).at(-1) || closes.at(-1) || null;
}

function closedBy(conversation) {
  const parts = partsOf(conversation);
  if (!parts) return undefined;
  const close = ratedClose(conversation, parts);
  if (!close) return "unknown";
  return close.author?.type === "admin" ? "human" : "bot";
}

// The team inbox the conversation was closed in: the last team it was assigned
// to before that close. A move afterwards (for example a workflow that sends
// negative ratings to an internal follow-up team) does not count.
// Returns the team ID, null if the history shows no team assignment, or
// undefined when the conversation was loaded without its parts.
function teamAtClose(conversation) {
  const parts = partsOf(conversation);
  if (!parts) return undefined;
  const close = ratedClose(conversation, parts);
  const limit = close ? close.created_at : conversation.conversation_rating?.created_at ?? Infinity;
  const assigned = parts.filter((p) => p.assigned_to?.type === "team" && p.created_at <= limit).at(-1);
  return assigned ? String(assigned.assigned_to.id) : null;
}

// SQL condition for ratings that count. Unknown and older rows count as human;
// only a clear bot close is left out.
const COUNTS_SQL = "COALESCE(closed_by, 'human') <> 'bot'";

module.exports = { closedBy, teamAtClose, COUNTS_SQL };
