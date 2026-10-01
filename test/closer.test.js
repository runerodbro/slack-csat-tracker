const test = require("node:test");
const assert = require("node:assert/strict");
const { closedBy } = require("../src/closer");

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
