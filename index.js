// Entry point: HTTP server for Intercom webhooks plus the scheduler.
// Start with: node --env-file=.env index.js

const { loadConfig } = require("./src/config");
const { createApp } = require("./src/app");
const { createServer } = require("./src/server");
const { createScheduler } = require("./src/scheduler");

const config = loadConfig();
const app = createApp(config);
const server = createServer({ intercom: app.intercom, queue: app.queue, config });
const scheduler = createScheduler({ db: app.db, clock: app.clock, jobs: app.jobs, queue: app.queue });

server.listen(config.port, config.host, () => {
  console.log(`Listening on ${config.host}:${config.port} (time zone ${config.timezone})`);
  scheduler.start();
});

function shutdown() {
  scheduler.stop();
  server.close(() => {
    app.db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
