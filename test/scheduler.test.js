const test = require("node:test");
const assert = require("node:assert/strict");
const { open } = require("../src/db");
const { makeClock } = require("../src/time");
const { createScheduler } = require("../src/scheduler");

function setup() {
  const clock = makeClock("Europe/Copenhagen");
  const runs = [];
  const jobs = {
    morning: async (d) => runs.push(`morning ${d}`),
    weekly: async (d) => runs.push(`weekly ${d}`),
    reconcile: async () => 0,
  };
  const queue = { processDue: async () => {} };
  const log = { info() {}, warn() {}, error() {} };
  const scheduler = createScheduler({ db: open(":memory:"), clock, jobs, queue, log });
  const at = (date, hh, mm) => scheduler.tick(clock.epochAt(date, hh, mm));
  return { at, runs };
}

test("morning post on weekdays from 08:30, once per day, never on weekends", async () => {
  const { at, runs } = setup();
  await at("2026-10-05", 8, 29); // Monday
  await at("2026-10-05", 8, 30);
  await at("2026-10-05", 9, 0);
  await at("2026-10-03", 8, 30); // Saturday
  await at("2026-10-04", 9, 0); // Sunday
  assert.deepEqual(runs, ["morning 2026-10-05"]);
});

test("weekly report on Friday from 14:00, including after a restart", async () => {
  const { at, runs } = setup();
  await at("2026-10-09", 13, 59);
  await at("2026-10-09", 15, 10); // server came back late
  await at("2026-10-09", 16, 0);
  await at("2026-10-08", 14, 0); // Thursday
  assert.deepEqual(runs, ["weekly 2026-10-09"]);
});

test("switched-off posts are skipped, and go out if switched on again inside the window", async () => {
  const { open } = require("../src/db");
  const clock = makeClock("Europe/Copenhagen");
  const runs = [];
  const jobs = { morning: async (d) => runs.push(`morning ${d}`), weekly: async (d) => runs.push(`weekly ${d}`), reconcile: async () => 0 };
  const on = { morning: false, weekly: false };
  const scheduler = createScheduler({
    db: open(":memory:"), clock, jobs, queue: { processDue: async () => {} }, prefs: { get: () => on },
    log: { info() {}, warn() {}, error() {} },
  });
  await scheduler.tick(clock.epochAt("2026-10-09", 8, 30)); // Friday
  await scheduler.tick(clock.epochAt("2026-10-09", 14, 0));
  assert.deepEqual(runs, []);
  on.weekly = true;
  await scheduler.tick(clock.epochAt("2026-10-09", 15, 0));
  assert.deepEqual(runs, ["weekly 2026-10-09"]);
});
