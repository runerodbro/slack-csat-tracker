const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingMessage, streakMessage } = require("../src/messages");

const rating = {
  score: 2, remark: "Slow <b>reply</b> & rude", admin_name: "Ann", contact_name: "Cy", contact_email: "cy@example.com",
};

test("rating message: fields, escaping, red bar for negative", () => {
  const msg = ratingMessage({ rating, url: "https://x/1", assigneeSlackId: "U1", change: { from: 5 } });
  const json = JSON.stringify(msg);
  assert.equal(msg.attachments[0].color, "#EE2737");
  assert.match(json, /<@U1>/);
  assert.match(json, /Slow &lt;b&gt;reply&lt;\/b&gt; &amp; rude/);
  assert.match(json, /changed from 5\/5 to 2\/5/);
  assert.match(json, /https:\/\/x\/1/);
});

test("rating message: dark blue for positive, no Slack user falls back to name", () => {
  const msg = ratingMessage({ rating: { ...rating, score: 5, remark: null }, url: "u" });
  assert.equal(msg.attachments[0].color, "#091722");
  assert.match(JSON.stringify(msg), /\*Assignee\*\\nAnn/);
  assert.match(JSON.stringify(msg), /No comment/);
});

test("streak message marks a new record", () => {
  const msg = streakMessage({ current: 12, since: "2026-09-18", record: { length: 9, from: "2026-08-01", to: "2026-08-10" }, isNewRecord: true });
  assert.match(msg.text, /NEW RECORD/);
});
