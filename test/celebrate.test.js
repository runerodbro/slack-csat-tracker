const test = require("node:test");
const assert = require("node:assert/strict");
const { celebrationFor } = require("../src/celebrate");
const { streakMessage } = require("../src/messages");

const streak = (current, isNewRecord = true) => ({
  current, since: "2025-12-08", isNewRecord, record: { length: 210, from: "2025-03-01", to: "2025-10-01" },
});

test("first record post celebrates and covers milestones already passed", () => {
  const c = celebrationFor({ streak: streak(296), celebrated: new Set() });
  assert.equal(c.title, "🏆 NEW RECORD! 🏆");
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

test("record post is gold with distance to the old record; celebration adds header and thanks", () => {
  const plain = streakMessage(streak(296));
  assert.equal(plain.attachments[0].color, "#D4A017");
  assert.match(JSON.stringify(plain), /\+86 days/);

  const party = streakMessage(streak(296), {
    title: "🏆 NEW RECORD! 🏆", count: 250, fiveStar: 220, average: 4.88,
    agents: [{ name: "Ann", slackId: "U1", count: 90 }, { name: "Bo <x>", slackId: null, count: 40 }],
  });
  const json = JSON.stringify(party);
  assert.equal(party.attachments[0].blocks[0].type, "header");
  assert.match(json, /250 ratings · 220 × 🤩 5\/5 · average 4.88/);
  assert.match(json, /<@U1> \(90\), Bo &lt;x&gt; \(40\)/);
});
