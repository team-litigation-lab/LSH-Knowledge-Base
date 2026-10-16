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

Owned by the `gantt-chart-update` skill: the file ID, the column map, the status values and the write
rules all live there. Invoke it for phase 5 rather than writing the sheet from here.

What this skill is responsible for is the *input* to it: which rows the week's work belongs to, what
moved and on what evidence, and the live blockers. Training-Portal work lands on the LSH TRC Portal
and Foundation Builds rows; LSH-Knowledge-Base work lands on the LSH TRC Portal and Knowledge Base
rows. A fix is progress on an existing row — never a new WBS row.
