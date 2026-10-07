// The posting channel, changed from Slack with /csat here or the Home tab.

const CHANNEL_KEY = "slack_channel";

// Posts a visible confirmation in the new channel, which also proves the bot
// is in it, then saves it. Returns "ok", or "not_in_channel" and changes nothing.
async function changeChannel({ slack, settings, log = console }, channelId, userId) {
  try {
    await slack.post({ text: `✅ CSAT posts go to this channel from now on. Changed by <@${userId}>.` }, channelId);
  } catch (err) {
    if (/not_in_channel|channel_not_found/.test(err.message)) return "not_in_channel";
    throw err;
  }
  settings.set(CHANNEL_KEY, channelId, userId);
  log.info(`Posting channel changed to ${channelId} by ${userId}`);
  return "ok";
}

module.exports = { CHANNEL_KEY, changeChannel };
