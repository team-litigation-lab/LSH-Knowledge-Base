---
name: request-budget-guard
description: Find, fix and prevent runaway request loops and render storms on the LSH platform — a page that re-renders dozens of times a second, re-fetches the same endpoint on every render or frame, accumulates polling intervals, or retries a failing call without backoff, burning through the Cloudflare monthly request allowance shared by every LSH site. Use when a page feels slow or hot, when request counts or Cloudflare usage jump, when adding or changing any fetch, poll, interval or re-render path, when a reviewer asks whether a change is request-safe, and as the request-budget pass of the weekly code inventory.
---

# Request budget guard

Every request that runs a Pages Function or a Worker counts against **one** Cloudflare monthly
allowance shared by every LSH site: the Training Portal, the course Workers, the CMS, Ring Channel
and the Knowledge Base. 10 million a billing month on the Workers Paid plan, then charged.

A render storm does not cost a little more. One tab re-rendering 45 times a second and re-fetching
on each render is **~2,700 requests a minute**, about 160,000 an hour — from a single open tab. That
is the whole class this skill exists to stop: not slow pages, but pages that spend the allowance
while nobody is looking.

The platform has already been through one round of this: about 98 requests a minute per signed-in
tab became about 5, by consolidating three 3-second polls into one `/api/live` every 20 s and
slowing the heartbeat from 2 s to 30 s. Those cadences are the standard. Do not regress them, and do
not add a new poll beside them without reading "The standard cadences" below.

## The signature

A storm, not merely a chatty page:

- the same path requested many times a second, at no fixed interval — it tracks the frame rate, not
  a timer
- request count that grows with *time on page* rather than with what the person does
- it appears in an **empty state** — no saved records yet, an empty list, a new account — and
  disappears as soon as there is one row
- the page is hot, the fan spins, scrolling stutters
- the count does not change when you change the poll interval, because no timer is driving it

That empty-state point is the one most often missed. The Practice Lab storm that prompted this skill
fired only when a trainee had **no saved firm profiles**: ~45 renders a second, each re-requesting
`settings:firms`, about 140 requests in 3 seconds. With one profile saved it was invisible. So the
empty state is where you look first, and what the probe below tests by default.

## Detect it

