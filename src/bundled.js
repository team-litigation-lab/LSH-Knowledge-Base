import { nowIso } from './util.js';
import { makeLive, getSetting, setSetting } from './db.js';
import { COURSE_HANDOUTS, SYNC_NOTE } from './sync.js';

/* Bundled pages keep themselves in the library.
   public/seed/docs.json (written lessons, procedures, handouts), training.json (one page per topic of the Foundational
   Training's lessons) and tettra.json (the firm's Tettra pages) are the library's bundled pages. They used to wait for an
   admin to run an import, and the Admin screen lost its import buttons (#28): nothing new in a bundle reached the library,
   so a link to a newer page (a course slide's #/doc/… or #/topic/… link, a Tettra page's /#/go/… link) said the page wasn't
   in the library, and pages imported long ago kept their old links. Now:
   - a page that a link asks for and that isn't in the library yet is added on the spot (resolveRef, behind /api/resolve);
   - the Worker's schedule (wrangler.jsonc) adds every page that isn't in yet and brings a page up to date when its bundled
     text changed, a few dozen pages a run, until the library matches the bundles (syncBundled). The bundles' fingerprint is
     kept in kb_settings ('bundled'), so a run with nothing to do costs one read; each run is noted in 'bundled_run'.
   What is never done here: overwriting text someone edited in the library (a page is updated only while its live text is
   still the text an import last wrote), archiving a page or bringing back one an admin archived, and bringing back a page an
   admin deleted (lib_ref_gone remembers it). Those stay an admin's decision. */

export const BUNDLE_NOTES = { added: 'Added from the bundled pages', updated: 'Updated from the bundled pages' };
const SYSTEM = { name: 'LSH Team', batch: '', key: 'system|bundled' };
const REVIEWER = 'Automatic: bundled page';
// The notes the imports (this file, the old admin imports, the course-handout sync) write on a version. With the authors
// below they mark "the text an import wrote": a page whose live text is still that text was never edited by hand.
const IMPORT_NOTES = [BUNDLE_NOTES.added, BUNDLE_NOTES.updated, 'Added from the bundled documents', 'Updated from the bundled document',
    'Added from the Foundational Training handouts', 'Made from the Foundational Training lesson', 'Training topic updated from the lesson',
    'Updated from the course handout'];
const IMPORT_AUTHOR = `(m.author_key LIKE 'tettra|%' OR m.author_key LIKE 'system|bundled%' OR m.author_key LIKE 'sync:%' OR (m.by_staff = 1 AND m.note IN (${IMPORT_NOTES.map(() => '?').join(',')})))`;
// Pages kept in step with a course's own source (src/sync.js): once that sync has written one, it is the course's to update,
// not the bundle's (the two would take turns otherwise).
const COURSE_REFS = new Set(COURSE_HANDOUTS.map(h => h.ref));

export const slugOf = (name) => String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'collection';
export const collectionOf = (cat) => cat === 'Test. Test' ? 'general' : slugOf(cat);
export const tettraTime = (t) => String(t || '').replace(' ', 'T') + 'Z';

// A link's reference to a bundled page: a docs.json file name, a training topic (L<lesson>-T<topic>) or a Tettra page id.
export const REF_RE = /^(seed:[a-z0-9][\w.-]{0,160}|train:L\d{1,2}-T\d{1,3}|tettra:\d{1,12})$/i;

const KINDS = {
    seed: { path: '/seed/docs.json', items: (j) => (Array.isArray(j) ? j : []), key: (d) => d.file,
        data: (d) => ({ collection: d.collection, section: d.section || '', type: d.type || 'Guide', title: d.title, summary: d.summary || '',
            body: d.body, tags: d.tags || [], credits: [], files: [], official: false }) },
    train: { path: '/seed/training.json', items: (j) => (j && j.pages) || [], key: (p) => p.id,
        data: (p) => ({ collection: 'foundational', section: `Lesson ${p.lesson} · ${p.lessonTitle}`, type: 'Guide', title: p.title,
            summary: p.summary || '', body: p.body, tags: ['training', 'lesson ' + p.lesson], credits: [], files: [], official: false }) },
    tettra: { path: '/seed/tettra.json', items: (j) => (j && j.pages) || [], key: (p) => String(p.id),
        data: (p) => ({ collection: collectionOf(p.category), section: p.subcategory || '', type: 'Guide', title: p.title, summary: p.summary || '',
            body: p.body, tags: p.tags || [], credits: p.owner ? [p.owner] : [], files: [], official: false }),
        // a Tettra page keeps its owner and its Tettra dates, as the Tettra import always did
        author: (p) => ({ name: p.owner || 'LSH Team', batch: '', key: 'tettra|' + p.id }),
        times: (p) => ({ created: tettraTime(p.created), updated: tettraTime(p.updated) }) }
};
export const KIND_ORDER = ['seed', 'train', 'tettra'];   // the written lessons first: they are what the course slides link to

