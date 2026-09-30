// Slack Block Kit messages. Pure functions: data in, message payload out.
//
// The colored side bar comes from a legacy attachment with blocks inside it.
// The color shows the situation:
// Imperial Red (iPaper palette) for what needs attention: negative rating,
// broken streak. Green for a positive rating or a normal streak post. Gold for
// a new record. Green and gold are outside the palette by choice. Green has at
// least 3:1 contrast on Slack's light and dark theme; gold is fainter on light.
// Gray 3 for a restored break.

const { formatDate, addDays } = require("./time");
const { isNegative } = require("./streak");

const IMPERIAL_RED = "#EE2737";
const GRAY = "#B6BBBF";
const GREEN = "#1F9D63";
const GOLD = "#D4A017";

const alert = (yes) => (yes ? IMPERIAL_RED : GREEN);

const SCORES = {
  1: { emoji: "😠", label: "Terrible" },
  2: { emoji: "🙁", label: "Bad" },
  3: { emoji: "😐", label: "OK" },
  4: { emoji: "😃", label: "Great" },
  5: { emoji: "🤩", label: "Amazing" },
};

const MAX_COMMENT = 1500;

function escape(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function days(n) {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

function stars(score) {
  return "★".repeat(score) + "☆".repeat(5 - score);
}

function field(label, value) {
  return { type: "mrkdwn", text: `*${label}*\n${value}` };
}

function wrap(text, color, blocks) {
  return { text, attachments: [{ color, blocks }] };
}

function person(name, email, slackUserId) {
  if (slackUserId) return `<@${slackUserId}>`;
  if (name && email) return `${escape(name)}\n${escape(email)}`;
  return escape(name || email || "Unknown");
}

function scoreLine(score) {
  const s = SCORES[score];
  return `${s.emoji} ${stars(score)}  ${score}/5 ${s.label}`;
}

// rating: row from the ratings table. change: { from } when the score changed.
function ratingMessage({ rating, url, assigneeSlackId, change }) {
  const s = SCORES[rating.score];
  let comment = rating.remark ? escape(rating.remark) : "_No comment_";
  if (comment.length > MAX_COMMENT) comment = `${comment.slice(0, MAX_COMMENT)}…`;

  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `*${s.emoji} New CSAT rating: ${s.label}*` } },
    {
      type: "section",
      fields: [
        field("Assignee", person(rating.admin_name, null, assigneeSlackId)),
        field("Customer", person(rating.contact_name, rating.contact_email)),
        field("Rating", scoreLine(rating.score)),
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Comment*\n${comment}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `<${url}|View conversation in Intercom →>` }] },
  ];
  if (change && change.from !== rating.score) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `✏️ Rating changed from ${change.from}/5 to ${rating.score}/5` }],
    });
  }
  return wrap(
    `${s.emoji} CSAT ${rating.score}/5 for ${rating.admin_name || "unassigned"}`,
    alert(isNegative(rating.score)),
    blocks,
  );
}

function recordText(record) {
  if (!record) return "No record yet. This is the first streak.";
  // record.from is the day of the break before it, so the first counted day is the next one.
  return `${days(record.length)} (${formatDate(addDays(record.from, 1))} – ${formatDate(record.to)})`;
}

// streak: result of computeStreak().
// celebration (optional): { title, count, fiveStar, average, agents: [{ name, slackId, count }] }
function streakMessage(streak, celebration = null) {
  const headline = streak.isNewRecord
    ? `🏆 *NEW RECORD!* ${days(streak.current)} of 100% positive ratings`
    : `🔥 *CSAT streak: ${days(streak.current)}* of 100% positive ratings`;
  const fields = [field("Current streak", days(streak.current))];
  if (streak.isNewRecord) {
    fields.push(field("Old record", recordText(streak.record)));
    fields.push(field("Past the old record", `+${days(streak.current - streak.record.length)}`));
  } else {
    fields.push(field("Record", recordText(streak.record)));
  }
  // since is the day of the last break; the streak starts the day after.
  if (streak.since) fields.push(field("Streak started", formatDate(addDays(streak.since, 1))));

  const blocks = [];
  if (celebration) blocks.push({ type: "header", text: { type: "plain_text", text: celebration.title, emoji: true } });
  blocks.push({ type: "section", text: { type: "mrkdwn", text: headline } }, { type: "section", fields });

  if (celebration) {
    blocks.push({ type: "divider" });
    if (celebration.count) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*During this streak* 📈\n${celebration.count} ${celebration.count === 1 ? "rating" : "ratings"}` +
            ` · ${celebration.fiveStar} × 🤩 5/5 · average ${celebration.average.toFixed(2)}`,
        },
      });
    }
    if (celebration.agents.length) {
      const names = celebration.agents
        .map((a) => `${a.slackId ? `<@${a.slackId}>` : escape(a.name)} (${a.count})`)
        .join(", ");
      blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Thank you* 🙌\n${names}` } });
    }
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "🎊 Keep it going, team! 🎊" }] });
  }

  const text = celebration
    ? `${celebration.title} CSAT streak ${days(streak.current)}`
    : streak.isNewRecord
      ? `NEW RECORD: CSAT streak ${days(streak.current)}`
      : `CSAT streak: ${days(streak.current)}`;
  return wrap(text, streak.isNewRecord ? GOLD : GREEN, blocks);
}