`references/probe.cjs` is a runnable, repo-agnostic probe. It serves the repo statically, stubs every
`/api/**` call with an **empty** success response, opens the pages you name, and fails if any single
path is requested more than a ceiling inside a window, or if the total after settling is too high.
It needs Playwright and Chromium, which are already preinstalled here
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`).

```
node <skill>/references/probe.cjs                       # every page the repo serves
node <skill>/references/probe.cjs --page simulators/practice-lab.html
node <skill>/references/probe.cjs --max-per-path 6 --window 10000 --verbose
```

It prints a per-path table and exits non-zero on a storm, so it drops straight into CI. Read its
header for the options and what each default means.

Why a generic ceiling and not more hand-written assertions: `requests.cjs` in the Training Portal
asserts the *known* cadences path by path, which is right for the ones that matter and useless for a
page nobody wrote an assertion for. A blanket ceiling catches the next storm on a page that does not
exist yet. Keep both — the named assertions for the agreed cadences, the ceiling for everything else.

Quick manual check, when you have the page in front of you: open DevTools → Network, filter to
`api`, clear, wait 10 seconds **without touching anything**, and read the count. On an idle page it
should be 0 or 1. Anything in double figures is a storm.

## The causes, in the order they actually occur

1. **The empty result is not cached.** A cache that stores only truthy answers treats `[]`, `null`,
   `undefined` and `{}` as a miss, so an empty collection is re-fetched on every single render,
   forever. This is the Practice Lab bug and the single most common cause. **Cache the fact that the
   answer was empty**, not just a non-empty answer.
2. **Fetching from a render path.** A fetch in the body of a render function, a template helper, a
   getter or a computed property. The fetch resolves, state changes, the page re-renders, the fetch
   runs again. There is no timer to slow it down, so it runs at frame rate.
3. **An effect whose dependency is rebuilt every render.** An object, array or function literal in
   the dependency list is a new identity each time, so the effect re-runs every render. Depend on
   primitives, or memoise the value.
4. **Interval accumulation.** `setInterval` started on mount, re-entry or re-render without clearing
   the previous one. Five visits, five live timers, five times the requests — and it survives until
   the tab closes. Every `setInterval` needs exactly one owner and a `clearInterval` on the way out;
   the pattern already used here is `stopPoll(); … E.poll = setInterval(…)`.
5. **No in-flight dedup.** Several components, cards or rows each ask for the same key at the same
   moment. Keep one promise per key while it is in flight and hand every caller the same one.
6. **A failing call with no backoff.** A 4xx or 5xx that triggers a re-render, which retries
   immediately. Error states need a backoff and a stop, not a retry per frame.
7. **An observer that writes what it observes.** A `MutationObserver` or `ResizeObserver` whose
   callback changes the DOM it watches, or a `requestAnimationFrame` loop that sets state. These
   self-trigger at frame rate; guard with a "did anything actually change" check before writing.
8. **Polling where an event would do.** A 1-second poll waiting for something the server could
   return once, or that a single consolidated poll already carries.

## Fix it, in this order

Prefer the fix that removes the requests over the one that spaces them out.

1. **Cache the answer, including an empty one.** `Map` with an explicit sentinel, or store
   `{ ok: true, value }` so `value === null` is still a hit. Decide and write down when it expires.
2. **Dedup in flight.** One promise per key, shared by every caller, cleared when it settles.
3. **One owner per key.** A page-level load that passes data down beats every component fetching for
   itself.
4. **Move the fetch out of the render path** into load, an explicit event, or an effect with
   primitive dependencies.
5. **Guard the re-render.** Only set state when the value really changed; compare before writing.
6. **Then, and only then, adjust cadence** — debounce, a longer interval, `document.hidden`
   throttling, backoff on error.

Raising a poll interval on a page whose problem is a render loop hides the storm without fixing it:
the loop still runs at frame rate, it just asks a different endpoint. If changing the interval does
not change the request count, you have not found the cause yet.

## The standard cadences

Match these; they are what the last round of this work settled on, and `requests.cjs` enforces them.

| What | How often |
|---|---|
| Lock, pause, alert and new pings — **one** request, `/api/live` | every 20 s; 60 s in a background tab; once immediately when the tab comes back |
| Heartbeat (the server allows 90 s between beats) | every 30 s, and when the tab comes back |
| Progress and leaderboard | once a minute, only on a page that shows them, only while in view |
| Anything new | justify it against the three above before adding a fourth timer |

An idle signed-in tab should sit at about 5 requests a minute. If a page you touched is above that
with nobody interacting, it is this skill's problem.

`/api/site-state`, `/api/alert` and `/api/pings` still answer individually — Master Control uses them
right after a change — so finding a *call* to them is fine. Finding them on a *timer* is the
regression `requests.cjs` already fails on.

## Gate it in CI

A fix without a gate comes back. For a storm you fixed:

1. Add the page to the probe's page list, or a named assertion to `requests.cjs` if it is one of the
   agreed cadences.
2. **Assert the empty state**, since that is where storms hide — the probe's stubs default to empty
   for exactly this reason.
3. Add the step to `.github/workflows/checks.yml` beside the existing
   `Server requests from an open page` step, with a name that says what it protects.
4. Re-run and watch it fail against the pre-fix code before you trust it. A gate never seen red is
   not known to work.

## Rules

- **Reproduce the count before you change anything,** and quote it: "140 requests in 3 s, idle,
  empty state". A fix with no before-number cannot be shown to have worked.
- **Measure in the empty state first**, then with one record, then with many.
- **Never cache a response the viewer is not allowed to see** across viewers. A per-key cache is
  per-tab; do not promote it to anything shared without thinking about who can read it.
- **Never silence a storm by removing the feature's data loading.** The page still needs its data;
  it needs to ask once.
- **Report the cost, not just the bug.** Requests a minute per idle tab, before and after. That is
  the number the allowance is spent in, and the one worth putting in a report or on the Gantt chart's
  blocker line.
- A storm found on `main` or another default branch is a live cost, not a backlog item: it is
  spending the allowance right now. Say so plainly and fix it ahead of tidier work.
