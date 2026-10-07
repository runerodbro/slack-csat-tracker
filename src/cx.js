// Intercom's CX Score for the weekly report and the Home tab Overview.
//
// Intercom scores every conversation (the "CX Score rating" conversation
// attribute, 1–5), rated or not. This counts the conversations closed in a
// period in the team inboxes picked in Settings:
// - only conversations a teammate closed (the same rule as CSAT); no known
//   closer counts as a teammate;
// - a conversation moved to another team after the close (for example to the
//   internal follow-up team after a negative rating) counts under the team it
//   was closed in;
// - conversations without a score yet are counted separately.

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

  // Returns { count, average, notScored, teams: [{ name, count, average }] }.
  async function period(start, end) {
    const selected = new Set(await teamIds());
    const byTeam = new Map();
    let notScored = 0;

    for await (let conv of intercom.searchClosed(start, end)) {
      const closer = conv.statistics?.last_closed_by_id;
      if (closer != null && !(await intercom.getAdmin(closer))) continue; // Fin, a bot or a workflow

      let team = conv.team_assignee_id == null ? null : String(conv.team_assignee_id);
      if (!selected.has(team)) {
        // Moved after the close? Look at the team it was closed in.
        conv = await intercom.getConversation(conv.id);
        team = teamAtClose(conv) ?? null;
        if (!selected.has(team)) continue;
      }

      const value = score(conv);
      if (value == null) {
        notScored++;
        continue;
      }
      const t = byTeam.get(team) || { id: team, count: 0, sum: 0 };
      t.count++;
      t.sum += value;
      byTeam.set(team, t);
    }

    const teams = [];
    for (const t of byTeam.values()) {
      const info = await intercom.getTeam(t.id).catch(() => null);
      teams.push({ name: info?.name || `Team ${t.id}`, count: t.count, average: t.sum / t.count });
    }
    teams.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const count = teams.reduce((n, t) => n + t.count, 0);
    const sum = [...byTeam.values()].reduce((n, t) => n + t.sum, 0);
    return { count, average: count ? sum / count : 0, notScored, teams };
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
