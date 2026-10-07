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
const { CHANNEL_KEY, NEGATIVE_CHANNEL_KEY, changeChannel } = require("./channels");

const { escape, teamLabel, recordText, sinceText, pct, SCORES, cxBlocks } = messages;
const { DEFAULT_TEAM_NAMES } = require("./cx");

const text = (t) => ({ type: "mrkdwn", text: t });
const section = (t, extra = {}) => ({ type: "section", text: text(t), ...extra });
const context = (t) => ({ type: "context", elements: [text(t)] });
const divider = { type: "divider" };
const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;

const SWITCHES = [
  ["ratings", "Rating posts"],
  ["morning", "Morning streak post (with records and celebrations)"],
  ["weekly", "Weekly report"],
  ["breaks", "Streak broken posts"],
];
const COMMENT_FILTERS = [
  ["positiveNeedsComment", "Only post 🤩 😃 when the customer left a comment"],
  ["negativeNeedsComment", "Only post 😐 🙁 😠 when the customer left a comment"],
];

const SETTING_ACTIONS = [
  "posting_channel", "negative_channel", "negative_channel_clear", "app_admins",
  "post_switches", "rating_scores", "comment_filters", "cx_switch", "cx_teams",
];

const option = (value, label) => ({ value: String(value), text: { type: "plain_text", text: label } });

// A checkboxes accessory; Slack needs initial_options to repeat the options exactly.
function checkboxes(actionId, options, selected) {
  const opts = options.map(([value, label]) => option(value, label));
  const initial = opts.filter((o) => selected.includes(o.value));
  return { type: "checkboxes", action_id: actionId, options: opts, ...(initial.length && { initial_options: initial }) };
}

