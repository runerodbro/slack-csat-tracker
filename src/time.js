// Time zone helpers. Dates are 'YYYY-MM-DD' strings in the configured time zone.
// Times are Unix seconds.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function dayNumber(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function daysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

function addDays(date, days) {
  return new Date((dayNumber(date) + days) * 86400000).toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function makeClock(timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });

  // Local calendar parts for a Unix time. weekday: Monday = 1 ... Sunday = 7.
  function parts(epoch) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(epoch * 1000)).map((x) => [x.type, x.value]));
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      year: Number(p.year),
      month: Number(p.month),
      day: Number(p.day),
      hour: Number(p.hour),
      minute: Number(p.minute),
      second: Number(p.second),
      weekday: WEEKDAYS.indexOf(p.weekday) + 1,
    };
  }

  // Unix time of a local wall-clock time. Handles summer and winter time.
  function epochAt(date, hour = 0, minute = 0) {
    const [y, m, d] = date.split("-").map(Number);
    const target = Date.UTC(y, m - 1, d, hour, minute) / 1000;
    let guess = target;
    for (let i = 0; i < 2; i++) {
      const p = parts(guess);
      guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
    }
    return guess;
  }

  return { parts, localDate: (epoch) => parts(epoch).date, epochAt };
}

module.exports = { nowSeconds, daysBetween, addDays, formatDate, makeClock };
