// Scheduled jobs: morning streak post, weekly report, reconciliation.

const { nowSeconds, addDays } = require("./time");
const { celebrationFor } = require("./celebrate");
const { closedBy, COUNTS_SQL } = require("./closer");
const { topicFields } = require("./topic");
const { weeklyStats } = require("./report");
const messages = require("./messages");

const RECONCILE_DAYS = 3;
// A missed rating older than this is saved without a Slack post.
const LATE_POST_LIMIT = 6 * 60 * 60;

function createJobs({ db, intercom, slack, clock, ratings, queue, prefs, cx, log = console }) {
  const weekRows = db.prepare(
    `SELECT score, admin_id, admin_name, team_id, team_name FROM ratings WHERE rated_at >= ? AND rated_at < ? AND ${COUNTS_SQL}`,
  );
  const weekBotRows = db.prepare(
    "SELECT COUNT(*) AS count, AVG(score) AS average FROM ratings WHERE rated_at >= ? AND rated_at < ? AND closed_by = 'bot'",
  );
  const unclassified = db.prepare("SELECT conversation_id FROM ratings WHERE closed_by IS NULL OR team_id IS NULL");
  const allRatings = db.prepare("SELECT conversation_id FROM ratings");
  const setClassified = db.prepare(
    `UPDATE ratings SET closed_by = ?, team_id = ?, team_name = ?, category = ?, product_area = ?, outcome = ?
     WHERE conversation_id = ?`,
  );
  const getRating = db.prepare("SELECT score, remark FROM ratings WHERE conversation_id = ?");

  const celebratedKeys = db.prepare("SELECT run_key FROM scheduled_runs WHERE job = 'celebration'");
  const markCelebrated = db.prepare("INSERT OR IGNORE INTO scheduled_runs (job, run_key) VALUES ('celebration', ?)");
  const streakRows = db.prepare(
    `SELECT score, admin_id, admin_name, admin_email FROM ratings WHERE rated_at >= ? AND ${COUNTS_SQL}`,
  );

  async function streakStats(since) {
    const rows = streakRows.all(clock.epochAt(addDays(since, 1), 0, 0));
    const agents = new Map();
    // Only real agents get thanks; ratings without one still count in the totals.
    for (const r of rows) {
      if (!r.admin_id) continue;
      const a = agents.get(r.admin_id) || { name: r.admin_name || "Unknown agent", email: r.admin_email, count: 0 };
      a.count++;
      agents.set(r.admin_id, a);
    }
    const top = [...agents.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 5);
    for (const a of top) a.slackId = await slack.userIdByEmail(a.email);
    return {
      count: rows.length,
      fiveStar: rows.filter((r) => r.score === 5).length,
      fourStar: rows.filter((r) => r.score === 4).length,
      average: rows.length ? rows.reduce((sum, r) => sum + r.score, 0) / rows.length : 0,
      agents: top,
    };
  }

  // remember: false for test runs, so the real post still celebrates.
  // forceCelebration: show the celebration even if it was used (preview).
  async function morning(today = clock.localDate(nowSeconds()), { remember = true, forceCelebration = false } = {}) {
    const streak = ratings.currentStreak(today);
    const celebrated = forceCelebration ? new Set() : new Set(celebratedKeys.all().map((r) => r.run_key));
    const due = celebrationFor({ streak, celebrated });
    const celebration = due ? { title: due.title, ...(await streakStats(streak.since)) } : null;

    const posted = await slack.post(messages.streakMessage(streak, celebration));
    if (due) {
      await slack.react(posted.ts, "tada", posted.channel);
      await slack.react(posted.ts, "trophy", posted.channel);
      if (remember) for (const key of due.keys) markCelebrated.run(key);
    }
    return { ...streak, celebration: due?.title || null };
  }

  // friday: local date of the report. Covers Friday 14:00 a week ago to 14:00 on that day.
  // Default: the latest report time that has passed (Friday 14:00).
  function lastReportFriday(now = nowSeconds()) {
    const p = clock.parts(now);
    let friday = addDays(p.date, -((p.weekday - 5 + 7) % 7));
    if (now < clock.epochAt(friday, 14, 0)) friday = addDays(friday, -7);
    return friday;
  }

  // The weekly report message for start to end, and its numbers. The CX Score
  // is added when it is switched on in Settings.
  // withCx: false leaves it out (the Overview adds its own cached one).
  async function weekReport(start, end, { withCx = true } = {}) {
    const stats = weeklyStats(weekRows.all(start, end));
    stats.bots = weekBotRows.get(start, end);
    if (withCx && prefs?.get().cxScore && cx) stats.cx = await cx.period(start, end);
    const label = (epoch) => {
      const p = clock.parts(epoch);
      return new Date(Date.UTC(p.year, p.month - 1, p.day)).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }) + ` ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    };
    return { stats, from: label(start), to: label(end), message: messages.weeklyMessage({ stats, from: label(start), to: label(end) }) };
  }

  async function weekly(friday = lastReportFriday()) {
    const { stats, message } = await weekReport(clock.epochAt(addDays(friday, -7), 14, 0), clock.epochAt(friday, 14, 0));
    await slack.post(message);
    return stats;
  }

  // Finds ratings the webhook missed or changes it did not report, and fills
  // in topics Intercom set after the post.
  async function reconcile({ days = RECONCILE_DAYS } = {}) {
    const now = nowSeconds();
    let found = 0;
    let topics = 0;
    for await (let conv of intercom.searchRated(now - days * 86400)) {
      if (conv.conversation_rating === undefined) conv = await intercom.getConversation(conv.id);
      const r = conv.conversation_rating;
      if (!r || r.rating == null) continue;
      const row = getRating.get(String(conv.id));
      if (queue.has(conv.id)) continue;
      if (row && row.score === Number(r.rating) && (row.remark || null) === (r.remark || null)) {
        if (await ratings.refreshTopic(conv)) topics++;
        continue;
      }
      found++;
      if (!row && (r.created_at || 0) < now - LATE_POST_LIMIT) {
        await ratings.processConversation(conv.id, { conversation: conv, post: false });
      } else {
        queue.enqueue(conv.id, now);
      }
    }
    if (found) log.info(`Reconcile: ${found} new or changed ratings`);
    if (topics) log.info(`Reconcile: topic added to ${topics} rating posts`);
    return found;
  }

  // Imports history without Slack posts, so the streak record starts correct.
  async function backfill({ days, onProgress = () => {} }) {
    let seen = 0;
    let saved = 0;
    for await (const conv of intercom.searchRated(nowSeconds() - days * 86400)) {
      const result = await ratings.processConversation(conv.id, {
        conversation: conv.conversation_rating === undefined ? null : conv,
        post: false,
      });
      seen++;
      if (result === "saved") saved++;
      if (seen % 50 === 0) onProgress({ seen, saved });
    }
    return saved;
  }

  // Fills in who closed each saved rating, its team inbox and its topic, where
  // the closer or team is missing.
  // recheckTeams: work out the team and topic again for every saved rating.
  async function classify({ onProgress = () => {}, recheckTeams = false } = {}) {
    const counts = { human: 0, bot: 0, unknown: 0, failed: 0 };
    const teams = {};
    const rows = recheckTeams ? allRatings.all() : unclassified.all();
    for (const [i, row] of rows.entries()) {
      try {
        const conv = await intercom.getConversation(row.conversation_id);
        const closer = closedBy(conv) ?? "unknown";
        const team = await ratings.teamFields(conv);
        const topic = topicFields(conv);
        setClassified.run(closer, team.team_id, team.team_name, topic.category, topic.product_area, topic.outcome,
          row.conversation_id);
        counts[closer]++;
        const label = team.team_name || (team.team_id === "none" ? "No team" : `Team ${team.team_id}`);
        teams[label] = (teams[label] || 0) + 1;
      } catch (err) {
        counts.failed++;
        log.warn(`Classify ${row.conversation_id}: ${err.message}`);
      }
      if ((i + 1) % 50 === 0) onProgress({ checked: i + 1, total: rows.length, ...counts });
    }
    return { ...counts, teams };
  }

  return { morning, weekly, weekReport, streakStats, reconcile, backfill, classify, lastReportFriday };
}

module.exports = { createJobs };
