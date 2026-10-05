// Backups of the whole Knowledge Base in R2 (the FILES bucket), under kb/backups/.
// The site itself runs on D1; each backup is one JSON file holding every row of the library's tables, so all of the
// information is also in R2 next to the uploaded files (kb/files/) and the copied images (kb/img/).
// Left out on purpose: kb_settings (it holds the access-code hash and sign-in settings), kb_rate (throttle counters)
// and lib_fts (the search index, rebuilt from the entries by Admin → Refresh the search).
import { nowIso } from './util.js';

const PREFIX = 'kb/backups/';
const KEEP = 30;   // daily backups kept; older ones are deleted
// parents before children, so a restore reads naturally
const TABLES = ['lib_collections', 'lib_entries', 'lib_revisions', 'lib_files', 'lib_entry_files', 'lib_images', 'lib_terms',
    'lib_roles', 'kb_comments', 'kb_stats', 'kb_votes'];

export async function buildSnapshot(db) {
    const out = { app: 'lsh-knowledge-base', version: 1, createdAt: nowIso(), tables: {} };
    for (const t of TABLES) out.tables[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results || [];
    return out;
}

// Writes kb/backups/<date>/<timestamp>.json. Several on one day are allowed; only the newest KEEP days are kept.
export async function backupToR2(env, db, by) {
    if (!env.FILES) throw new Error('File storage isn’t connected: the R2 bucket (FILES) is not bound to this Worker.');
    const snap = await buildSnapshot(db);
    snap.by = by || 'scheduled';
    const stamp = snap.createdAt.replace(/[:.]/g, '-');
    const key = `${PREFIX}${snap.createdAt.slice(0, 10)}/${stamp}.json`;
    const body = JSON.stringify(snap);
    await env.FILES.put(key, body, { httpMetadata: { contentType: 'application/json' }, customMetadata: { by: snap.by } });
    await prune(env);
    const rows = Object.values(snap.tables).reduce((n, r) => n + r.length, 0);
    return { key, bytes: body.length, rows, createdAt: snap.createdAt };
}

export async function listBackups(env) {
    if (!env.FILES) return [];
    const all = [];
    let cursor;
    do {
        const page = await env.FILES.list({ prefix: PREFIX, cursor });
        all.push(...page.objects);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return all.map(o => ({ key: o.key, bytes: o.size, uploaded: o.uploaded.toISOString(), by: (o.customMetadata && o.customMetadata.by) || '' }))
        .sort((a, b) => b.key.localeCompare(a.key));
}

async function prune(env) {
    const list = await listBackups(env);
    const days = [...new Set(list.map(b => b.key.split('/')[2]))];   // newest first
    const old = new Set(days.slice(KEEP));
    for (const b of list) if (old.has(b.key.split('/')[2])) await env.FILES.delete(b.key);
}

// Puts the rows of a backup back. Rows with the same id are replaced; rows that are not in the backup are left alone,
// so a restore never deletes anything made since. Column names are checked against the live table, never trusted.
export async function restoreFromR2(env, db, key) {
    if (!env.FILES) throw new Error('File storage isn’t connected: the R2 bucket (FILES) is not bound to this Worker.');
    if (!key || !key.startsWith(PREFIX) || key.includes('..')) throw new Error('Choose one of the backups in the list.');
    const obj = await env.FILES.get(key);
    if (!obj) throw new Error('That backup no longer exists.');
    const snap = JSON.parse(await obj.text());
    if (snap.app !== 'lsh-knowledge-base' || !snap.tables) throw new Error('That file is not a Knowledge Base backup.');
    const restored = {};
    for (const t of TABLES) {
        const rows = snap.tables[t];
        if (!Array.isArray(rows) || !rows.length) continue;
        const live = new Set(((await db.prepare(`PRAGMA table_info(${t})`).all()).results || []).map(c => c.name));
        for (let i = 0; i < rows.length; i += 40) {
            await db.batch(rows.slice(i, i + 40).map(r => {
                const cols = Object.keys(r).filter(c => live.has(c));
                return db.prepare(`INSERT OR REPLACE INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
                    .bind(...cols.map(c => r[c] === undefined ? null : r[c]));
            }));
        }
        restored[t] = rows.length;
    }
    return { restored, createdAt: snap.createdAt };
}
