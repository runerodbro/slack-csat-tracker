// Full flow with fake Intercom and Slack APIs and an in-memory database.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const { createServer } = require("../src/server");
const { loadConfig } = require("../src/config");

const realFetch = globalThis.fetch;
// Text of a posted message: top-level text, or the attachment fallback.
const textOf = (body) => body.text ?? body.attachments?.[0]?.fallback ?? "";

function setup() {
  const config = loadConfig({
    INTERCOM_ACCESS_TOKEN: "t", INTERCOM_CLIENT_SECRET: "secret", SLACK_BOT_TOKEN: "x", SLACK_CHANNEL_ID: "C1",
    INTERCOM_API_URL: "https://intercom.test", SLACK_API_URL: "https://slack.test",
    INTERCOM_WORKSPACE_ID: "ws1", STREAK_START_DATE: "2026-01-01", POST_DELAY_SECONDS: "300",
    SLACK_SIGNING_SECRET: "slacksecret", SLACK_ADMIN_USER_IDS: "UFRIEND",
  });
  const state = { rating: null, calls: [], nextTs: 1 };
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    state.calls.push({ path: u.pathname, body });
    const json = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => "" });
    if (u.host === "intercom.test") {
      if (u.pathname === "/admins") return json({ admins: [{ id: 7, name: "Ann", email: "ann@x.io" }] });
      if (u.pathname === "/teams") return json({ teams: [{ id: 11, name: "Billing" }, { id: 12, name: "Product A" }, { id: 13, name: "Support: Chat" }, { id: 99, name: "Support: Feedback" }] });
      if (u.pathname.startsWith("/contacts/")) return json({ name: "Cy", email: "cy@example.com" });
      if (u.pathname === "/conversations/search") {
        if (body.query?.operator === "AND") {
          if (state.closedSearchFails) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
          return json({ conversations: state.closed ?? [] });
        }
        return json({ conversations: state.search ?? [] });
      }
      if (u.pathname.startsWith("/conversations/")) {
        const id = u.pathname.split("/").pop();
        const closer = state.closers?.[id];
        const parts = state.parts?.[id] ?? (closer && [{ part_type: "close", created_at: 1, author: { type: closer } }]);
        return json({
          id, conversation_rating: state.rating, team_assignee_id: state.teams?.[id] ?? null,
          custom_attributes: state.attributes?.[id] ?? {},
          ...(parts && { conversation_parts: { conversation_parts: parts } }),
        });
      }
    }
    if (u.pathname === "/users.lookupByEmail") return json({ ok: true, user: { id: "UANN" } });
    if (u.pathname === "/users.info") return json({ ok: true, user: { id: u.searchParams.get("user"), is_admin: u.searchParams.get("user") === "UADMIN" } });
    if (u.pathname === "/chat.postMessage") {
      if (body.channel === "CNOBOT") return json({ ok: false, error: "not_in_channel" });
      return json({ ok: true, ts: String(state.nextTs++), channel: body.channel });
    }
    if (u.pathname === "/chat.update") return json({ ok: true });
    if (u.pathname === "/views.publish") return json({ ok: true });
    if (u.pathname === "/reactions.add") return json({ ok: true });
    throw new Error(`Unexpected fetch ${url}`);
  };
  const log = { info() {}, warn() {}, error() {} };
  const app = createApp(config, { db: open(":memory:"), log });
  const slackCalls = () => state.calls.filter((c) => c.path.startsWith("/chat."));
  return { app, config, state, slackCalls, log };
}

const rating = (score, created_at = Math.floor(Date.now() / 1000)) => ({
  rating: score, remark: null, created_at, contact: { id: "c1" }, teammate: { id: 7 },
});

test("new positive rating posts once, unchanged rating posts nothing", async () => {
  const { app, state, slackCalls } = setup();
  state.rating = rating(5);
  assert.equal(await app.ratings.processConversation("42"), "posted");
  assert.equal(await app.ratings.processConversation("42"), "unchanged");
  const calls = slackCalls();
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0].body), /<@UANN>/);
});

test("positive changed to negative: message updated and streak break posted; changed back: restored", async () => {
  const { app, state, slackCalls } = setup();
  state.rating = rating(5);
  await app.ratings.processConversation("42");

  state.rating = rating(2);
  assert.equal(await app.ratings.processConversation("42"), "updated");
  let calls = slackCalls();
  assert.equal(calls[1].path, "/chat.update");
  assert.equal(calls[1].body.ts, "1");
  assert.equal(calls[2].path, "/chat.postMessage");
  assert.match(textOf(calls[2].body), /Streak has been broken/);
  assert.equal(app.ratings.currentStreak().current, 0);

  state.rating = rating(4);
  await app.ratings.processConversation("42");
  calls = slackCalls();
  assert.equal(calls[3].body.ts, "1"); // rating message updated
  assert.equal(calls[4].path, "/chat.update");
  assert.equal(calls[4].body.ts, "2"); // break message updated
  assert.match(textOf(calls[4].body), /restored/);
  assert.ok(app.ratings.currentStreak().current > 0);
});

