// Who may change the app's settings: Slack workspace admins and owners, the
// app admins picked in the Home tab, and SLACK_ADMIN_USER_IDS from .env.

const APP_ADMINS_KEY = "app_admins";

function createAccess({ slack, settings, config, log = console }) {
  function appAdmins() {
    try {
      const ids = JSON.parse(settings.get(APP_ADMINS_KEY)?.value || "[]");
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  }

  async function canEdit(userId) {
    if (!userId) return false;
    if (config.slack.adminUserIds.includes(userId) || appAdmins().includes(userId)) return true;
    try {
      const user = await slack.userInfo(userId);
      return Boolean(user.is_admin || user.is_owner || user.is_primary_owner);
    } catch (err) {
      log.warn(err.message);
      return false;
    }
  }

  function setAppAdmins(ids, updatedBy) {
    settings.set(APP_ADMINS_KEY, JSON.stringify([...new Set(ids)]), updatedBy);
  }

  return { canEdit, appAdmins, setAppAdmins, appAdminsRow: () => settings.get(APP_ADMINS_KEY) };
}

module.exports = { createAccess, APP_ADMINS_KEY };
