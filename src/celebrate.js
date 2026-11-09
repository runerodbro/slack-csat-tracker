// Milestones: what the tracker counts down to, and when the big celebration
// goes out. Pure functions.
//
// Milestones of a streak:
// - days: every 100 days and every full year (365, 730…);
// - positive ratings in a row: every 100;
// - twice the old record (only during a record streak);
// - a Perfect Year: a whole calendar year without a 1–3 rating, celebrated in
//   the first morning post from 2 January (1 January is a holiday);
// - a new record: the extra special celebration, once per streak.
//
// Every reached milestone is celebrated, in any streak. A milestone reached on
// a weekend, or between two morning posts, is celebrated in the next morning
// post. Milestones already passed when a celebration goes out are marked done
// with it, so only the latest of each kind is celebrated.
//
// When a 1–3 rating breaks the streak, any celebration the ending streak still
// had pending goes out first, then the break post (atBreak), so no milestone
// is lost. A Perfect Year then goes out on 1 January too.

const { daysBetween } = require("./time");

const RATINGS_STEP = 100;

const isDayMilestone = (n) => n > 0 && (n % 100 === 0 || n % 365 === 0);

function yearsText(n) {
  const years = n / 365;
  return years === 1 ? "One full year" : `${years} full years`;
}

// Short names, for combined titles and the tracker.
const dayName = (n) => (n % 365 === 0 ? yearsText(n) : `${n} days`);

// The highest day milestone reached, or 0.
function highestDayMilestone(current) {
  for (let n = current; n > 0; n--) if (isDayMilestone(n)) return n;
  return 0;
}

function nextDayMilestone(current) {
  let n = current + 1;
  while (!isDayMilestone(n)) n++;
  return n;
}

// A Perfect Year Y needs the whole of Y inside the streak: the last break
// (since) before 1 January Y.
const perfectYearPossible = (since, year) => since < `${year}-01-01`;

// state: { streak, ratingsInRow, today (YYYY-MM-DD), celebrated: Set, atBreak }.
// Returns { kind: "record" | "milestone", title, keys } or null.
function celebrationFor({ streak, ratingsInRow = 0, today, celebrated, atBreak = false }) {
  if (!streak.since) return null;
  const s = streak.since;
  const done = (key) => celebrated.has(key);

  // Every milestone reached so far, as keys; the latest of each kind is "due".
  const keys = [];
  const due = [];

  const dayTop = highestDayMilestone(streak.current);
  for (let n = 1; n <= dayTop; n++) if (isDayMilestone(n)) keys.push(`${s}:${n}`);
  if (dayTop && !done(`${s}:${dayTop}`)) due.push({ name: dayName(dayTop), title: `${dayName(dayTop)} of 100% positive ratings` });

  const ratingTop = Math.floor(ratingsInRow / RATINGS_STEP) * RATINGS_STEP;
  for (let n = RATINGS_STEP; n <= ratingTop; n += RATINGS_STEP) keys.push(`${s}:ratings:${n}`);
  if (ratingTop && !done(`${s}:ratings:${ratingTop}`)) {
    due.push({ name: `${ratingTop} positive ratings in a row`, title: `${ratingTop} positive ratings in a row` });
  }

  if (streak.isNewRecord && streak.current >= 2 * streak.record.length) {
    keys.push(`${s}:double`);
    if (!done(`${s}:double`)) due.push({ name: "Twice the old record", title: `Twice the old record: ${streak.current} days` });
  }

  const year = Number(today?.slice(0, 4)) - 1;
  const perfectFrom = atBreak ? `${year + 1}-01-01` : `${year + 1}-01-02`;
  if (today >= perfectFrom && perfectYearPossible(s, year)) {
    keys.push(`perfect:${year}`);
    if (!done(`perfect:${year}`)) due.push({ name: `Perfect Year ${year}`, title: `Perfect Year ${year}: not one negative rating all year` });
  }

  // The first record post of a streak: the extra special celebration, which
  // also covers any milestone due today.
  const recordKey = `${s}:record`;
  if (streak.isNewRecord && !done(recordKey)) {
    return { kind: "record", title: `🏆 NEW RECORD: ${streak.current} days of 100% positive ratings`, keys: [recordKey, ...keys] };
  }
  if (!due.length) return null;
  const title = due.length === 1 ? `🎉 ${due[0].title}!` : `🎉 ${due.map((d) => d.name).join(" · ")}!`;
  return { kind: "milestone", title, keys };
}

// The next milestones, nearest first, for the tracker line. ratesPerDay: the
// streak's ratings per day, only used to sort "ratings to go" among the rest.
// Returns [{ text, days }], at most `limit`.
function upcoming({ streak, ratingsInRow = 0, ratesPerDay = 0, today, limit = 3 }) {
  if (!streak.since) return [];
  const list = [];
  const inDays = (n) => (n === 1 ? "tomorrow" : `in ${n} days`);

  const nextDay = nextDayMilestone(streak.current);
  list.push({ days: nextDay - streak.current, text: `${dayName(nextDay)} ${inDays(nextDay - streak.current)}` });

  if (streak.record && !streak.isNewRecord) {
    const toGo = streak.record.length + 1 - streak.current;
    list.push({ days: toGo, text: `beat the record ${inDays(toGo)}` });
  }
  if (streak.isNewRecord && streak.current < 2 * streak.record.length) {
    const toGo = 2 * streak.record.length - streak.current;
    list.push({ days: toGo, text: `twice the old record ${inDays(toGo)}` });
  }

  const nextRatings = (Math.floor(ratingsInRow / RATINGS_STEP) + 1) * RATINGS_STEP;
  const ratingsToGo = nextRatings - ratingsInRow;
  list.push({
    days: ratesPerDay > 0 ? ratingsToGo / ratesPerDay : Infinity,
    text: `${nextRatings} ratings in a row: ${ratingsToGo} to go`,
  });

  const year = Number(today.slice(0, 4));
  if (perfectYearPossible(streak.since, year)) {
    // Complete at the end of 31 December; counted to 1 January.
    const toGo = daysBetween(today, `${year + 1}-01-01`);
    list.push({ days: toGo, text: `Perfect Year ${year} ${inDays(toGo)}` });
  }

  return list.sort((a, b) => a.days - b.days).slice(0, limit);
}

// The milestone a preview shows: the next day milestone.
function nextMilestoneTitle(current) {
  return `🎉 ${dayName(nextDayMilestone(current))} of 100% positive ratings!`;
}

module.exports = { celebrationFor, upcoming, nextMilestoneTitle, isDayMilestone };
