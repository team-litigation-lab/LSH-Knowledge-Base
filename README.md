# LSH Knowledge Base

LSH Community Library: official SOPs, training videos, guides and know-how from the whole community, on its own site. It replaces the Knowledge Base page in the LSH Training Portal (`/kb.html`) and takes over its code, posts, replies, votes and views.

## What it does

- **A library, not a feed.** Entries sit in **collections**, one per program or role: Foundational Training, Reception, Intake, Lien Negotiation, Case Management, EA / PA and so on. Inside a collection, entries are grouped by **section** (for example "Day 17 · Lien Negotiator Training"), with a table of contents. Admins add, rename, reorder and archive collections.
- **Real uploads.** Anyone in the community can upload PDFs, Word, Excel and PowerPoint files, images, audio and **training videos**, up to 5 GB each.
  - Files go to Cloudflare R2 in 10 MB parts, three at a time, and each part is retried if it fails.
  - Videos play in the page and can seek. PDFs open inline, and everything can be downloaded.
- **Writing that looks the way you want.** The editor has a formatting toolbar: **bold**, *italic*, underline, colored text, links and photos placed right in the text (the 🖼️ Photo button uploads the image and drops it where the cursor is). The same markup can be typed by hand (`**bold**`, `*italic*`, `++underline++`, `{color:#D33}…{/color}`, `[text](https://…)`), and the Preview tab shows the page as readers will see it. Everything stays safe Markdown (`js/md.js`): the text is HTML-escaped first, so nothing a VA types can run as code.
- **Pasting keeps its formatting.** Paste a table, or bold, italic or underlined text, from Word, Google Docs or a spreadsheet straight into the Write box, and it turns into this library's own markdown instead of flattening to plain text: a pasted table becomes `| pipe | table |` rows, bold stays `**bold**` (Google Docs writes bold as a styled span, not a `<b>` tag, and that's read too), and a spreadsheet's plain tab-separated paste becomes a table the same way. A plain paste with no formatting to carry over pastes as plain text, same as before (`js/paste-format.js`; unit-tested in `tests/paste-format.cjs`).
- **Autoformat existing articles (Admin → Library maintenance).** Runs the same kind of cleanup on entries already in the library: a plain-text table lined up with tabs, a bare `|`, or two or more spaces becomes a real table, and a short "Label:" at the start of a line (`Note:`, `Duration:`, `Date:` and the like — the style already used by hand in most of the library's own pages) is bolded. Only an entry whose body actually changes gets a new version (`autoformatBody` in `src/util.js`, the `autoformat-body` admin action, 12 entries per call, repeated until none remain — the same pattern as **Tidy ALL-CAPS titles**; unit-tested in `tests/autoformat-body.cjs`). An entry that's already formatted, or whose author typed the markup by hand, is left exactly as it is.
- **Nothing is lost.**
  - Every save adds a version. Nothing is overwritten.
  - The history shows every version and compares any version with the current one. The comparison is word for word: only the words that were removed are struck out and only the words that were added are highlighted — whole sentences are never crossed out over a one-word change — and long unchanged stretches fold away so the exact edit stands out.
  - Admins can restore any earlier version at once; a reviewer's restore waits for approval like any other edit.
  - Removing an entry archives it. Only an admin can delete permanently, by typing DELETE.
  - Admin → **Download a backup** exports every entry and version as JSON.
- **Search that scales.** Search runs on the server (SQLite FTS5 in D1). It covers titles, summaries, content, tags, sections and the **text inside uploaded PDFs and Word, Excel and PowerPoint files**, which the browser extracts at upload. Results are ranked, highlighted and paged.
- **Community review.**
  - **Only tenured VAs, reviewers and admins can edit.** Info Access readers can read and search, and nothing else (no entries, edits, Glossary changes or notes).
  - **Every edit waits for approval.** A new entry, an edit (to anyone's entry, your own included), a restore of an earlier version, a Glossary term and an "update current info" note are all held until approved. The current version stays up until then.
  - **Only an admin's own edits go live at once.** A reviewer's edits wait too, and nobody can approve their own change: another reviewer or an admin does (the server refuses it; admins are the final authority).
  - An approval never changes Official, and an edit written against an older version is refused (409) once the page has changed, so it can't overwrite a newer edit or bring back a removed file; the author redoes it. A reviewer's own notes wait too, nobody approves their own note, only admins bring an archived entry back, and a file's search text can't be changed once it is on a page. The old team-code sign-in (`KB_CODE_LOGIN=on`) is Info Access only. A Glossary term an admin removed stays removed when the Glossary is imported again.
  - A reviewer who wants to fix someone else's new entry that isn't live yet approves it or sends it back with a note; only its author or an admin edits it.
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
| `src/util.js` | Tokens, passwords and cookies, in the same formats as the portal; `autoformatBody` for the **Autoformat existing articles** admin action |
| `public/` | The site: `index.html`, `css/app.css`, `js/app.js` (all pages), `js/upload.js`, `js/md.js` (safe Markdown), `js/paste-format.js` (turns a pasted table or bold/italic/underlined text into that Markdown), `js/blueprint-content.js` and `js/lsh-blueprint.js` (the 🧭 Blueprint) |
| `tests/` | End-to-end tests and local seed data |
| `wrangler.jsonc` | Worker config and bindings |
| `.github/workflows/checks.yml` | The checks GitHub runs on every pull request and push |

## Comments · update current info

Every page ends with a **Comments · update current info** section. Tenured team members, reviewers and admins can send a note that something is out of date and what it should say now (`kind` = `update`), or add a plain comment; Info Access readers see the notes but cannot send any (a note is a suggested edit, so it follows the same rule). A note waits for a reviewer (it appears in the review queue with an *Update to current info* badge) unless a reviewer or admin wrote it. Once approved it shows on the page; a reviewer updates the page and presses **Mark page updated**, which adds a *✓ Page updated* badge. The `kind` column is added to `kb_comments` automatically.

## Pages that came from Tettra

Nothing marks them: a page that came from the firm's Tettra reads like any other, with no tag and no badge. Where it came from is not the reader's concern. The text does not mention Tettra either — links to other Tettra pages go to their Knowledge Base pages, and the five file attachments (four PDFs and a training video) are copied into the library and linked as `/att/<id>`, so no link points at Tettra's storage. Step 2 (Copy images) copies the images and the attachments.

Re-running step 1 updates pages imported earlier, and archives any page that is no longer in `public/seed/tettra.json` — that is how the company-policy and software-tutorial pages (Tools & Applications, Automation, Marketing, Accounting, Document Generation, Company Information, VA and Client Management) left the library: the converter excludes those categories, so the import archives what it no longer carries. Archived pages keep every version and an admin can bring one back.

## Glossary (top bar → Glossary)

A dictionary kept apart from the entries: `lib_terms` (term, meaning, example, category). The page has a search box (it matches the term or any word of its meaning), A to Z letter links, category chips and one card per term; a library search also shows matching terms above the entries. It starts with about 970 terms: 62 from the two Tettra pages (7 legal terms from "LSH Legal Jargon", 55 medical abbreviations from "Medical Terminologies and Abbreviations") and 330 general US legal-industry terms, with the most in personal injury (claims, evidence, injuries, treatment, damages, accident types) written from general knowledge (`scripts/glossary_extra.py`: Legal, Litigation, Personal Injury, Insurance & Liens and Medical-Legal; plain-English meanings, and rules differ by state, so a reviewer should check them). `scripts/glossary_us.py` adds about 580 more across the whole of US law (civil procedure, evidence, contracts, torts, criminal, property, family, estates and trusts, business, employment, immigration, insurance and Latin phrases). The Glossary loads these itself the first time it is opened empty. Add more by editing those files and running `scripts/tettra_convert.py`, or on the page itself. They are loaded by **Admin → Import documents**. Changes follow the same rule as entries. Tenured VAs and reviewers use **Suggest a term**, **Suggest an edit** and **Suggest removal** (a removal needs a reason); each is held in `lib_term_changes` and appears under **Review → Glossary changes**, where an admin or another reviewer (never the person who made it) approves or sends it back with a note. Admins add, edit and delete directly. A term someone has edited is not overwritten by a later import (`edited` = 1). Everyone signed in can read it; Info Access readers cannot suggest changes.

## Bundled documents (Admin → Import documents)

`public/seed/docs.json` holds the Demand Phase and Case Management handouts as Markdown (headings, lists, tables), made from the PDFs with `scripts/pdf_to_md.py`. **Admin → Import documents** publishes each one as a page of the library, not as a PDF in a viewer, and refreshes the search. It is safe to run again: a handout already imported is skipped, and one imported earlier as a PDF attachment is rewritten as a page (`legacy_ref` = `seed:<file name>`). The Worker answers 404 for `/seed/*` and handles every request first (`run_worker_first`), so the bundled data is only reachable through the library.

**Case Management Training handouts.** The 15 handouts of the Case Management Training course (John Doe v. Robert Smith) are in the **Case Management** collection, one section per training day: `CM Training · Day 1 · Intake, Claims & Property Damage`, `Day 2 · Claim Set Up & Treatment`, `Day 3 · Pre-Demand Audit, the Demand & Settlement Negotiation`, `Day 4 · Reductions, Lien Negotiation & ADR` and `Day 5 · Litigation & Dropped Cases`. The course has no Handouts page of its own any more: its **📚 Knowledge Base** link opens this collection through the Portal (`/api/launch?tool=kb&to=cmkb`). Trainers add more with **+ Add to Case Management** and type the day's section name; an admin's entry goes live at once, anyone else's waits for review as usual. Seven of them (the treatment-phase gaps, MedPay & first-party coordination, pre-demand & reduction review, advanced UM demand, settlement release clauses, the safe release form and the mediation binder checklist) were converted from the course's files with `pdf_to_md.py` and `docx_to_md.py`; four that were in Medsum & Demands moved here with the rest, and **Import documents** moves them (each move is a new version).

## Word documents (scripts/docx_to_md.py)

A Word file becomes a page with `python3 scripts/docx_to_md.py file.docx` (headings, bold and italic, links, nested bullet and numbered lists, tables; needs `pip install python-docx`). The Markdown goes into `public/seed/docs.json` like any other document. The three Demand training files (Demand Framework, the Demand Upskill Training Guide SOP and the Demand Training job description and SOPs) were added this way, in the Medsum & Demands collection. The page text supports nested lists (two spaces per level).

## Procedures from Word files (scripts/add_docx.py)

`python3 scripts/add_docx.py file.docx --title … --collection … --type SOP --tags … --key short-name` adds a Word document as a page of `public/seed/docs.json` (converted by `docx_to_md.py`, checked for lost words, summary from the first paragraph). `FIXES` in that script are applied to every page: they take the name of the firm the procedures came from, its web and e-mail domain, and a saved card's last digits out, so the library names no firm (an e-mail reads `litigation@[firm domain]`). The 22 procedure documents added so far are the six numbered litigation procedures (initiation, service of pleadings, pending response, discovery, scheduling depositions, mediation and CME, proposal for settlement), setting motions for hearings, e-filing, motion to withdraw, serving through the Secretary of State, Sunbiz company search, clearing the calendars, IME client notices, medical records and bills, file review for demands and reductions, SR and CS to clients, unresponsive clients, new files, first-stage intake, the litigation paralegal role description, health subrogation set-up and the PI litigation phases. Usernames and passwords found in a source are never copied in.

## Scanned procedures (scripts/lessons/pi-training/)

Two PDFs with no text layer were transcribed by hand from their page images: a 36-page personal injury new-hire training (new-hire checklist, calls, case phases, tasks and notes, roles, naming documents and folders, welcome call, documenting in the case system, 2-week calls and balance verification, treatment case review, pre-demand requirements, invoices, withdrawal and termination) and a 4-page client onboarding packet (contract for legal services, HIPAA authorization, power of attorney). They are 14 Markdown files, added to `docs.json` with `scripts/add_lesson.py --section …`: 13 pages in Case Management under the section "Personal Injury Team Procedures", and the sample packet in Intake under "Onboarding". The firm's name, address, phone and staff names are left out (the packet shows `[Firm Name]`), and no credentials are copied. `docs.json` entries can carry a `section`, which Import documents applies. A reviewer should read the transcriptions against the originals.

## Written lessons (scripts/add_lesson.py)

A lesson written for the Knowledge Base, not taken from a PDF or Tettra, lives as Markdown in `scripts/lessons/` and is added to `public/seed/docs.json` with `python3 scripts/add_lesson.py scripts/lessons/<file>.md --title … --summary … --collection … --tags …`; **Admin → Import documents** publishes it (and updates it if the text changes). The first is **Insurance Coverage in Personal Injury Claims: What Applies, Who Pays and How to Find It** (about 3,000 words, in Insurance Communication): the coverages in an injury claim, 1P and 3P claims, who pays first with a worked example, the coverage hunt, reading a declarations page, common coverage problems and a quick-reference table. It is written from general knowledge of US insurance practice, so a reviewer should check state-specific points.

The second is **How to calculate non-economic damages** (about 3,000 words, in Medsum & Demands): what pain and suffering and the other non-economic losses are, why there is no formula, the support team's role (gather and organize, never quote a value), how a value is built step by step, the multiplier, per diem, evaluation-software and comparable-verdict methods with worked examples, what raises or lowers the value, limits that vary by state (comparative fault, no-fault thresholds, caps), an evidence checklist, the damages section of the demand and common mistakes. Also written from general knowledge, so an attorney should check it.

A third page is a transcription of an image-only infographic, **What happens after a car accident in Florida? The property damage claim process** (in Insurance Communication): the six steps (intake, liability, insurance and coverage, vehicle damage, repair or total loss, documentation and follow-up), what is gathered at each and the skill used.

## Titles in sentence case

An ALL-CAPS title or heading is shown in sentence case ("WRITE A WINNING DEMAND LETTER" becomes "Write a winning demand letter"; mixed-case titles are not touched). `scripts/sentence_case.py` does it for the bundled files (`python3 scripts/sentence_case.py` rewrites `public/seed/*.json`, and the converters `tettra_convert.py`, `add_docx.py` and `add_lesson.py` apply it themselves). The Worker applies the same rules to a title when an entry is saved (`fixTitle` in `src/util.js`), and **Admin → Import documents → Tidy ALL-CAPS titles** fixes entries already in the library (each fix is a new version, so the history keeps the old title). Acronyms (SOP, PIP, ADR, ERISA and so on) and a few proper nouns (Medicare, Medicaid, United States) keep their capitals; the lists are in both files. Long bold sentences in capitals inside a contract are left alone, because they are emphasis.

## Training topics (Admin → Import documents)

`public/seed/training.json` has one page for each topic of the Foundational Training lessons 1 to 8 (68 pages: 6, 11, 9, 6, 9, 11, 9 and 7 per lesson), made by `node scripts/training_topics.mjs <Foundational-Training repo>`. A topic is the part of a lesson between its slide-list dividers (`FT_TOPICS` in that repo's `js/ft-updates.js`); its page is the text of those slides under the slides' own headings. Each page is in the **Foundational Training** collection, in a section named for its lesson, tagged `training` and `lesson N`. The **Import documents** button adds them (12 per call, repeated by itself) and is safe to run again: a page already imported is skipped, or updated if the lesson's text changed (`legacy_ref` = `train:<lesson>-T<topic>`). Trainer-only material (the Training Guide, facilitator's notes, answer sheets) is not used.

## Tettra import (Admin → Import Tettra pages)

`public/seed/tettra.json` holds the 46 pages of LSH's Tettra export that are about the law practice itself (made by `python3 scripts/tettra_convert.py <export.json>`: the HTML becomes the library's Markdown, owner e-mails are dropped). **Step 1, Import pages** publishes them 12 at a time: each Tettra category becomes a collection, each subcategory a section, and the page's owner, created and updated dates are kept (`legacy_ref` = `tettra:<id>`). **Step 2, Copy images** copies the 629 images into R2 (`kb/img/<hash>`, 15 per call) so they stay if Tettra is closed; until then an image is copied the first time someone opens it. Images are served at `/img/<hash>` to signed-in readers only. When the last page is in, the starter collections that have nothing in them (Reception, Intake and so on) are archived, so only collections with knowledge in them are listed; Admin can bring one back. **3, Refresh the search** rebuilds the search for every published entry (it also runs by itself after steps 1 and the handouts); a collection's name is searchable, so "VA Management" finds that category's pages. Running step 1 again also brings pages imported earlier up to date with the file. **Left out as company policies:** the three sections "I. Company Information", "II. Client Management" and "II. VA Management" (13 pages); step 1 archives any of them imported earlier (hidden, every version kept; an admin can restore one). **Brought up to date:** links to other Tettra pages go to their Knowledge Base pages, "Tettra article" reads "Knowledge Base article", the Tettra login that was in the Task Assessment Manual is removed, links that no longer work (`scripts/dead_links.json`) say "(link no longer works)", and the 19 pages whose dates stop at 2023 or earlier carry a "Needs review" note and the `needs-review` tag. **The Knowledge Base is limited to the law practice itself** (intake, claims and case work, bills and records, demands, medical summaries and liens, litigation, practice areas). Also left out: software tutorials ("III. Tools & Applications": Clio, Filevine, Lawmatics, LawPay, Airtable, PracticePanther, Monday.com, Nitro Pro), "III. Service: Document Generation" (Filevine and Lawmatics), "III. Service: Automation" (Zapier), "III. Service: Marketing" (video editors), "III Service: Accounting/Bookkeeping" (QuickBooks), and three general VA-skills pages ("Email Management", "Ways to Manage Your Email Inbox", "Upskill on your FREE TIME"). They are in `EXCLUDE_CATEGORIES` and `EXCLUDE_TITLES` in `scripts/tettra_convert.py`; take a name out of those lists and run the converter to bring it back. Also left out as company-internal: "LSH Marketing Products", "LSH Task Assessment Manual (TAM)" and Tettra's 10 starter templates (step 1 archives any of them imported earlier). The two dictionary pages, "LSH Legal Jargon" and "Medical Terminologies and Abbreviations", are the Glossary instead of entries. Also left out: one page deleted in Tettra, the empty "asd" test page, and "How to Install Nitro Pro" (instructions for a cracked copy).

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
npx wrangler dev --var KB_CODE_LOGIN:on --var PORTAL_URL:http://127.0.0.1:8789   # http://127.0.0.1:8787; the end-to-end test runs a mock Portal on 8789
pip install playwright && npm pack pdfjs-dist@3.11.174 && mkdir -p tests/.cache/pdfjs && tar xzf pdfjs-dist-3.11.174.tgz -C tests/.cache/pdfjs
npm test                                    # end-to-end checks; start from fresh local data (rm -rf .wrangler/state, seed again)
npm run test:blueprint                      # the 🧭 Blueprint; needs Node Playwright and jsPDF (npm install --no-save playwright jspdf@4.2.1, npx playwright install chromium)
npm run test:paste-format                   # paste autoformatting; pure logic, no server or browser needed
npm run test:autoformat-body                # autoformatting existing articles; pure logic, no server or browser needed
```

The tests cover:
- sign-in (the code and admin login)
- the import
- a 25 MB upload in parts, checked byte for byte
- video Range requests and playback
- search inside a PDF
- suggestions, review, history, restore, official, archive and purge
- the 🧭 Blueprint (`tests/blueprint.cjs`): a VA gets the VA deck only and an admin both; every slide fits on a laptop and on a phone; both PDFs have a page per slide; the numbers match everywhere (Cover, then 1 to n, never n + 1)
- paste autoformatting (`tests/paste-format.cjs`): a pasted table, bold/italic/underline (including Google Docs' styled-span bold), a link and a list convert to this library's markdown; plain text with nothing to convert is left alone; a spreadsheet's tab-separated paste becomes a table the same way
- autoformatting existing articles (`tests/autoformat-body.cjs`): a plain-text table (by tabs, a bare `|`, or wide spaces) becomes a real table, a leading "Label:" is bolded, running it twice changes nothing the second time, and a heading, list, quote or already-valid table is left exactly as it is

**Checks on GitHub** (`.github/workflows/checks.yml`): every pull request and every push to the default branch builds the Worker without deploying (`wrangler deploy --dry-run`) and runs all of the tests above against a local `wrangler dev` with fresh, seeded data. A red **Checks** status means something broke; the log says which step.
