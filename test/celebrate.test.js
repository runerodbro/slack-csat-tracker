const test = require("node:test");
const assert = require("node:assert/strict");
const { celebrationFor, upcoming } = require("../src/celebrate");
const { streakMessage } = require("../src/messages");

const record = { length: 226, from: "2025-03-09", to: "2025-10-22" };
const history = [record, { length: 158, from: "2024-01-01", to: "2024-06-07" }, { length: 40, from: "2024-06-07", to: "2024-07-17" }];
const streak = (current, isNewRecord = true) => ({ current, since: "2025-12-08", isNewRecord, record, history });
const due = (s, ratingsInRow, today, celebrated) => celebrationFor({ streak: s, ratingsInRow, today, celebrated });

test("the first record post is the record celebration, and marks milestones already passed", () => {
  const c = due(streak(227), 250, "2026-07-24", new Set());
  assert.equal(c.kind, "record");
  assert.equal(c.title, "🏆 NEW RECORD: 227 days of 100% positive ratings");
  assert.deepEqual(c.keys, ["2025-12-08:record", "2025-12-08:100", "2025-12-08:200", "2025-12-08:ratings:100", "2025-12-08:ratings:200"]);
});

test("milestones: every 100 days, full years, 100 ratings in a row; weekend ones the next morning", () => {
  const celebrated = new Set(["2025-12-08:record", "2025-12-08:100", "2025-12-08:200", "2025-12-08:300", "2025-12-08:ratings:100"]);
  assert.equal(due(streak(336), 150, "2026-11-09", celebrated), null);
  // Ratings already passed when this went live: the latest one is celebrated once.
  const c = due(streak(336), 350, "2026-11-09", celebrated);
  assert.equal(c.kind, "milestone");
  assert.equal(c.title, "🎉 300 positive ratings in a row!");
  c.keys.forEach((k) => celebrated.add(k));
  assert.equal(due(streak(337), 350, "2026-11-10", celebrated), null);
  // 365 days fell on a weekend: celebrated on the next morning.
  const year = due(streak(367), 360, "2026-12-10", celebrated);
  assert.equal(year.title, "🏆 PERFECT YEAR: 365 days of 100% positive ratings");
  assert.equal(year.kind, "special", "a full year is as special as a record");
  year.keys.forEach((k) => celebrated.add(k));
  // Two on the same morning: one celebration, both named (the Perfect Year went out on 4 January).
  celebrated.add("perfect:2026");
  const both = due(streak(400), 400, "2027-01-12", celebrated);
  assert.equal(both.title, "🎉 400 days · 400 positive ratings in a row!");
});

test("twice the old record, and a Perfect Year from 2 January", () => {
  const celebrated = new Set(["2025-12-08:record", "2025-12-08:100", "2025-12-08:200", "2025-12-08:300", "2025-12-08:365", "2025-12-08:400"]);
  assert.match(due(streak(452), 0, "2027-03-05", new Set([...celebrated, "perfect:2026"])).title, /Twice the old record: 452 days/);
  const onNewYear = new Set([...celebrated, "2025-12-08:double"]);
  assert.equal(due(streak(389), 0, "2027-01-01", onNewYear), null, "1 January is a holiday");
  const calendar = due(streak(392), 0, "2027-01-04", onNewYear);
  assert.equal(calendar.title, "🏆 2026 - A PERFECT YEAR: Exclusively positive ratings");
  assert.equal(calendar.kind, "special");
  assert.equal(due({ ...streak(730) }, 0, "2027-12-08", new Set([...onNewYear, "perfect:2026", "2025-12-08:500", "2025-12-08:600", "2025-12-08:700"])).title,
    "🏆 2 PERFECT YEARS: 730 days of 100% positive ratings");
  // A streak that started in 2026 can't make 2026 a Perfect Year.
  const later = { ...streak(300), since: "2026-03-01" };
  assert.equal(due(later, 0, "2027-01-04", new Set(["2026-03-01:record", "2026-03-01:100", "2026-03-01:200", "2026-03-01:300"])), null);
});