function createHome({ slack, settings, ratings, jobs, previews, access, prefs, cx, intercom, clock, config, getChannel, log = console }) {
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

  async function weekBlocks() {
    const now = nowSeconds();
    const start = clock.epochAt(jobs.lastReportFriday(now), 14, 0);
    const { stats, from } = await jobs.weekReport(start, now + 1, { withCx: false });
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
    if (prefs.get().cxScore) {
      const result = await cx.cachedPeriod(start, now + 1, now);
      const at = result.at ? clock.parts(result.at) : null;
      const asOf = at ? `${String(at.hour).padStart(2, "0")}:${String(at.minute).padStart(2, "0")}` : null;
      blocks.push(...cxBlocks(result, asOf));
    }
    return blocks;
  }

  async function overview() {
    const s = ratings.currentStreak();
    const p = prefs.get();
    const headline = s.isNewRecord
      ? `🏆 *Streak: ${days(s.current)}* of 100% positive ratings, a new record`
      : `🔥 *Streak: ${days(s.current)}* of 100% positive ratings`;
    const fields = [text(`*${s.isNewRecord ? "Old record" : "Record"}*\n${recordText(s.record)}`)];
    if (s.since) fields.push(text(`*Streak started*\n${sinceText(s)}`));

    return [
      section(headline),
      { type: "section", fields },
      divider,
      ...(await weekBlocks()),
      divider,
      {
        type: "section",
        fields: [
          text(`*Posting channel*\n<#${getChannel()}>`),
          text(`*1–3 channel*\n${prefs.negativeChannel() ? `<#${prefs.negativeChannel()}>` : "Not set"}`),
          text(
            `*Schedule*\nStreak Mon–Fri 08:30${p.morning ? "" : " (off)"}\n` +
              `Weekly report Fri 14:00${p.weekly ? "" : " (off)"}\n(${config.timezone})`,
          ),
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

  async function settingsBlocks(editable, userId) {
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

    const negative = prefs.negativeChannel();
    const negativeText =
      "*1–3 channel* (optional)\n1–3 rating posts and break posts also go here. It gets every 1–3 rating; the switches and filter below don't apply to it.";
    if (editable) {
      blocks.push(
        section(negativeText, {
          accessory: {
            type: "conversations_select",
            action_id: "negative_channel",
            placeholder: { type: "plain_text", text: "Pick a channel" },
            ...(negative && { initial_conversation: negative }),
            filter: { include: ["public", "private"], exclude_bot_users: true },
          },
        }),
      );
      if (negative) {
        blocks.push({
          type: "actions",
          elements: [{ type: "button", action_id: "negative_channel_clear", text: { type: "plain_text", text: "Stop using a 1–3 channel" } }],
        });
      }
    } else {
      blocks.push(section(`${negativeText}\n${negative ? `<#${negative}>` : "Not set"}`));
    }
    const negativeRow = prefs.negativeChannelRow();
    if (negativeRow?.updated_by) blocks.push(context(changedBy(negativeRow)));
    blocks.push(divider);

    const p = prefs.get();
    const on = (keys) => keys.filter(([key]) => p[key]).map(([key]) => key);
    if (editable) {
      blocks.push(section("*Posts*\nTicked posts go out automatically. Ratings are always saved and counted.", {
        accessory: checkboxes("post_switches", SWITCHES, on(SWITCHES)),
      }));
      blocks.push(section("*Rating posts in the posting channel*\nRatings to post. Ticked = posted.", {
        accessory: checkboxes(
          "rating_scores",
          [5, 4, 3, 2, 1].map((n) => [n, `${SCORES[n].emoji} ${SCORES[n].label}`]),
          p.scores.map(String),
        ),
      }));
      blocks.push(section("*Comments*", { accessory: checkboxes("comment_filters", COMMENT_FILTERS, on(COMMENT_FILTERS)) }));
    } else {
      const yes = (v) => (v ? "on" : "off");
      blocks.push(section(`*Posts*\n${SWITCHES.map(([key, label]) => `${label}: ${yes(p[key])}`).join("\n")}`));
      blocks.push(section(
        `*Rating posts in the posting channel*\n${[5, 4, 3, 2, 1].filter((n) => p.scores.includes(n)).map((n) => SCORES[n].emoji).join(" ") || "None"}\n` +
          COMMENT_FILTERS.filter(([key]) => p[key]).map(([, label]) => label).join("\n"),
      ));
    }
    blocks.push(divider);
    blocks.push(...(await cxSettings(editable, p)));
    if (prefs.row()?.updated_by) blocks.push(context(changedBy(prefs.row())));
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

  // CX Score: the switch and the team inboxes it covers.
  async function cxSettings(editable, p) {
    const intro = "*CX Score*\nIntercom's CX Score in the weekly report and the Overview, for all conversations closed by a teammate in these team inboxes.";
    let teams = [];
    try {
      teams = await intercom.listTeams();
    } catch (err) {
      log.warn(`Teams: ${err.message}`);
    }
    const picked = await cx.teamIds().catch(() => []);
    const names = teams.filter((t) => picked.includes(String(t.id))).map((t) => teamLabel(t.name));
    if (!editable) {
      return [section(`${intro}\n${p.cxScore ? "On" : "Off"} · ${names.join(", ") || DEFAULT_TEAM_NAMES.map(teamLabel).join(", ")}`)];
    }
    const blocks = [section(intro, { accessory: checkboxes("cx_switch", [["cxScore", "Show the CX Score"]], p.cxScore ? ["cxScore"] : []) })];
    if (teams.length) {
      const options = teams.slice(0, 100).map((t) => option(t.id, teamLabel(t.name).slice(0, 75)));
      const initial = options.filter((o) => picked.includes(o.value));
      blocks.push(section("Team inboxes", {
        accessory: {
          type: "multi_static_select",
          action_id: "cx_teams",
          placeholder: { type: "plain_text", text: "Pick team inboxes" },
          options,
          ...(initial.length && { initial_options: initial }),
        },
      }));
    } else {
      blocks.push(context("Couldn't load the team inboxes from Intercom. Try again later."));
    }
    return blocks;
  }

  async function publish(userId) {
    const tab = tabs.get(userId) || "overview";
    const body = tab === "settings" ? await settingsBlocks(await access.canEdit(userId), userId) : await overview();
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
    } else if (SETTING_ACTIONS.includes(act.action_id)) {
      tabs.set(userId, "settings");
      const picked = (act.selected_options || []).map((o) => o.value);
      if (!(await access.canEdit(userId))) {
        notices.set(userId, "Only workspace admins and owners, and the app admins, can change settings.");
      } else if (act.action_id === "posting_channel" || act.action_id === "negative_channel") {
        const key = act.action_id === "posting_channel" ? CHANNEL_KEY : NEGATIVE_CHANNEL_KEY;
        const current = key === CHANNEL_KEY ? getChannel() : prefs.negativeChannel();
        const channel = act.selected_conversation;
        if (channel && channel !== current) {
          const result = await changeChannel({ slack, settings, getChannel, log }, channel, userId, key);
          const done = key === CHANNEL_KEY ? `✅ Posts go to <#${channel}> from now on.` : `✅ 1–3 ratings and break posts also go to <#${channel}> from now on.`;
          notices.set(userId, {
            ok: done,
            same_channel: `⚠️ <#${channel}> is already the ${key === CHANNEL_KEY ? "1–3" : "posting"} channel. Pick another one. Nothing was changed.`,
            not_in_channel: `⚠️ I'm not in <#${channel}> yet. Invite me with \`/invite @CSAT Streak Counter\` in that channel, then pick it again. Nothing was changed.`,
          }[result]);
        }
      } else if (act.action_id === "negative_channel_clear") {
        prefs.clearNegativeChannel(userId);
        notices.set(userId, "✅ No separate 1–3 channel from now on. Posts already there stay, and still get updated.");
        log.info(`1–3 channel removed by ${userId}`);
      } else if (act.action_id === "post_switches") {
        prefs.set(Object.fromEntries(SWITCHES.map(([key]) => [key, picked.includes(key)])), userId);
      } else if (act.action_id === "rating_scores") {
        prefs.set({ scores: picked.map(Number).sort() }, userId);
      } else if (act.action_id === "cx_switch") {
        prefs.set({ cxScore: picked.includes("cxScore") }, userId);
        cx.invalidate();
      } else if (act.action_id === "cx_teams") {
        prefs.set({ cxTeams: picked }, userId);
        cx.invalidate();
      } else if (act.action_id === "comment_filters") {
        prefs.set(Object.fromEntries(COMMENT_FILTERS.map(([key]) => [key, picked.includes(key)])), userId);
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
