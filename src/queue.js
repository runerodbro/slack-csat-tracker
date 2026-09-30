// Delay queue for rating posts, stored in the pending_posts table.
// A new event for the same conversation moves the due time forward, so a
// customer who changes the rating within the delay gets one post.

const MAX_ATTEMPTS = 10;

function createQueue({ db, handler, log = console }) {
  const q = {
    enqueue: db.prepare(`
      INSERT INTO pending_posts (conversation_id, due_at) VALUES (?, ?)
      ON CONFLICT (conversation_id) DO UPDATE SET due_at = excluded.due_at`),
    has: db.prepare("SELECT 1 FROM pending_posts WHERE conversation_id = ?"),
    due: db.prepare("SELECT * FROM pending_posts WHERE due_at <= ? ORDER BY due_at LIMIT 20"),
    // Only delete if no new event moved the due time while we worked.
    done: db.prepare("DELETE FROM pending_posts WHERE conversation_id = ? AND due_at = ?"),
    retry: db.prepare(
      "UPDATE pending_posts SET due_at = ?, attempts = ?, last_error = ? WHERE conversation_id = ? AND due_at = ?",
    ),
  };

  let busy = false;
  async function processDue(now) {
    if (busy) return;
    busy = true;
    try {
      for (const item of q.due.all(now)) {
        try {
          const result = await handler(item.conversation_id);
          log.info(`Conversation ${item.conversation_id}: ${result}`);
          q.done.run(item.conversation_id, item.due_at);
        } catch (err) {
          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            log.error(`Conversation ${item.conversation_id}: giving up after ${attempts} attempts: ${err.message}`);
            q.done.run(item.conversation_id, item.due_at);
          } else {
            const wait = Math.min(60 * 2 ** attempts, 3600);
            log.warn(`Conversation ${item.conversation_id}: ${err.message} (retry in ${wait}s)`);
            q.retry.run(now + wait, attempts, err.message.slice(0, 500), item.conversation_id, item.due_at);
          }
        }
      }
    } finally {
      busy = false;
    }
  }

  return {
    enqueue: (conversationId, dueAt) => q.enqueue.run(String(conversationId), dueAt),
    has: (conversationId) => Boolean(q.has.get(String(conversationId))),
    processDue,
  };
}

module.exports = { createQueue };
