// Intercom's CX Score for the weekly report and the Home tab Overview.
//
// Intercom scores every conversation (the "CX Score rating" conversation
// attribute, 1–5), rated or not. This counts the conversations closed in a
// period in the team inboxes picked in Settings:
// - only conversations a teammate closed; no known closer counts as a
//   teammate. The search results only name the closer, and Intercom lists
//   bots such as a renamed Fin ("Buddy") as admins too, so a closer that is
//   not an admin or has no inbox seat counts as a bot;
// - a conversation moved to another team after the close (for example to the
//   internal follow-up team after a negative rating) counts under the team it
//   was closed in;
// - Intercom only scores conversations with enough back-and-forth (at least
//   two customer and two teammate or chatbot replies), so many short ones,
//   often emails, never get a score. Each team shows how many of its
//   conversations were scored.
// - The score is Intercom's own: the share of scored conversations rated 4 or
//   5 ("% positive"). Unlike Intercom's "Teammate CX Score", which leaves out
//   conversations Fin took part in, this counts every conversation a teammate
//   closed, including Fin handovers (the same rule as CSAT).

const { teamAtClose } = require("./closer");

const CX_ATTRIBUTE = "CX Score rating";
// The team inboxes where customers are asked for a rating; the starting value
// of the team picker in Settings.
const DEFAULT_TEAM_NAMES = ["Support: Chat", "Support: Email", "Horizon: Chat", "Horizon: Email", "Billing Support", "Customer Success"];
const OVERVIEW_CACHE_SECONDS = 15 * 60;
// Conversations loaded from Intercom at the same time. Well inside Intercom's
// rate limit, and about 8 times faster than one by one.
const PARALLEL = 8;

// Runs fn on every item, at most `limit` at a time; keeps the order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function createCx({ intercom, prefs, log = console }) {
  // The picked team IDs; before anyone picks, the default team names.
  async function teamIds() {
    const picked = prefs.get().cxTeams;
    if (Array.isArray(picked)) return picked.map(String);
    const teams = await intercom.listTeams();
    return teams.filter((t) => DEFAULT_TEAM_NAMES.includes(t.name)).map((t) => String(t.id));
  }

  const score = (conv) => {
    const value = Number(conv.custom_attributes?.[CX_ATTRIBUTE]);
    return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
  };

  // Returns { count, total, positiveShare, teams: [{ name, count, total, positiveShare }] }:
  // count = scored conversations, total = all counted conversations,
  // positiveShare = share of the scored ones rated 4 or 5.
  async function period(start, end) {
    const selected = new Set(await teamIds());
    const byTeam = new Map();

    // Closes by a teammate (the admin list is cached, so this is quick).
    const closedByTeammate = [];
    for await (const conv of intercom.searchClosed(start, end)) {
      const closer = conv.statistics?.last_closed_by_id;
      if (closer != null) {
        const admin = await intercom.getAdmin(closer);
        if (!admin || admin.has_inbox_seat === false) continue; // Fin, a bot or a workflow
      }
      closedByTeammate.push(conv);
    }

    // A conversation now outside the picked teams may have been moved after
    // the close: load it to find the team it was closed in. These loads run
    // in parallel, as they are most of the time this takes.
    const counted = await mapLimit(closedByTeammate, PARALLEL, async (conv) => {
      const team = conv.team_assignee_id == null ? null : String(conv.team_assignee_id);
      if (selected.has(team)) return { conv, team };
      const full = await intercom.getConversation(conv.id);
      return { conv: full, team: teamAtClose(full) ?? null };
    });

    for (const { conv, team } of counted) {
      if (!selected.has(team)) continue;
      const t = byTeam.get(team) || { id: team, count: 0, total: 0, positive: 0 };
      t.total++;
      const value = score(conv);
      if (value != null) {
        t.count++;
        if (value >= 4) t.positive++;
      }
      byTeam.set(team, t);
    }

    const teams = [];
    for (const t of byTeam.values()) {
      const info = await intercom.getTeam(t.id).catch(() => null);
      teams.push({ name: info?.name || `Team ${t.id}`, count: t.count, total: t.total, positiveShare: t.count ? t.positive / t.count : 0 });
    }
    teams.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const count = teams.reduce((n, t) => n + t.count, 0);
    const total = teams.reduce((n, t) => n + t.total, 0);
    const positive = [...byTeam.values()].reduce((n, t) => n + t.positive, 0);
    return { count, total, positiveShare: count ? positive / count : 0, teams };
  }

  // For the Overview: reuses a result up to 15 minutes old for the same
  // period. fresh() returns it without waiting, or null; cachedPeriod() loads
  // it, and people opening the tab at the same time share one load.
  let cached = null;
  let loading = null;
  const fresh = (start, now) =>
    cached && cached.start === start && now - cached.at < OVERVIEW_CACHE_SECONDS ? cached : null;
  async function cachedPeriod(start, end, now) {
    if (fresh(start, now)) return cached;
    if (!loading) {
      loading = period(start, end)
        .then((result) => (cached = { start, at: now, ...result }))
        .finally(() => { loading = null; });
    }
    return loading;
  }

  // Safe versions for posts: a failure gives { error } instead of throwing, so
  // the weekly report still goes out.
  const safe = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      log.warn(`CX Score: ${err.message}`);
      return { error: err.message };
    }
  };

  return { period: safe(period), cachedPeriod: safe(cachedPeriod), fresh, teamIds, invalidate: () => { cached = null; } };
}

module.exports = { createCx, DEFAULT_TEAM_NAMES, CX_ATTRIBUTE };
