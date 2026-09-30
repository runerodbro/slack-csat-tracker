// Weekly report numbers. Pure function over rating rows.

const { isNegative } = require("./streak");

// rows: [{ score, admin_id, admin_name }]
function weeklyStats(rows) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const agents = new Map();
  let sum = 0;
  let positive = 0;

  for (const row of rows) {
    distribution[row.score]++;
    sum += row.score;
    if (!isNegative(row.score)) positive++;

    const key = row.admin_id || "unassigned";
    const agent = agents.get(key) || { name: row.admin_name || "Unassigned", count: 0, sum: 0, positive: 0 };
    agent.count++;
    agent.sum += row.score;
    if (!isNegative(row.score)) agent.positive++;
    agents.set(key, agent);
  }

  const total = rows.length;
  return {
    total,
    average: total ? sum / total : 0,
    positiveShare: total ? positive / total : 0,
    distribution,
    // Ranked by number of ratings, then by average score.
    agents: [...agents.values()]
      .map((a) => ({ name: a.name, count: a.count, average: a.sum / a.count, positiveShare: a.positive / a.count }))
      .sort((a, b) => b.count - a.count || b.average - a.average || a.name.localeCompare(b.name)),
  };
}

module.exports = { weeklyStats };
