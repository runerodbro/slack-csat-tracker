// Streak rules. Pure functions, no database.
//
// A streak day is a local calendar day. The streak on a given day is the number
// of days since the last day with a negative (1-3) rating. Days with no ratings
// count. Example: a negative rating on Tuesday gives a streak of 1 on Wednesday.

const { daysBetween } = require("./time");

const NEGATIVE_MAX = 3;

function isNegative(score) {
  return score <= NEGATIVE_MAX;
}

// negativeDates: local dates with a negative rating.
// startDate: first day of tracking. It counts as a break for the first streak.
function computeStreak({ negativeDates, startDate, today }) {
  const negatives = [...new Set(negativeDates)]
    .filter((d) => d <= today && (!startDate || d >= startDate))
    .sort();
  const anchors = startDate && negatives[0] !== startDate ? [startDate, ...negatives] : negatives;
  if (!anchors.length || anchors[0] > today) {
    return { current: 0, since: null, record: null, isNewRecord: false };
  }

  let record = null;
  for (let i = 1; i < anchors.length; i++) {
    const length = daysBetween(anchors[i - 1], anchors[i]);
    if (!record || length > record.length) record = { length, from: anchors[i - 1], to: anchors[i] };
  }

  const since = anchors[anchors.length - 1];
  const current = daysBetween(since, today);
  return { current, since, record, isNewRecord: Boolean(record) && current > record.length };
}

// Result for a negative rating on `date`. Returns null when another negative
// rating already broke the streak that day.
function breakInfo({ otherNegativeDates, startDate, date }) {
  if (otherNegativeDates.includes(date)) return null;
  const before = computeStreak({
    negativeDates: otherNegativeDates.filter((d) => d < date),
    startDate,
    today: date,
  });
  return {
    length: before.current,
    since: before.since,
    previousRecord: before.record,
    isRecord: before.record ? before.current > before.record.length : false,
  };
}

module.exports = { NEGATIVE_MAX, isNegative, computeStreak, breakInfo };
