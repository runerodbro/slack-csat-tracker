const test = require("node:test");
const assert = require("node:assert/strict");
const { computeStreak, breakInfo } = require("../src/streak");

test("break on Tuesday shows 1 on Wednesday morning", () => {
  const s = computeStreak({ negativeDates: ["2026-09-29"], startDate: "2026-09-01", today: "2026-09-30" });
  assert.equal(s.current, 1);
  assert.equal(s.since, "2026-09-29");
});

test("weekend days count: Friday break shows 3 on Monday", () => {
  const s = computeStreak({ negativeDates: ["2026-10-02"], startDate: "2026-09-01", today: "2026-10-05" });
  assert.equal(s.current, 3);
});

test("days with no ratings count from the start date", () => {
  const s = computeStreak({ negativeDates: [], startDate: "2026-09-01", today: "2026-09-11" });
  assert.equal(s.current, 10);
  assert.equal(s.record, null);
  assert.equal(s.isNewRecord, false);
});

test("record is the longest past streak, new record when current beats it", () => {
  const negativeDates = ["2026-09-05", "2026-09-06", "2026-09-10"];
  const s = computeStreak({ negativeDates, startDate: "2026-09-01", today: "2026-09-20" });
  assert.deepEqual(s.record, { length: 4, from: "2026-09-01", to: "2026-09-05" });
  assert.equal(s.current, 10);
  assert.equal(s.isNewRecord, true);
});

test("equal to the record is not a new record", () => {
  const s = computeStreak({ negativeDates: ["2026-09-05"], startDate: "2026-09-01", today: "2026-09-09" });
  assert.equal(s.current, 4);
  assert.equal(s.isNewRecord, false);
});

test("break length is what the morning post showed that day", () => {
  const info = breakInfo({ otherNegativeDates: ["2026-09-01"], startDate: "2026-08-01", date: "2026-09-15" });
  assert.equal(info.length, 14);
  assert.deepEqual(info.previousRecord, { length: 31, from: "2026-08-01", to: "2026-09-01" });
  assert.equal(info.isRecord, false);
});

test("break that beat the record", () => {
  const info = breakInfo({ otherNegativeDates: ["2026-09-03"], startDate: "2026-09-01", date: "2026-09-20" });
  assert.equal(info.length, 17);
  assert.equal(info.isRecord, true);
});

test("second negative the same day gives no second break", () => {
  assert.equal(breakInfo({ otherNegativeDates: ["2026-09-15"], startDate: "2026-09-01", date: "2026-09-15" }), null);
});

test("negative on the first tracked day", () => {
  const info = breakInfo({ otherNegativeDates: [], startDate: "2026-09-15", date: "2026-09-15" });
  assert.equal(info.length, 0);
  assert.equal(info.previousRecord, null);
});
