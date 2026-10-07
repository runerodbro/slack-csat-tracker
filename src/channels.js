// The posting channel and the 1–3 channel, changed from Slack with /csat here
// or the Home tab.

const CHANNEL_KEY = "slack_channel";
const NEGATIVE_CHANNEL_KEY = "negative_channel";

const CONFIRM = {
  [CHANNEL_KEY]: (user) => `✅ CSAT posts go to this channel from now on. Changed by <@${user}>.`,
  [NEGATIVE_CHANNEL_KEY]: (user) =>
    `✅ 1–3 ratings and break posts also go to this channel from now on. Changed by <@${user}>.`,
};

// Posts a visible confirmation in the new channel, which also proves the bot
// is in it, then saves it. Returns "ok", "not_in_channel", or "same_channel"
// when the other channel setting already uses it; the last two change nothing.
async function changeChannel({ slack, settings, getChannel, log = console }, channelId, userId, key = CHANNEL_KEY) {
  const other = key === CHANNEL_KEY ? settings.get(NEGATIVE_CHANNEL_KEY)?.value : getChannel();
  if (other && other === channelId) return "same_channel";
  try {
    await slack.post({ text: CONFIRM[key](userId) }, channelId);
  } catch (err) {
    if (/not_in_channel|channel_not_found/.test(err.message)) return "not_in_channel";
    throw err;
  }
  settings.set(key, channelId, userId);
  log.info(`${key} changed to ${channelId} by ${userId}`);
  return "ok";
}

module.exports = { CHANNEL_KEY, NEGATIVE_CHANNEL_KEY, changeChannel };