test("milestones are celebrated in a streak that is not a record too", () => {
  const s = { current: 100, since: "2026-08-01", isNewRecord: false, record, history };
  const c = due(s, 40, "2026-11-09", new Set());
  assert.equal(c.kind, "milestone");
  assert.equal(c.title, "🎉 100 days of 100% positive ratings!");
});

test("tracker: the next three, nearest first", () => {
  const next = upcoming({ streak: streak(336), ratingsInRow: 388, ratesPerDay: 1.15, today: "2026-11-09" });
  assert.deepEqual(next.map((t) => t.text), ["400 ratings in a row: 12 to go", "365 Days in 29 days", "2026 - A PERFECT YEAR in 53 days"]);
  const normal = upcoming({ streak: { current: 153, since: "2026-06-09", isNewRecord: false, record, history }, ratingsInRow: 170, ratesPerDay: 1.1, today: "2026-11-09" });
  // 30 ratings at 1.1 a day is about 27 days, so it comes first.
  assert.deepEqual(normal.map((t) => t.text), ["200 ratings in a row: 30 to go", "200 days in 47 days", "beat the record in 74 days"]);
});

test("record post: gold, tracker on one line, no repeated text", () => {
  const plain = streakMessage(streak(296), null, [{ text: "365 Days in 69 days" }, { text: "300 days in 4 days" }]);
  assert.equal(plain.text, undefined);
  assert.equal(plain.attachments[0].color, "#D4A017");
  const json = JSON.stringify(plain.attachments[0].blocks);
  assert.match(json, /New record: 296 days/);
  assert.match(json, /\+70 days/);
  assert.match(json, /🎯 Next: 365 Days in 69 days · 300 days in 4 days/);
  assert.doesNotMatch(json, /Current streak/);
});

test("record celebration: @here, hall of fame, everyone thanked; a milestone stays plain", () => {
  const stats = { count: 250, fiveStar: 220, fourStar: 30, average: 4.88, agents: [{ name: "Ann", slackId: "U1", count: 90 }, { name: "Bo <x>", slackId: null, count: 40 }] };
  const party = streakMessage(streak(296), { kind: "record", title: "🏆 NEW RECORD: 296 days of 100% positive ratings", ...stats }, [{ text: "300 days in 4 days" }]);
  assert.equal(party.attachments, undefined, "not collapsed behind Show more");
  assert.equal(party.blocks[0].type, "header");
  assert.match(party.text, /^<!here> /);
  const json = JSON.stringify(party.blocks);
  assert.equal(json.match(/NEW RECORD/gi).length, 1, "NEW RECORD shows once");
  assert.match(json, /\*\+70 days\* past the old record of 226 days/);
  assert.match(json, /Hall of fame:\* 226 days \(2025\) · 158 days \(2024\) · 40 days \(2024\) → \*now 296 days\*/);
  assert.match(json, /Thank you, everyone\* 🙌\\n<@U1> \(90\), Bo &lt;x&gt; \(40\)/);
  assert.match(json, /🎯 Next: 300 days in 4 days/);

  const milestone = streakMessage(streak(301), { kind: "milestone", title: "🎉 300 days of 100% positive ratings!", ...stats });
  const m = JSON.stringify(milestone);
  assert.doesNotMatch(m, /<!here>|Hall of fame/);
  assert.match(m, /Today: 301 days/);
  assert.match(m, /\*Thank you\* 🙌/);

  const year = streakMessage(streak(365), { kind: "special", title: "🏆 PERFECT YEAR: 365 days of 100% positive ratings", ...stats });
  assert.match(year.text, /^<!here> 🏆 PERFECT YEAR/);
  assert.match(JSON.stringify(year.blocks), /Hall of fame.*Thank you, everyone/);

  const notRecord = streakMessage({ ...streak(100, false), since: "2026-08-01" }, { kind: "milestone", title: "🎉 100 days of 100% positive ratings!", ...stats });
  assert.doesNotMatch(JSON.stringify(notRecord), /past the old record/);
});
