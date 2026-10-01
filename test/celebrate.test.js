const test = require("node:test");
const assert = require("node:assert/strict");
const { celebrationFor } = require("../src/celebrate");
const { streakMessage } = require("../src/messages");

const streak = (current, isNewRecord = true) => ({
  current, since: "2025-12-08", isNewRecord, record: { length: 210, from: "2025-03-01", to: "2025-10-01" },
});

test("first record post celebrates and covers milestones already passed", () => {
  const c = celebrationFor({ streak: streak(296), celebrated: new Set() });
  assert.equal(c.title, "🏆 NEW RECORD: 296 days of 100% positive ratings");
  assert.deepEqual(c.keys, ["2025-12-08:record", "2025-12-08:50", "2025-12-08:100", "2025-12-08:150", "2025-12-08:200", "2025-12-08:250"]);
});

test("after that: nothing until the next milestone, also when it fell on a weekend", () => {
  const celebrated = new Set(celebrationFor({ streak: streak(296), celebrated: new Set() }).keys);
  assert.equal(celebrationFor({ streak: streak(297), celebrated }), null);
  const c = celebrationFor({ streak: streak(301), celebrated }); // 300 was a Sunday
  assert.match(c.title, /300 days/);
  c.keys.forEach((k) => celebrated.add(k));
  assert.equal(celebrationFor({ streak: streak(302), celebrated }), null);
  assert.match(celebrationFor({ streak: streak(365), celebrated }).title, /One full year/);
  assert.match(celebrationFor({ streak: streak(730), celebrated }).title, /2 full years/);
});

test("no celebration when the streak is not a record", () => {
  assert.equal(celebrationFor({ streak: streak(300, false), celebrated: new Set() }), null);
});

test("record post: gold, no repeated text, no line above the bar", () => {
  const plain = streakMessage(streak(296));
  assert.equal(plain.text, undefined);
  assert.equal(plain.attachments[0].color, "#D4A017");
  const json = JSON.stringify(plain.attachments[0].blocks);
  assert.match(json, /New record: 296 days/);
  assert.match(json, /\+86 days/);
  assert.equal(json.match(/296 days/g).length, 1, "the number shows once");
  assert.doesNotMatch(json, /Current streak/);
});

test("celebration: plain blocks with the header as the only headline", () => {
  const title = "🏆 NEW RECORD: 296 days of 100% positive ratings";
  const party = streakMessage(streak(296), {
    title, count: 250, fiveStar: 220, fourStar: 30, average: 4.88,
    agents: [{ name: "Ann", slackId: "U1", count: 90 }, { name: "Bo <x>", slackId: null, count: 40 }],
  });
  assert.equal(party.attachments, undefined, "not collapsed behind Show more");
  assert.equal(party.blocks[0].type, "header");
  assert.equal(party.text, title);
  const json = JSON.stringify(party.blocks);
  assert.equal(json.match(/NEW RECORD/gi).length, 1, "NEW RECORD shows once");
  assert.equal(json.match(/296 days/g).length, 1, "the number shows once");
  assert.match(json, /\*\+86 days\* past the old record of 210 days/);
  assert.match(json, /250 ratings · average 4.88\\n🤩 5\/5: 220 \(88%\) · 😃 4\/5: 30 \(12%\)/);
  assert.match(json, /<@U1> \(90\), Bo &lt;x&gt; \(40\)/);

  const milestone = streakMessage(streak(301), { title: "🎉 300 days of 100% positive ratings!", count: 0, fiveStar: 0, fourStar: 0, average: 0, agents: [] });
  assert.match(JSON.stringify(milestone.blocks), /Today: 301 days/);
});
