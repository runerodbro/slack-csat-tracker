# slack-csat-tracker

Posts Intercom CSAT ratings to Slack, counts the streak of days with 100%
positive ratings, celebrates records, and sends a weekly report.

## What it does

### Rating posts

Each rating (1–5) is posted to Slack 5 minutes after it arrives, as a compact
list: a heading with the rating emoji that links to the conversation, then the
assignee (@mention when the email matches a Slack user), customer, the team
inbox the conversation is in, and the comment if there is one. The post stays
at 5 lines at most, because Slack folds longer posts behind "Show more".

- If the customer changes the rating within the 5 minutes, only the final
  rating is posted.
- If the rating changes later, the Slack message is updated.

### Streak

The streak is the number of days since the last day with a 1–3 rating. Days
with no ratings count. A 1–3 rating on Tuesday gives a streak of 1 on
Wednesday morning.

- **Morning post**, Monday to Friday at 08:30 Copenhagen time: "🔥 CSAT
  streak: 296 days of 100% positive ratings", with the record and the date the
  streak started.
- **New record:** when the current streak is longer than the record, the post
  is gold and says "🏆 New record: 297 days of 100% positive ratings", with the
  number of days past the old record.
- **Celebration** on the first record post of a streak and on milestones
  (every 50 days, every full year): a large header ("🏆 NEW RECORD: 297 days
  of 100% positive ratings" or "🎉 300 days of 100% positive ratings!"),
  statistics for the streak, thanks with @mentions of the 5 agents with the
  most ratings in the streak, and 🎉🏆 reactions. A milestone on a weekend is
  celebrated on Monday.
- **Streak broken:** a 1–3 rating posts "Streak has been broken 😭" after the
  5-minute delay, with how long the streak lasted and whether it beat the
  record. Only the first 1–3 rating of a day posts this.
- **Late changes:** if a positive rating is changed to 1–3 later, the streak
  breaks then. If a 1–3 rating is changed to positive, the break post is
  updated to "restored" and the streak is calculated again.

### Weekly report

Friday at 14:00 Copenhagen time, for Friday 14:00 to Friday 14:00: number of
ratings, average, % positive, the distribution, and the top 5 agents by number
of ratings with their average and % positive, and the same split by team
inbox, sorted by number of ratings ("No team" last). Ratings without an agent
count in the totals, not in the agent list.

### Human ratings only

A rating counts only when a human closed the conversation, because Intercom
asks for the rating at that close. The last close before the rating decides:

- Closed by a teammate: counts.
- Closed by Fin, a renamed AI agent, a chatbot or a workflow: saved, but no
  Slack post, and left out of the streak, record, celebration and weekly
  numbers. The weekly report shows these ratings on one separate line.
- No close found: counts as human.

### Missed ratings

Every hour the app asks Intercom for ratings from the last 3 days and
processes any that did not arrive.

### `/csat` slash command

| Command | What it does |
|---|---|
| `/csat here` | Posts go to this channel from now on. Only workspace admins and owners, or people in `SLACK_ADMIN_USER_IDS`. The bot must be in the channel; it posts a visible confirmation there. |
| `/csat status` | Shows the posting channel, who set it, the streak and the schedule. |
| `/csat preview` | Shows the streak post, only to you. |
| `/csat help` | Lists the commands. |

Replies are only visible to the person who typed the command. After a channel
change, updates to older messages still happen in the channel where those
messages are.

### Side bar colors

| Post | Color |
|---|---|
| Rating 4–5, normal streak post | Green |
| Rating 1–3, streak broken | Red |
| New record | Gold |
| Break restored | Gray |
| Weekly report, celebration | No side bar, so Slack never collapses them |

### Schedule

Each scheduled post goes out once per period. If the app was not running at
the planned time, the post goes out when it starts again inside the window:

| Post | Window |
|---|---|
| Morning streak | Monday–Friday 08:30–11:00 |
| Weekly report | Friday 14:00–18:00 |

## Setup

Needs Node.js 22.13 or later. No npm packages.

### Intercom

A private app in the Developer Hub with these scopes: Read conversations, Read
admins, and Read one user and one company (or Read and list users and
companies). Subscribe the webhook to `conversation.rating.added`, with the URL
`<app URL>/webhooks/intercom`.

### Slack

An app with a bot token and these scopes:

| Scope | For |
|---|---|
| `chat:write` | Posting (required) |
| `users:read`, `users:read.email` | @mentions and the admin check for `/csat here` |
| `reactions:write` | The celebration reactions |
| `commands` | `/csat` |

Missing optional scopes are skipped quietly. Invite the bot to the channel.

For `/csat`, create the slash command with the Request URL
`<app URL>/slack/commands`, and set `SLACK_SIGNING_SECRET` (Basic Information
→ App Credentials → Signing Secret). Without it the command is off.

### Settings

Copy `.env.example` to `.env` and fill it in.

| Setting | |
|---|---|
| `INTERCOM_ACCESS_TOKEN`, `INTERCOM_CLIENT_SECRET` | Required. From the Intercom app. |
| `SLACK_BOT_TOKEN` | Required. |
| `SLACK_CHANNEL_ID` | Required. The default channel; `/csat here` overrides it. |
| `DB_PATH` | Where the database file is saved. |
| `SLACK_SIGNING_SECRET` | Turns on `/csat`. |
| `SLACK_ADMIN_USER_IDS` | Slack user IDs who may run `/csat here`, besides workspace admins and owners. |
| `STREAK_START_DATE` | The first day the streak and record count from. Use it to skip periods without real CSAT data; otherwise a gap in the data looks like a long streak. |
| `TIMEZONE`, `POST_DELAY_SECONDS`, `INTERCOM_API_URL` | Optional. Defaults: Europe/Copenhagen, 300, US Intercom. |

### First run

1. `npm run db:init` creates the database.
2. `node --env-file=.env scripts/cli.js backfill 1095` imports 3 years of
   ratings without posting them, so the streak record is correct.
3. `npm start`

## Commands

```bash
node --env-file=.env scripts/cli.js <command>
```

| Command | What it does |
|---|---|
| `backfill [days]` | Imports ratings from the last N days (default 365) without Slack posts. Safe to run again. |
| `classify` | Fills in who closed each saved rating and its team inbox, where missing. Safe to run again. |
| `streak` | Prints the streak and record. No post. |
| `morning` | Posts the streak now. A test run does not use up a celebration. Add `--celebrate` to preview the celebration. |
| `weekly [YYYY-MM-DD]` | Posts the weekly report for the Friday given, by default the last one. |
| `reconcile` | Looks for missed ratings. |
| `post <conversation-id>` | Processes one conversation now. |

Add `--channel=C0123` to post in a test channel for that one run. Each command
prints the channel it posts to.

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `Intercom ... 401 token_unauthorized` | The Intercom app misses a scope. |
| `Slack ...: not_in_channel` | Invite the bot to the channel. |
| `/csat` says "dispatch_failed" | Slack can't reach the app. Check the Request URL and that the app runs. |
| "bad signature" in the log | `SLACK_SIGNING_SECRET` or `INTERCOM_CLIENT_SECRET` is wrong. |
| A streak or record looks too long | A period without CSAT data. Set `STREAK_START_DATE` after it. |

## Development

```bash
npm test
```

Tests use fake Intercom and Slack APIs and an in-memory database. GitHub
Actions runs them on Node 24 for every pull request.
