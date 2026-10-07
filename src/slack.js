// Slack Web API client: post and update messages, find users, check request signatures.

const crypto = require("crypto");

// getChannel: returns the current posting channel. Posts return { ts, channel },
// and updates and reactions take the channel the message was posted in.
function createSlack({ token, getChannel, apiUrl, log = console }) {
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
  async function react(ts, name, channel) {
    if (reactDisabled) return;
    try {
      await call("reactions.add", { channel, timestamp: ts, name });
    } catch (err) {
      if (err.message.includes("missing_scope")) reactDisabled = true;
      if (!err.message.includes("already_reacted")) log.warn(err.message);
    }
  }

  async function userInfo(userId) {
    const res = await fetch(`${apiUrl}/users.info?user=${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
    if (!data.ok) throw new Error(`Slack users.info: ${data.error}`);
    return data.user;
  }

  async function post(message, channel = getChannel()) {
    const data = await call("chat.postMessage", { channel, unfurl_links: false, ...message });
    return { ts: data.ts, channel: data.channel || channel };
  }

  return {
    react,
    post,
    update: (ts, message, channel) => call("chat.update", { channel: channel || getChannel(), ts, ...message }),
    publishView: (userId, view) => call("views.publish", { user_id: userId, view }),
    userIdByEmail,
    userInfo,
  };
}

// Slack signs requests with HMAC-SHA256 over "v0:<timestamp>:<body>".
// Requests older than 5 minutes are rejected to stop replays.
function verifySlackSignature({ secret, rawBody, timestamp, signature, now = Date.now() / 1000 }) {
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(now - Number(timestamp)) > 300) return false;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

module.exports = { createSlack, verifySlackSignature };
