// Previews of every Slack post, for /csat preview <post>. They use real data
// where there is an example, and made-up sample data where there is none.

const messages = require("./messages");
const { nowSeconds } = require("./time");
const { nextMilestone } = require("./celebrate");
const { COUNTS_SQL } = require("./closer");

const POSTS = {
  rating: "positive rating post",
  negative: "negative rating post",
  changed: "rating changed after it was posted",
  streak: "morning streak post",
  record: "gold new record post",
  celebration: "record celebration",
  milestone: "milestone celebration",
  break: "streak broken",
  restored: "break restored",
  weekly: "weekly report, this week so far",
};

const SAMPLE = {
  conversation_id: null,
  admin_name: "Sample Agent",
  admin_email: null,
  contact_name: "Sample Customer",
  contact_email: "customer@example.com",
  team_name: "Support: Chat",
  category: "General Use / Best Practices",
  product_area: "PDF Processing",
  outcome: "Solved for the customer 🎉",
};
const SAMPLE_URL = "https://app.intercom.com";

function createPreviews({ db, ratings, jobs, intercom, slack, clock }) {
  const latest = (where) =>
    db.prepare(`SELECT * FROM ratings WHERE ${where} AND ${COUNTS_SQL} ORDER BY rated_at DESC LIMIT 1`).get();
  const latestBreak = db.prepare("SELECT * FROM streak_breaks ORDER BY broken_at DESC LIMIT 1");
  const ratingRow = db.prepare("SELECT * FROM ratings WHERE conversation_id = ?");

  const positive = () => latest("score >= 4") || { ...SAMPLE, score: 5, remark: "Quick and helpful, thank you!" };
  const negative = () =>
    latest("score <= 3 AND remark IS NOT NULL") ||
    latest("score <= 3") || { ...SAMPLE, score: 2, remark: "It took a long time to get an answer." };

  const urlFor = (row) => (row.conversation_id ? intercom.conversationUrl(row.conversation_id) : SAMPLE_URL);

  async function ratingPost(row, change = null) {
    const assigneeSlackId = await slack.userIdByEmail(row.admin_email);
    return messages.ratingMessage({ rating: row, url: await urlFor(row), assigneeSlackId, change });
  }

  // The latest break with its rating, or a sample.
  function breakData() {
    const brk = latestBreak.get();
    const row = (brk && ratingRow.get(brk.conversation_id)) || negative();
    const info = brk
      ? { length: brk.length_days, previousRecordDays: brk.previous_record_days, isRecord: Boolean(brk.was_record) }
      : { length: 42, previousRecordDays: 226, isRecord: false };
    return { row, info };
  }

  // The streak as it looks on a record day: today's streak if it is a record,
  // otherwise the day it beats the record.
  function recordStreak() {
    const s = ratings.currentStreak();
    if (s.isNewRecord || !s.record) return s;
    return { ...s, current: s.record.length + 1, isNewRecord: true };
  }

  const today = () => clock.localDate(nowSeconds());
  const tracker = (s) => jobs.milestoneState(s, today()).tracker;

  // kind: "record" (thanks everyone, hall of fame) or "milestone".
  async function celebration(s, kind, title) {
    let stats = await jobs.streakStats(s.since, { allAgents: kind !== "milestone" });
    if (!stats.count) {
      stats = { count: 120, fiveStar: 100, fourStar: 20, average: 4.83, agents: [{ name: SAMPLE.admin_name, count: 40 }] };
    }
    return messages.streakMessage(s, { kind, title, ...stats }, tracker(s));
  }

  const build = {
    rating: () => ratingPost(positive()),
    negative: () => ratingPost(negative()),
    changed: () => ratingPost(negative(), { from: 5 }),
    streak: () => {
      const s = ratings.currentStreak();
      return messages.streakMessage(s, null, tracker(s));
    },
    record: () => {
      const s = recordStreak();
      return messages.streakMessage(s, null, tracker(s));
    },
    celebration: () => {
      const s = recordStreak();
      return celebration(s, "record", `🏆 NEW RECORD: ${s.current} days of 100% positive ratings`);
    },
    milestone: () => {
      const s = ratings.currentStreak();
      const { kind, title } = nextMilestone(s.current);
      return celebration(s, kind, title);
    },
    break: async () => {
      const { row, info } = breakData();
      return messages.breakMessage({ info, rating: row, url: await urlFor(row) });
    },
    restored: async () => {
      const { row, info } = breakData();
      return messages.restoredMessage({ info, rating: { ...row, score: 4 }, url: await urlFor(row), stillBroken: false });
    },
    weekly: async () => {
      const now = nowSeconds();
      return (await jobs.weekReport(clock.epochAt(jobs.lastReportFriday(now), 14, 0), now + 1)).message;
    },
  };

  // Returns the message for a post name, or null for an unknown name.
  async function preview(name) {
    return build[name] ? build[name]() : null;
  }

  return { preview };
}

module.exports = { createPreviews, POSTS };
