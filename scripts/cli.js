// Run a job by hand. Examples:
//   node --env-file=.env scripts/cli.js backfill 365   import history, no Slack posts
//   node --env-file=.env scripts/cli.js streak         print the streak, no Slack post
//   node --env-file=.env scripts/cli.js morning        post the streak message now
//   node --env-file=.env scripts/cli.js weekly [YYYY-MM-DD]   post the weekly report now
//   node --env-file=.env scripts/cli.js reconcile      look for missed ratings
//   node --env-file=.env scripts/cli.js post <conversation-id>   process one conversation now
//
// To test in another channel: SLACK_CHANNEL_ID=C0123 node --env-file=.env scripts/cli.js morning

const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");

async function main() {
  const [command, arg] = process.argv.slice(2);
  const app = createApp(loadConfig());
  switch (command) {
    case "backfill": {
      const days = Number(arg || 365);
      console.log(`Importing ratings from the last ${days} days...`);
      const saved = await app.jobs.backfill({
        days,
        onProgress: ({ seen, saved }) => console.log(`  ${seen} conversations checked, ${saved} new ratings saved`),
      });
      console.log(`Saved ${saved} ratings from the last ${days} days.`);
      console.log(app.ratings.currentStreak());
      break;
    }
    case "streak":
      console.log({ startDate: app.ratings.streakStartDate(), ...app.ratings.currentStreak() });
      break;
    case "morning":
      // A test run does not use up the celebration for the real morning post.
      console.log(await app.jobs.morning(undefined, { remember: false }));
      break;
    case "weekly":
      console.log(await app.jobs.weekly(arg));
      break;
    case "reconcile":
      console.log(`Found ${await app.jobs.reconcile()} new or changed ratings.`);
      break;
    case "post":
      if (!arg) throw new Error("Usage: post <conversation-id>");
      console.log(await app.ratings.processConversation(arg));
      break;
    default:
      console.log("Commands: backfill [days], streak, morning, weekly [YYYY-MM-DD], reconcile, post <id>");
      process.exitCode = 1;
  }
  app.db.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
