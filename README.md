# Handover: bus-factor radar and instant handover kit

Handover finds the people your team cannot afford to lose (knowledge silos) from Jira, Confluence and Teamwork Graph activity, and when someone is about to be away it builds the handover for you: in-flight work with next steps, decisions buried in comments, key pages, who to ask instead and open risks. The kit becomes a Confluence page plus Jira follow-up tasks. A weekly report nudges pairing before anyone leaves.

Built for Atlassian Codegeist 2026 on Forge. Category: Apps for Business Teams / Software Teams.

## What is in the app

| Surface | What it does |
|---|---|
| Jira global page "Handover" (UI Kit) | Radar (risk per area, who-knows-what matrix), People (exposure), Handover kit (preview, publish), Settings |
| Rovo agent "Handover" | Chat with the silo report, ask for a person's footprint, a backup for an area, or a full handover kit. Publishing needs an explicit yes. |
| `rovo:mcp` "Handover MCP" | Exposes the same six actions as MCP tools for any MCP client (see `skill.md`) |
| Teamwork Graph | Curated queries `atlassianUserAssignedJiraWorkItems` cross-check ownership ("graph-confirmed") |
| Weekly scheduled trigger | Recomputes, updates the "Weekly Silo Report" Confluence page, creates up to three pairing tasks |

Actions (used by the agent and MCP): `get-silo-report`, `get-person-footprint`, `get-handover-kit`, `publish-handover-kit`, `get-backup-for-area`, `set-absence`.

## How the score works

Touch events per person and area (Jira assignee 3, reporter 1, comment 1.5, Confluence page creator 3, version 1, named owner 4) decay with a 60 day half-life. **Bus factor** is the smallest group that holds more than half of an area's knowledge. **Silo risk** (0 to 100) is criticality (open and high priority work, recent activity) multiplied by concentration. A top owner who is away raises the risk. Areas are Jira components (or `area:<name>` labels); Confluence pages join an area through a label with the same name; page owners come from an `Owner:` line with an @mention.

## Install and try (judges)

1. Open the installation link from the Devpost submission and install into a site that has **Jira and Confluence** (Jira is required, Confluence is optional but needed for page analysis and publishing).
2. In Jira open **Apps > Handover**. The first time, click **Allow access** and accept the permissions (the app reads Jira and Confluence as you and writes only when you press Publish).
3. Go to **Settings**. Set Jira project keys and Confluence space keys (empty means everything you can see). Press **Ignore my own account** if you are an admin who is not part of the team. Turn on **Teamwork Graph** to show graph-confirmed badges. Save.
4. Open **Radar** and press **Analyse now**.
5. Components are the areas. If your issues have no components, add `area:payments` style labels or components first. Pages join an area through a label with the same name (for example `payments-core`).
6. Try **People > Handover kit**, choose dates, **Preview kit**, then **Publish**. A Confluence page and Jira tasks are created and the absence is recorded.
7. Rovo chat: open the Handover agent and ask "Which areas are a single point of failure?" or "Build a handover kit for <name> next week".
8. **Settings > Run weekly report now** publishes the weekly page and pairing tasks. **Test agent actions** and **Check access** are built-in diagnostics.

Demo video and install link: see the Devpost submission.

Demo data used in the video: `scripts/seed-users.mjs`, `seed-data.mjs`, `seed-pages.mjs` (project NWP, 74 issues, 14 pages, five people). Reset with `scripts/reset-demo.mjs`.

## Permissions

`read:jira-work`, `write:jira-work` (follow-up tasks and optional comments), `read:jira-user` (names), `read:page:confluence`, `read:label:confluence`, `read:space:confluence`, `write:page:confluence` (kit and weekly pages), `read:graph:issue:jira`, `read:graph:user:atlassian`, `read:graph:page:confluence` (Teamwork Graph), `storage:app` (settings, snapshot, absences). No external egress, no data leaves Atlassian.

## License

MIT, see LICENSE.

## Development

```
npm install
npm test            # unit tests for scoring, kit building, names, rendering
forge lint && forge deploy -e development
forge install --upgrade -p Jira -s <site> -e development
forge install -p Confluence -s <site> -e development
SITE=<your-site>.atlassian.net node scripts/local-run.mjs snapshot   # run the real engine from your machine (FORGE_EMAIL / FORGE_API_TOKEN env vars)
```

Structure: `src/engine/` (pure logic: collect, score, kit, publish, twg), `src/core.js` (use-cases shared by UI, agent, MCP and the weekly job), `src/index.js` (resolver, actions, triggers), `src/frontend/index.jsx` (UI Kit), `resource/agent/prompts` (agent prompt).
