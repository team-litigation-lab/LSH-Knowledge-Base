# LSH Knowledge Base

LSH Community Library: official SOPs, training videos, guides and know-how from the whole community, on its own site. It replaces the Knowledge Base page in the LSH Training Portal (`/kb.html`) and takes over its code, posts, replies, votes and views.

## What it does

- **A library, not a feed.** Entries sit in **collections**, one per program or role: Foundational Training, Reception, Intake, Lien Negotiation, Case Management, EA / PA and so on. Inside a collection, entries are grouped by **section** (for example "Day 17 · Lien Negotiator Training"), with a table of contents. Admins add, rename, reorder and archive collections.
- **Real uploads.** Anyone in the community can upload PDFs, Word, Excel and PowerPoint files, images, audio and **training videos**, up to 5 GB each.
  - Files go to Cloudflare R2 in 10 MB parts, three at a time, and each part is retried if it fails.
  - Videos play in the page and can seek. PDFs open inline, and everything can be downloaded.
- **Nothing is lost.**
  - Every save adds a version. Nothing is overwritten.
  - The history shows every version and compares any version with the current one.
  - Reviewers can restore any earlier version.
  - Removing an entry archives it. Only an admin can delete permanently, by typing DELETE.
  - Admin → **Download a backup** exports every entry and version as JSON.
- **Search that scales.** Search runs on the server (SQLite FTS5 in D1). It covers titles, summaries, content, tags, sections and the **text inside uploaded PDFs and Word, Excel and PowerPoint files**, which the browser extracts at upload. Results are ranked, highlighted and paged.
- **Community review.**
  - New entries, suggested edits and replies from VAs wait for review.
  - A VA's edit to someone else's entry is a *suggestion*: the current version stays up until a reviewer approves it.
  - Admins can make trusted VAs **reviewers**, so admins aren't the bottleneck.
  - Only admins mark entries **Official**, change settings or delete permanently.
- Helpful votes, view counts, featured entries, "experience from the team" replies, a contributors directory and a "My contributions" page.

## Who can get in

- **Everyone signs in once, on the LSH Training Portal** and opens the Knowledge Base from there. The Portal sends them here with a short-lived signed ticket (`?ticket=…`); this Worker hands it back to the Portal's `/api/verify-ticket` to check (so it needs no shared secret) and starts a 12-hour session with their name and batch from their Portal account. There is no second sign-in. `PORTAL_URL` (default `https://cm-training-activity.pages.dev`) points at the Portal.
- **Admins always type the admin password here**: the same one as on every LSH platform (`MASTER_ADMIN_PASSWORD`, which the Portal holds, so the Worker asks the Portal's `/api/login` to check it). There is no username box: it signs in as the Master Account. No ticket signs an admin in; the Portal opens this site on the **Admin Portal** tab (`?admin=1`).
- The old **team access code** sign-in is off. It works only if the variable `KB_CODE_LOGIN` is set to `on` (the end-to-end tests do that).
- The portal's site lock (Master Control) closes this site too.

## 🧭 Blueprint (how the Knowledge Base works, for VAs and for admins)

**🧭 Blueprint** in the top bar (before Sign out) opens a full-screen slide deck.
- **VA blueprint** (shown as the Trainee blueprint; a cover and 8 slides), for everyone signed in: what the Knowledge Base is, signing in, finding what you need, videos and files, adding to the library, editing and suggesting, replies, votes and your contributions, and reviewers.
- **Admin blueprint** (shown as the Trainer blueprint; admins only; a cover and 8 slides): signing in as an admin, the team access code, the review queue, reviewers, Official and Featured, history, restore, archive and delete, collections and sections, and import and backup.
- Admins get both as tabs; VAs and reviewers only the VA deck.
- **Moving around:** ◀ ▶, the ← → keys or the contents strip. Esc closes it.
- **Numbering:** the cover is ★ Cover (the counter says "Cover · 8 slides"); the slides are 1 to 8 everywhere: the contents strip, the counter ("8 / 8" on the last), the slide's heading and footer, and the PDF's page footers.
- **⬇ Download PDF:** the deck that's showing, as a landscape PDF with one page per slide, made from the deployed site each time and stamped with the deploy (the page's ETag) and the date.
- **Files:** the slides are in `public/js/blueprint-content.js`. `public/js/lsh-blueprint.js` (the page and the PDFs) is the same file on every LSH platform: change it in one, copy it to all. Test: `tests/blueprint.cjs`.

