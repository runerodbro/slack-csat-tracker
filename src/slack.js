// Slack Web API client: post and update messages, find users by email.

function createSlack({ token, channel, apiUrl, log = console }) {
  async function call(method, body) {
    const res = await fetch(`${apiUrl}/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
    if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
    return data;
  }

  const userIds = new Map();
  let lookupDisabled = false;
  // Returns a Slack user ID, or null if not found or the scope is missing.
  async function userIdByEmail(email) {
    if (!email || lookupDisabled) return null;
    if (userIds.has(email)) return userIds.get(email);
    const res = await fetch(`${apiUrl}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
    if (data.ok) {
      userIds.set(email, data.user.id);
      return data.user.id;
    }
    if (data.error === "users_not_found") {
      userIds.set(email, null);
    } else {
      lookupDisabled = data.error === "missing_scope";
      log.warn(`Slack users.lookupByEmail: ${data.error}`);
    }
    return null;
  }

  // Adds an emoji reaction. Needs the reactions:write scope; fails quietly without it.
  let reactDisabled = false;
  async function react(ts, name) {
    if (reactDisabled) return;
    try {
      await call("reactions.add", { channel, timestamp: ts, name });
    } catch (err) {
      if (err.message.includes("missing_scope")) reactDisabled = true;
      if (!err.message.includes("already_reacted")) log.warn(err.message);
    }
  }

  return {
    react,
    post: async (message) => (await call("chat.postMessage", { channel, unfurl_links: false, ...message })).ts,
    update: (ts, message) => call("chat.update", { channel, ts, ...message }),
    userIdByEmail,
  };
}

module.exports = { createSlack };
