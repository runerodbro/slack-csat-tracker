# slack-csat-tracker

Posts Intercom CSAT ratings to Slack, counts the streak of days with 100%
positive ratings, celebrates records, and sends a weekly report.

## What it does

### Rating posts

Each rating (1–5) is posted to Slack 5 minutes after it arrives, as a compact
list:

```
😃 Conversation rated
• Assignee: @Jane · Support Chat
• Customer: Name (email)
• Comment: "…"
• Topic: Bug / Troubleshooting › Aliases · Solved for the customer 🎉
```

The heading links to the conversation. The assignee is an @mention when the
email matches a Slack user, followed by the team inbox the conversation was
closed in. The comment and topic lines show only when there is something in
them. The post has 5 lines at most, because Slack folds longer posts behind
"Show more". A long comment or topic can still wrap and make Slack fold the
post; the comment comes before the topic, so its start stays visible.

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

### Team inbox

The team is the inbox the conversation was closed in: the last team it was
assigned to before the close. A move afterwards, such as a workflow that sends
negative ratings to an internal follow-up team, does not change it. Without a
team assignment in the history, the conversation's current team is used. In
Slack, colons in team names are shown as spaces ("Support: Chat" →
"Support Chat").

### Topic

The topic comes from the conversation attributes Category, Product Area and
Outcome, in this order: Category › Product Area · Outcome. An attribute
matches with or without a suffix in brackets, so "Category (Support)" and
"Product Area (Horizon)" count. If several match, the first filled one is
used. Values that are not set are left out.

If Intercom sets the attributes after the post went out, the hourly check
adds the topic to the post once.

### Missed ratings

Every hour the app asks Intercom for ratings from the last 3 days and
processes any that did not arrive.

### Home tab

Open the app in Slack to see its Home tab, with two buttons:

- **Overview**, for everyone: the streak, the record and when the streak
  started; this week so far (ratings, average, % positive, the split per
  score, per team inbox, and ratings closed by bots); the posting channel and
  the schedule. A dropdown sends a preview of any post to the app's Messages
  tab, with the same data as `/csat preview`.
- **Settings**: the posting channel and the app admins. Workspace admins and
  owners and the app admins can change them; everyone else sees them
  read-only.
  - Picking a new posting channel works like `/csat here`: the app posts a
    confirmation there. If the bot is not in the channel, nothing changes.
  - App admins can change settings and use `/csat here`. They can also add or
    remove app admins.

The Home tab is drawn again every time someone opens it, so the numbers are
current.

### `/csat` slash command

| Command | What it does |
|---|---|
| `/csat here` | Posts go to this channel from now on. Only workspace admins and owners, and the app admins. The bot must be in the channel; it posts a visible confirmation there. |
| `/csat status` | Shows the posting channel, who set it, the streak and the schedule. |
| `/csat preview` | Shows the streak post, with the list of previews under it. |
| `/csat preview <post>` | Shows any post, see below. Anyone can use it. |
| `/csat help` | Lists the commands. |

Previews show how each post looks, without waiting for it to happen. They use
real data: the latest rating of that kind, today's streak and this week's
numbers. Where there is no real example, they use made-up sample data. A
preview posts nothing to the channel and uses up no celebration.

| Post | Shows |
|---|---|
| `rating` | The latest 4–5 rating post |
| `negative` | The latest 1–3 rating post, one with a comment if there is one |
| `changed` | That rating as changed from 🤩 |
| `streak` | The morning streak post |
| `record` | The gold new record post: today's, or the day the streak beats the record |
| `celebration` | The record celebration with the streak's numbers and top agents |
| `milestone` | The celebration for today's or the next milestone |
| `break` | The latest streak break post |
| `restored` | That break post as restored |
| `weekly` | The weekly report for this week so far |

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
| `users:read`, `users:read.email` | @mentions and the admin check for `/csat here` and Settings |
| `reactions:write` | The celebration reactions |
| `commands` | `/csat` |

Missing optional scopes are skipped quietly. Invite the bot to the channel.

For `/csat`, create the slash command with the Request URL
`<app URL>/slack/commands`, and set `SLACK_SIGNING_SECRET` (Basic Information
→ App Credentials → Signing Secret). Without it the command and the Home tab
are off.

For the Home tab:

| Slack app page | Setting |
|---|---|
| App Home | Turn on the Home Tab and the Messages Tab. |
| Event Subscriptions | Turn on, Request URL `<app URL>/slack/events`, bot event `app_home_opened`. |
| Interactivity & Shortcuts | Turn on, Request URL `<app URL>/slack/interactions`. |

### Settings

Copy `.env.example` to `.env` and fill it in.

| Setting | |
|---|---|
| `INTERCOM_ACCESS_TOKEN`, `INTERCOM_CLIENT_SECRET` | Required. From the Intercom app. |
| `SLACK_BOT_TOKEN` | Required. |
| `SLACK_CHANNEL_ID` | Required. The default channel; `/csat here` overrides it. |
| `DB_PATH` | Where the database file is saved. |
| `SLACK_SIGNING_SECRET` | Turns on `/csat`. |
| `SLACK_ADMIN_USER_IDS` | Slack user IDs who are always app admins, besides the ones picked in Settings. |
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
| `classify` | Fills in who closed each saved rating, its team inbox and its topic, where the closer or team is missing. Add `--recheck-teams` to work out every rating's team and topic again. Safe to run again. |
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