test("backfill saves silently and does not post later unless the rating changes", async () => {
  const { app, state, slackCalls } = setup();
  state.rating = rating(1, Date.parse("2026-03-01T10:00:00Z") / 1000);
  assert.equal(await app.ratings.processConversation("42", { post: false }), "saved");
  assert.equal(await app.ratings.processConversation("42"), "unchanged");
  assert.equal(slackCalls().length, 0);
  assert.equal(app.ratings.currentStreak("2026-03-05").current, 4);
});

test("webhook: bad signature rejected, good one queued with the delay, queue then posts", async () => {
  const { app, config, state, slackCalls, log } = setup();
  state.rating = rating(5);
  const server = createServer({ intercom: app.intercom, queue: app.queue, config, log });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ topic: "conversation.rating.added", data: { item: { id: "42" } } });
  const sig = "sha1=" + crypto.createHmac("sha1", "secret").update(body).digest("hex");

  const bad = await realFetch(`${base}/webhooks/intercom`, { method: "POST", body, headers: { "x-hub-signature": "sha1=00" } });
  assert.equal(bad.status, 401);
  const good = await realFetch(`${base}/webhooks/intercom`, { method: "POST", body, headers: { "x-hub-signature": sig } });
  assert.equal(good.status, 200);
  server.close();

  const now = Math.floor(Date.now() / 1000);
  await app.queue.processDue(now);
  assert.equal(slackCalls().length, 0, "not posted before the delay");
  await app.queue.processDue(now + 301);
  assert.equal(slackCalls().length, 1);
  assert.equal(app.queue.has("42"), false);
});

test("history rating that changes is posted, and a failed post is retried", async () => {
  const { app, state, slackCalls } = setup();
  state.rating = rating(5, Date.parse("2026-03-01T10:00:00Z") / 1000);
  await app.ratings.processConversation("42", { post: false });

  state.rating = rating(2);
  const fetchOk = global.fetch;
  global.fetch = async (url, init) =>
    String(url).includes("chat.postMessage") ? { ok: true, json: async () => ({ ok: false, error: "ratelimited" }) } : fetchOk(url, init);
  await assert.rejects(app.ratings.processConversation("42"), /ratelimited/);
  global.fetch = fetchOk;

  assert.equal(await app.ratings.processConversation("42"), "posted");
  assert.match(textOf(slackCalls().at(-1).body), /Streak has been broken/);
});

test("morning: record celebration once, with reactions; a test run does not use it up", async () => {
  const { app, state } = setup();
  // History: a negative rating on 2026-03-01, positive ones after it.
  state.rating = rating(2, Date.parse("2026-03-01T10:00:00Z") / 1000);
  await app.ratings.processConversation("42", { post: false });
  state.rating = { ...rating(5, Date.parse("2026-05-01T10:00:00Z") / 1000), teammate: { id: 7 } };
  await app.ratings.processConversation("43", { post: false, conversation: { id: "43", conversation_rating: state.rating } });
  // A rating without an agent: counts in the stats, not in the thanks.
  const unassigned = { ...rating(5, Date.parse("2026-05-02T10:00:00Z") / 1000), teammate: { id: 999 } };
  await app.ratings.processConversation("44", { post: false, conversation: { id: "44", conversation_rating: unassigned } });

  const posts = () => state.calls.filter((c) => c.path === "/chat.postMessage");
  const reactions = () => state.calls.filter((c) => c.path === "/reactions.add");

  let r = await app.jobs.morning("2026-10-05", { remember: false });
  assert.match(r.celebration, /^🏆 NEW RECORD: \d+ days of 100% positive ratings$/);
  r = await app.jobs.morning("2026-10-05");
  assert.match(r.celebration, /NEW RECORD/, "test run did not use it up");
  const celebration = JSON.stringify(posts().at(-1).body);
  assert.match(celebration, /<@UANN> \(1\)/);
  assert.match(celebration, /2 ratings/);
  assert.doesNotMatch(celebration, /Unassigned|Unknown/);
  assert.equal(reactions().length, 4);

  r = await app.jobs.morning("2026-10-06");
  assert.equal(r.celebration, null, "no second celebration");
  assert.equal(posts().at(-1).body.attachments[0].color, "#D4A017");
  r = await app.jobs.morning("2026-10-06", { remember: false, forceCelebration: true });
  assert.match(r.celebration, /NEW RECORD/, "preview can force it");
});

