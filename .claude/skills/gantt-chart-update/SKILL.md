---
name: gantt-chart-update
description: Update the LSH Web-Based Platform Project Gantt / Milestone chart in Google Drive from what actually changed — shipped work, commits, merged PRs, blockers, a code-inventory report, or a plain spoken update. Use when asked to update the Gantt chart, the milestone chart, the project tracker or the project timeline, to log progress or a blocker against the project plan, when reporting what shipped this week, or at month-end for the progress log. Also used by the weekly-code-inventory skill as its reporting step.
---

# Gantt chart update

Takes what changed and writes it into the project's Gantt / Milestone chart. The chart is the thing
Gwen, Matt and Nicson read, so it has to say what is true as of today and nothing it cannot support.

## The file

`Web-Based_Platform_Project_Gantt_Chart_Oct2026_Baseline` —
`1C6CojhC_bxhyUtJgnO9M_jjyOWUehYxoxfbBYHST_DE`
(owner `info@legalsupporthelp.com`; `team-litigation@legalsupporthelp.com` has writer).

Load the `anthropic-skills:google-workspace` skill before the first Sheets call. Confirm the ID still
resolves, and read the sheet before writing — never write from the map below alone:

```
search_files: title contains 'Gantt_Chart' and mimeType = 'application/vnd.google-apps.spreadsheet'
```

Other Drive files share this title and are **not** copies of it. In particular
`1q0nVZND_v9_9V1ItJBYD0jwXvmXAH-RHArk5iMkzZNM` is a different layout — a tab per project, with a
`Checklist` sheet driving each task's %. The column map below does not apply to it. Never write to it
on the strength of a title match; if it is the one meant, stop and ask, because the protocol differs.

Sheets in the file: `Gantt Chart` (task rows), `Monthly Progress Log`, `Settings & Calendar`
(working-day inputs and the holiday table — every projected date recalculates from these),
`Required Columns Checklist`.

## The column map

`Gantt Chart`, header row 8, task rows below it:

| Col | Field | Write it? |
|---|---|---|
| A | WBS | only when adding a row |
| B | Priority / Topic | only when adding a row |
| C | Effort (hrs) | only when adding a row |
| D | Plan Start Date | no — baseline, do not revise history |
| E | Actual Start Date | yes, when work actually began |
| F | Projected Timeline (working days) | only if the estimate genuinely changed |
| G | Projected End Date | no — recalculates |
| H | Status | yes |
| I | % Completion | yes |
| J | Challenges / Completion Blockers | yes |
| K | Finish Date | yes, when it finished |
| L | Duration in Days | **no — formula** |
| M | Plan End (baseline) | no — baseline |
| N onward | weekly grid | no — recalculates; `◆` marks a milestone |

Summary block is rows 5–6 (Overall %, the status counts, Projected Project End); `Report as of:` is
**E3**. The summary counts are derived — if they are formulas, leave them; if they are typed values,
update them to match the rows you changed and say so.

`Status` takes only these five: `Not Started`, `In Progress`, `Testing Phase`, `Completed`,
`On Hold / Blocked`. Colours follow status: navy Completed, orange In Progress, purple Testing
Phase, red On Hold / Blocked, grey Not Started.

## How to do it

**1. Read first.** Pull the `Gantt Chart` sheet and find the rows that the update actually concerns.
Match on the Priority / Topic text, not on a remembered row number — rows move.

**2. Map the update onto existing rows.** A fix, a shipped feature or a blocker is *progress on a row
that already exists*. Do not create a WBS row for a bug fix or a week's work. Add a row only for
genuinely new scope, and say in your closing summary that you added it and why.

The main workstreams: Foundation Builds (CM System / Training CRM, mock docket, EA/PA Upskill),
LSH TRC Centralized Portal, New Training Programs, Rollout & Handover, Reporting & Check-ins.
Training-Portal work lands on the TRC Portal and Foundation Builds rows; LSH-Knowledge-Base work
lands on the TRC Portal and Knowledge Base rows.

**3. Decide each row's new state honestly.**

- `% Completion` — move it only on evidence you can name. Shipped and verified work raises it;
  "worked on it" does not. If the row has a checklist elsewhere, count from that.
- `Status` — `Testing Phase` means built and under test, not "nearly done". A row with an open
  blocker that stops work is `On Hold / Blocked`, even if it is 90% done.
- `Actual Start Date` (E) — fill only if blank and work really began; never overwrite an existing one.
- `Finish Date` (K) — only when the row is actually done, with `Status = Completed` and `% = 100%`.
- `Challenges / Completion Blockers` (J) — one short line per live blocker. **Replace** a blocker
  that is resolved; do not append forever. Clearing a resolved blocker is part of the update.
- Never move a `%` down without saying why in the closing summary.

**4. Write.** Set the cells, then `Report as of:` (E3) to today. Leave every formula, baseline column
and grid cell alone — if a value you were about to type is produced by a formula, that is a signal
you are writing in the wrong place.

**5. Month-end.** If the run falls in the last three days of a month, or the user asks for the
month-end report, add the month's row to `Monthly Progress Log`: Month, Report Date, the summary
numbers as **values** (not formulas), Key Accomplishments, Challenges / Blockers, Focus for Next
Month, Sent To (`Gwen Paiso, Matt, Nicson`). Keep each note to a few sentences a project lead can
read aloud.

**6. Report back.** List every cell you changed as `row — field — old → new`, and name anything you
deliberately did not change. If the file could not be written, give that same list so it can be
pasted in by hand, and say why the write failed.

## Rules

- Evidence or nothing. Every number you write must trace to something real — a merged PR, a passing
  check, a deployed build, a report, or the user telling you. If an update is vague, write what it
  supports and say what you left alone rather than inventing a percentage.
- Never revise baselines (`Plan Start`, `Plan End`) or retype a formula's output.
- Never invent a milestone or a date for one.
- Do not delete a row. A cancelled task is a question for the project lead, not an edit.
- If the chart and the repos disagree about what is done, say so in the closing summary instead of
  quietly picking a side.
