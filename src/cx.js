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
//   conversations were scored, so the average is read against that.

const { teamAtClose } = require("./closer");

const CX_ATTRIBUTE = "CX Score rating";
// The team inboxes where customers are asked for a rating; the starting value
// of the team picker in Settings.
const DEFAULT_TEAM_NAMES = ["Support: Chat", "Support: Email", "Horizon: Chat", "Horizon: Email", "Billing Support", "Customer Success"];
const OVERVIEW_CACHE_SECONDS = 15 * 60;

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

  // Returns { count, total, average, teams: [{ name, count, total, average }] }:
  // count = scored conversations, total = all counted conversations.
  async function period(start, end) {
    const selected = new Set(await teamIds());
    const byTeam = new Map();

    for await (let conv of intercom.searchClosed(start, end)) {
      const closer = conv.statistics?.last_closed_by_id;
      if (closer != null) {
        const admin = await intercom.getAdmin(closer);
        if (!admin || admin.has_inbox_seat === false) continue; // Fin, a bot or a workflow
      }

      let team = conv.team_assignee_id == null ? null : String(conv.team_assignee_id);
      if (!selected.has(team)) {
        // Moved after the close? Look at the team it was closed in.
        conv = await intercom.getConversation(conv.id);
        team = teamAtClose(conv) ?? null;
        if (!selected.has(team)) continue;
      }

      const t = byTeam.get(team) || { id: team, count: 0, total: 0, sum: 0 };
      t.total++;
      const value = score(conv);
      if (value != null) {
        t.count++;
        t.sum += value;
      }
      byTeam.set(team, t);
    }

    const teams = [];
    for (const t of byTeam.values()) {
      const info = await intercom.getTeam(t.id).catch(() => null);
      teams.push({ name: info?.name || `Team ${t.id}`, count: t.count, total: t.total, average: t.count ? t.sum / t.count : 0 });
    }
    teams.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const count = teams.reduce((n, t) => n + t.count, 0);
    const total = teams.reduce((n, t) => n + t.total, 0);
    const sum = [...byTeam.values()].reduce((n, t) => n + t.sum, 0);
    return { count, total, average: count ? sum / count : 0, teams };
  }

  // For the Overview: reuses a result up to 15 minutes old for the same period.
  let cached = null;
  async function cachedPeriod(start, end, now) {
    if (cached && cached.start === start && now - cached.at < OVERVIEW_CACHE_SECONDS) return cached;
    cached = { start, at: now, ...(await period(start, end)) };
    return cached;
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

  return { period: safe(period), cachedPeriod: safe(cachedPeriod), teamIds, invalidate: () => { cached = null; } };
}

module.exports = { createCx, DEFAULT_TEAM_NAMES, CX_ATTRIBUTE };