test("/csat here: only admins, needs the bot in the channel, then all posts go there", async () => {
  const { app, state } = setup();
  const posts = () => state.calls.filter((c) => c.path === "/chat.postMessage");
  state.rating = rating(5);
  await app.ratings.processConversation("42"); // posted in C1

  let r = await app.commands.handle({ text: "here", user_id: "UNOBODY", channel_id: "C2" });
  assert.match(r.text, /Only Slack workspace admins/);
  r = await app.commands.handle({ text: "here", user_id: "UADMIN", channel_id: "CNOBOT" });
  assert.match(r.text, /Invite me first/);
  assert.equal(app.getChannel(), "C1");

  r = await app.commands.handle({ text: "here", user_id: "UADMIN", channel_id: "C2" });
  assert.match(r.text, /Done/);
  assert.equal(posts().at(-1).body.channel, "C2");
  assert.match(posts().at(-1).body.text, /Changed by <@UADMIN>/);
  assert.equal(app.getChannel(), "C2");

  // A person in SLACK_ADMIN_USER_IDS may change it too.
  r = await app.commands.handle({ text: "here", user_id: "UFRIEND", channel_id: "C3" });
  assert.match(r.text, /Done/);

  // The old message is updated in its own channel; new posts go to the new one.
  state.rating = rating(2);
  await app.ratings.processConversation("42");
  const update = state.calls.filter((c) => c.path === "/chat.update").at(-1);
  assert.equal(update.body.channel, "C1");
  assert.equal(posts().at(-1).body.channel, "C3");
  assert.match(textOf(posts().at(-1).body), /Streak has been broken/);

  r = await app.commands.handle({ text: "status", user_id: "UNOBODY" });
  assert.match(r.text, /<#C3>, set by <@UFRIEND>/);
  r = await app.commands.handle({ text: "preview" });
  assert.equal(r.response_type, "ephemeral");
  assert.ok(r.attachments);
  assert.match((await app.commands.handle({ text: "" })).text, /CSAT commands/);
});

test("Slack command route: signature checked, JSON reply", async () => {
  const { app, config, log } = setup();
  const server = createServer({ intercom: app.intercom, queue: app.queue, commands: app.commands, config, log });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/slack/commands`;
  const body = "command=%2Fcsat&text=help&user_id=U1&channel_id=C1";
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "v0=" + crypto.createHmac("sha256", "slacksecret").update(`v0:${ts}:${body}`).digest("hex");
  const headers = { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts };

  const bad = await realFetch(url, { method: "POST", body, headers: { ...headers, "x-slack-signature": "v0=00" } });
  assert.equal(bad.status, 401);
  const old = String(Number(ts) - 600);
  const oldSig = "v0=" + crypto.createHmac("sha256", "slacksecret").update(`v0:${old}:${body}`).digest("hex");
  const replay = await realFetch(url, { method: "POST", body, headers: { ...headers, "x-slack-request-timestamp": old, "x-slack-signature": oldSig } });
  assert.equal(replay.status, 401);
  const good = await realFetch(url, { method: "POST", body, headers: { ...headers, "x-slack-signature": sig } });
  assert.equal(good.status, 200);
  assert.match((await good.json()).text, /CSAT commands/);
  server.close();
});

test("CLI channel override wins over the Slack setting", async () => {
  const { config } = setup();
  const db = open(":memory:");
  const app = createApp(config, { db, log: { info() {}, warn() {}, error() {} }, channelOverride: "CTEST" });
  app.settings.set("slack_channel", "C9", "U1");
  assert.equal(app.getChannel(), "CTEST");
  const app2 = createApp(config, { db, log: { info() {}, warn() {}, error() {} } });
  assert.equal(app2.getChannel(), "C9");
});

test("closed by a bot: saved, but no post, no streak break, and only a separate line in the weekly report", async () => {
  const { app, state, slackCalls } = setup();
  state.closers = { "50": "bot", "51": "admin" };
  const now = Math.floor(Date.now() / 1000);

  state.rating = rating(1, now);
  assert.equal(await app.ratings.processConversation("50"), "saved (closed by a bot)");
  assert.equal(slackCalls().length, 0, "no rating post, no break post");
  const before = app.ratings.currentStreak();
  assert.ok(before.current > 0, "a bot's 1/5 does not break the streak");

  state.rating = rating(5, now);
  assert.equal(await app.ratings.processConversation("51"), "posted");

  const today = app.clock.localDate(now);
  const p = app.clock.parts(now);
  // The report Friday on or after today, so the window holds both ratings.
  const { addDays } = require("../src/time");
  const friday = addDays(today, (5 - p.weekday + 7) % 7 + (p.weekday === 5 && p.hour >= 14 ? 7 : 0));
  const stats = await app.jobs.weekly(friday);
  assert.equal(stats.total, 1, "only the human rating counts");
  const report = state.calls.filter((c) => c.path === "/chat.postMessage").at(-1).body;
  assert.match(JSON.stringify(report), /Closed by Fin or a bot, not counted above: 1 rating · average 1.00/);
});

test("classify: checks saved ratings once and a bot close leaves the streak", async () => {
  const { app, state } = setup();
  const day = Date.parse("2026-06-01T10:00:00Z") / 1000;
  state.rating = rating(2, day);
  await app.ratings.processConversation("60", { post: false }); // saved before closers were known
  app.db.prepare("UPDATE ratings SET closed_by = NULL").run();
  assert.equal(app.ratings.currentStreak("2026-06-05").since, "2026-06-01");

  state.closers = { "60": "bot" };
  assert.deepEqual(await app.jobs.classify(), { human: 0, bot: 1, unknown: 0, failed: 0, teams: { "No team": 1 } });
  assert.equal(app.ratings.currentStreak("2026-06-05").since, "2026-01-01", "the bot's 2/5 no longer breaks the streak");
  assert.deepEqual(await app.jobs.classify(), { human: 0, bot: 0, unknown: 0, failed: 0, teams: {} }, "nothing left to check");
});

test("team inbox: shown on the rating post, split in the weekly report, filled in by classify", async () => {
  const { app, state } = setup();
  const now = Math.floor(Date.now() / 1000);
  state.teams = { "70": 11, "71": 12, "72": 12 };

  state.rating = rating(5, now);
  await app.ratings.processConversation("70");
  const post = state.calls.filter((c) => c.path === "/chat.postMessage").at(-1).body;
  assert.match(post.attachments[0].blocks[0].text.text, /• \*Assignee:\* <@UANN> · Billing\n/);

  state.rating = rating(4, now);
  await app.ratings.processConversation("71");
  state.rating = rating(3, now);
  await app.ratings.processConversation("72");
  state.rating = rating(5, now);
  delete state.teams["73"];
  await app.ratings.processConversation("73"); // no team

  const { addDays } = require("../src/time");
  const p = app.clock.parts(now);
  const friday = addDays(app.clock.localDate(now), (5 - p.weekday + 7) % 7 + (p.weekday === 5 && p.hour >= 14 ? 7 : 0));
  const stats = await app.jobs.weekly(friday);
  assert.deepEqual(stats.teams.map((t) => [t.name, t.count]), [["Product A", 2], ["Billing", 1], ["No team", 1]]);
  const report = JSON.stringify(state.calls.filter((c) => c.path === "/chat.postMessage").at(-1).body);
  assert.match(report, /By team inbox\*\\n\*Product A\*: 2 ratings · avg 3.50 · 50% positive/);

  // Older rows without a team get it from classify.
  app.db.prepare("UPDATE ratings SET team_id = NULL, team_name = NULL").run();
  const result = await app.jobs.classify();
  assert.deepEqual(result.teams, { Billing: 1, "Product A": 2, "No team": 1 });
  assert.equal(app.db.prepare("SELECT team_name FROM ratings WHERE conversation_id = '70'").get().team_name, "Billing");
});

test("team inbox: a rating moved to the feedback team after the close keeps its own team; colons left out in Slack", async () => {
  const { app, state } = setup();
  const now = Math.floor(Date.now() / 1000);
  // Handled and closed in Support: Chat, then moved to Support: Feedback by a workflow.
  state.teams = { "80": 99 };
  state.parts = { "80": [
    { part_type: "assignment", created_at: now - 600, assigned_to: { type: "team", id: 13 } },
    { part_type: "close", created_at: now - 120, author: { type: "admin" } },
    { part_type: "assignment", created_at: now + 60, assigned_to: { type: "team", id: 99 } },
  ] };
  state.rating = rating(2, now);
  await app.ratings.processConversation("80");
  const post = state.calls.filter((c) => c.path === "/chat.postMessage").find((c) => c.body.attachments?.[0]?.blocks?.[0]?.text?.text?.includes("Assignee"));
  assert.match(post.body.attachments[0].blocks[0].text.text, /• \*Assignee:\* <@UANN> · Support Chat\n/);
  assert.equal(app.db.prepare("SELECT team_name FROM ratings WHERE conversation_id = '80'").get().team_name, "Support: Chat");

  // Rows saved with the old rule get the right team from --recheck-teams.
  app.db.prepare("UPDATE ratings SET team_id = '99', team_name = 'Support: Feedback'").run();
  const result = await app.jobs.classify({ recheckTeams: true });
  assert.deepEqual(result.teams, { "Support: Chat": 1 });
  assert.equal(app.db.prepare("SELECT team_name FROM ratings WHERE conversation_id = '80'").get().team_name, "Support: Chat");
});

test("topic: shown on the rating post, saved, and added to the post once when Intercom sets it later", async () => {
  const { app, state, slackCalls } = setup();
  const now = Math.floor(Date.now() / 1000);
  state.attributes = { "90": {
    "Has attachments": false, "Category (Support)": "Bug / Troubleshooting", "Product Area (Flipbooks)": "",
    "Product Area (Horizon)": "Aliases", "Outcome (Support)": "Solved for the customer 🎉",
  } };
  state.rating = rating(5, now);
  await app.ratings.processConversation("90");
  const post = slackCalls().at(-1).body.attachments[0].blocks[0].text.text;
  assert.match(post, /• \*Topic:\* Bug \/ Troubleshooting › Aliases · Solved for the customer 🎉/);
  assert.deepEqual(
    { ...app.db.prepare("SELECT category, product_area, outcome FROM ratings WHERE conversation_id = '90'").get() },
    { category: "Bug / Troubleshooting", product_area: "Aliases", outcome: "Solved for the customer 🎉" },
  );

  // Posted before the AI filled the attributes: the hourly check adds the topic.
  await app.ratings.processConversation("91");
  assert.doesNotMatch(slackCalls().at(-1).body.attachments[0].blocks[0].text.text, /Topic/);
  const search = (id) => ({ id, conversation_rating: state.rating, custom_attributes: state.attributes[id] });
  state.attributes["91"] = { "Category (Support)": "Billing", "Outcome (Support)": "Workaround offered ♻️" };
  state.search = [search("90"), search("91")];
  const before = slackCalls().length;
  await app.jobs.reconcile();
  const updates = slackCalls().slice(before);
  assert.equal(updates.length, 1, "only the post without a topic is updated");
  assert.equal(updates[0].path, "/chat.update");
  assert.match(updates[0].body.attachments[0].blocks[0].text.text, /• \*Topic:\* Billing · Workaround offered ♻️/);

  await app.jobs.reconcile();
  assert.equal(slackCalls().length, before + 1, "updated once");
});

test("/csat preview: every post, with sample data on an empty database and real data after ratings", async () => {
  const { app, state } = setup();
  const { POSTS } = require("../src/previews");
  const show = async (name) => {
    const r = await app.commands.handle({ text: `preview ${name}`, user_id: "UNOBODY" });
    assert.equal(r.response_type, "ephemeral", name);
    return JSON.stringify(r);
  };

  for (const name of Object.keys(POSTS)) assert.ok((await show(name)).length > 50, name);
  assert.match(await show("rating"), /Sample Agent/);
  assert.match(await show("milestone"), /🎉 \d+ days of 100% positive ratings!.*Today: \d+ days/);
  assert.match(await show("celebration"), /NEW RECORD.*During this streak.*Sample Agent \(40\)/);
  assert.match(await show("nonsense"), /I don't know the post `nonsense`/);

  // A bare preview: the streak post with the list under it.
  const bare = await app.commands.handle({ text: "preview" });
  assert.equal(bare.attachments.length, 2);
  assert.match(bare.attachments[1].blocks[0].elements[0].text, /`weekly` weekly report, this week so far/);

  const now = Math.floor(Date.now() / 1000);
  state.rating = rating(5, now - 60);
  await app.ratings.processConversation("100");
  state.rating = { ...rating(2, now), remark: "Too slow" };
  await app.ratings.processConversation("101");
  const posted = state.calls.filter((c) => c.path === "/chat.postMessage").length;
  assert.match(await show("rating"), /<@UANN>/);
  assert.match(await show("negative"), /Too slow/);
  assert.match(await show("changed"), /changed from 🤩/);
  assert.match(await show("break"), /Streak has been broken/);
  assert.match(await show("restored"), /Rating changed to 4\/5/);
  assert.match(await show("weekly"), /Weekly CSAT report/);
  for (const name of Object.keys(POSTS)) await show(name);
  assert.equal(state.calls.filter((c) => c.path === "/chat.postMessage").length, posted, "previews post nothing to the channel");
});

test("Home tab: overview for everyone, settings read-only for others, editable by admins", async () => {
  const { app, state } = setup();
  const views = () => state.calls.filter((c) => c.path === "/views.publish");
  const last = () => JSON.stringify(views().at(-1).body);
  const act = (user, action) => app.home.action({ type: "block_actions", user: { id: user }, actions: [action] });

  state.rating = rating(5, Math.floor(Date.now() / 1000));
  await app.ratings.processConversation("110");

  await app.home.publish("UNOBODY");
  assert.equal(views().at(-1).body.user_id, "UNOBODY");
  assert.match(last(), /Streak: \d+ days\*/);
  assert.match(last(), /This week/);
  assert.match(last(), /By team inbox/);
  assert.match(last(), /<#C1>/);
  assert.match(last(), /"action_id":"preview_post"/);

  // Others see Settings without dropdowns, and cannot change them.
  await act("UNOBODY", { action_id: "home_tab_settings", value: "settings" });
  assert.match(last(), /Only workspace admins and owners, and the app admins, can change these settings/);
  assert.doesNotMatch(last(), /conversations_select/);
  await act("UNOBODY", { action_id: "posting_channel", selected_conversation: "C7" });
  assert.equal(app.getChannel(), "C1");

  // A workspace admin changes the channel: confirmation in the new channel.
  await act("UADMIN", { action_id: "home_tab_settings", value: "settings" });
  assert.match(last(), /"type":"conversations_select","action_id":"posting_channel","initial_conversation":"C1"/);
  await act("UADMIN", { action_id: "posting_channel", selected_conversation: "C7" });
  assert.equal(app.getChannel(), "C7");
  const confirm = state.calls.filter((c) => c.path === "/chat.postMessage").at(-1).body;
  assert.equal(confirm.channel, "C7");
  assert.match(confirm.text, /Changed by <@UADMIN>/);
  assert.match(last(), /Posts go to <#C7> from now on/);

  // A channel the bot is not in changes nothing.
  await act("UADMIN", { action_id: "posting_channel", selected_conversation: "CNOBOT" });
  assert.equal(app.getChannel(), "C7");
  assert.match(last(), /I'm not in <#CNOBOT> yet/);

  // An app admin added in the picker can change settings and use /csat here.
  assert.match((await app.commands.handle({ text: "here", user_id: "UNEW", channel_id: "C8" })).text, /Only Slack workspace admins/);
  await act("UADMIN", { action_id: "app_admins", selected_users: ["UNEW"] });
  assert.deepEqual(app.access.appAdmins(), ["UNEW"]);
  assert.match((await app.commands.handle({ text: "here", user_id: "UNEW", channel_id: "C8" })).text, /Done/);
  await act("UNEW", { action_id: "app_admins", selected_users: ["UNEW", "UOTHER"] });
  assert.deepEqual(app.access.appAdmins(), ["UNEW", "UOTHER"], "app admins can edit the list");

  // A preview goes to the user's Messages tab.
  await act("UNOBODY", { action_id: "preview_post", selected_option: { value: "weekly" } });
  const preview = state.calls.filter((c) => c.path === "/chat.postMessage").at(-1).body;
  assert.equal(preview.channel, "UNOBODY");
  assert.match(JSON.stringify(preview), /Weekly CSAT report/);
});

test("Slack events and interactions routes: URL check, Home tab on open, signature checked", async () => {
  const { app, config, state, log } = setup();
  const server = createServer({ intercom: app.intercom, queue: app.queue, commands: app.commands, home: app.home, config, log });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, body, type = "application/json", sigOk = true) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = "v0=" + crypto.createHmac("sha256", sigOk ? "slacksecret" : "wrong").update(`v0:${ts}:${body}`).digest("hex");
    return realFetch(base + path, { method: "POST", body, headers: { "content-type": type, "x-slack-request-timestamp": ts, "x-slack-signature": sig } });
  };

  const check = await send("/slack/events", JSON.stringify({ type: "url_verification", challenge: "abc" }));
  assert.deepEqual(await check.json(), { challenge: "abc" });
  assert.equal((await send("/slack/events", JSON.stringify({ type: "url_verification", challenge: "x" }), "application/json", false)).status, 401);

  const opened = await send("/slack/events", JSON.stringify({ type: "event_callback", event: { type: "app_home_opened", tab: "home", user: "UNOBODY" } }));
  assert.equal(opened.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(state.calls.filter((c) => c.path === "/views.publish").at(-1).body.user_id, "UNOBODY");

  const payload = JSON.stringify({ type: "block_actions", user: { id: "UNOBODY" }, actions: [{ action_id: "home_tab_settings", value: "settings" }] });
  const form = `payload=${encodeURIComponent(payload)}`;
  assert.equal((await send("/slack/interactions", form, "application/x-www-form-urlencoded", false)).status, 401);
  assert.equal((await send("/slack/interactions", form, "application/x-www-form-urlencoded")).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.match(JSON.stringify(state.calls.filter((c) => c.path === "/views.publish").at(-1).body), /Posting channel/);
  server.close();
});

test("rating filter: main channel only, judged on the current rating; existing posts always updated", async () => {
  const { app, state } = setup();
  const now = Math.floor(Date.now() / 1000);
  const posts = () => state.calls.filter((c) => c.path === "/chat.postMessage");
  app.prefs.set({ scores: [5], positiveNeedsComment: true }, "UADMIN");

  state.rating = rating(4, now);
  assert.equal(await app.ratings.processConversation("120"), "saved (no post: settings)");
  state.rating = rating(5, now);
  assert.equal(await app.ratings.processConversation("120"), "saved (no post: settings)", "a 5 without comment");
  state.rating = { ...rating(5, now), remark: "Great help" };
  assert.equal(await app.ratings.processConversation("120"), "posted", "posted once it passes");
  assert.equal(posts().length, 1);

  // A later change that the filter would hide still updates the post.
  state.rating = { ...rating(3, now), remark: "Great help" };
  assert.equal(await app.ratings.processConversation("120"), "updated");
  assert.match(textOf(posts().at(-1).body), /Streak has been broken/, "break posts are a separate switch");
});

test("1–3 channel: every 1–3 rating and break post also goes there, copies are updated", async () => {
  const { app, state } = setup();
  const now = Math.floor(Date.now() / 1000);
  const posts = () => state.calls.filter((c) => c.path === "/chat.postMessage");
  const updates = () => state.calls.filter((c) => c.path === "/chat.update");
  app.settings.set("negative_channel", "CNEG", "UADMIN");
  app.prefs.set({ ratings: false, breaks: false }, "UADMIN");

  // Rating and break posts are off in the main channel; the 1–3 channel still gets both.
  state.rating = { ...rating(2, now), remark: "Slow" };
  assert.equal(await app.ratings.processConversation("130"), "posted");
  assert.deepEqual(posts().map((c) => c.body.channel), ["CNEG", "CNEG"]);
  assert.match(textOf(posts()[1].body), /Streak has been broken/);

  // Changed to positive: the copy and the break post are updated.
  state.rating = { ...rating(5, now), remark: "Slow" };
  assert.equal(await app.ratings.processConversation("130"), "updated");
  assert.deepEqual(updates().map((c) => c.body.channel), ["CNEG", "CNEG"]);
  assert.match(JSON.stringify(updates()[0].body), /changed from 🙁/);
  assert.match(JSON.stringify(updates()[1].body), /Rating changed to 5\/5/);

  // With everything on: a posted 5 changed to 2 gets a new post in the 1–3 channel.
  app.prefs.set({ ratings: true, breaks: true }, "UADMIN");
  state.rating = rating(5, now);
  await app.ratings.processConversation("131");
  assert.equal(posts().at(-1).body.channel, "C1");
  state.rating = rating(2, now);
  await app.ratings.processConversation("131");
  const negCopy = posts().find((c) => c.body.channel === "CNEG" && JSON.stringify(c.body).includes("changed from 🤩"));
  assert.ok(negCopy, "new post in the 1–3 channel with the change");
  assert.deepEqual(posts().slice(-2).map((c) => c.body.channel), ["C1", "CNEG"], "break post in both channels");
});

test("Settings: 1–3 channel, switches and filters; the same channel is refused for both", async () => {
  const { app, state } = setup();
  const last = () => JSON.stringify(state.calls.filter((c) => c.path === "/views.publish").at(-1).body);
  const act = (action) => app.home.action({ type: "block_actions", user: { id: "UADMIN" }, actions: [action] });

  await act({ action_id: "home_tab_settings", value: "settings" });
  assert.match(last(), /"action_id":"negative_channel"/);
  assert.match(last(), /"action_id":"post_switches".*"initial_options":\[\{"value":"ratings"/);

  await act({ action_id: "negative_channel", selected_conversation: "C1" });
  assert.match(last(), /<#C1> is already the posting channel/);
  assert.equal(app.prefs.negativeChannel(), null);

  await act({ action_id: "negative_channel", selected_conversation: "CNEG" });
  assert.equal(app.prefs.negativeChannel(), "CNEG");
  assert.match(state.calls.filter((c) => c.path === "/chat.postMessage").at(-1).body.text, /1–3 ratings and break posts also go to this channel/);
  assert.match((await app.commands.handle({ text: "here", user_id: "UADMIN", channel_id: "CNEG" })).text, /This is the 1–3 channel/);
  assert.equal(app.getChannel(), "C1");

  await act({ action_id: "post_switches", selected_options: [{ value: "ratings" }, { value: "weekly" }] });
  await act({ action_id: "rating_scores", selected_options: [{ value: "1" }, { value: "5" }] });
  await act({ action_id: "comment_filters", selected_options: [{ value: "negativeNeedsComment" }] });
  const p = app.prefs.get();
  assert.deepEqual([p.ratings, p.morning, p.weekly, p.breaks], [true, false, true, false]);
  assert.deepEqual(p.scores, [1, 5]);
  assert.deepEqual([p.positiveNeedsComment, p.negativeNeedsComment], [false, true]);

  await app.home.action({ type: "block_actions", user: { id: "UADMIN" }, actions: [{ action_id: "home_tab_overview", value: "overview" }] });
  assert.match(last(), /1–3 channel\*\\n<#CNEG>/);
  assert.match(last(), /Streak Mon–Fri 08:30 \(off\)/);

  await act({ action_id: "negative_channel_clear" });
  assert.equal(app.prefs.negativeChannel(), null);
});

test("CX Score: teammate closes in the picked teams, a moved conversation counts under its closing team", async () => {
  const { app, state } = setup();
  const now = Math.floor(Date.now() / 1000);
  const posts = () => state.calls.filter((c) => c.path === "/chat.postMessage");
  const closed = (id, team, closer, cx) => ({
    id, team_assignee_id: team, statistics: { last_closed_by_id: closer },
    custom_attributes: cx == null ? {} : { "CX Score rating": cx },
  });
  state.closed = [
    closed("c1", 13, 7, 5),
    closed("c2", 13, 7, 3),
    closed("c3", 13, 555, 1), // closed by a bot: left out
    closed("c4", 99, 7, 2), // moved to the feedback team after the close
    closed("c5", 13, 7, null), // not scored yet
    closed("c6", 11, 7, 5), // Billing: not picked by default
  ];
  state.attributes = { c4: { "CX Score rating": 2 }, c6: { "CX Score rating": 5 } };
  state.parts = { c4: [
    { part_type: "assignment", created_at: now - 600, assigned_to: { type: "team", id: 13 } },
    { part_type: "close", created_at: now - 300, author: { type: "admin" } },
    { part_type: "assignment", created_at: now - 100, assigned_to: { type: "team", id: 99 } },
  ] };

  // Off by default: no CX Score in the report.
  await app.jobs.weekly(app.jobs.lastReportFriday(now));
  assert.doesNotMatch(JSON.stringify(posts().at(-1).body), /CX Score/);

  app.prefs.set({ cxScore: true }, "UADMIN");
  const stats = await app.jobs.weekly(app.jobs.lastReportFriday(now));
  assert.deepEqual(stats.cx.teams.map((t) => [t.name, t.count]), [["Support: Chat", 3]]);
  assert.equal(stats.cx.average.toFixed(2), "3.33");
  assert.equal(stats.cx.notScored, 1);
  const report = JSON.stringify(posts().at(-1).body);
  assert.match(report, /CX Score\* 🧭\\n3 conversations · avg 3\.33 \/ 5\\n\*Support Chat\*: 3 · avg 3\.33/);
  assert.match(report, /not scored yet: 1/);

  // Picking Billing too in Settings adds it.
  await app.home.action({ type: "block_actions", user: { id: "UADMIN" }, actions: [{ action_id: "home_tab_settings", value: "settings" }] });
  const settingsView = JSON.stringify(state.calls.filter((c) => c.path === "/views.publish").at(-1).body);
  assert.match(settingsView, /"action_id":"cx_teams"/);
  assert.match(settingsView, /"initial_options":\[\{"value":"13"/);
  await app.home.action({ type: "block_actions", user: { id: "UADMIN" }, actions: [{ action_id: "cx_teams", selected_options: [{ value: "11" }, { value: "13" }] }] });
  const both = await app.cx.period(now - 86400, now + 1);
  assert.deepEqual(both.teams.map((t) => [t.name, t.count]), [["Support: Chat", 3], ["Billing", 1]]);

  // The Overview shows it with its age.
  await app.home.action({ type: "block_actions", user: { id: "UADMIN" }, actions: [{ action_id: "home_tab_overview", value: "overview" }] });
  assert.match(JSON.stringify(state.calls.filter((c) => c.path === "/views.publish").at(-1).body), /CX Score.*as of \d\d:\d\d/);

  // A failed search does not stop the weekly report.
  state.closedSearchFails = true;
  await app.jobs.weekly(app.jobs.lastReportFriday(now));
  assert.match(JSON.stringify(posts().at(-1).body), /CX Score\* 🧭\\nCould not be loaded this time/);
});
