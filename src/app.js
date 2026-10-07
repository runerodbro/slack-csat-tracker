// Builds all parts of the app from the config.

const { open } = require("./db");
const { makeClock } = require("./time");
const { createIntercom } = require("./intercom");
const { createSlack } = require("./slack");
const { createRatings } = require("./ratings");
const { createQueue } = require("./queue");
const { createJobs } = require("./jobs");
const { createSettings } = require("./settings");
const { createCommands } = require("./commands");
const { CHANNEL_KEY } = require("./channels");
const { createAccess } = require("./access");
const { createHome } = require("./home");
const { createPrefs } = require("./prefs");
const { createPreviews } = require("./previews");

// channelOverride: post everything in this channel (test runs from the CLI).
function createApp(config, { db = open(), log = console, channelOverride = null } = {}) {
  const clock = makeClock(config.timezone);
  const intercom = createIntercom(config.intercom);
  const settings = createSettings(db);
  // Messages posted before channels were stored went to the .env channel.
  db.prepare("UPDATE ratings SET slack_channel = ? WHERE slack_ts IS NOT NULL AND slack_channel IS NULL").run(config.slack.channel);
  db.prepare("UPDATE streak_breaks SET slack_channel = ? WHERE slack_ts IS NOT NULL AND slack_channel IS NULL").run(config.slack.channel);
  const getChannel = () => channelOverride || settings.get(CHANNEL_KEY)?.value || config.slack.channel;
  const slack = createSlack({ ...config.slack, getChannel, log });
  const prefs = createPrefs(settings);
  const ratings = createRatings({ db, intercom, slack, clock, config, prefs, log });
  const queue = createQueue({ db, handler: (id) => ratings.processConversation(id), log });
  const jobs = createJobs({ db, intercom, slack, clock, ratings, queue, log });
  const previews = createPreviews({ db, ratings, jobs, intercom, slack, clock });
  const access = createAccess({ slack, settings, config, log });
  const commands = createCommands({ slack, settings, ratings, previews, access, getChannel, clock, config, log });
  const home = createHome({ slack, settings, ratings, jobs, previews, access, prefs, clock, config, getChannel, log });
  return { db, clock, intercom, slack, settings, prefs, ratings, queue, jobs, commands, home, access, getChannel };
}

module.exports = { createApp };
