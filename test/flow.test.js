// Full flow with fake Intercom and Slack APIs and an in-memory database.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { open } = require("../src/db");
const { createApp } = require("../src/app");
const { createServer } = require("../src/server");
const { loadConfig } = require("../src/config");

const realFetch = globalThis.fetch;

function setup() {
  const config = loadConfig({
    INTERCOM_ACCESS_TOKEN: "t", INTERCOM_CLIENT_SECRET: "secret", SLACK_BOT_TOKEN: "x", SLACK_CHANNEL_ID: "C1",
    INTERCOM_API_URL: "https://intercom.test", SLACK_API_URL: "https://slack.test",
    INTERCOM_WORKSPACE_ID: "ws1", STREAK_START_DATE: "2026-01-01", POST_DELAY_SECONDS: "300",
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
    if (u.pathname === "/chat.postMessage") return json({ ok: true, ts: String(state.nextTs++) });
    if (u.pathname === "/chat.update") return json({ ok: true });
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
  assert.match(calls[2].body.text, /Streak has been broken/);
  assert.equal(app.ratings.currentStreak().current, 0);

  state.rating = rating(4);
  await app.ratings.processConversation("42");
  calls = slackCalls();
  assert.equal(calls[3].body.ts, "1"); // rating message updated
  assert.equal(calls[4].path, "/chat.update");
  assert.equal(calls[4].body.ts, "2"); // break message updated
  assert.match(calls[4].body.text, /restored/);
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
  assert.match(slackCalls().at(-1).body.text, /Streak has been broken/);
});
