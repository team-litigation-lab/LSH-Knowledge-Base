# The projects, their checks, and the Gantt chart

## team-litigation-lab/Training-Portal

LSH Training Portal — Cloudflare Pages site (static HTML/CSS/JS at the root) plus Pages Functions
in `functions/` (API under `functions/api/`, shared middleware in the `_*.js` files). Simulators in
`simulators/`. Default branch `main`. Designated work branch `claude/great-ptolemy-3tezc3`.

`CODEMAP.md` is an inventory of every code file with line counts from the October 2026 audit — the
fastest way to spot a file that has appeared, grown oddly, or gone unreferenced. `README.md` and
`SIMULATORS.md` are the living feature docs.

Checks (mirror `.github/workflows/checks.yml`; run from the repo root with Node 22):

```
node .github/scripts/check-site.mjs        # JS syntax, local file references, JSON
node .github/scripts/batch.mjs
node --no-warnings .github/scripts/registration.mjs
node --no-warnings .github/scripts/front-door.mjs
node --no-warnings .github/scripts/master-control.mjs
node --no-warnings .github/scripts/admin-approval.mjs
node --no-warnings .github/scripts/ai-gateway.mjs
npx --yes wrangler@3 pages functions build --outdir /tmp/tp-dist   # build only, never deploy
```

The rest of `checks.yml` (the `smoke` job) needs Playwright and Chromium. Chromium is preinstalled at
`/opt/pw-browsers/chromium` — run a smoke script only when the change touches the pages it covers,
and never run `playwright install`.

## team-litigation-lab/LSH-Knowledge-Base

LSH Knowledge Base — a Cloudflare Worker: `src/index.js` (routes), `src/db.js` (D1), `src/files.js`
(R2), `src/util.js`. Tests in `tests/`, maintenance scripts in `scripts/`. Config in `wrangler.json`,
scripts in `package.json`. Default branch `claude/brave-newton-xors2t` (per `.github/workflows/checks.yml`;
confirm with `git remote show origin` before branching). Designated work branch
`claude/great-ptolemy-3tezc3`.

Checks:

```
npm ci
npx wrangler deploy --dry-run --outdir /tmp/kb-dist     # build only, never deploy
node tests/blueprint.cjs
node tests/paste-format.cjs
node tests/autoformat-body.cjs
```

The Node tests and `python tests/e2e.py` need the site running locally first:

```
npm run seed:local
echo "SESSION_SECRET=ci-secret" > .dev.vars
npx wrangler dev --port 8787 --ip 127.0.0.1 --var KB_CODE_LOGIN:on --var PORTAL_URL:http://127.0.0.1:8789 &
```

Shared with the Portal: single sign-on (`tests/portal.cjs`), the Blueprint engine, and a D1 database
whose schema changes must stay backward compatible with the Portal. A conflict between the two repos
belongs in both reports.

## The Gantt / Milestone chart

Title: `Web-Based_Platform_Project_Gantt_Chart_Oct2026_Baseline`. Sheets: `Gantt Chart` (the task
rows), `Monthly Progress Log`, `Settings & Calendar` (working-day inputs and the holiday table —
every projected date recalculates from these), `Required Columns Checklist`.

Write to `1C6CojhC_bxhyUtJgnO9M_jjyOWUehYxoxfbBYHST_DE` (owner `info@legalsupporthelp.com`,
`team-litigation@legalsupporthelp.com` has writer). That is the reporting copy: it carries the live
summary block and the Monthly Progress Log history. Confirm the ID still resolves each run:

```
search_files: title contains 'Gantt_Chart' and mimeType = 'application/vnd.google-apps.spreadsheet'
```

Other files share the title and are **not** interchangeable. In particular
`1q0nVZND_v9_9V1ItJBYD0jwXvmXAH-RHArk5iMkzZNM` is a different layout — a tab per project
(`Overview`, `Platforms & Links`, `Foundation Builds`, `LSH TRC Portal`, `New Training Programs`,
`Rollout & Handover`, `Reporting & Check-ins`) with a `Checklist` sheet driving each task's %. The
column map below does not apply to it. Never write to it on the strength of a title match; if it is
the one that should be updated, stop and ask, because the update protocol differs.

Column map on `Gantt Chart` (header row 8, task rows below): A WBS · B Priority / Topic ·
C Effort (hrs) · D Plan Start · E Actual Start · F Projected Timeline (working days) ·
G Projected End · H Status · I % Completion · J Challenges / Completion Blockers · K Finish Date ·
L Duration (formula) · M Plan End (baseline) · N onward the weekly grid (`◆` marks a milestone).
Summary block rows 5–6; `Report as of:` is E3.

Gantt colours, for reference: navy = Completed, orange = In Progress, purple = Testing Phase,
red = On Hold / Blocked, grey = Not Started.

Which rows this skill touches: the ones whose work the week's findings and fixes belong to — the
LSH TRC centralized portal rows, the CM System / Training CRM rows, the EA/PA program rows and the
Knowledge Base rows. Do not invent new WBS rows for a bug fix; a fix is progress on an existing row.
Add a row only for work that is genuinely a new workstream, and say so in the summary.
