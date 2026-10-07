// Weekly report numbers. Pure function over rating rows.

const { isNegative } = require("./streak");

// rows: [{ score, admin_id, admin_name, team_id?, team_name? }]
function weeklyStats(rows) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const agents = new Map();
  const teams = new Map();
  let sum = 0;
  let positive = 0;

  for (const row of rows) {
    distribution[row.score]++;
    sum += row.score;
    if (!isNegative(row.score)) positive++;

    // Every rating counts under a team; ratings without one under "No team".
    const teamKey = row.team_id || "unknown";
    const teamName =
      row.team_name || (row.team_id === "none" ? "No team" : row.team_id ? `Team ${row.team_id}` : "Not checked");
    const team = teams.get(teamKey) || { name: teamName, count: 0, sum: 0, positive: 0 };
    team.count++;
    team.sum += row.score;
    if (!isNegative(row.score)) team.positive++;
    teams.set(teamKey, team);

    // Top agents lists real agents only; ratings without one still count in the totals.
    if (!row.admin_id) continue;
    const agent = agents.get(row.admin_id) || { name: row.admin_name || "Unknown agent", count: 0, sum: 0, positive: 0 };
    agent.count++;
    agent.sum += row.score;
    if (!isNegative(row.score)) agent.positive++;
    agents.set(row.admin_id, agent);
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
    // Ranked by number of ratings; ratings without a team last.
    teams: [...teams.entries()]
      .map(([key, t]) => ({ key, name: t.name, count: t.count, average: t.sum / t.count, positiveShare: t.positive / t.count }))
      .sort((a, b) => (a.key === "none") - (b.key === "none") || b.count - a.count || a.name.localeCompare(b.name)),
  };
}

module.exports = { weeklyStats };
