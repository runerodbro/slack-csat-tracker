// The /csat slash command in Slack.
//
//   /csat here      post in this channel from now on (admins only)
//   /csat status    show the posting channel and the streak
//   /csat preview   show the streak post and the list of previews, only to you
//   /csat preview <post>   show any post (see previews.js), only to you
//   /csat help      list the commands
//
// Replies are ephemeral (only the person who typed the command sees them),
// except the confirmation in the new channel, which everyone there sees.

const messages = require("./messages");
const { formatDate } = require("./time");
const { POSTS } = require("./previews");
const { CHANNEL_KEY, changeChannel } = require("./channels");

function createCommands({ slack, settings, ratings, previews, access, clock, config, log = console }) {
  const reply = (text) => ({ response_type: "ephemeral", text });

  async function here({ user_id, channel_id }) {
    if (!(await access.canEdit(user_id))) {
      return reply("Only Slack workspace admins and owners, and the app admins, can change the CSAT channel.");
    }
    if ((await changeChannel({ slack, settings, log }, channel_id, user_id)) === "not_in_channel") {
      return reply("I'm not in this channel yet. Invite me first with `/invite @CSAT Streak Counter`, then run `/csat here` again.");
    }
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

  const postList = () => Object.entries(POSTS).map(([name, what]) => `\`${name}\` ${what}`).join(" · ");

  // Without a post name: the streak post, with the list of previews under it.
  async function preview(name) {
    if (!name) {
      const msg = messages.streakMessage(ratings.currentStreak());
      const list = `*Preview any post:* \`/csat preview <post>\`\n${postList()}`;
      msg.attachments.push({ fallback: list, blocks: [{ type: "context", elements: [{ type: "mrkdwn", text: list }] }] });
      return { response_type: "ephemeral", ...msg };
    }
    const msg = await previews.preview(name);
    if (!msg) return reply(`I don't know the post \`${name}\`. Pick one of these:\n${postList()}`);
    return { response_type: "ephemeral", ...msg };
  }

  function help() {
    return reply(
      "*CSAT commands*\n" +
        "`/csat here`: post in this channel from now on (admins only)\n" +
        "Open the app's *Home* tab for the overview and settings.\n" +
        "`/csat status`: show the posting channel and the streak\n" +
        "`/csat preview`: show the streak post and the list of previews, only to you\n" +
        "`/csat preview <post>`: show any post with real data, only to you\n" +
        "`/csat help`: this list",
    );
  }

  // params: the form fields Slack sends (command, text, user_id, channel_id, ...).
  async function handle(params) {
    const [sub, arg] = (params.text || "").trim().toLowerCase().split(/\s+/);
    switch (sub) {
      case "here":
        return here(params);
      case "status":
        return status();
      case "preview":
        return preview(arg);
      default:
        return help();
    }
  }

  return { handle };
}

module.exports = { createCommands, CHANNEL_KEY };
