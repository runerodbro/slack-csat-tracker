const test = require("node:test");
const assert = require("node:assert/strict");
const { ratingMessage, streakMessage } = require("../src/messages");

const rating = {
  score: 2, remark: "Slow <b>reply</b> & rude", admin_name: "Ann", contact_name: "Cy", contact_email: "cy@example.com",
};

test("rating message: compact list, escaping, red bar for negative, change shown", () => {
  const msg = ratingMessage({ rating, url: "https://x/1", assigneeSlackId: "U1", change: { from: 5 } });
  assert.equal(msg.attachments[0].color, "#EE2737");
  assert.equal(msg.attachments[0].blocks.length, 1, "one block");
  const text = msg.attachments[0].blocks[0].text.text;
  assert.equal(
    text,
    "*Conversation rated:*\n• *Assignee:* <@U1>\n• *Customer:* _Cy_ (cy@example.com)\n• *Rating:* 🙁\n" +
      "• *Comment:* “Slow &lt;b&gt;reply&lt;/b&gt; &amp; rude”\n• *Changed:* 🤩 → 🙁\n<https://x/1|View conversation>",
  );
});

test("rating message: green bar for positive, no comment line, name fallback", () => {
  const msg = ratingMessage({ rating: { ...rating, score: 5, remark: null, contact_name: null }, url: "u" });
  assert.equal(msg.attachments[0].color, "#1F9D63");
  const text = msg.attachments[0].blocks[0].text.text;
  assert.match(text, /• \*Assignee:\* Ann\n/);
  assert.match(text, /• \*Customer:\* cy@example.com\n/);
  assert.match(text, /• \*Rating:\* 🤩\n/);
  assert.doesNotMatch(text, /Comment/);
});

test("streak message marks a new record", () => {
  const msg = streakMessage({ current: 12, since: "2026-09-18", record: { length: 9, from: "2026-08-01", to: "2026-08-10" }, isNewRecord: true });
  assert.match(msg.attachments[0].fallback, /New record: 12 days/);
  assert.equal(msg.attachments[0].color, "#D4A017");
  const normal = streakMessage({ current: 5, since: "2026-09-25", record: { length: 9, from: "2026-08-01", to: "2026-08-10" }, isNewRecord: false });
  assert.equal(normal.attachments[0].color, "#1F9D63");
});

test("streak message: positive wording, start date and record range start the day after the break", () => {
  const msg = streakMessage({ current: 296, since: "2025-12-08", record: { length: 310, from: "2023-02-06", to: "2023-12-13" }, isNewRecord: false });
  const json = JSON.stringify(msg);
  assert.match(json, /Streak started\*\\n9 Dec 2025/);
  assert.match(json, /296 days\* of 100% positive ratings/);
  assert.doesNotMatch(json, /negative/);
  assert.match(json, /310 days \(7 Feb 2023 – 13 Dec 2023\)/);
});
