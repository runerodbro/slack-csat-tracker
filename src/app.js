// Builds all parts of the app from the config.

const { open } = require("./db");
const { makeClock } = require("./time");
const { createIntercom } = require("./intercom");
const { createSlack } = require("./slack");
const { createRatings } = require("./ratings");
const { createQueue } = require("./queue");
const { createJobs } = require("./jobs");
const { createSettings } = require("./settings");
const { createCommands, CHANNEL_KEY } = require("./commands");

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
  const ratings = createRatings({ db, intercom, slack, clock, config, log });
  const queue = createQueue({ db, handler: (id) => ratings.processConversation(id), log });
  const jobs = createJobs({ db, intercom, slack, clock, ratings, queue, log });
  const commands = createCommands({ slack, settings, ratings, clock, config, log });
  return { db, clock, intercom, slack, settings, ratings, queue, jobs, commands, getChannel };
}

module.exports = { createApp };