/* The link rules (public/seed/links.json, from a link check of the live and bundled pages), applied to a page's Markdown: a
   moved link gets its new address, a dead one keeps its words and loses its link (marked, as the Tettra converter marks one), a
   link marked dead that works after all loses the mark, and a link to a Tettra page goes to that page in the library (or says
   it is an old page that isn't). Pure, so tests/bundled-sync.cjs checks it. tettra: the Tettra pages' addresses' last part
   (their "slug") → the page's Tettra id, from tettra.json. */
const DEAD = ' *(link no longer works)*', OLD_PAGE = ' *(an old page that is not in the library)*';
const tettraSlug = (u) => { const m = /^https?:\/\/app\.tettra\.co\/teams\/[^/\s]+\/pages\/([a-z0-9-]+?)(?:Edit\S*)?(?:[#?]\S*)?$/i.exec(u); return m ? m[1].toLowerCase() : null; };
export function fixLinks(md, rules, tettra = new Map()) {
    if (!md || !rules) return md || '';
    const moved = rules.moved || {}, dead = new Set(rules.dead || []), alive = new Set(rules.alive || []);
    // a Markdown link, with the dead mark that may follow it
    let out = String(md).replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)( \*\(link no longer works\)\*)?/g, (all, text, url, marked) => {
        if (moved[url]) return `[${text}](${moved[url]})`;
        if (dead.has(url)) return text + DEAD;
        if (marked && alive.has(url)) return `[${text}](${url})`;
        const slug = tettraSlug(url);
        if (slug) return tettra.has(slug) ? `[${text}](/#/go/${tettra.get(slug)})` : text + OLD_PAGE;
        return all;
    });
    // a bare address in the text (the library links those itself); not one inside a link above
    out = out.replace(/(?<![(\[\/\w])(https?:\/\/[^\s<)\]]*[^\s<).,;:!?'\]*])/g, (url) => {
        if (moved[url]) return moved[url];
        if (dead.has(url)) return url.replace(/^https?:\/\//, '') + DEAD;   // no longer an address, so it isn't linked
        const slug = tettraSlug(url);
        if (slug) return tettra.has(slug) ? `[this page](/#/go/${tettra.get(slug)})` : 'an old Tettra page' + OLD_PAGE;
        return url;
    });
    return out;
}
async function loadRules(env) {
    const [links, t] = await Promise.all([loadFile(env, '/seed/links.json'), loadBundle(env, 'tettra')]);
    const tettra = new Map();
    for (const p of t.items) { const slug = tettraSlug(String(p.url || '')); if (slug) tettra.set(slug, String(p.id)); }
    return { text: links.text, rules: links.json || {}, tettra };
}

const loaded = new Map();   // per Worker instance: the bundles are part of the deploy, so they never change under it
async function loadFile(env, path) {
    if (loaded.has(path)) return loaded.get(path);
    const res = await env.ASSETS.fetch(new Request('https://bundle.invalid' + path));
    const text = res.ok ? await res.text() : '';
    const f = { text, json: text ? JSON.parse(text) : null };
    loaded.set(path, f);
    return f;
}
async function loadBundle(env, kind) {
    const f = await loadFile(env, KINDS[kind].path);
    return { ...f, items: KINDS[kind].items(f.json) };
}
async function fingerprint(texts) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texts.join('\u0000')));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
// (files: a handout imported long ago as a PDF attachment becomes the text page its bundle now holds, as Import documents did)
const FIELDS = ['title', 'summary', 'collection', 'section', 'type', 'tags', 'credits', 'files'];
// What to do with one bundled page. row: its library entry, if any ({status, live, imp}: the live version's data and the data
// the last import wrote). Pure, so tests/bundled-sync.cjs checks it without a database.
export function planChange(want, row, { updatable = true } = {}) {
    if (!row) return { op: 'add' };
    if (row.status !== 'published') return null;                   // archived or waiting for review: an admin's call
    if (!updatable) return null;
    const live = row.live, imp = row.imp;
    if (!live || !imp || live.body !== imp.body) return null;       // edited in the library: never overwritten
    // a field someone changed since the import keeps their value (a title put in sentence case, a page moved to a section)
    const next = { ...live, body: want.body };
    for (const k of FIELDS) next[k] = same(live[k], imp[k]) ? want[k] : live[k];
    return FIELDS.concat('body').every(k => same(next[k], live[k])) ? null : { op: 'update', data: next };
}

