// Settings changed from Slack, stored in the settings table.

function createSettings(db) {
  const getRow = db.prepare("SELECT value, updated_by, updated_at FROM settings WHERE key = ?");
  const setRow = db.prepare(`
    INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, unixepoch())
    ON CONFLICT (key) DO UPDATE SET
      value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  return {
    get: (key) => getRow.get(key) || null,
    set: (key, value, updatedBy = null) => setRow.run(key, value, updatedBy),
  };
}

module.exports = { createSettings };
