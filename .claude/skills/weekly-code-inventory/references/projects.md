# The LSH platform: every repository, its checks, and the Gantt chart

Eleven repositories under `team-litigation-lab`, all Cloudflare (Workers or Pages), all sharing one
account: one request allowance, one Gemini key pool and budget, one D1 login database, and one
single-sign-on secret. That sharing is why a change in one repo can break another, and why the
cross-repo pass below matters more than it looks.

Work every repo on branch `claude/great-ptolemy-3tezc3`, created from its default branch, which is
`main` everywhere **except** `LSH-Knowledge-Base` (see its row). Never open a pull request unless
asked.

## What they are

| Repository | What it is | Entry points |
|---|---|---|
| `Training-Portal` | **The hub.** Cloudflare Pages: static HTML/CSS/JS at the root, Pages Functions in `functions/`, simulators in `simulators/`. Issues the SSO tickets every other site trusts, and owns the AI gateway and its budget. | `functions/api/*`, `app.js`, `portal.js`, `CODEMAP.md` |
| `LSH-Knowledge-Base` | The VA library. A Worker: routes, D1, R2. | `src/index.js`, `src/db.js`, `src/files.js` |
| `Foundational-Training` | Standard Training program. Worker + a large single-page app, `js/ft-*.js` modules. | `worker.js`, `index.html`, `js/` |
| `EA-PA-TRAINING` | EA/PA Upskill, the 10-day portal. Same engine as Foundational. | `worker.js`, `index.html`, `js/` |
| `Case-Management-Training` | CM course. Built from the EA/PA engine (`build-from-eapa.yml`). | `worker.js`, `index.html`, `js/cm-*.js` |
| `CaseManagementTraining` | **Different thing, confusingly similar name:** the Training CRM / CMS that trainees practise in. Pages, many top-level modules. | `app.js`, `index.html`, `functions/` |
| `Training-Interface` | A single page; thin front end. | `index.html` |
| `propertydamageclaimstraining` | PD Claims program. Same engine as Foundational. | `worker.js`, `index.html` |
| `medsumanddemandtraining` | MedSum & Demand program. Same engine as Foundational. | `worker.js`, `index.html`, `js/md-*.js` |
| `lshringchannel` | The practice phone. The only repo with a `package.json` and a real test runner. | `wrangler.json`, `tests/run.sh` |
| `Training-Directory` | A single page listing the programs. | `index.html`, `apps.js` |

The two case-management repos are the trap: `Case-Management-Training` (hyphens) is the **course**,
`CaseManagementTraining` (no hyphens) is the **CRM**. Read the entry points before you edit either.

## Checks

Nearly every program repo follows the same convention, so run what exists rather than assuming:

```
node .github/scripts/check-site.mjs      # JS syntax, local file references, JSON — in every program repo
node .github/scripts/batch-id.cjs        # Batch IDs are B + MMDDYY
node .github/scripts/sso.cjs             # the Portal is the only way in; a missing PORTAL_SSO_SECRET says so
node .github/scripts/check-data.mjs      # documents/handouts exist and references resolve (PD, MedSum, CMS)
```

A reliable way to run the right set for whatever repo you are in:

```
for f in .github/scripts/*.mjs .github/scripts/*.cjs; do [ -f "$f" ] && echo "== $f" && node --no-warnings "$f" || true; done
```

Per-repo additions worth knowing:

- **Training-Portal** — ten node gates plus a Playwright `smoke` job; full list in `checks.yml`. Build
  with `npx --yes wrangler@3 pages functions build --outdir "$TMPDIR/dist"`. Never deploy.
- **LSH-Knowledge-Base** — default branch is **`claude/brave-newton-xors2t`**, not `main`. Needs
  `npm ci`, then `npm run seed:local` into **fresh** state (`rm -rf .wrangler` first — the seeds are
  not re-runnable and a second seed fails on a UNIQUE constraint), then `npx wrangler dev`. Suites:
  `tests/e2e.py` (52 assertions), `blueprint.cjs`, `paste-format.cjs`, `autoformat-body.cjs`,
  `portal.cjs`. Build: `npx wrangler deploy --dry-run`.
- **Foundational-Training** — also `gemini-keys.mjs`; `r2-docs.yml` is a separate workflow.
- **EA-PA-TRAINING** — also `storage.mjs` (progress in R2, the rest in KV); `backup.yml` is separate.
- **Case-Management-Training** — also `tool-links.cjs`; it is generated from EA/PA, so a fix belonging
  to the shared engine goes to EA/PA, not here, or the next build overwrites it.
- **CaseManagementTraining** — `check-data.mjs`, `call-ai.mjs`, `library-photos.mjs`; `migrate-d1.yml`
  is separate and touches the shared database — never run it as part of an audit.
- **lshringchannel** — `npm run check` to build, `bash tests/run.sh` for the browser tests.
- **Training-Interface**, **Training-Directory** — no CI. Check them by syntax (`node --check`) and
  with the request probe.

Chromium is preinstalled at `/opt/pw-browsers/chromium`; never run `playwright install`.

## The cross-repo pass

Because these sites share infrastructure, check each week:

- **The shared D1 login database.** A schema change must stay backward compatible with every reader:
  Training-Portal, the CRM, and each course.
- **Single sign-on.** Ticket format, TTL and single-use semantics live in Training-Portal
  (`functions/api/verify-ticket.js`, `ticket-login.js`); every other repo trusts them. A change on
  either side is a cross-repo change.
- **Revocation.** Training-Portal re-reads `users.status` on every request; a satellite that caches a
  session for hours keeps a revoked person signed in. This is a standing open question in the
  Knowledge Base.
- **The shared engine.** Foundational, EA/PA, CM, PD and MedSum are near-copies. A bug found in one
  is probably in the others — grep all five before calling it fixed, and remember CM is generated
  from EA/PA.
- **The Gemini key pool and the AI budget**, both owned by Training-Portal's gateway.
- **The request allowance** — see the `request-budget-guard` skill, and the request-budget pass.
- **The Blueprint engine**, copied into several repos and already drifted between Training-Portal and
  the Knowledge Base.

## The Gantt / Milestone chart

Owned by the `gantt-chart-update` skill: the file ID, the column map, the status values and the write
rules all live there. Invoke it for phase 5 rather than writing the sheet from here.

What this skill owns is the *input*: which rows the week's work belongs to, what moved and on what
evidence, and the live blockers. Training-Portal and the Knowledge Base work lands on the LSH TRC
Portal rows; a program repo's work lands on its own row under Foundation Builds or New Training
Programs. A fix is progress on an existing row — never a new WBS row.
