const test = require("node:test");
const assert = require("node:assert/strict");
const { closedBy, teamAtClose } = require("../src/closer");

const conv = (parts, ratedAt = 1000) => ({
  conversation_rating: { created_at: ratedAt },
  conversation_parts: { conversation_parts: parts },
});
const close = (type, at) => ({ part_type: "close", created_at: at, author: { type, name: type === "bot" ? "Buddy" : "Ann" } });

test("closed by a teammate is human, by Fin or a bot is bot", () => {
  assert.equal(closedBy(conv([{ part_type: "comment", created_at: 1, author: { type: "bot" } }, close("admin", 900)])), "human");
  assert.equal(closedBy(conv([{ part_type: "comment", created_at: 1, author: { type: "admin" } }, close("bot", 900)])), "bot");
});

test("reopened conversation: the last close before the rating counts", () => {
  assert.equal(closedBy(conv([close("bot", 100), close("admin", 900), close("bot", 2000)])), "human");
  assert.equal(closedBy(conv([close("admin", 100), close("bot", 900)])), "bot");
});

test("no close found is unknown; parts not loaded is undefined", () => {
  assert.equal(closedBy(conv([{ part_type: "comment", created_at: 1, author: { type: "admin" } }])), "unknown");
  assert.equal(closedBy({ conversation_rating: { created_at: 1 } }), undefined);
});

const assign = (team, at) => ({ part_type: "assignment", created_at: at, assigned_to: { type: "team", id: team } });

test("team at close: the last team before the close, not a move to a follow-up team afterwards", () => {
  // Handled in Support Chat (11), closed, rated, then moved to Support Feedback (99).
  assert.equal(teamAtClose(conv([assign(5, 10), assign(11, 100), close("admin", 900), assign(99, 1100)])), "11");
});

test("team at close: reopened and handed over before the rated close", () => {
  assert.equal(teamAtClose(conv([assign(11, 10), close("admin", 100), assign(12, 200), close("admin", 900)])), "12");
});

test("team at close: no team assignment in the history is null, parts not loaded is undefined", () => {
  assert.equal(teamAtClose(conv([{ part_type: "assignment", created_at: 5, assigned_to: { type: "admin", id: 7 } }, close("admin", 900)])), null);
  assert.equal(teamAtClose({ conversation_rating: { created_at: 1 } }), undefined);
});
