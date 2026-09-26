import { getCookie, readToken, personKey, nowIso } from './util.js';

// Storage for the LSH Knowledge Base.
//
// D1 TRAINING_DB (shared with the LSH Training Portal, so the old Knowledge
// Base's team code, posts, replies, votes and views carry over):
//   kb_settings       team access code hash and version (same rows the portal used)
//   kb_comments / kb_stats / kb_votes / kb_rate   reused as-is; entries use the ref "e:<id>"
//   lib_collections   the library's shelves: one per program or role
//   lib_entries       one row per entry, with the live version's listing fields copied in
//   lib_revisions     every version of every entry, never overwritten
//   lib_files         uploaded files; the bytes live in R2 (FILES) under kb/files/
//   lib_entry_files   which files the live version of each entry shows (for access checks)
//   lib_roles         community reviewers
//   lib_fts           full-text search over the live version of each published entry
// D1 DB (the portal's accounts database, read-only here): admin sign-in and the site lock.

export const TYPES = ['Training video', 'SOP', 'Guide', 'Checklist', 'Template', 'Reference', 'Tip', 'Lesson learned', 'Question'];

export const DEFAULT_COLLECTIONS = [
    ['foundational', 'Foundational Training', 'The Standard Foundational Training program: day-by-day material, recordings and handouts.'],
    ['reception', 'Reception', 'Answering calls, greeting clients, messages and routing.'],
    ['calendar', 'Calendar Management', 'Scheduling, calendaring, reminders and docketing.'],
    ['intake', 'Intake & Client Communication', 'New-client intake, screening, and keeping clients informed.'],
    ['insurance', 'Insurance Communication', 'Claims, adjusters, policy limits and coverage letters.'],
    ['provider', 'Provider Communication & Records', 'Medical providers, records and bills requests, and follow-ups.'],
    ['lien', 'Lien Negotiation & Subrogation', 'Liens, reductions, payoffs, Medicare, Medicaid and health plans.'],
    ['case-management', 'Case Management', 'Running a case file from sign-up to settlement.'],
    ['ea-pa', 'EA / PA', 'Executive and personal assistant work for attorneys.'],
    ['litigation', 'Litigation & Discovery', 'Pleadings, discovery, e-filing and court deadlines.'],
    ['demands', 'Medsum & Demands', 'Medical summaries, demand letters and settlement packages.'],
    ['practice-areas', 'Practice Areas', 'Mass tort, family, immigration, estate planning, business and real estate law.'],
    ['tools', 'Tools & Systems', 'The software LSH VAs use every day, and how to use it well.'],
    ['skills', 'Productivity & Soft Skills', 'Writing, time management, and working with attorneys and clients.'],
    ['general', 'General', 'Everything else the community wants to keep.']
];

