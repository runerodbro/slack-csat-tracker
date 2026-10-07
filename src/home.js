// The app's Home tab in Slack: Overview and Settings, switched with two
// buttons (Slack has no tabs inside the Home tab). Slack shows it when someone
// opens the app; it is drawn again on every open, so the numbers are current.
//
// Everyone sees the Overview and can send a preview to the app's Messages tab.
// Settings can be changed by workspace admins and owners and the app admins
// (access.js); everyone else sees them read-only.

const messages = require("./messages");
const { nowSeconds, formatDate } = require("./time");
const { POSTS } = require("./previews");
const { CHANNEL_KEY, changeChannel } = require("./channels");

const { escape, teamLabel, recordText, sinceText, pct, SCORES } = messages;

const text = (t) => ({ type: "mrkdwn", text: t });
const section = (t, extra = {}) => ({ type: "section", text: text(t), ...extra });
const context = (t) => ({ type: "context", elements: [text(t)] });
const divider = { type: "divider" };
const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;

function createHome({ slack, settings, ratings, jobs, previews, access, clock, config, getChannel, log = console }) {
  const tabs = new Map(); // user ID → "overview" | "settings"
  const notices = new Map(); // user ID → a line to show once in Settings

  function tabButtons(active) {
    const button = (value, label) => ({
      type: "button",
      action_id: `home_tab_${value}`,
      value,
      text: { type: "plain_text", text: label },
      ...(active === value && { style: "primary" }),
    });
    return { type: "actions", elements: [button("overview", "Overview"), button("settings", "Settings")] };
  }

  function weekBlocks() {
    const now = nowSeconds();
    const { stats, from } = jobs.weekReport(clock.epochAt(jobs.lastReportFriday(now), 14, 0), now + 1);
    const blocks = [section("*This week*"), context(`Since ${from}, goes into Friday's report`)];
    if (!stats.total) {
      blocks.push(section("No ratings yet this week."));
    } else {
      blocks.push({
        type: "section",
        fields: [
          text(`*Ratings*\n${stats.total}`),
          text(`*Average*\n${stats.average.toFixed(2)} / 5`),
          text(`*Positive (4–5)*\n${pct(stats.positiveShare)}`),
        ],
      });
      blocks.push(context([5, 4, 3, 2, 1].map((s) => `${SCORES[s].emoji} ${stats.distribution[s]}`).join(" · ")));
      if (stats.teams?.length) {
        const lines = stats.teams.map(
          (t) =>
            `*${escape(teamLabel(t.name))}*: ${t.count} · avg ${t.average.toFixed(2)} · ${pct(t.positiveShare)} positive`,
        );
        blocks.push(section(`*By team inbox*\n${lines.join("\n")}`));
      }
    }
    if (stats.bots?.count) {
      blocks.push(context(`🤖 Closed by Fin or a bot, not counted: ${stats.bots.count}`));
    }
    return blocks;
  }

  function overview() {
    const s = ratings.currentStreak();
    const headline = s.isNewRecord
      ? `🏆 *Streak: ${days(s.current)}* of 100% positive ratings, a new record`
      : `🔥 *Streak: ${days(s.current)}* of 100% positive ratings`;
    const fields = [text(`*${s.isNewRecord ? "Old record" : "Record"}*\n${recordText(s.record)}`)];
    if (s.since) fields.push(text(`*Streak started*\n${sinceText(s)}`));

    return [
      section(headline),
      { type: "section", fields },
      divider,
      ...weekBlocks(),
      divider,
      {
        type: "section",
        fields: [
          text(`*Posting channel*\n<#${getChannel()}>`),
          text(`*Schedule*\nStreak Mon–Fri 08:30\nWeekly report Fri 14:00\n(${config.timezone})`),
        ],
      },
      divider,
      section("*Preview a post*\nSends the post to this app's Messages tab, with real data.", {
        accessory: {
          type: "static_select",
          action_id: "preview_post",
          placeholder: { type: "plain_text", text: "Pick a post" },
          options: Object.entries(POSTS).map(([value, what]) => ({
            value,
            text: { type: "plain_text", text: `${value}: ${what}`.slice(0, 75) },
          })),
        },
      }),
    ];
  }

  function changedBy(row) {
    return row?.updated_by ? `Changed by <@${row.updated_by}> on ${formatDate(clock.localDate(row.updated_at))}` : null;
  }

  function settingsBlocks(editable, userId) {
    const channelRow = settings.get(CHANNEL_KEY);
    const admins = access.appAdmins();
    const envAdmins = config.slack.adminUserIds;
    const blocks = [];

    const notice = notices.get(userId);
    if (notice) {
      blocks.push(section(notice), divider);
      notices.delete(userId);
    }
    if (!editable) {
      blocks.push(context("Only workspace admins and owners, and the app admins, can change these settings."));
    }

    const channelText = "*Posting channel*\nRating posts, the morning streak post and the weekly report.";
    blocks.push(
      editable
        ? section(channelText, {
            accessory: {
              type: "conversations_select",
              action_id: "posting_channel",
              initial_conversation: getChannel(),
              filter: { include: ["public", "private"], exclude_bot_users: true },
            },
          })
        : section(`${channelText}\n<#${getChannel()}>`),
    );
    blocks.push(context(changedBy(channelRow) || "From the server settings"));
    blocks.push(divider);

    const adminsText =
      "*App admins*\nCan change these settings and use `/csat here`, besides workspace admins and owners.";
    blocks.push(
      editable
        ? section(adminsText, {
            accessory: {
              type: "multi_users_select",
              action_id: "app_admins",
              placeholder: { type: "plain_text", text: "Add people" },
              ...(admins.length && { initial_users: admins }),
            },
          })
        : section(`${adminsText}\n${admins.length ? admins.map((id) => `<@${id}>`).join(", ") : "None"}`),
    );
    const notes = [changedBy(access.appAdminsRow())];
    if (envAdmins.length) notes.push(`Also in the server settings: ${envAdmins.map((id) => `<@${id}>`).join(", ")}`);
    if (notes.some(Boolean)) blocks.push(context(notes.filter(Boolean).join(" · ")));
    return blocks;
  }

  async function publish(userId) {
    const tab = tabs.get(userId) || "overview";
    const body = tab === "settings" ? settingsBlocks(await access.canEdit(userId), userId) : overview();
    await slack.publishView(userId, { type: "home", blocks: [tabButtons(tab), divider, ...body] });
  }

  // payload: a block_actions payload from Slack.
  async function action(payload) {
    const userId = payload.user?.id;
    const act = payload.actions?.[0];
    if (!userId || !act) return;

    if (act.action_id.startsWith("home_tab_")) {
      tabs.set(userId, act.value === "settings" ? "settings" : "overview");
    } else if (act.action_id === "preview_post") {
      const msg = await previews.preview(act.selected_option?.value);
      if (msg) await slack.post(msg, userId);
      return;
    } else if (act.action_id === "posting_channel" || act.action_id === "app_admins") {
      tabs.set(userId, "settings");
      if (!(await access.canEdit(userId))) {
        notices.set(userId, "Only workspace admins and owners, and the app admins, can change settings.");
      } else if (act.action_id === "posting_channel" && act.selected_conversation !== getChannel()) {
        const result = await changeChannel({ slack, settings, log }, act.selected_conversation, userId);
        notices.set(
          userId,
          result === "ok"
            ? `✅ Posts go to <#${act.selected_conversation}> from now on.`
            : `⚠️ I'm not in <#${act.selected_conversation}> yet. Invite me with \`/invite @CSAT Streak Counter\` in that channel, then pick it again. Nothing was changed.`,
        );
      } else if (act.action_id === "app_admins") {
        access.setAppAdmins(act.selected_users || [], userId);
        log.info(`App admins changed by ${userId}: ${(act.selected_users || []).join(", ") || "none"}`);
      }
    }
    await publish(userId);
  }

  return { publish, action };
}

module.exports = { createHome };
