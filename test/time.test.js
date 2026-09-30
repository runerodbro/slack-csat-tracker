const test = require("node:test");
const assert = require("node:assert/strict");
const { makeClock, addDays, daysBetween } = require("../src/time");

const clock = makeClock("Europe/Copenhagen");

test("14:00 local is 12:00 UTC in summer and 13:00 UTC in winter", () => {
  assert.equal(new Date(clock.epochAt("2026-09-25", 14) * 1000).toISOString(), "2026-09-25T12:00:00.000Z");
  assert.equal(new Date(clock.epochAt("2026-11-06", 14) * 1000).toISOString(), "2026-11-06T13:00:00.000Z");
});

test("local date and weekday near midnight", () => {
  const p = clock.parts(Date.parse("2026-09-29T22:30:00Z") / 1000); // 00:30 on Wednesday in Copenhagen
  assert.equal(p.date, "2026-09-30");
  assert.equal(p.weekday, 3);
  assert.equal(p.hour, 0);
});

test("day math across the DST change", () => {
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
  assert.equal(addDays("2026-10-02", -7), "2026-09-25");
});
