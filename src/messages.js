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

// Team inbox names as shown in Slack: "Support: Chat" reads oddly after
// "Team:", so colons become spaces ("Support Chat").
function teamLabel(name) {
  return String(name).replace(/\s*:\s*/g, " ").trim();
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

// The text goes in the attachment's fallback: Slack uses it for notifications
// but does not show it in the channel. A top-level text would show as an extra
// line above the colored bar.
function wrap(text, color, blocks) {
  return { attachments: [{ color, fallback: text, blocks }] };
}

function scoreLine(score) {
  const s = SCORES[score];
  return `${s.emoji} ${stars(score)}  ${score}/5 ${s.label}`;
}

// rating: row from the ratings table. change: { from } when the score changed.
// A compact list, like Supportman's. Slack collapses a post with a side bar
// after 5 lines, so the post stays at 5 lines at most: the rating emoji and a
// rating change sit in the heading, the heading is the link, and the team
// shares the assignee line. Slack folds by how the post looks, and a long
// topic or comment wraps, so the comment comes before the topic: when the post
// folds, the comment's start stays visible and the topic folds first.
function ratingMessage({ rating, url, assigneeSlackId, change }) {
  const s = SCORES[rating.score];
  const assignee = assigneeSlackId ? `<@${assigneeSlackId}>` : escape(rating.admin_name || "Unassigned");
  const name = rating.contact_name ? `_${escape(rating.contact_name)}_` : "";
  const email = rating.contact_email ? escape(rating.contact_email) : "";
  const customer = name && email ? `${name} (${email})` : name || email || "Unknown";
  const changed = change && change.from !== rating.score ? ` · changed from ${SCORES[change.from].emoji}` : "";

  const team = rating.team_name ? ` · ${escape(teamLabel(rating.team_name))}` : "";
  // Category › Product Area · Outcome, leaving out what is not set.
  const subject = [rating.category, rating.product_area].filter(Boolean).map(escape).join(" › ");
  const topic = [subject, rating.outcome && escape(rating.outcome)].filter(Boolean).join(" · ");

  const lines = [
    `${s.emoji} *<${url}|Conversation rated>*${changed}`,
    `• *Assignee:* ${assignee}${team}`,
    `• *Customer:* ${customer}`,
  ];
  if (rating.remark) {
    let comment = escape(rating.remark).replace(/\s*\n\s*/g, " ");
    if (comment.length > MAX_COMMENT) comment = `${comment.slice(0, MAX_COMMENT)}…`;
    lines.push(`• *Comment:* “${comment}”`);
  }
  if (topic) lines.push(`• *Topic:* ${topic}`);

  return wrap(
    `${s.emoji} ${s.label} rating for ${rating.admin_name || "unassigned"}`,
    alert(isNegative(rating.score)),
    [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }],
  );
}

function recordText(record) {
  if (!record) return "No record yet. This is the first streak.";
  // record.from is the day of the break before it, so the first counted day is the next one.
  return `${days(record.length)} (${formatDate(addDays(record.from, 1))} – ${formatDate(record.to)})`;
}

function sinceText(streak) {
  // since is the day of the last break; the streak starts the day after.
  return streak.since ? formatDate(addDays(streak.since, 1)) : null;
}

// streak: result of computeStreak().
// celebration (optional): { title, count, fiveStar, fourStar, average, agents: [{ name, slackId, count }] }
function streakMessage(streak, celebration = null) {
  if (celebration) return celebrationMessage(streak, celebration);

  const headline = streak.isNewRecord
    ? `🏆 *New record: ${days(streak.current)}* of 100% positive ratings`
    : `🔥 *CSAT streak: ${days(streak.current)}* of 100% positive ratings`;
  const fields = streak.isNewRecord
    ? [
        field("Old record", recordText(streak.record)),
        field("Past the old record", `+${days(streak.current - streak.record.length)}`),
      ]
    : [field("Record", recordText(streak.record))];
  if (streak.since) fields.push(field("Streak started", sinceText(streak)));

  const text = streak.isNewRecord
    ? `🏆 New record: ${days(streak.current)} of 100% positive ratings`
    : `🔥 CSAT streak: ${days(streak.current)} of 100% positive ratings`;
  return wrap(text, streak.isNewRecord ? GOLD : GREEN, [
    { type: "section", text: { type: "mrkdwn", text: headline } },
    { type: "section", fields },
  ]);
}

// Big celebration: plain blocks, not an attachment, so Slack never collapses
// it behind "Show more". The header carries the message; nothing repeats it.
function celebrationMessage(streak, celebration) {
  const lines = [];
  if (streak.record) {
    lines.push(
      `*+${days(streak.current - streak.record.length)}* past the old record of ${recordText(streak.record)}`,
    );
  }
  const context = [`Streak started ${sinceText(streak)}`];
  if (!celebration.title.includes(`${streak.current} days`)) context.unshift(`Today: ${days(streak.current)}`);

  const blocks = [{ type: "header", text: { type: "plain_text", text: celebration.title, emoji: true } }];
  if (lines.length) blocks.push({ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } });
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: context.join(" · ") }] });
  blocks.push({ type: "divider" });
  if (celebration.count) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*During this streak* 📈\n${celebration.count} ${celebration.count === 1 ? "rating" : "ratings"}` +
          ` · average ${celebration.average.toFixed(2)}\n` +
          // A streak holds only 4 and 5 ratings, so the two add up to the total.
          `🤩 ${celebration.fiveStar} (${pct(celebration.fiveStar / celebration.count)})` +
          ` · 😃 ${celebration.fourStar} (${pct(celebration.fourStar / celebration.count)})`,
      },
    });
  }
  if (celebration.agents.length) {
    const names = celebration.agents
      .map((a) => `${a.slackId ? `<@${a.slackId}>` : escape(a.name)} (${a.count})`)
      .join(", ");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Thank you* 🙌\n${names}` } });
  }
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "🎊 Keep it going, team!" }] });
  return { text: celebration.title, blocks };
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

  if (stats.teams?.length) {
    const teams = stats.teams
      .map(
        (t) =>
          `*${escape(teamLabel(t.name))}*: ${t.count} ${t.count === 1 ? "rating" : "ratings"} · avg ${t.average.toFixed(2)} · ${pct(t.positiveShare)} positive`,
      )
      .join("\n");
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*By team inbox*\n${teams}` } });
  }

  // Plain blocks, not an attachment: Slack collapses long attachments behind "Show more".
  if (stats.bots?.count) {
    blocks.push({
      type: "context",
      elements: [{
        type: "mrkdwn",
        text: `🤖 Closed by Fin or a bot, not counted above: ${stats.bots.count} ${stats.bots.count === 1 ? "rating" : "ratings"} · average ${stats.bots.average.toFixed(2)}`,
      }],
    });
  }
  return { text: `Weekly CSAT report: ${stats.total} ratings, average ${stats.average.toFixed(2)}`, blocks };
}

module.exports = { ratingMessage, streakMessage, breakMessage, restoredMessage, weeklyMessage, escape, teamLabel, recordText, sinceText, pct, SCORES };
