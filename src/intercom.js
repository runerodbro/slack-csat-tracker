// Intercom REST API client and webhook signature check.

const crypto = require("crypto");

const API_VERSION = "2.11";
const ADMIN_CACHE_MS = 60 * 60 * 1000;
const ADMIN_MISS_REFRESH_MS = 5 * 60 * 1000;

function createIntercom({ token, clientSecret, apiUrl, appUrl, workspaceId }) {
  async function request(method, path, body) {
    const res = await fetch(apiUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Intercom-Version": API_VERSION,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Intercom ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }

  let admins = null;
  let adminsLoadedAt = 0;
  async function getAdmin(id) {
    if (id == null) return null;
    const age = Date.now() - adminsLoadedAt;
    if (!admins || age > ADMIN_CACHE_MS || (!admins.has(String(id)) && age > ADMIN_MISS_REFRESH_MS)) {
      const data = await request("GET", "/admins");
      admins = new Map((data.admins || []).map((a) => [String(a.id), a]));
      adminsLoadedAt = Date.now();
    }
    return admins.get(String(id)) || null;
  }

  let teams = null;
  let teamsLoadedAt = 0;
  // Team inbox by ID, from the team list (cached like admins). null if unknown.
  async function loadTeams() {
    const data = await request("GET", "/teams");
    teams = new Map((data.teams || []).map((t) => [String(t.id), t]));
    teamsLoadedAt = Date.now();
  }

  async function getTeam(id) {
    if (id == null) return null;
    const age = Date.now() - teamsLoadedAt;
    if (!teams || age > ADMIN_CACHE_MS || (!teams.has(String(id)) && age > ADMIN_MISS_REFRESH_MS)) await loadTeams();
    return teams.get(String(id)) || null;
  }

  // All team inboxes, from the same cached list.
  async function listTeams() {
    if (!teams || Date.now() - teamsLoadedAt > ADMIN_CACHE_MS) await loadTeams();
    return [...teams.values()];
  }

  // Yields closed conversations whose last close was in [start, end) (Unix seconds).
  async function* searchClosed(start, end) {
    let startingAfter;
    do {
      const data = await request("POST", "/conversations/search", {
        query: {
          operator: "AND",
          value: [
            { field: "statistics.last_close_at", operator: ">", value: start - 1 },
            { field: "statistics.last_close_at", operator: "<", value: end },
            { field: "state", operator: "=", value: "closed" },
          ],
        },
        pagination: { per_page: 150, ...(startingAfter && { starting_after: startingAfter }) },
      });
      for (const conversation of data.conversations || []) yield conversation;
      const next = data.pages?.next?.starting_after;
      startingAfter = next && next !== startingAfter ? next : null;
    } while (startingAfter);
  }

  let appId = workspaceId;
  async function conversationUrl(id) {
    if (!appId) appId = (await request("GET", "/me")).app?.id_code;
    return `${appUrl}/a/inbox/${appId}/inbox/conversation/${id}`;
  }

  // Yields conversations whose rating was given after `since` (Unix seconds).
  async function* searchRated(since) {
    let startingAfter;
    do {
      const data = await request("POST", "/conversations/search", {
        query: { field: "conversation_rating.replied_at", operator: ">", value: since },
        pagination: { per_page: 150, ...(startingAfter && { starting_after: startingAfter }) },
      });
      for (const conversation of data.conversations || []) yield conversation;
      const next = data.pages?.next?.starting_after;
      startingAfter = next && next !== startingAfter ? next : null; // stop if the cursor repeats
    } while (startingAfter);
  }

  // Intercom signs the raw body with HMAC-SHA1 and the app's client secret.
  function verifySignature(rawBody, header) {
    if (!header || !header.startsWith("sha1=")) return false;
    const expected = crypto.createHmac("sha1", clientSecret).update(rawBody).digest("hex");
    const given = header.slice(5);
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }

  return {
    getConversation: (id) => request("GET", `/conversations/${encodeURIComponent(id)}`),
    getContact: (id) => request("GET", `/contacts/${encodeURIComponent(id)}`),
    getAdmin,
    getTeam,
    listTeams,
    searchClosed,
    conversationUrl,
    searchRated,
    verifySignature,
  };
}

module.exports = { createIntercom };
