// Builds all parts of the app from the config.

const { open } = require("./db");
const { makeClock } = require("./time");
const { createIntercom } = require("./intercom");
const { createSlack } = require("./slack");
const { createRatings } = require("./ratings");
const { createQueue } = require("./queue");
const { createJobs } = require("./jobs");

function createApp(config, { db = open(), log = console } = {}) {
  const clock = makeClock(config.timezone);
  const intercom = createIntercom(config.intercom);
  const slack = createSlack({ ...config.slack, log });
  const ratings = createRatings({ db, intercom, slack, clock, config, log });
  const queue = createQueue({ db, handler: (id) => ratings.processConversation(id), log });
  const jobs = createJobs({ db, intercom, slack, clock, ratings, queue, log });
  return { db, clock, intercom, slack, ratings, queue, jobs };
}

module.exports = { createApp };
