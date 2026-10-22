#!/usr/bin/env node
// Writes the course handouts kept in step with their source (COURSE_HANDOUTS in src/sync.js) into public/seed/docs.json,
// as the same Markdown the Worker publishes on its schedule, so the bundled copy (Import documents) is never older than
// the library's page.
//   node scripts/sync_course_handouts.mjs                       (fetches each source from GitHub)
//   node scripts/sync_course_handouts.mjs --repo <course repo>  (reads it from a local checkout instead)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSE_HANDOUTS, handoutToMd } from '../src/sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'public/seed/docs.json');
const at = process.argv.indexOf('--repo'), repo = at > 0 ? process.argv[at + 1] : null;

const source = async (h) => {
    if (repo) return fs.readFileSync(path.join(repo, h.url.replace(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\//, '')), 'utf8');
    const r = await fetch(h.url);
    if (!r.ok) throw new Error(`${h.url}: HTTP ${r.status}`);
    return r.text();
};

const docs = JSON.parse(fs.readFileSync(DOCS, 'utf8'));
let changed = 0;
for (const h of COURSE_HANDOUTS) {
    const d = docs.find(x => 'seed:' + x.file === h.ref);
    if (!d) { console.log(`not in docs.json: ${h.ref}`); continue; }
    const body = handoutToMd(await source(h));
    if (d.body === body) { console.log(`up to date: ${d.title}`); continue; }
    d.body = body; changed++;
    console.log(`updated: ${d.title} (${body.length} characters)`);
}
if (changed) fs.writeFileSync(DOCS, JSON.stringify(docs, null, 1));
