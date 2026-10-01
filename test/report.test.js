const test = require("node:test");
const assert = require("node:assert/strict");
const { weeklyStats } = require("../src/report");
const { weeklyMessage } = require("../src/messages");

test("weekly stats and ranking", () => {
  const stats = weeklyStats([
    { score: 5, admin_id: "1", admin_name: "Ann" },
    { score: 4, admin_id: "1", admin_name: "Ann" },
    { score: 2, admin_id: "2", admin_name: "Bo" },
    { score: 5, admin_id: "2", admin_name: "Bo" },
    { score: 5, admin_id: "2", admin_name: "Bo" },
    { score: 3, admin_id: null, admin_name: null },
  ]);
  assert.equal(stats.total, 6);
  assert.equal(stats.average, 4);
  assert.equal(stats.positiveShare, 4 / 6);
  assert.deepEqual(stats.distribution, { 1: 0, 2: 1, 3: 1, 4: 1, 5: 3 });
  assert.deepEqual(stats.agents.map((a) => [a.name, a.count]), [["Bo", 3], ["Ann", 2]], "no Unassigned entry");
  assert.equal(stats.agents[0].positiveShare, 2 / 3);

  const text = JSON.stringify(weeklyMessage({ stats, from: "a", to: "b" }));
  assert.match(text, /Bo\*: 3 ratings · avg 4.00 · 67% positive/);
});

test("empty week", () => {
  const msg = weeklyMessage({ stats: weeklyStats([]), from: "a", to: "b" });
  assert.match(msg.text, /no ratings/);
});

test("weekly report uses plain blocks, so Slack does not collapse it", () => {
  const msg = weeklyMessage({ stats: weeklyStats([{ score: 5, admin_id: "1", admin_name: "Ann" }]), from: "a", to: "b" });
  assert.equal(msg.attachments, undefined);
  assert.ok(msg.blocks.length > 3);
});

test("last report Friday", () => {
  const { makeClock } = require("../src/time");
  const { createJobs } = require("../src/jobs");
  const clock = makeClock("Europe/Copenhagen");
  const db = { prepare: () => ({}) };
  const jobs = createJobs({ db, clock });
  assert.equal(jobs.lastReportFriday(clock.epochAt("2026-09-30", 13, 26)), "2026-09-25"); // Wednesday
  assert.equal(jobs.lastReportFriday(clock.epochAt("2026-10-02", 13, 59)), "2026-09-25"); // Friday before 14:00
  assert.equal(jobs.lastReportFriday(clock.epochAt("2026-10-02", 14, 0)), "2026-10-02"); // Friday 14:00
  assert.equal(jobs.lastReportFriday(clock.epochAt("2026-10-04", 9, 0)), "2026-10-02"); // Sunday
});