## Files

| Path | What it is |
|---|---|
| `src/index.js` | The Worker: routing, sign-in, entries, versions, review, replies, admin, import, backup |
| `src/files.js` | Uploads (R2 multipart) and file streaming with Range support |
| `src/db.js` | Tables, collections, making a version live, the search index |
| `src/util.js` | Tokens, passwords and cookies, in the same formats as the portal |
| `public/` | The site: `index.html`, `css/app.css`, `js/app.js` (all pages), `js/upload.js`, `js/md.js` (safe Markdown), `js/blueprint-content.js` and `js/lsh-blueprint.js` (the 🧭 Blueprint) |
| `tests/` | End-to-end tests and local seed data |
| `wrangler.json` | Worker config and bindings |
| `.github/workflows/checks.yml` | The checks GitHub runs on every pull request and push |

## Comments · update current info

Every page ends with a **Comments · update current info** section. Anyone signed in, including Info Access readers, can send a note that something is out of date and what it should say now (`kind` = `update`); contributors can also add a plain comment. A note waits for a reviewer (it appears in the review queue with an *Update to current info* badge) unless a reviewer or admin wrote it. Once approved it shows on the page; a reviewer updates the page and presses **Mark page updated**, which adds a *✓ Page updated* badge. Info Access readers still cannot add entries, edits or plain comments. The `kind` column is added to `kb_comments` automatically.

## Glossary (top bar → Glossary)

A dictionary kept apart from the entries: `lib_terms` (term, meaning, example, category). The page has a search box (it matches the term or any word of its meaning), A to Z letter links, category chips and one card per term; a library search also shows matching terms above the entries. It starts with 62 terms from the two Tettra pages (7 legal terms from "LSH Legal Jargon", 55 medical abbreviations from "Medical Terminologies and Abbreviations"), loaded by **Admin → Import documents**. Admins and reviewers can add, edit and delete terms on the page; a term someone has edited is not overwritten by a later import (`edited` = 1). Everyone signed in can read it.

## Bundled documents (Admin → Import documents)

`public/seed/docs.json` holds the Demand Phase and Case Management handouts as Markdown (headings, lists, tables), made from the PDFs with `scripts/pdf_to_md.py`. **Admin → Import documents** publishes each one as a page of the library, not as a PDF in a viewer, and refreshes the search. It is safe to run again: a handout already imported is skipped, and one imported earlier as a PDF attachment is rewritten as a page (`legacy_ref` = `seed:<file name>`). The Worker answers 404 for `/seed/*` and handles every request first (`run_worker_first`), so the bundled data is only reachable through the library.

## Training topics (Admin → Import documents)

`public/seed/training.json` has one page for each topic of the Foundational Training lessons 1 to 8 (68 pages: 6, 11, 9, 6, 9, 11, 9 and 7 per lesson), made by `node scripts/training_topics.mjs <Foundational-Training repo>`. A topic is the part of a lesson between its slide-list dividers (`FT_TOPICS` in that repo's `js/ft-updates.js`); its page is the text of those slides under the slides' own headings. Each page is in the **Foundational Training** collection, in a section named for its lesson, tagged `training` and `lesson N`. The **Import documents** button adds them (12 per call, repeated by itself) and is safe to run again: a page already imported is skipped, or updated if the lesson's text changed (`legacy_ref` = `train:<lesson>-T<topic>`). Trainer-only material (the Training Guide, facilitator's notes, answer sheets) is not used.

## Tettra import (Admin → Import Tettra pages)

