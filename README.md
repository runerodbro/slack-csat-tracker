# slack-csat-tracker

Posts Intercom CSAT ratings to Slack, keeps a streak of days without negative
ratings, and sends a weekly report.

## What it does

- **Rating posts.** Each Intercom rating (1–5) is posted to Slack 5 minutes
  after it arrives, with assignee, customer, rating, comment and a link to the
  conversation. If the customer changes the rating within the 5 minutes, only
  the final rating is posted. If it changes later, the Slack message is updated.
- **Streak.** The streak is the number of days since the last day with a
  negative rating (1–3). Days with no ratings count. A negative rating on
  Tuesday gives a streak of 1 on Wednesday morning.
  - Morning post: Monday to Friday at 08:30 Copenhagen time, with the record
    and **NEW RECORD** (gold) when the current streak beats it.
  - Big celebration on the first record post of a streak and on milestones
    (every 50 days, every full year): header, streak statistics, thanks with
    @mentions of the top 5 agents in the streak, and 🎉🏆 reactions.
  - A negative rating posts "Streak has been broken 😭" at once (after the
    5-minute delay), with the length and whether it beat the record. Only the
    first negative rating of a day posts this.
  - If a positive rating is changed to negative later, the streak breaks then.
    If a negative rating is changed to positive, the break message is updated
    and the streak is calculated again.
- **Weekly report.** Friday at 14:00 Copenhagen time, for Friday 14:00 to
  Friday 14:00: number of ratings, average, % positive, distribution, and the
  top 5 agents by number of ratings with average and % positive.
- **Reconciliation.** Every hour the app asks Intercom for ratings from the
  last 3 days and processes any the webhook missed.

## Setup

Needs Node.js 22.13 or later. No npm packages; it uses Node's built-in SQLite.

1. `cp .env.example .env` and fill it in.
2. `npm run db:init` creates the database.
3. Import history so the streak record is correct:
   `node --env-file=.env scripts/cli.js backfill 365`
4. `npm start`

Intercom: subscribe the app's webhook to `conversation.rating.added` with the
URL `https://<host>/csat/webhooks/intercom`.

Slack: the bot needs `chat:write`. Add `users:read` and `users:read.email` to
@mention agents, and `reactions:write` for the celebration reactions. Invite
the bot to the channel.

Server files: `deploy/csat.service` (systemd) and `deploy/nginx-csat.conf`.

## Commands

```
node --env-file=.env scripts/cli.js streak              # print the streak, no post
node --env-file=.env scripts/cli.js morning             # post the streak now
node --env-file=.env scripts/cli.js weekly [YYYY-MM-DD] # post the weekly report now
node --env-file=.env scripts/cli.js reconcile           # look for missed ratings
node --env-file=.env scripts/cli.js post <id>           # process one conversation now
npm test
```

Set `SLACK_CHANNEL_ID=C0123` in front of a command to post in a test channel.
