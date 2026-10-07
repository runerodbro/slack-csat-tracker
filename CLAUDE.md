# Notes for Claude

## Internal wiki

Server setup, paths, deploy steps, backups and other infrastructure details
are documented in the internal Confluence wiki ("CSAT Streak Counter: setup
and operations"), not in this repository. Keep them out of this repo: it is
public.

When a change affects anything the wiki describes, remind the maintainer to
update the wiki, and list the exact changes in the pull request under
"Wiki update". That includes:

- server setup, paths, the systemd unit, Apache, backups or the deploy script
- settings in `.env` (new, renamed or removed)
- Intercom or Slack app setup: scopes, webhook, slash command
- CLI commands, operations or troubleshooting steps
- behaviour the wiki explains under "Decisions and history"

If nothing in the wiki changes, write "None" under "Wiki update".

## Working on this repo

- Before building, list the decisions and open questions for a change and get
  the maintainer's answer. Do not pick a default and build on it; this
  includes layout, behaviour, naming and what to leave out.
- When the maintainer has to run something (deploy, CLI commands, checks on
  the server), give the full, exact command in that message, every time. Never
  refer to a command from earlier in the conversation; it can't be found again
  in a long conversation.
- Every change goes through a pull request; `main` requires the `test` check.
  Pull requests are squash merged.
- Run `npm test` before pushing, and commit only when it passes.
- Update `README.md` in the same pull request when behaviour, settings or
  commands change. The README covers functionality and guidance only.
