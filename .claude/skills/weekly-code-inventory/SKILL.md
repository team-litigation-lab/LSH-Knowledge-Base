---
name: weekly-code-inventory
description: Weekly Saturday-morning code inventory of the LSH platform repos (Training-Portal and LSH-Knowledge-Base) — finds bugs, dead code, conflicts and stale setups, fixes what is safe to fix on the designated branch, writes a dated summary report, and updates the project Gantt / Milestone chart. Use when asked to run the weekly code inventory, the Saturday audit, a repo health check, or when a scheduled task fires asking for it.
---

# Weekly Code Inventory

A once-a-week sweep of the LSH platform repositories that ends with three things: fixes pushed,
a summary written, and the Gantt chart current. Read `references/projects.md` for what each repo is,
how to validate it, and where the Gantt chart lives.

Run it in five phases, in order. Do not skip the validation phase — a push that reddens CI costs
more than the findings are worth.

## 1. Set up

For each repo in `references/projects.md`:

```
git -C <repo> fetch origin
git -C <repo> checkout claude/great-ptolemy-3tezc3 2>/dev/null || git -C <repo> checkout -b claude/great-ptolemy-3tezc3 origin/<default-branch>
git -C <repo> merge origin/<default-branch> --no-edit
```

If the designated branch's PR has already been merged, restart the branch from the default branch
instead of stacking on merged history (`git checkout -B claude/great-ptolemy-3tezc3 origin/<default-branch>`).

Record the window being audited: commits since the last inventory
(`git log --oneline --since="8 days ago"`) and the last report under `reports/code-inventory/`.

## 2. Inventory

Work the five categories below. Fan out with subagents (one per category per repo) when the sweep is
large; each returns findings, not file dumps. Every finding needs a file:line and a concrete failure
path — "could be a problem" is not a finding.

**Bugs.** Trace real inputs to wrong output or a crash. Priorities for these repos: auth and session
handling, admin-vs-trainee gating, D1 queries (shared database — a schema change must stay backward
compatible), unawaited promises, unhandled fetch failures, `null`/`undefined` on response shapes,
formula injection in CSV export, and anything touching the AI gateway budget.

**Dead code.** Functions, files, endpoints, CSS classes and HTML pages with no reachable caller.
Check with a repo-wide grep for the identifier before calling it dead — a string-built handler name
or an `onclick=` attribute counts as a caller. In Training-Portal, cross-check `CODEMAP.md`: a file
the map does not list, or lists as retired, is a candidate.

**Conflicts.** Duplicated logic that has drifted between the two copies (the auth CSS/login pages,
Blueprint engine, session code shared between repos), routes defined twice, `_redirects`/`wrangler`
rules that shadow each other, two sources of truth for the same setting, and CSS rules fighting
across `styles.css`/`theme.css`/page-local blocks.

**Stale setups.** Pinned versions in `package.json`, `package-lock.json` and the CI workflows that
have drifted apart or trail the runtime; `wrangler.json`/`wrangler.toml` bindings that name
resources no longer used; env vars and secrets referenced in code but absent from config (and the
reverse); workflow steps pointing at scripts that no longer exist; and seed/test data that no longer
matches the schema.

**Repo hygiene.** Open PRs that are stale or conflicted, CI red on the default branch, files that
should be gitignored (`node_modules`, `__pycache__`, build output) and tracked anyway, and
`CODEMAP.md` entries whose line counts or descriptions no longer match the file.

Verify each finding before it goes in the report. Drop the ones you cannot reproduce or trace, and
say in the report how many you dropped.

## 3. Fix what is safe to fix

Fix on the designated branch, in small commits grouped by category. Safe to fix without asking:

- a traced bug whose fix is local and covered by an existing test, or by one you add
- dead code you proved unreachable
- drifted duplicates reconciled to the version that is actually correct
- version, binding, ignore-file and workflow-reference drift
- `CODEMAP.md` and README lines that have gone out of date

Do **not** fix on your own: schema changes, auth or gating behavior changes, anything that changes
what a trainee or admin can see, API shape changes, dependency major bumps, or deleting a page or
endpoint that something outside the repo may link to. Those go in the report under **Needs a
decision**, each with the proposed patch described, and they are the first thing the summary names.

Never skip, disable or quarantine a test to get green.

## 4. Validate, then push

Run the repo's own checks before pushing — the commands are in `references/projects.md`. At minimum:
the syntax/file checks, the wrangler build (dry run, never a deploy), and any test touching code you
changed. Reproduce a bug's failure first, then show the same check passing.

Re-read your own diff adversarially, then:

```
git -C <repo> push -u origin claude/great-ptolemy-3tezc3
```

Retry a network failure up to 4 times with 2s/4s/8s/16s backoff. Do not open a pull request unless
asked.

## 5. Summary and Gantt chart

**The report.** Write `reports/code-inventory/YYYY-MM-DD.md` in each repo and commit it with the
fixes. Structure:

```
# Code inventory — <repo> — <date>
Window audited: <commit range / dates>

## At a glance
<counts: bugs / dead code / conflicts / stale setups / hygiene; fixed vs. needs a decision>

## Fixed this week
- <finding> — <file:line> — <what was wrong, what the fix does> (<commit sha>)

## Needs a decision
- <finding> — <file:line> — <failure path, proposed fix, why it is not mine to make>

## Verified clean
<areas swept that came back empty, so next week knows what was covered>

## Checks run
<commands and their results>
```

**The Gantt chart.** Then update the project Gantt / Milestone chart in Google Drive. Load the
`anthropic-skills:google-workspace` skill first, and find the chart with Drive search rather than a
remembered file ID — see `references/projects.md` for which copy to write to. On the `Gantt Chart`
sheet, for the rows this week's work touched:

- `% Completion` (I) and `Status` (H) — use only the standard values: `Not Started`, `In Progress`,
  `Testing Phase`, `Completed`, `On Hold / Blocked`
- `Actual Start Date` (E) when work began this week; `Finish Date` (K) when it finished (Duration in
  L is a formula — leave it alone)
- `Challenges / Completion Blockers` (J) — one short line per blocker from **Needs a decision**;
  replace a stale line, do not append forever
- `Report as of:` (E3) — set to the run date

Leave formula cells, the baseline columns and the week grid to recalculate themselves; never retype
a value a formula produces. If the run falls at month-end, also add the month's row to the
`Monthly Progress Log` sheet (Key Accomplishments from "Fixed this week", Challenges from "Needs a
decision", Focus for Next Month from what stayed open).

If the chart cannot be written (read-only copy, no access), say so plainly in the closing summary
with the exact row-and-value changes it should have received, so they can be pasted in by hand.

**Closing.** Finish with a short summary naming, in this order: what needs a decision, what was
fixed and pushed, the report paths, and the Gantt rows updated. Keep it to what a project lead needs
on a Saturday morning — the reports hold the detail.
