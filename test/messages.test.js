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

test("rating message: gray bar for positive, no Slack user falls back to name", () => {
  const msg = ratingMessage({ rating: { ...rating, score: 5, remark: null }, url: "u" });
  assert.equal(msg.attachments[0].color, "#B6BBBF");
  assert.match(JSON.stringify(msg), /\*Assignee\*\\nAnn/);
  assert.match(JSON.stringify(msg), /No comment/);
});

test("streak message marks a new record", () => {
  const msg = streakMessage({ current: 12, since: "2026-09-18", record: { length: 9, from: "2026-08-01", to: "2026-08-10" }, isNewRecord: true });
  assert.match(msg.text, /NEW RECORD/);
  assert.equal(msg.attachments[0].color, "#EE2737");
  const normal = streakMessage({ current: 5, since: "2026-09-25", record: { length: 9, from: "2026-08-01", to: "2026-08-10" }, isNewRecord: false });
  assert.equal(normal.attachments[0].color, "#B6BBBF");
});

test("streak message: last negative date and record range starting the day after the break", () => {
  const msg = streakMessage({ current: 296, since: "2025-12-08", record: { length: 310, from: "2023-02-06", to: "2023-12-13" }, isNewRecord: false });
  const json = JSON.stringify(msg);
  assert.match(json, /Last negative rating\*\\n8 Dec 2025/);
  assert.match(json, /310 days \(7 Feb 2023 – 13 Dec 2023\)/);
});