// The old Knowledge Base's categories and types, for the import.
export const LEGACY_COLLECTION = {
    'Case Management': 'case-management', 'EA / PA': 'ea-pa', 'Intake & Client Communication': 'intake',
    'Medical Records & Billing': 'provider', 'Demands & Negotiation': 'demands', 'Liens & Subrogation': 'lien',
    'Litigation & Discovery': 'litigation', 'Calendaring & Docketing': 'calendar', 'Mass Tort': 'practice-areas',
    'Family Law': 'practice-areas', 'Immigration Law': 'practice-areas', 'Estate Planning': 'practice-areas',
    'Business Law': 'practice-areas', 'Real Estate & Property': 'practice-areas', 'Tools & Systems': 'tools',
    'Productivity & Soft Skills': 'skills', 'General': 'general'
};
export const LEGACY_TYPE = { 'Tip': 'Tip', 'How-to guide': 'Guide', 'Checklist': 'Checklist', 'Template': 'Template', 'Lesson learned': 'Lesson learned', 'Question': 'Question' };

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS kb_settings (key TEXT PRIMARY KEY, value TEXT)`,
    `CREATE TABLE IF NOT EXISTS kb_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, article_ref TEXT NOT NULL, body TEXT NOT NULL,
        author_name TEXT NOT NULL, author_batch TEXT, author_key TEXT NOT NULL, by_admin INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', review_note TEXT, reviewed_by TEXT, reviewed_at TEXT,
        created_at TEXT NOT NULL, ip TEXT)`,
    `CREATE INDEX IF NOT EXISTS kb_comments_ref ON kb_comments (article_ref, status)`,
    `CREATE TABLE IF NOT EXISTS kb_stats (article_ref TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0, helpful INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS kb_votes (article_ref TEXT NOT NULL, voter TEXT NOT NULL, created_at TEXT, PRIMARY KEY (article_ref, voter))`,
    `CREATE TABLE IF NOT EXISTS kb_rate (ip TEXT NOT NULL, kind TEXT NOT NULL, bucket INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ip, kind, bucket))`,
    `CREATE TABLE IF NOT EXISTS lib_collections (
        slug TEXT PRIMARY KEY, name TEXT NOT NULL, blurb TEXT, sort INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS lib_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT NOT NULL, live_rev INTEGER,
        collection TEXT NOT NULL, section TEXT, type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT, tags TEXT,
        official INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
        has_video INTEGER NOT NULL DEFAULT 0, file_count INTEGER NOT NULL DEFAULT 0,
        author_name TEXT NOT NULL, author_batch TEXT, author_key TEXT NOT NULL, by_staff INTEGER NOT NULL DEFAULT 0,
        legacy_ref TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT,
        review_note TEXT, reviewed_by TEXT, reviewed_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS lib_entries_list ON lib_entries (status, collection, updated_at)`,
    `CREATE INDEX IF NOT EXISTS lib_entries_author ON lib_entries (author_key)`,
    `CREATE TABLE IF NOT EXISTS lib_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL,
        note TEXT, author_name TEXT NOT NULL, author_batch TEXT, author_key TEXT NOT NULL, by_staff INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, review_note TEXT, reviewed_by TEXT, reviewed_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS lib_revisions_entry ON lib_revisions (entry_id, id)`,
    `CREATE INDEX IF NOT EXISTS lib_revisions_status ON lib_revisions (status)`,
    `CREATE TABLE IF NOT EXISTS lib_files (
        id TEXT PRIMARY KEY, r2_key TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, mime TEXT,
        kind TEXT NOT NULL, status TEXT NOT NULL, upload_id TEXT, text TEXT,
        uploader_name TEXT, uploader_key TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT)`,
    `CREATE INDEX IF NOT EXISTS lib_files_uploader ON lib_files (uploader_key)`,
    `CREATE TABLE IF NOT EXISTS lib_entry_files (entry_id INTEGER NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY (entry_id, file_id))`,
    `CREATE INDEX IF NOT EXISTS lib_entry_files_file ON lib_entry_files (file_id)`,
    `CREATE TABLE IF NOT EXISTS lib_roles (person_key TEXT PRIMARY KEY, name TEXT NOT NULL, batch TEXT, role TEXT NOT NULL, granted_by TEXT, granted_at TEXT)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS lib_fts USING fts5(title, summary, body, tags, files, tokenize = 'porter unicode61')`
];

let ready = false;   // once per Worker instance
export async function ensureSchema(db) {
    if (ready) return;
    for (const s of SCHEMA) await db.prepare(s).run();
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM lib_collections`).first();
    if (!n || !n.n) {
        const now = nowIso();
        await db.batch(DEFAULT_COLLECTIONS.map(([slug, name, blurb], i) =>
            db.prepare(`INSERT OR IGNORE INTO lib_collections (slug, name, blurb, sort, created_at) VALUES (?, ?, ?, ?, ?)`).bind(slug, name, blurb, (i + 1) * 10, now)));
    }
    ready = true;
}