function recordVerdict({ length, previousRecordDays, isRecord }) {
  if (previousRecordDays == null) return "This was the first streak";
  if (isRecord) return `Yes 🏆 ${days(length)} beat the old record of ${days(previousRecordDays)}`;
  return `No. The record is ${days(previousRecordDays)}`;
}

// info: { length, previousRecordDays, isRecord }. rating: ratings row.
function breakMessage({ info, rating, url }) {
  return wrap(`Streak has been broken 😭 It lasted ${days(info.length)}.`, IMPERIAL_RED, [
    { type: "section", text: { type: "mrkdwn", text: "*Streak has been broken 😭*" } },
    {
      type: "section",
      fields: [
        field("Streak lasted", days(info.length)),
        field("Broke the record?", recordVerdict(info)),
        field("Rating", `${scoreLine(rating.score)}\n<${url}|View conversation →>`),
      ],
    },
  ]);
}

// Replaces a break message when the negative rating was changed to positive.
function restoredMessage({ info, rating, url, stillBroken }) {
  const status = stillBroken
    ? "The streak stays broken by another negative rating that day."
    : "The streak continues.";
  return wrap(`Streak restored: rating changed to ${rating.score}/5`, GRAY, [
    { type: "section", text: { type: "mrkdwn", text: "~Streak has been broken 😭~" } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Rating changed to ${rating.score}/5.* ${status}\n<${url}|View conversation →>`,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Before the change: the streak had lasted ${days(info.length)}.` }],
    },
  ]);
}

function bar(share) {
  const blocks = Math.round(share * 10);
  return "█".repeat(blocks) + "░".repeat(10 - blocks);
}

function pct(share) {
  return `${Math.round(share * 100)}%`;
}

// stats: result of weeklyStats(). from/to: labels for the period.
function weeklyMessage({ stats, from, to }) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "📊 Weekly CSAT report", emoji: true } },
    { type: "context", elements: [{ type: "mrkdwn", text: `${from} – ${to}` }] },
  ];
  if (!stats.total) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "No ratings this week." } });
    return { text: "Weekly CSAT report: no ratings this week", blocks };
  }

  blocks.push({
    type: "section",
    fields: [
      field("Ratings", String(stats.total)),
      field("Average", `${stats.average.toFixed(2)} / 5`),
      field("Positive (4–5)", pct(stats.positiveShare)),
    ],
  });
  const distribution = [5, 4, 3, 2, 1]
    .map((score) => {
      const count = stats.distribution[score];
      return `${SCORES[score].emoji} ${score}  \`${bar(count / stats.total)}\`  ${count} (${pct(count / stats.total)})`;
    })
    .join("\n");
  blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Rating distribution*\n${distribution}` } });

  const agents = stats.agents
    .slice(0, 5)
    .map(
      (a, i) =>
        `${i + 1}. *${escape(a.name)}*: ${a.count} ${a.count === 1 ? "rating" : "ratings"} · avg ${a.average.toFixed(2)} · ${pct(a.positiveShare)} positive`,
    )
    .join("\n");
  blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Top agents*\n${agents}` } });

  // Plain blocks, not an attachment: Slack collapses long attachments behind "Show more".
  return { text: `Weekly CSAT report: ${stats.total} ratings, average ${stats.average.toFixed(2)}`, blocks };
}

module.exports = { ratingMessage, streakMessage, breakMessage, restoredMessage, weeklyMessage, escape };
