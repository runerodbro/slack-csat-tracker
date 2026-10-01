// Run a job by hand. Examples:
//   node --env-file=.env scripts/cli.js backfill 365   import history, no Slack posts
//   node --env-file=.env scripts/cli.js classify       check who closed each saved rating
//   node --env-file=.env scripts/cli.js streak         print the streak, no Slack post
//   node --env-file=.env scripts/cli.js morning        post the streak message now
//   node --env-file=.env scripts/cli.js weekly [YYYY-MM-DD]   post the weekly report now
//   node --env-file=.env scripts/cli.js reconcile      look for missed ratings
//   node --env-file=.env scripts/cli.js post <conversation-id>   process one conversation now
//
// To post in a test channel: add --channel=C0123, for example
//   node --env-file=.env scripts/cli.js morning --channel=C0123
// SLACK_CHANNEL_ID=C0123 in front of the command still works too.
// morning --celebrate previews the big celebration post.

const fs = require("fs");
const util = require("util");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");

// A channel given for this run only. Without it, posts go to the channel set
// with /csat here, or to SLACK_CHANNEL_ID in .env.
function channelOverride(argv) {
  const flag = argv.find((a) => a.startsWith("--channel="));
  if (flag) return flag.slice("--channel=".length);
  // SLACK_CHANNEL_ID=... in front of the command: differs from the value in .env.
  try {
    const fromFile = util.parseEnv(fs.readFileSync(".env", "utf8")).SLACK_CHANNEL_ID;
    if (process.env.SLACK_CHANNEL_ID && process.env.SLACK_CHANNEL_ID !== fromFile) return process.env.SLACK_CHANNEL_ID;
  } catch {}
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const [command, arg] = argv.filter((a) => !a.startsWith("--"));
  const app = createApp(loadConfig(), { channelOverride: channelOverride(argv) });
  if (["morning", "weekly", "post", "reconcile"].includes(command)) console.log(`Posting to channel ${app.getChannel()}`);
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
    case "classify": {
      console.log("Checking who closed each saved rating...");
      const counts = await app.jobs.classify({
        onProgress: (c) => console.log(`  ${c.checked}/${c.total} checked: ${c.human} human, ${c.bot} bot, ${c.unknown} unknown`),
      });
      console.log(counts);
      console.log({ startDate: app.ratings.streakStartDate(), ...app.ratings.currentStreak() });
      break;
    }
    case "streak":
      console.log({ startDate: app.ratings.streakStartDate(), ...app.ratings.currentStreak() });
      break;
    case "morning":
      // A test run does not use up the celebration for the real morning post.
      // --celebrate previews the big celebration (only while the streak is a record).
      console.log(await app.jobs.morning(undefined, { remember: false, forceCelebration: argv.includes("--celebrate") }));
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
      console.log("Commands: backfill [days], classify, streak, morning, weekly [YYYY-MM-DD], reconcile, post <id>");
      process.exitCode = 1;
  }
  app.db.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