`public/seed/tettra.json` holds the 71 pages of LSH's Tettra export that belong in the Knowledge Base (made by `python3 scripts/tettra_convert.py <export.json>`: the HTML becomes the library's Markdown, owner e-mails are dropped). **Step 1, Import pages** publishes them 12 at a time: each Tettra category becomes a collection, each subcategory a section, and the page's owner, created and updated dates are kept (`legacy_ref` = `tettra:<id>`). **Step 2, Copy images** copies the 629 images into R2 (`kb/img/<hash>`, 15 per call) so they stay if Tettra is closed; until then an image is copied the first time someone opens it. Images are served at `/img/<hash>` to signed-in readers only. When the last page is in, the starter collections that have nothing in them (Reception, Intake and so on) are archived, so only collections with knowledge in them are listed; Admin can bring one back. **3, Refresh the search** rebuilds the search for every published entry (it also runs by itself after steps 1 and the handouts); a collection's name is searchable, so "VA Management" finds that category's pages. Running step 1 again also brings pages imported earlier up to date with the file. **Left out as company policies:** the three sections "I. Company Information", "II. Client Management" and "II. VA Management" (13 pages); step 1 archives any of them imported earlier (hidden, every version kept; an admin can restore one). **Brought up to date:** links to other Tettra pages go to their Knowledge Base pages, "Tettra article" reads "Knowledge Base article", the Tettra login that was in the Task Assessment Manual is removed, links that no longer work (`scripts/dead_links.json`) say "(link no longer works)", and the 19 pages whose dates stop at 2023 or earlier carry a "Needs review" note and the `needs-review` tag. Also left out as company-internal: "LSH Marketing Products", "LSH Task Assessment Manual (TAM)" and Tettra's 10 starter templates (step 1 archives any of them imported earlier). The two dictionary pages, "LSH Legal Jargon" and "Medical Terminologies and Abbreviations", are the Glossary instead of entries. Also left out: one page deleted in Tettra, the empty "asd" test page, and "How to Install Nitro Pro" (instructions for a cracked copy).

## Storage

| Binding | What | Shared with |
|---|---|---|
| `TRAINING_DB` (D1 `lsh-training-activities-db`) | `lib_*` tables (collections, entries, versions, files, reviewers, search) plus the old `kb_*` tables for the code, replies, votes and views | LSH Training Portal |
| `DB` (D1 `lshcasemanagementtraining-trainingcrmlogins`) | Read-only: admin sign-in (`users`) and the site lock (`site_state`) | LSH Training Portal |
| `FILES` (R2 `lshtraining`) | Uploaded files, under `kb/files/<year>/<month>/<id>/<name>` | EA/PA portal (its `DOCUMENTS` bucket) |

The tables are created automatically on the first request.

## Deploy

1. Deploy the Worker from this repository. Either:
   - connect the repo in **Cloudflare → Workers & Pages → Create → Import a repository**, or
   - run `npm install` then `npx wrangler deploy`.

   Use the Cloudflare account that holds the portal's D1 databases and the `lshtraining` R2 bucket. The Worker is `lsh-knowledge-base`, at `https://lsh-knowledge-base.legalsupporthelp.workers.dev/` unless you add a custom domain.
2. Add the secret `SESSION_SECRET`: a long random string, set in **Settings → Variables and Secrets** or with `npx wrangler secret put SESSION_SECRET`.
3. Open the site and sign in on the **Admin** tab with your portal login. Then, in **Admin**:
   - click **Import posts** to copy the old Knowledge Base's posts, replies, votes and views;
   - add **reviewers**.
4. The portal's Knowledge Base links open this site through `/api/launch?tool=kb`, which signs trainees in.

**Limits.**
- Each upload part is 10 MB, which is under the Workers request limit, so file size isn't limited by the plan. This site caps files at 5 GB.
- R2 has no download (egress) fees. Storage above R2's free 10 GB is billed per GB-month.

## Develop and test

```
npm install
npm run seed:local                          # a test admin (trainer1 / admin-pass) and three old-style posts
echo "SESSION_SECRET=dev-secret" > .dev.vars
npm run dev                                 # http://127.0.0.1:8787
pip install playwright && npm pack pdfjs-dist@3.11.174 && mkdir -p tests/.cache/pdfjs && tar xzf pdfjs-dist-3.11.174.tgz -C tests/.cache/pdfjs
npm test                                    # 43 end-to-end checks; start from fresh local data (rm -rf .wrangler/state, seed again)
npm run test:blueprint                      # the 🧭 Blueprint; needs Node Playwright and jsPDF (npm install --no-save playwright jspdf@4.2.1, npx playwright install chromium)
```

The tests cover:
- sign-in (the code and admin login)
- the import
- a 25 MB upload in parts, checked byte for byte
- video Range requests and playback
- search inside a PDF
- suggestions, review, history, restore, official, archive and purge
- the 🧭 Blueprint (`tests/blueprint.cjs`): a VA gets the VA deck only and an admin both; every slide fits on a laptop and on a phone; both PDFs have a page per slide; the numbers match everywhere (Cover, then 1 to n, never n + 1)

**Checks on GitHub** (`.github/workflows/checks.yml`): every pull request and every push to the default branch builds the Worker without deploying (`wrangler deploy --dry-run`) and runs all of the tests above against a local `wrangler dev` with fresh, seeded data. A red **Checks** status means something broke; the log says which step.
