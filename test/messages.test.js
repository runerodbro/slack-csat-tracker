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
    "🙁 *<https://x/1|Conversation rated>* · changed from 🤩\n• *Assignee:* <@U1>\n• *Customer:* _Cy_ (cy@example.com)\n" +
      "• *Comment:* “Slow &lt;b&gt;reply&lt;/b&gt; &amp; rude”",
  );
});

test("rating message: green bar for positive, no comment line, name fallback", () => {
  const msg = ratingMessage({ rating: { ...rating, score: 5, remark: null, contact_name: null }, url: "u" });
  assert.equal(msg.attachments[0].color, "#1F9D63");
  const text = msg.attachments[0].blocks[0].text.text;
  assert.match(text, /• \*Assignee:\* Ann\n/);
  assert.match(text, /• \*Customer:\* cy@example.com$/);
  assert.match(text, /^🤩 \*<u\|Conversation rated>\*\n/);
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

test("rating message: team on the assignee line only when the team is known", () => {
  const withTeam = ratingMessage({ rating: { ...rating, score: 5, team_name: "Billing <EU>" }, url: "u" });
  assert.match(withTeam.attachments[0].blocks[0].text.text, /• \*Assignee:\* Ann · Billing &lt;EU&gt;\n• \*Customer:\*/);
  const without = ratingMessage({ rating: { ...rating, score: 5 }, url: "u" });
  assert.match(without.attachments[0].blocks[0].text.text, /• \*Assignee:\* Ann\n/);
});

test("rating message: topic line as Category › Product Area · Outcome, leaving out what is not set", () => {
  const text = (fields) => ratingMessage({ rating: { ...rating, ...fields }, url: "u" }).attachments[0].blocks[0].text.text;
  assert.match(
    text({ category: "Bug / Troubleshooting", product_area: "Aliases", outcome: "Solved for the customer 🎉" }),
    /\n• \*Comment:\* .*\n• \*Topic:\* Bug \/ Troubleshooting › Aliases · Solved for the customer 🎉$/,
  );
  assert.match(text({ category: "Billing", outcome: "Refund <given>" }), /• \*Topic:\* Billing · Refund &lt;given&gt;$/);
  assert.match(text({ product_area: "PDF Processing" }), /• \*Topic:\* PDF Processing$/);
  assert.doesNotMatch(text({}), /Topic/);
});

test("rating message: never more than 5 lines, so Slack does not fold it", () => {
  const full = ratingMessage({
    rating: {
      ...rating, team_name: "Support: Chat", remark: "Line one\nline two",
      category: "General Use / Best Practices", product_area: "PDF Processing", outcome: "Solved with user education 🧑‍🏫",
    },
    url: "u", assigneeSlackId: "U1", change: { from: 5 },
  });
  const lines = full.attachments[0].blocks[0].text.text.split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines.at(-2), /^• \*Comment:\* “Line one line two”$/, "comment before topic, so it stays visible when Slack folds");
  assert.match(lines.at(-1), /^• \*Topic:\* /);
});
