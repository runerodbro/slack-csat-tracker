// Runs the queue and the scheduled jobs. Checks every 20 seconds.
//
// Morning post: Monday to Friday, 08:30 local time.
// Weekly report: Friday, 14:00 local time.
// Each job runs once per period (scheduled_runs table). If the server was down
// at the planned time, the job still runs when it comes back inside the window.
// A post switched off in the Home tab (prefs.js) is skipped, and not marked as
// run, so it still goes out if it is switched on again inside the window. A
// celebration on a skipped day comes with the next morning post.

const { nowSeconds } = require("./time");

const MORNING = { from: 8 * 60 + 30, until: 11 * 60 };
const WEEKLY = { from: 14 * 60, until: 18 * 60 };
const RECONCILE_EVERY_MS = 60 * 60 * 1000;

function createScheduler({ db, clock, jobs, queue, prefs = { get: () => ({ morning: true, weekly: true }) }, log = console, intervalMs = 20000 }) {
  const hasRun = db.prepare("SELECT 1 FROM scheduled_runs WHERE job = ? AND run_key = ?");
  const markRun = db.prepare("INSERT OR IGNORE INTO scheduled_runs (job, run_key) VALUES (?, ?)");

  async function once(job, key, fn) {
    if (hasRun.get(job, key)) return;
    try {
      await fn();
      markRun.run(job, key);
      log.info(`Job ${job} ${key}: done`);
    } catch (err) {
      log.error(`Job ${job} ${key}: ${err.message}`);
    }
  }

  // First reconcile about 2 minutes after start.
  let lastReconcile = Date.now() - RECONCILE_EVERY_MS + 2 * 60 * 1000;
  let ticking = false;

  async function tick(now = nowSeconds()) {
    if (ticking) return;
    ticking = true;
    try {
      await queue.processDue(now);

      const p = clock.parts(now);
      const minutes = p.hour * 60 + p.minute;
      const on = prefs.get();
      if (on.morning && p.weekday <= 5 && minutes >= MORNING.from && minutes < MORNING.until) {
        await once("morning", p.date, () => jobs.morning(p.date));
      }
      if (on.weekly && p.weekday === 5 && minutes >= WEEKLY.from && minutes < WEEKLY.until) {
        await once("weekly", p.date, () => jobs.weekly(p.date));
      }
      if (Date.now() - lastReconcile >= RECONCILE_EVERY_MS) {
        lastReconcile = Date.now();
        await jobs.reconcile().catch((err) => log.error(`Reconcile: ${err.message}`));
      }
    } finally {
      ticking = false;
    }
  }

  let timer = null;
  return {
    tick,
    start() {
      timer = setInterval(() => tick().catch((err) => log.error(err)), intervalMs);
      tick().catch((err) => log.error(err));
    },
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { createScheduler };
