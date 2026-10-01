// The /csat slash command in Slack.
//
//   /csat here      post in this channel from now on (admins only)
//   /csat status    show the posting channel and the streak
//   /csat preview   show the streak post, only to you
//   /csat help      list the commands
//
// Replies are ephemeral (only the person who typed the command sees them),
// except the confirmation in the new channel, which everyone there sees.

const messages = require("./messages");
const { formatDate } = require("./time");

const CHANNEL_KEY = "slack_channel";

function createCommands({ slack, settings, ratings, clock, config, log = console }) {
  const reply = (text) => ({ response_type: "ephemeral", text });

  async function isAllowed(userId) {
    if (config.slack.adminUserIds.includes(userId)) return true;
    try {
      const user = await slack.userInfo(userId);
      return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
    } catch (err) {
      log.warn(err.message);
      return false;
    }
  }

  async function here({ user_id, channel_id }) {
    if (!(await isAllowed(user_id))) {
      return reply("Only Slack workspace admins and owners can change the CSAT channel.");
    }
    try {
      await slack.post(
        { text: `✅ CSAT posts go to this channel from now on. Changed by <@${user_id}>.` },
        channel_id,
      );
    } catch (err) {
      if (/not_in_channel|channel_not_found/.test(err.message)) {
        return reply("I'm not in this channel yet. Invite me first with `/invite @CSAT Streak Counter`, then run `/csat here` again.");
      }
      throw err;
    }
    settings.set(CHANNEL_KEY, channel_id, user_id);
    log.info(`Posting channel changed to ${channel_id} by ${user_id}`);
    return reply("Done. Ratings, the morning streak post and the weekly report now go to this channel.");
  }

  function status() {
    const saved = settings.get(CHANNEL_KEY);
    const channel = saved
      ? `<#${saved.value}>, set by <@${saved.updated_by}> on ${formatDate(clock.localDate(saved.updated_at))}`
      : `<#${config.slack.channel}> (from the server settings)`;
    const s = ratings.currentStreak();
    const record = s.record ? `${s.record.length} days` : "none yet";
    return reply(
      `*Posting channel:* ${channel}\n` +
        `*Streak:* ${s.current} days of 100% positive ratings${s.isNewRecord ? " 🏆 (record)" : ""}\n` +
        `*${s.isNewRecord ? "Old record" : "Record"}:* ${record}\n` +
        `*Schedule:* streak Mon–Fri 08:30, weekly report Fri 14:00 (${config.timezone})`,
    );
  }

  function preview() {
    return { response_type: "ephemeral", ...messages.streakMessage(ratings.currentStreak()) };
  }

  function help() {
    return reply(
      "*CSAT commands*\n" +
        "`/csat here`: post in this channel from now on (admins only)\n" +
        "`/csat status`: show the posting channel and the streak\n" +
        "`/csat preview`: show the streak post, only to you\n" +
        "`/csat help`: this list",
    );
  }

  // params: the form fields Slack sends (command, text, user_id, channel_id, ...).
  async function handle(params) {
    const sub = (params.text || "").trim().split(/\s+/)[0].toLowerCase();
    switch (sub) {
      case "here":
        return here(params);
      case "status":
        return status();
      case "preview":
        return preview();
      default:
        return help();
    }
  }

  return { handle };
}

module.exports = { createCommands, CHANNEL_KEY };