async function entriesOf(db, kind) {
    const { results } = await db.prepare(`SELECT e.id, e.legacy_ref AS ref, e.status, lr.data AS live, lr.note AS live_note,
            (SELECT m.data FROM lib_revisions m WHERE m.entry_id = e.id AND ${IMPORT_AUTHOR} ORDER BY m.id DESC LIMIT 1) AS imp
        FROM lib_entries e LEFT JOIN lib_revisions lr ON lr.id = e.live_rev WHERE e.legacy_ref LIKE ?`).bind(...IMPORT_NOTES, kind + ':%').all();
    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
    return new Map((results || []).map(r => [r.ref, { id: r.id, status: r.status, live: parse(r.live), imp: parse(r.imp), liveNote: r.live_note || '' }]));
}

// The Tettra pages' collections (one per Tettra category) and their image list, before a Tettra page is added or updated.
async function prepareTettra(db, bundle, now) {
    const pages = bundle.items, images = (bundle.json && bundle.json.images) || {};
    const cats = [...new Set(pages.map(p => p.category))].sort();
    await db.batch(cats.map((c, i) => db.prepare(`INSERT INTO lib_collections (slug, name, blurb, sort, archived, created_at) VALUES (?, ?, '', ?, 0, ?)
        ON CONFLICT(slug) DO NOTHING`).bind(collectionOf(c), c === 'Test. Test' ? 'General' : c, 1000 + i, now)));
    const rows = Object.entries(images);
    const have = await db.prepare(`SELECT COUNT(*) AS n FROM lib_images`).first();
    if (!have || have.n < rows.length)
        for (let i = 0; i < rows.length; i += 90) await db.batch(rows.slice(i, i + 90).map(([h, u]) => db.prepare(`INSERT OR IGNORE INTO lib_images (hash, src) VALUES (?, ?)`).bind(h, u)));
}

