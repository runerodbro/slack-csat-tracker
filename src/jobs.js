// Scheduled jobs: morning streak post, weekly report, reconciliation.

const { nowSeconds, addDays } = require("./time");
const { weeklyStats } = require("./report");
const messages = require("./messages");

const RECONCILE_DAYS = 3;
// A missed rating older than this is saved without a Slack post.
const LATE_POST_LIMIT = 6 * 60 * 60;

function createJobs({ db, intercom, slack, clock, ratings, queue, log = console }) {
  const weekRows = db.prepare(
    "SELECT score, admin_id, admin_name FROM ratings WHERE rated_at >= ? AND rated_at < ?",
  );
  const getRating = db.prepare("SELECT score, remark FROM ratings WHERE conversation_id = ?");

  async function morning(today = clock.localDate(nowSeconds())) {
    const streak = ratings.currentStreak(today);
    await slack.post(messages.streakMessage(streak));
    return streak;
  }

  // friday: local date of the report. Covers Friday 14:00 a week ago to 14:00 on that day.
  // Default: the latest report time that has passed (Friday 14:00).
  function lastReportFriday(now = nowSeconds()) {
    const p = clock.parts(now);
    let friday = addDays(p.date, -((p.weekday - 5 + 7) % 7));
    if (now < clock.epochAt(friday, 14, 0)) friday = addDays(friday, -7);
    return friday;
  }

  async function weekly(friday = lastReportFriday()) {
    const start = clock.epochAt(addDays(friday, -7), 14, 0);
    const end = clock.epochAt(friday, 14, 0);
    const stats = weeklyStats(weekRows.all(start, end));
    const label = (epoch) => {
      const p = clock.parts(epoch);
      return new Date(Date.UTC(p.year, p.month - 1, p.day)).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }) + ` ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    };
    await slack.post(messages.weeklyMessage({ stats, from: label(start), to: label(end) }));
    return stats;
  }

  // Finds ratings the webhook missed or changes it did not report.
  async function reconcile({ days = RECONCILE_DAYS } = {}) {
    const now = nowSeconds();
    let found = 0;
    for await (let conv of intercom.searchRated(now - days * 86400)) {
      if (conv.conversation_rating === undefined) conv = await intercom.getConversation(conv.id);
      const r = conv.conversation_rating;
      if (!r || r.rating == null) continue;
      const row = getRating.get(String(conv.id));
      if (row && row.score === Number(r.rating) && (row.remark || null) === (r.remark || null)) continue;
      if (queue.has(conv.id)) continue;
      found++;
      if (!row && (r.created_at || 0) < now - LATE_POST_LIMIT) {
        await ratings.processConversation(conv.id, { conversation: conv, post: false });
      } else {
        queue.enqueue(conv.id, now);
      }
    }
    if (found) log.info(`Reconcile: ${found} new or changed ratings`);
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

  return { morning, weekly, reconcile, backfill, lastReportFriday };
}

module.exports = { createJobs };
