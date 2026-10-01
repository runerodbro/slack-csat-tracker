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
      if (u.pathname.startsWith("/contacts/")) return json({ name: "Cy", email: "cy@example.com" });
      if (u.pathname.startsWith("/conversations/")) {
        return json({ id: "42", conversation_rating: state.rating });
      }
    }
    if (u.pathname === "/users.lookupByEmail") return json({ ok: true, user: { id: "UANN" } });
    if (u.pathname === "/users.info") return json({ ok: true, user: { id: u.searchParams.get("user"), is_admin: u.searchParams.get("user") === "UADMIN" } });
    if (u.pathname === "/chat.postMessage") {
      if (body.channel === "CNOBOT") return json({ ok: false, error: "not_in_channel" });
      return json({ ok: true, ts: String(state.nextTs++), channel: body.channel });
    }
    if (u.pathname === "/chat.update") return json({ ok: true });
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

  const posts = () => state.calls.filter((c) => c.path === "/chat.postMessage");
  const reactions = () => state.calls.filter((c) => c.path === "/reactions.add");

  let r = await app.jobs.morning("2026-10-05", { remember: false });
  assert.match(r.celebration, /^🏆 NEW RECORD: \d+ days of 100% positive ratings$/);
  r = await app.jobs.morning("2026-10-05");
  assert.match(r.celebration, /NEW RECORD/, "test run did not use it up");
  assert.match(JSON.stringify(posts().at(-1).body), /<@UANN> \(1\)/);
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
