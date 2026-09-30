// Which record posts get the big celebration. Pure functions.
//
// Every record day gets the gold NEW RECORD post. The big celebration (header,
// streak statistics, thanks to agents, reactions) is only for:
// - the first record post of a streak, and
// - milestones: every 50 days and every full year.
// A milestone that fell on a weekend is celebrated in the next morning post.

function highestMilestone(days) {
  return Math.max(Math.floor(days / 50) * 50, Math.floor(days / 365) * 365);
}

function milestoneTitle(days) {
  if (days % 365 === 0) {
    const years = days / 365;
    return `🎉 ${years === 1 ? "One full year" : `${years} full years`} of 100% positive ratings! 🎉`;
  }
  return `🎉 ${days} days of 100% positive ratings! 🎉`;
}

// celebrated: Set of keys already celebrated. Returns { title, keys } or null.
// keys are to be remembered after posting.
function celebrationFor({ streak, celebrated }) {
  if (!streak.isNewRecord || !streak.since) return null;
  const milestone = highestMilestone(streak.current);
  const milestoneKey = `${streak.since}:${milestone}`;

  const recordKey = `${streak.since}:record`;
  if (!celebrated.has(recordKey)) {
    // Milestones already passed are part of this first celebration.
    const keys = [recordKey];
    for (let m = 50; m <= streak.current; m++) if (highestMilestone(m) === m) keys.push(`${streak.since}:${m}`);
    return { title: "🏆 NEW RECORD! 🏆", keys };
  }
  if (milestone > 0 && !celebrated.has(milestoneKey)) {
    return { title: milestoneTitle(milestone), keys: [milestoneKey] };
  }
  return null;
}

module.exports = { celebrationFor, highestMilestone };
