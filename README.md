# slack-csat-tracker

Posts Intercom CSAT ratings to Slack, counts the streak of days with 100%
positive ratings, celebrates records, and sends a weekly report.

## What it does

- **Rating posts.** Each Intercom rating (1–5) is posted to Slack 5 minutes
  after it arrives, as a compact list like Supportman's: assignee (@mention
  when the email matches a Slack user), customer, rating emoji, the comment if
  there is one, and a link to the conversation. If the
  customer changes the rating within the 5 minutes, only the final rating is
  posted. If it changes later, the Slack message is updated.
- **Streak.** The number of days since the last day with a 1–3 rating. Days
  with no ratings count. A 1–3 rating on Tuesday gives a streak of 1 on
  Wednesday morning.
  - Morning post: Monday to Friday at 08:30 Copenhagen time, for example
    "🔥 CSAT streak: 296 days of 100% positive ratings", with the record and
    the date the streak started.
  - When the current streak is longer than the record, the post is gold and
    says "🏆 New record: 297 days of 100% positive ratings", with the number
    of days past the old record.
  - Big celebration on the first record post of a streak and on milestones
    (every 50 days, every full year): a large header that carries the message
    ("🏆 NEW RECORD: 297 days of 100% positive ratings" or "🎉 300 days of 100%
    positive ratings!"), statistics for the streak, thanks with @mentions of
    the 5 agents with the most ratings in the streak (ratings without an
    agent count in the statistics only), and 🎉🏆 reactions. It
    uses plain blocks, so Slack does not collapse it behind "Show more". A
    milestone on a weekend is celebrated on Monday.
  - A 1–3 rating posts "Streak has been broken 😭" after the 5-minute delay,
    with how long the streak lasted and whether it beat the record. Only the
    first 1–3 rating of a day posts this.
  - If a positive rating is changed to 1–3 later, the streak breaks then. If a
    1–3 rating is changed to positive, the break post is updated to "restored"
    and the streak is calculated again.
- **Weekly report.** Friday at 14:00 Copenhagen time, for Friday 14:00 to
  Friday 14:00: number of ratings, average, % positive, distribution, and the
  top 5 agents by number of ratings with average and % positive. Ratings
  without an agent count in the totals, not in the agent list.
- **Human ratings only.** A rating counts only when a human closed the
  conversation: Intercom asks for the rating at that close. The app takes the
  last close before the rating; closed by a teammate (`admin`) counts, closed
  by Fin, a renamed AI agent, a chatbot or a workflow (`bot`) does not. Those
  ratings are saved but get no Slack post and stay out of the streak, record,
  celebration and weekly numbers; the weekly report shows their count on one
  separate line. A rating with no close found counts as human.
- **Reconciliation.** Every hour the app asks Intercom for ratings from the
  last 3 days and processes any the webhook missed.
- **`/csat` slash command in Slack.**

  | Command | What it does |
  |---|---|
  | `/csat here` | Posts go to this channel from now on. Only workspace admins and owners, or people in `SLACK_ADMIN_USER_IDS`. The bot must be in the channel; it posts a visible confirmation there. |
  | `/csat status` | Shows the posting channel, who set it, the streak and the schedule. |
  | `/csat preview` | Shows the streak post, only to you. |
  | `/csat help` | Lists the commands. |

  Replies are only visible to the person who typed the command. After a
  channel change, updates to older messages (a changed rating, a restored
  break) still happen in the channel where those messages are.

### Side bar colors

| Post | Color |
|---|---|
| Rating 4–5, normal streak post | Green `#1F9D63` |
| Rating 1–3, streak broken | Imperial Red `#EE2737` |
| NEW RECORD | Gold `#D4A017` |
| Break restored | Gray 3 `#B6BBBF` |
| Weekly report, big celebration | No side bar (plain blocks, so Slack does not collapse them) |

Posts with a side bar put their notification text in the attachment's
`fallback`, so no extra line shows above the bar. Green and gold are outside
the iPaper palette by choice. Green has at least 3:1
contrast on Slack's light and dark theme; gold is fainter on the light theme.

### Schedule and restarts

Each scheduled post runs once per period. If the server was down at the
planned time, the post still goes out when it comes back inside the window:

| Post | Window |
|---|---|
| Morning streak | Monday–Friday 08:30–11:00 |
| Weekly report | Friday 14:00–18:00 |

So a start inside a window posts right away. Start the service outside these
windows if you do not want that.

## Requirements

- Node.js 22.13 or later. No npm packages; the app uses Node's built-in SQLite.
- **Intercom:** a private app in the Developer Hub with these scopes:
  Read conversations, Read admins, and Read one user and one company (or Read
  and list users and companies). Subscribe the app's webhook to
  `conversation.rating.added` with the URL
  `https://middleware.ipaperdemo.io/csat/webhooks/intercom`.
- **Slack:** an app with a bot token and these scopes: `chat:write`;
  `users:read` and `users:read.email` for @mentions and the admin check;
  `reactions:write` for the celebration reactions; `commands` for `/csat`.
  Invite the bot to the channel. Missing optional scopes are skipped quietly.
  For `/csat`: under **Slash Commands**, create `/csat` with the Request URL
  `https://middleware.ipaperdemo.io/csat/slack/commands`, and put the
  **Signing Secret** (Basic Information → App Credentials) in `.env` as
  `SLACK_SIGNING_SECRET`. Without it the command is off.

## Settings (`.env`)

See `.env.example`. Required: `INTERCOM_ACCESS_TOKEN`, `INTERCOM_CLIENT_SECRET`,
`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`, `DB_PATH`. Optional for `/csat`:
`SLACK_SIGNING_SECRET`, `SLACK_ADMIN_USER_IDS`.

`SLACK_CHANNEL_ID` is the default channel. A channel set with `/csat here` is
saved in the database and wins over it.

`STREAK_START_DATE` sets the first day the streak and record count from. Use it
to skip periods without real CSAT data. Without it, the app counts from the
oldest saved rating, and a period with no data looks like a long streak.
Production uses `STREAK_START_DATE=2023-10-01`, because February to October
2023 was a test of another CSAT method.

To change `.env` on the server, paste the whole file at once:

```bash
cat > /opt/csat/.env <<'EOF'
...all settings...
EOF
chown csat:csat /opt/csat/.env && chmod 600 /opt/csat/.env
systemctl restart csat
```

Start the paste with a space, so bash does not save the keys in its history.

## Server layout

| What | Where |
|---|---|
| Code | `/opt/csat` (outside the web root) |
| Settings | `/opt/csat/.env`, owner `csat`, mode 600 |
| Database | `/var/lib/csat/csat.db` |
| Backups | `/var/backups/csat`, nightly at 03:15, kept 14 days (`/etc/cron.d/csat-backup`) |
| Service | `csat` (systemd), runs as user `csat` |
| Apache | `/csat/` is forwarded to `127.0.0.1:3000` (`/etc/apache2/sites-available/000-default-le-ssl.conf`) |

### First setup

```bash
useradd --system --home /opt/csat --shell /usr/sbin/nologin csat
mkdir -p /var/lib/csat /var/backups/csat && chown csat:csat /var/lib/csat /var/backups/csat
cd /opt/csat
sudo -u csat node --env-file=.env --disable-warning=ExperimentalWarning src/db.js
sudo -u csat node --env-file=.env --disable-warning=ExperimentalWarning scripts/cli.js backfill 1095
cp deploy/csat.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now csat
```

Forward `/csat/` in Apache to the app. This adds the lines from
`deploy/apache-csat.conf` to the HTTPS site, makes a backup first, and puts
the backup back if the config test fails:

```bash
F=/etc/apache2/sites-available/000-default-le-ssl.conf
cp "$F" "$F.before-csat"
a2enmod -q proxy proxy_http
grep -q "ProxyPass /csat/" "$F" || awk '!done && /<\/VirtualHost>/ {
  print "    # CSAT app: forward /csat/ to the Node app on port 3000"
  print "    RedirectMatch 301 ^/csat$ /csat/"
  print "    ProxyPreserveHost On"
  print "    ProxyPass /csat/ http://127.0.0.1:3000/"
  print "    ProxyPassReverse /csat/ http://127.0.0.1:3000/"
  done = 1
} { print }' "$F.before-csat" > "$F"
apachectl configtest && systemctl reload apache2 || { cp "$F.before-csat" "$F"; echo "Config test failed. Old config restored."; }
```

Check with `curl https://middleware.ipaperdemo.io/csat/health` (expect `ok`).

### Deploy a new version

`/usr/local/bin/csat-deploy [branch]` (default `main`) checks out the latest
version of the branch in `/opt/csat` and restarts the service.

### Logs

```bash
journalctl -u csat -f
```

## Commands

Run on the server from `/opt/csat`, as the app user:

```bash
sudo -u csat node --env-file=.env --disable-warning=ExperimentalWarning scripts/cli.js <command>
```

| Command | What it does |
|---|---|
| `backfill [days]` | Imports ratings from the last N days (default 365) without Slack posts. Shows progress. Safe to run again. |
| `classify` | Checks who closed each saved rating that was not checked yet (one Intercom call each). Run once after updating; safe to run again. |
| `streak` | Prints the streak and record. No post. |
| `morning` | Posts the streak now. A test run does not use up a celebration. Add `--celebrate` to preview the big celebration (only while the streak is a record). |
| `weekly [YYYY-MM-DD]` | Posts the weekly report for the Friday given, default the last report Friday. |
| `reconcile` | Looks for ratings the webhook missed. |
| `post <conversation-id>` | Processes one conversation now. |

To post in a test channel, add `--channel=C0123` to the command. It wins over
the channel set with `/csat here`, for that one run only. The command prints
the channel it posts to.

Useful database queries:

```bash
# Ratings per month
sqlite3 -header -column /var/lib/csat/csat.db "SELECT strftime('%Y-%m', rated_at, 'unixepoch') AS month, COUNT(*) AS ratings, SUM(score <= 3) AS negative, ROUND(AVG(score), 2) AS avg FROM ratings GROUP BY month ORDER BY month;"
# Days with a 1–3 rating
sqlite3 -header -column /var/lib/csat/csat.db "SELECT date(rated_at, 'unixepoch') AS day, score FROM ratings WHERE score <= 3 ORDER BY rated_at;"
```

## Troubleshooting

| Error | Cause and fix |
|---|---|
| `node: .env: not found` | The command ran outside `/opt/csat`. Run `cd /opt/csat` first. |
| `Intercom ... 401 token_unauthorized` | The Intercom app misses a scope. Add it in the Developer Hub (see Requirements). |
| `Slack ...: not_in_channel` | Invite the bot to the channel. |
| `/csat` says "dispatch_failed" or "operation_timeout" | Slack can't reach the server. Check the Apache forwarding, the service, and the Request URL. |
| `/csat` does nothing and the log shows "bad signature" | `SLACK_SIGNING_SECRET` is wrong or missing. |
| A streak or record that looks too long | A period without CSAT data. Set `STREAK_START_DATE` after it. |

## Development

```bash
npm test
```

Tests use fake Intercom and Slack APIs and an in-memory database.

GitHub Actions runs `npm test` on Node 24 for every pull request and every push
to `main` (`.github/workflows/test.yml`). To block merging when tests fail, add
the `test` check as a required status check in the ruleset for `main`.
