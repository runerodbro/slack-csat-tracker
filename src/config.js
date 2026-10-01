// Reads settings from environment variables (loaded from .env by Node's --env-file).

const REQUIRED = ["INTERCOM_ACCESS_TOKEN", "INTERCOM_CLIENT_SECRET", "SLACK_BOT_TOKEN", "SLACK_CHANNEL_ID"];

function intercomAppUrl(apiUrl) {
  if (apiUrl.includes(".eu.")) return "https://app.eu.intercom.com";
  if (apiUrl.includes(".au.")) return "https://app.au.intercom.com";
  return "https://app.intercom.com";
}

function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const apiUrl = (env.INTERCOM_API_URL || "https://api.intercom.io").replace(/\/$/, "");
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || "127.0.0.1",
    timezone: env.TIMEZONE || "Europe/Copenhagen",
    postDelaySeconds: Number(env.POST_DELAY_SECONDS ?? 300),
    streakStartDate: env.STREAK_START_DATE || null,
    intercom: {
      token: env.INTERCOM_ACCESS_TOKEN,
      clientSecret: env.INTERCOM_CLIENT_SECRET,
      apiUrl,
      appUrl: env.INTERCOM_APP_URL || intercomAppUrl(apiUrl),
      workspaceId: env.INTERCOM_WORKSPACE_ID || null,
    },
    slack: {
      token: env.SLACK_BOT_TOKEN,
      // Default posting channel. `/csat here` in Slack overrides it.
      channel: env.SLACK_CHANNEL_ID,
      signingSecret: env.SLACK_SIGNING_SECRET || null,
      // People who may change settings with /csat, besides workspace admins and owners.
      adminUserIds: (env.SLACK_ADMIN_USER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
      apiUrl: (env.SLACK_API_URL || "https://slack.com/api").replace(/\/$/, ""),
    },
  };
}

module.exports = { loadConfig };
