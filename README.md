# LSH Knowledge Base

The LSH VA community library: official SOPs, training videos, guides and know-how from the whole community, on its own site. It replaces the Knowledge Base page in the LSH Training Portal (`/kb.html`) and takes over its code, posts, replies, votes and views.

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

- **VAs** enter their name, batch and the **team access code**. It's the same code as the portal's Knowledge Base, stored in the same `kb_settings` rows. The browser stays signed in for 30 days, and changing the code signs everyone out.
- **Admins** sign in with their **LSH Training Portal admin username and password**. They're checked against the portal's `users` table.
- The portal's site lock (Master Control) closes this site too.

## 🧭 Blueprint (how the Knowledge Base works, for VAs and for admins)

**🧭 Blueprint** in the top bar (before Sign out) opens a full-screen slide deck.
- **VA blueprint** (shown as the Trainee blueprint; a cover and 8 slides), for everyone signed in: what the Knowledge Base is, signing in, finding what you need, videos and files, adding to the library, editing and suggesting, replies, votes and your contributions, and reviewers.
- **Admin blueprint** (shown as the Trainer blueprint; admins only; a cover and 8 slides): signing in as an admin, the team access code, the review queue, reviewers, Official and Featured, history, restore, archive and delete, collections and sections, and import and backup.
- Admins get both as tabs; VAs and reviewers only the VA deck.
- **Moving around:** ◀ ▶, the ← → keys or the contents strip. Esc closes it.
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
   - check the **team access code** (if the portal's Knowledge Base already had one, it works here too);
   - click **Import posts** to copy the old Knowledge Base's posts, replies, votes and views;
   - add **reviewers**.
4. Point the portal's Knowledge Base links (`/kb.html` on the home page, the Training Index and Master Control) to the new site.

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
- the 🧭 Blueprint (`tests/blueprint.cjs`): a VA gets the VA deck only and an admin both; every slide fits on a laptop and on a phone; both PDFs have a page per slide

**Checks on GitHub** (`.github/workflows/checks.yml`): every pull request and every push to the default branch builds the Worker without deploying (`wrangler deploy --dry-run`) and runs all of the tests above against a local `wrangler dev` with fresh, seeded data. A red **Checks** status means something broke; the log says which step.