const wanted = (kind, item, L) => { const d = KINDS[kind].data(item); d.body = fixLinks(d.body, L.rules, L.tettra); return d; };
async function addPage(db, kind, item, now, L) {
    const K = KINDS[kind], data = wanted(kind, item, L), ref = kind + ':' + K.key(item);
    const who = K.author ? K.author(item) : SYSTEM, t = K.times ? K.times(item) : { created: now, updated: now };
    // the page's collection shows again if the starter shelves were tidied away (as the imports always did)
    await db.prepare(`UPDATE lib_collections SET archived = 0 WHERE slug = ? AND archived = 1`).bind(data.collection).run();
    const r = await db.prepare(`INSERT INTO lib_entries (status, collection, section, type, title, summary, tags, author_name, author_batch, author_key, by_staff, legacy_ref, created_at, updated_at)
        VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(data.collection, data.section, data.type, data.title, data.summary, data.tags.join(','),
        who.name, who.batch, who.key, ref, t.created, t.updated).run();
    const id = r.meta.last_row_id;
    const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, 1, ?)`).bind(id, JSON.stringify(data), BUNDLE_NOTES.added, who.name, who.batch, who.key, t.created).run();
    await makeLive(db, id, rev.meta.last_row_id, { reviewer: REVIEWER });
    if (K.times) await db.prepare(`UPDATE lib_entries SET created_at = ?, updated_at = ?, published_at = ? WHERE id = ?`).bind(t.created, t.updated, t.updated, id).run();
    return id;
}
async function updatePage(db, entryId, data, now) {
    const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
        VALUES (?, ?, 'pending', ?, ?, ?, ?, 1, ?)`).bind(entryId, JSON.stringify(data), BUNDLE_NOTES.updated, SYSTEM.name, SYSTEM.batch, SYSTEM.key, now).run();
    await makeLive(db, entryId, rev.meta.last_row_id, { reviewer: REVIEWER });
}
const isUnique = (e) => /UNIQUE constraint failed/i.test(String((e && e.message) || e));
const isLimit = (e) => /too many|limit|exceeded|subrequest/i.test(String((e && e.message) || e));

// One page, for a link that asks for it (/api/resolve). {id} when it is (now) in the library, else {status}: 'archived' or
// 'pending' (an admin's call), 'removed' (an admin deleted it), 'missing' (no such bundled page).
export async function resolveRef(env, db, ref) {
    const find = () => db.prepare(`SELECT id, status FROM lib_entries WHERE legacy_ref = ?`).bind(ref).first();
    const row = await find();
    if (row) return row.status === 'published' ? { id: row.id } : { status: row.status };
    if (await db.prepare(`SELECT 1 AS g FROM lib_ref_gone WHERE ref = ?`).bind(ref).first()) return { status: 'removed' };
    const kind = ref.slice(0, ref.indexOf(':')), key = ref.slice(ref.indexOf(':') + 1);
    if (!KINDS[kind]) return { status: 'missing' };
    const bundle = await loadBundle(env, kind), item = bundle.items.find(it => String(KINDS[kind].key(it)) === key);
    if (!item) return { status: 'missing' };
    const now = nowIso(), L = await loadRules(env);
    try {
        if (kind === 'tettra') await prepareTettra(db, bundle, now);
        return { id: await addPage(db, kind, item, now, L) };
    } catch (e) {
        if (!isUnique(e)) throw e;   // the schedule added it at the same moment: use that one
        const again = await find();
        return again && again.status === 'published' ? { id: again.id } : { status: again ? again.status : 'missing' };
    }
}

// Brings the library in step with the bundles, at most `budget` pages a call. kinds: which bundles (all three by default).
// force: work even when the fingerprint says the last complete run already matched these bundles.
export async function syncBundled(env, db, { kinds = KIND_ORDER, budget = 25, force = false } = {}) {
    const started = Date.now(), now = nowIso();
    const bundles = {};
    for (const k of kinds) bundles[k] = await loadBundle(env, k);
    const L = await loadRules(env);
    const whole = kinds.length === KIND_ORDER.length;
    const print = await fingerprint(KIND_ORDER.filter(k => bundles[k]).map(k => bundles[k].text).concat(L.text));
    if (whole && !force) {
        const last = JSON.parse((await getSetting(db, 'bundled')) || 'null');
        if (last && last.hash === print) return { status: 'up-to-date', added: 0, updated: 0, remaining: 0 };
    }
    const { results: goneRows } = await db.prepare(`SELECT ref FROM lib_ref_gone`).all();
    const gone = new Set((goneRows || []).map(r => r.ref));
    let added = 0, updated = 0, remaining = 0, stopped = '', errors = 0;
    for (const kind of kinds) {
        const K = KINDS[kind], bundle = bundles[kind];
        if (!bundle.items.length) continue;
        const have = await entriesOf(db, kind);
        const work = [], inBundle = new Set();
        for (const item of bundle.items) {
            const ref = kind + ':' + K.key(item);
            inBundle.add(ref);
            if (gone.has(ref)) continue;
            const row = have.get(ref);
            const p = planChange(wanted(kind, item, L), row, { updatable: !(COURSE_REFS.has(ref) && row && row.liveNote === SYNC_NOTE) });
            if (p) work.push({ item, ref, row, p });
        }
        // a page imported long ago that is no longer in its bundle (the Tettra pages left out of it): only its links are fixed,
        // and only while its text is still the text the import wrote
        for (const [ref, row] of have) {
            if (inBundle.has(ref) || row.status !== 'published' || !row.live || !row.imp || row.live.body !== row.imp.body) continue;
            const body = fixLinks(row.live.body, L.rules, L.tettra);
            if (body !== row.live.body) work.push({ ref, row, p: { op: 'update', data: { ...row.live, body } } });
        }
        if (work.length && kind === 'tettra' && !stopped && added + updated < budget) await prepareTettra(db, bundle, now);
        for (const w of work) {
            if (stopped || added + updated >= budget) { remaining++; continue; }
            try {
                if (w.p.op === 'add') { await addPage(db, kind, w.item, now, L); added++; }
                else { await updatePage(db, w.row.id, w.p.data, now); updated++; }
            } catch (e) {
                if (isUnique(e)) continue;                                   // a link added it meanwhile (resolveRef)
                if (isLimit(e)) { stopped = String(e.message || e).slice(0, 200); remaining++; continue; }   // this run's share is used up
                errors++; remaining++; console.error('bundled page', w.ref, e);
            }
        }
    }
    const run = { at: now, added, updated, remaining, ms: Date.now() - started, ...(stopped ? { stopped } : {}), ...(errors ? { errors } : {}) };
    await setSetting(db, 'bundled_run', JSON.stringify(run));
    if (whole && !remaining && !errors && !stopped) await setSetting(db, 'bundled', JSON.stringify({ hash: print, at: now }));
    return { status: remaining ? 'partial' : 'done', ...run };
}

// The pages an admin deleted on purpose: kept out of the library for good (lib_ref_gone), like the Glossary's removed terms.
export async function forgetRef(db, ref) {
    if (ref && REF_RE.test(ref)) await db.prepare(`INSERT OR IGNORE INTO lib_ref_gone (ref, at) VALUES (?, ?)`).bind(ref, nowIso()).run();
}