export async function getSetting(db, key) {
    const row = await db.prepare(`SELECT value FROM kb_settings WHERE key = ?`).bind(key).first();
    return row ? row.value : null;
}
export async function setSetting(db, key, value) {
    await db.prepare(`INSERT INTO kb_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

// The portal's site-wide lock (Master Control) closes this site too.
export async function siteLocked(env) {
    if (!env.DB) return false;
    try {
        const row = await env.DB.prepare(`SELECT locked FROM site_state WHERE id = 1`).first();
        return !!(row && row.locked);
    } catch (e) {
        return false;   // no site_state table: nothing is locked
    }
}

/* ---------- who is asking ---------- */
export const READER_COOKIE = 'lshkb';
export const ADMIN_COOKIE = 'lshkb_admin';

// { admin, reviewer, staff, adminUser, who:{name,batch,key} } or null (no access).
export async function getReader(request, env) {
    const db = env.TRAINING_DB;
    const adm = await readToken(getCookie(request, ADMIN_COOKIE), env.SESSION_SECRET);
    if (adm && adm.adm) {
        const name = adm.name || adm.username;
        return { admin: true, reviewer: false, staff: true, adminUser: adm.username,
            who: { name, batch: 'Admin', key: 'admin|' + String(adm.username).toLowerCase() } };
    }
    const p = await readToken(getCookie(request, READER_COOKIE), env.SESSION_SECRET);
    if (!p || !p.kb) return null;
    const version = await getSetting(db, 'code_version');
    if (!version || p.v !== version) return null;   // the code changed since they signed in
    const key = personKey(p.name, p.batch);
    const role = await db.prepare(`SELECT role FROM lib_roles WHERE person_key = ?`).bind(key).first();
    const reviewer = !!(role && role.role === 'reviewer');
    return { admin: false, reviewer, staff: reviewer, adminUser: null, who: { name: p.name, batch: p.batch || '', key } };
}

// Per-connection limit: `limit` hits of `kind` per 10 minutes. True when over.
export async function overLimit(request, db, kind, limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const bucket = Math.floor(Date.now() / 600000);
    try {
        await db.prepare(`INSERT INTO kb_rate (ip, kind, bucket, hits) VALUES (?, ?, ?, 1)
            ON CONFLICT(ip, kind, bucket) DO UPDATE SET hits = hits + 1`).bind(ip, kind, bucket).run();
        const row = await db.prepare(`SELECT hits FROM kb_rate WHERE ip = ? AND kind = ? AND bucket = ?`).bind(ip, kind, bucket).first();
        if (Math.random() < 0.05) await db.prepare(`DELETE FROM kb_rate WHERE bucket < ?`).bind(bucket - 1).run();
        return !!(row && row.hits > limit);
    } catch (e) {
        return false;
    }
}

/* ---------- entries ---------- */
export const refOf = (id) => 'e:' + id;

// Make a revision the live version of its entry: copy its listing fields onto
// the entry, point lib_entry_files at its files, and refresh the search index.
export async function makeLive(db, entryId, revId, { publish = true, reviewer = null } = {}) {
    const rev = await db.prepare(`SELECT * FROM lib_revisions WHERE id = ? AND entry_id = ?`).bind(revId, entryId).first();
    if (!rev) throw new Error('That version no longer exists.');
    const d = JSON.parse(rev.data);
    const now = nowIso();
    const files = d.files || [];
    const entry = await db.prepare(`SELECT status, published_at FROM lib_entries WHERE id = ?`).bind(entryId).first();
    const status = publish ? 'published' : entry.status;
    const stmts = [
        db.prepare(`UPDATE lib_revisions SET status = 'superseded' WHERE entry_id = ? AND status = 'live' AND id != ?`).bind(entryId, revId),
        db.prepare(`UPDATE lib_revisions SET status = 'live', reviewed_by = COALESCE(?, reviewed_by), reviewed_at = COALESCE(?, reviewed_at) WHERE id = ?`)
            .bind(reviewer, reviewer ? now : null, revId),
        db.prepare(`UPDATE lib_entries SET live_rev = ?, status = ?, collection = ?, section = ?, type = ?, title = ?, summary = ?, tags = ?,
            official = ?, has_video = ?, file_count = ?, updated_at = ?, published_at = COALESCE(published_at, ?) WHERE id = ?`)
            .bind(revId, status, d.collection, d.section || '', d.type, d.title, d.summary || '', (d.tags || []).join(','),
                d.official ? 1 : 0, files.some(f => f.kind === 'video') ? 1 : 0, files.length, now, status === 'published' ? now : null, entryId),
        db.prepare(`DELETE FROM lib_entry_files WHERE entry_id = ?`).bind(entryId),
        ...files.map(f => db.prepare(`INSERT OR IGNORE INTO lib_entry_files (entry_id, file_id) VALUES (?, ?)`).bind(entryId, f.id))
    ];
    await db.batch(stmts);
    await reindex(db, entryId);
}

// Search holds only published entries' live versions.
export async function reindex(db, entryId) {
    await db.prepare(`DELETE FROM lib_fts WHERE rowid = ?`).bind(entryId).run();
    const e = await db.prepare(`SELECT e.status, r.data FROM lib_entries e JOIN lib_revisions r ON r.id = e.live_rev WHERE e.id = ?`).bind(entryId).first();
    if (!e || e.status !== 'published') return;
    const d = JSON.parse(e.data);
    const ids = (d.files || []).map(f => f.id);
    let fileText = (d.files || []).map(f => f.name).join(' ');
    if (ids.length) {
        const { results } = await db.prepare(`SELECT text FROM lib_files WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
        fileText += ' ' + (results || []).map(r => r.text || '').join(' ');
    }
    await db.prepare(`INSERT INTO lib_fts (rowid, title, summary, body, tags, files) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(entryId, d.title, d.summary || '', d.body || '', (d.tags || []).join(' ') + ' ' + (d.section || ''), fileText.slice(0, 400000)).run();
}

// A search box's words → an FTS5 query: every word must match, the last one as a prefix.
export function ftsQuery(q) {
    const words = String(q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length) return null;
    return words.slice(0, 12).map((w, i, a) => `"${w}"${i === a.length - 1 ? '*' : ''}`).join(' ');
}
