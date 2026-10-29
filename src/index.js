import { json, fail, nowIso, clean, oneLine, fixTitle, autoformatBody, personKey, signToken, hashPassword, verifyPassword, setCookie, sameOrigin, readJson } from './util.js';
import { ensureSchema, getSetting, setSetting, siteLocked, getReader, overLimit, makeLive, reindex, ftsQuery, refOf,
    READER_COOKIE, ADMIN_COOKIE, TYPES, DEFAULT_COLLECTIONS, LEGACY_COLLECTION, LEGACY_TYPE } from './db.js';
import { startUpload, putPart, finishUpload, abortUpload, saveFileText, serveFile } from './files.js';
import { syncCourseHandouts } from './sync.js';

// LSH Knowledge Base Worker. Static pages come from public/ (the ASSETS
// binding); this Worker answers /api/* and streams uploaded files at /files/*.

const infoOnly = () => fail('Info Access is view-only. Tenured team members can add to the library, and an admin approves it. Ask an admin for tenured access.', 403, { code: 'INFO_ONLY' });
const READER_DAYS = 30, ADMIN_HOURS = 12, PAGE = 24, PORTAL_READER_HOURS = 12;
// People sign in once, on the LSH Training Portal. It sends them here with a short-lived signed ticket, which this Worker
// hands back to the Portal to check (so this Worker needs no shared secret) before it starts its own session.
const PORTAL_URL = 'https://cm-training-activity.pages.dev';
const portalBase = (env) => String(env.PORTAL_URL || PORTAL_URL).replace(/\/+$/, '');
// The team access code only works when KB_CODE_LOGIN is set to "on" (it is off: nobody signs in a second time here).
const MASTER_USERNAME = 'LSHADMIN123';   // the Portal's Master Account (functions/_utils.js there)
const codeLoginOn = (env) => String(env.KB_CODE_LOGIN || '').toLowerCase() === 'on';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        // public/seed/ holds documents the admin imports into the library; the Worker reads them itself, so they are never served to visitors.
        if (path.startsWith('/seed/')) return new Response('Not found', { status: 404 });
        if (!path.startsWith('/api/') && !path.startsWith('/files/') && !path.startsWith('/img/') && !path.startsWith('/att/')) return env.ASSETS.fetch(request);
        try {
            const db = env.TRAINING_DB;
            // The lock lives in the portal's database and the schema in this one: neither waits for the other.
            const [locked] = await Promise.all([siteLocked(env), ensureSchema(db)]);
            if (locked) return fail('The LSH Training Portal has been locked by an administrator.', 423, { code: 'SITE_LOCKED' });
            if (path === '/api/session') return await session(request, env);
            const reader = await getReader(request, env);
            if (!reader) return fail('Enter the team access code to open the Knowledge Base.', 401, { code: 'KB_LOCKED' });
            const write = request.method !== 'GET' && request.method !== 'HEAD';
            if (write && !sameOrigin(request)) return fail('Requests must come from the LSH Knowledge Base.', 403);
            const ctx = { request, env, db, url, reader };

            if (path.startsWith('/files/')) return await serveFile(ctx, path.split('/')[2]);
            if (path.startsWith('/img/')) return await serveImage(ctx, path.split('/')[2]);
            if (path.startsWith('/att/')) return await serveImage(ctx, path.split('/')[2], true);
            const seg = path.slice(5).split('/').filter(Boolean);   // after "/api/"
            switch (seg[0]) {
                case 'library': return await library(ctx);
                case 'glossary':
                    if (write && !reader.contributor) return infoOnly();
                    return write ? await glossaryAction(ctx) : await glossary(ctx);
                case 'resolve': {   // an old Tettra page's id, or a bundled document's file name (public/seed/docs.json) -> the library entry
                    // that holds it (links inside imported pages use the first; the Training Portal's day decks link to an article by the second)
                    const ref = String(url.searchParams.get('ref') || '');
                    const row = /^(tettra:\d+|seed:[a-z0-9][\w.-]{0,160})$/i.test(ref) ? await db.prepare(`SELECT id FROM lib_entries WHERE legacy_ref = ? AND status = 'published'`).bind(ref).first() : null;
                    return row ? json({ success: true, id: row.id }) : fail('That page isn’t in the library.', 404);
                }
                case 'entries':
                    if (!seg[1]) return write ? await createEntry(ctx) : await listEntries(ctx);
                    if (seg[2] === 'history') return await history(ctx, Number(seg[1]));
                    return write ? await entryAction(ctx, Number(seg[1])) : await getEntry(ctx, Number(seg[1]));
                case 'revisions': return write ? await revisionAction(ctx, Number(seg[1])) : await getRevision(ctx, Number(seg[1]));
                case 'review': return await reviewQueue(ctx);
                case 'comments': return await comments(ctx);
                case 'people': return await people(ctx);
                case 'files':
                    if (write && !reader.contributor) return infoOnly();
                    if (request.method === 'PUT' && seg[1] && seg[2]) return await putPart(ctx, seg[1], Number(seg[2]));
                    return await files(ctx);
                case 'admin':
                    if (!reader.admin) return fail('Admin sign-in required.', 403);
                    if (seg[1] === 'export') return await exportAll(ctx);
                    return write ? await adminAction(ctx) : await adminInfo(ctx);
            }
            return fail('Not found.', 404);
        } catch (err) {
            console.error(err);
            return fail(err.message || 'Something went wrong.', 500);
        }
    },
    // On the schedule in wrangler.jsonc: course handouts are brought up to date with their source (src/sync.js).
    async scheduled(event, env, ctx) {
        const db = env.TRAINING_DB;
        ctx.waitUntil(ensureSchema(db).then(() => syncCourseHandouts(env, db)).then(r => console.log('course handouts:', JSON.stringify(r))));
    }
};

/* =====================================================================
   SESSION: team access code for the VA community, portal login for admins
   ===================================================================== */
async function session(request, env) {
    const db = env.TRAINING_DB;
    if (request.method === 'GET') {
        const reader = await getReader(request, env);
        return json({ success: true, configured: !!(await getSetting(db, 'code_hash')), unlocked: !!reader, portalUrl: portalBase(env), codeLogin: codeLoginOn(env),
            admin: !!(reader && reader.admin), reviewer: !!(reader && reader.reviewer), contributor: !!(reader && reader.contributor), tier: reader ? reader.tier : null,
            who: reader ? { name: reader.who.name, batch: reader.who.batch, key: reader.who.key } : null });
    }
    if (!sameOrigin(request)) return fail('Requests must come from the LSH Knowledge Base.', 403);
    const body = await readJson(request) || {};
    if (body.action === 'signout') {
        return json({ success: true }, 200, { 'Set-Cookie': setCookie(READER_COOKIE, '', 0) });
    }
    if (body.action === 'admin-logout') {
        return json({ success: true }, 200, { 'Set-Cookie': setCookie(ADMIN_COOKIE, '', 0) });
    }
    if (body.action === 'portal-ticket') {
        if (await overLimit(request, db, 'ticket', 30)) return fail('Too many tries from this connection. Wait 10 minutes and try again.', 429);
        let v = null;
        try {
            const r = await fetch(portalBase(env) + '/api/verify-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: String(body.ticket || '') }) });
            v = await r.json();
        } catch (e) { return fail('Couldn’t reach the LSH Training Portal to check your sign-in. Try again in a moment.', 502); }
        if (!v || !v.ok) return fail('That sign-in link has expired. Open the Knowledge Base again from the LSH Training Portal.', 401, { code: 'TICKET' });
        if (v.system) return fail('This link can’t sign anyone in.', 403, { code: 'SYSTEM_TICKET' });
        // A trainer signed in to the Portal with their own admin account: an admin here, as themselves, no password.
        // An admin ticket works once (its signature is noted for 10 minutes, longer than a ticket lives).
        if (v.admin) {
            const sig = String(body.ticket || '').split('.').pop().slice(0, 43);
            try {
                await db.prepare(`CREATE TABLE IF NOT EXISTS kb_sso_used (sig TEXT PRIMARY KEY, at INTEGER NOT NULL)`).run();
                await db.prepare(`DELETE FROM kb_sso_used WHERE at < ?`).bind(Date.now() - 600000).run();
                await db.prepare(`INSERT INTO kb_sso_used (sig, at) VALUES (?, ?)`).bind(sig, Date.now()).run();
            } catch (e) { return fail('This sign-in link was already used. Open the Knowledge Base again from the LSH Training Portal.', 401, { code: 'used' }); }
            const name = oneLine(v.name, 80);
            const username = name ? 'admin:' + name.toLowerCase() : MASTER_USERNAME;
            const token = await signToken({ adm: 1, username, name: name || 'System Administrator' }, env.SESSION_SECRET, ADMIN_HOURS * 3600);
            return json({ success: true, admin: true }, 200, { 'Set-Cookie': setCookie(ADMIN_COOKIE, token, ADMIN_HOURS * 3600) });
        }
        const name = oneLine(`${v.first} ${v.last}`, 80), batch = oneLine(v.batch, 40);
        const token = await signToken({ kb: 1, sso: 1, name, batch }, env.SESSION_SECRET, PORTAL_READER_HOURS * 3600);
        return json({ success: true }, 200, { 'Set-Cookie': setCookie(READER_COOKIE, token, PORTAL_READER_HOURS * 3600) });
    }
    if (body.action === 'unlock') {
        if (!codeLoginOn(env)) return fail('Open the Knowledge Base from the LSH Training Portal. It signs you in; there is no second sign-in here.', 403, { code: 'PORTAL_ONLY' });
        if (await overLimit(request, db, 'unlock', 10)) return fail('Too many tries from this connection. Wait 10 minutes and try again.', 429);
        const hash = await getSetting(db, 'code_hash');
        if (!hash) return fail('The Knowledge Base isn’t open yet. An admin needs to set the team access code.', 409);
        const name = oneLine(body.name, 80), batch = oneLine(body.batch, 40);
        if (name.length < 2) return fail('Enter your full name.');
        if (!(await verifyPassword(String(body.code || '').trim(), hash))) return fail('That access code isn’t right. Ask your trainer or team lead for the current code.', 403);
        const token = await signToken({ kb: 1, name, batch, v: await getSetting(db, 'code_version') }, env.SESSION_SECRET, READER_DAYS * 86400);
        return json({ success: true }, 200, { 'Set-Cookie': setCookie(READER_COOKIE, token, READER_DAYS * 86400) });
    }
    if (body.action === 'admin-login') {
        if (await overLimit(request, db, 'admin-login', 10)) return fail('Too many tries from this connection. Wait 10 minutes and try again.', 429);
        const typed = oneLine(body.username, 80), password = String(body.password || '');
        if (!password) return fail('Enter the admin password.');
        const give = (username, name) => signToken({ adm: 1, username, name }, env.SESSION_SECRET, ADMIN_HOURS * 3600)
            .then(token => json({ success: true }, 200, { 'Set-Cookie': setCookie(ADMIN_COOKIE, token, ADMIN_HOURS * 3600) }));
        // 1. A Portal admin account typed with its own username and password.
        if (typed && typed !== MASTER_USERNAME && env.DB) {
            const user = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(typed).first();
            if (user && (user.user_type || user.userType) === 'Admin') {   // a real Portal admin account is checked on its own password only
                if (!(await verifyPassword(password, user.password))) return fail('Incorrect username or password.', 401);
                if (['Pending', 'Rejected', 'Revoked', 'Suspended'].includes(user.status)) return fail('This admin account isn’t active.', 403);
                return give(user.username, [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username);
            }
        }
        // 2. The admin password, the same one as on every platform (MASTER_ADMIN_PASSWORD, which the Portal holds, so the Portal checks it).
        //    A name typed with it is who the entries are credited to, as on the CMS; with no name it is the Master Account.
        let r;
        try {
            r = await fetch(portalBase(env) + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portalMode: 'Admin', username: MASTER_USERNAME, password }) });
        } catch (e) { return fail('Couldn’t reach the LSH Training Portal to check the admin password. Try again in a moment.', 502); }
        if (r.status === 429) return fail('Too many wrong passwords. Wait 10 minutes and try again.', 429);
        if (!r.ok) return fail('Incorrect admin password.', 401);
        if (!typed || typed === MASTER_USERNAME) return give(MASTER_USERNAME, 'System Administrator');
        return give('admin:' + typed.toLowerCase(), typed);
    }
    return fail('Unknown action.');
}

/* =====================================================================
   READING
   ===================================================================== */
const shapeRow = (r) => ({
    id: r.id, status: r.status, collection: r.collection, section: r.section || '', type: r.type, title: r.title,
    summary: r.summary || '', tags: r.tags ? r.tags.split(',') : [], official: !!r.official, featured: !!r.featured,
    hasVideo: !!r.has_video, fileCount: r.file_count || 0, author: r.author_name, batch: r.author_batch || '',
    authorKey: r.author_key, createdAt: r.created_at, updatedAt: r.updated_at, publishedAt: r.published_at,
    reviewNote: r.review_note || '', views: r.views || 0, helpful: r.helpful || 0, comments: r.comments || 0,
    ...(r.snip ? { snippet: r.snip } : {})
});
const STATS_JOIN = `LEFT JOIN kb_stats s ON s.article_ref = 'e:' || e.id
    LEFT JOIN (SELECT article_ref, COUNT(*) AS n FROM kb_comments WHERE status = 'approved' GROUP BY article_ref) c ON c.article_ref = 'e:' || e.id`;
const LIST_COLS = `e.*, COALESCE(s.views, 0) AS views, COALESCE(s.helpful, 0) AS helpful, COALESCE(c.n, 0) AS comments`;

async function library({ db, reader }) {
    // Every one of these is independent, and this runs on the first screen of every visit, so they go
    // to the database as one batch rather than a dozen round trips one after another.
    const stmts = [
        db.prepare(`SELECT c.*, COUNT(e.id) AS n, SUM(CASE WHEN e.has_video = 1 THEN 1 ELSE 0 END) AS videos
            FROM lib_collections c LEFT JOIN lib_entries e ON e.collection = c.slug AND e.status = 'published'
            WHERE c.archived = 0 GROUP BY c.slug ORDER BY c.sort, c.name`),
        // Featured is the screen the Knowledge Base opens on: fifteen cards, three rows of five.
        db.prepare(`SELECT ${LIST_COLS} FROM lib_entries e ${STATS_JOIN} WHERE e.status = 'published' AND e.featured = 1 ORDER BY e.updated_at DESC LIMIT 15`),
        db.prepare(`SELECT ${LIST_COLS} FROM lib_entries e ${STATS_JOIN} WHERE e.status = 'published' ORDER BY e.published_at DESC LIMIT 8`),
        db.prepare(`SELECT ${LIST_COLS} FROM lib_entries e ${STATS_JOIN} WHERE e.status = 'published' AND e.has_video = 1 ORDER BY e.published_at DESC LIMIT 6`),
        db.prepare(`SELECT ${LIST_COLS} FROM lib_entries e ${STATS_JOIN} WHERE e.status = 'published' ORDER BY (COALESCE(s.helpful, 0) * 5 + COALESCE(s.views, 0)) DESC LIMIT 6`),
        db.prepare(`SELECT COUNT(*) AS entries, SUM(has_video) AS videos, SUM(file_count) AS files, COUNT(DISTINCT author_key) AS people
            FROM lib_entries WHERE status = 'published'`),
        db.prepare(`SELECT SUM(status = 'pending') AS pending, SUM(status = 'rejected') AS rejected FROM lib_entries WHERE author_key = ?`).bind(reader.who.key),
        db.prepare(`SELECT SUM(status = 'pending') AS pending, SUM(status = 'rejected') AS rejected FROM lib_revisions r
            WHERE author_key = ? AND EXISTS (SELECT 1 FROM lib_entries e WHERE e.id = r.entry_id AND e.status != 'pending' AND e.status != 'rejected')`).bind(reader.who.key),
        // The usual kinds first, then any type someone wrote themselves, so the filters list them all.
        db.prepare(`SELECT DISTINCT type FROM lib_entries WHERE status = 'published' AND type != ''`)
    ];
    if (reader.staff) stmts.push(
        db.prepare(`SELECT COUNT(*) AS n FROM lib_revisions WHERE status = 'pending'`),
        db.prepare(`SELECT COUNT(*) AS n FROM kb_comments WHERE status = 'pending' AND article_ref LIKE 'e:%'`),
        db.prepare(`SELECT COUNT(*) AS n FROM lib_term_changes WHERE status = 'pending'`));
    const res = await db.batch(stmts);
    const rows = (i) => (res[i] && res[i].results) || [];
    const one = (i) => rows(i)[0] || {};
    const shaped = (i) => rows(i).map(shapeRow);
    const cols = rows(0);
    const featured = shaped(1), recent = shaped(2), videos = shaped(3), popular = shaped(4);
    const totals = one(5), mine = one(6), mySuggestions = one(7);
    const tps = rows(8);
    const queue = reader.staff ? { revisions: one(9).n, comments: one(10).n, terms: one(11).n } : undefined;
    const extraTypes = (tps || []).map(t => t.type).filter(t => !TYPES.some(k => k.toLowerCase() === String(t).toLowerCase())).sort();
    return json({ success: true, types: [...TYPES, ...extraTypes],
        collections: (cols || []).map(c => ({ slug: c.slug, name: c.name, blurb: c.blurb || '', count: c.n || 0, videos: c.videos || 0 })),
        featured, recent, videos, popular,
        totals: { entries: totals.entries || 0, videos: totals.videos || 0, files: totals.files || 0, people: totals.people || 0 },
        mine: { pending: (mine.pending || 0) + (mySuggestions.pending || 0), rejected: (mine.rejected || 0) + (mySuggestions.rejected || 0) },
        queue });
}

async function listEntries({ db, url, reader }) {
    const p = url.searchParams;
    const where = [], bind = [];
    const status = p.get('status');
    if (status === 'mine') { where.push(`e.author_key = ?`); bind.push(reader.who.key); }
    else if (status === 'archived' && reader.staff) where.push(`e.status = 'archived'`);
    else where.push(`e.status = 'published'`);
    if (p.get('collection')) { where.push(`e.collection = ?`); bind.push(p.get('collection')); }
    if (p.get('type')) { where.push(`e.type = ?`); bind.push(p.get('type')); }
    if (p.get('official') === '1') where.push(`e.official = 1`);
    if (p.get('official') === '0') where.push(`e.official = 0`);
    if (p.get('video') === '1') where.push(`e.has_video = 1`);
    if (p.get('author')) { where.push(`e.author_key = ?`); bind.push(p.get('author')); }
    if (p.get('tag')) { where.push(`(',' || e.tags || ',') LIKE ?`); bind.push('%,' + p.get('tag').toLowerCase() + ',%'); }
    const page = Math.max(1, Math.min(500, parseInt(p.get('page') || '1', 10) || 1));
    const fq = ftsQuery(p.get('q'));
    let sql, countSql, countBind;
    if (fq && status !== 'mine' && status !== 'archived') {
        const w = where.length ? ' AND ' + where.join(' AND ') : '';
        sql = `SELECT ${LIST_COLS}, snippet(lib_fts, -1, '[[', ']]', '…', 20) AS snip FROM lib_fts f JOIN lib_entries e ON e.id = f.rowid ${STATS_JOIN}
            WHERE lib_fts MATCH ?${w} ORDER BY e.official DESC, bm25(lib_fts, 10.0, 4.0, 1.0, 3.0, 1.0) LIMIT ? OFFSET ?`;
        countSql = `SELECT COUNT(*) AS n FROM lib_fts f JOIN lib_entries e ON e.id = f.rowid WHERE lib_fts MATCH ?${w}`;
        bind.unshift(fq);
        countBind = [...bind];
    } else {
        const order = { helpful: `helpful DESC, views DESC`, views: `views DESC`, title: `e.title COLLATE NOCASE`, az: `e.title COLLATE NOCASE`, section: `e.section COLLATE NOCASE, e.title COLLATE NOCASE` }[p.get('sort')]
            || `e.featured DESC, e.updated_at DESC`;
        const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
        sql = `SELECT ${LIST_COLS} FROM lib_entries e ${STATS_JOIN} ${w} ORDER BY ${p.get('sort') === 'az' ? '' : 'e.official DESC, '}${order} LIMIT ? OFFSET ?`;
        countSql = `SELECT COUNT(*) AS n FROM lib_entries e ${w}`;
        countBind = [...bind];
    }
    const pageSize = p.get('all') === '1' ? 500 : PAGE;
    const { results } = await db.prepare(sql).bind(...bind, pageSize, (page - 1) * pageSize).all();
    const total = await db.prepare(countSql).bind(...countBind).first();
    return json({ success: true, entries: (results || []).map(shapeRow), total: total ? total.n : 0, page, pageSize });
}

function canSeeEntry(entry, reader) {
    if (entry.status === 'published') return true;
    if (reader.staff) return true;
    return entry.author_key === reader.who.key && ['pending', 'rejected', 'withdrawn'].includes(entry.status);
}

async function getEntry({ db, reader }, id) {
    const e = await db.prepare(`SELECT * FROM lib_entries WHERE id = ?`).bind(id).first();
    if (!e || !canSeeEntry(e, reader)) return fail('That entry isn’t available.', 404);
    // Published entries show their live version; an unpublished one shows its latest version.
    const rev = e.live_rev
        ? await db.prepare(`SELECT * FROM lib_revisions WHERE id = ?`).bind(e.live_rev).first()
        : await db.prepare(`SELECT * FROM lib_revisions WHERE entry_id = ? ORDER BY id DESC LIMIT 1`).bind(id).first();
    const d = JSON.parse(rev.data);
    const ref = refOf(id);
    if (e.status === 'published') await db.prepare(`INSERT INTO kb_stats (article_ref, views) VALUES (?, 1) ON CONFLICT(article_ref) DO UPDATE SET views = views + 1`).bind(ref).run();
    const st = await db.prepare(`SELECT views, helpful FROM kb_stats WHERE article_ref = ?`).bind(ref).first();
    const voted = !!(await db.prepare(`SELECT 1 AS v FROM kb_votes WHERE article_ref = ? AND voter = ?`).bind(ref, reader.who.key).first());
    const { results: cm } = await db.prepare(reader.staff
        ? `SELECT * FROM kb_comments WHERE article_ref = ? AND status != 'deleted' ORDER BY id`
        : `SELECT * FROM kb_comments WHERE article_ref = ? AND (status = 'approved' OR (author_key = ? AND status != 'deleted')) ORDER BY id`)
        .bind(...(reader.staff ? [ref] : [ref, reader.who.key])).all();
    const counts = await db.prepare(`SELECT COUNT(*) AS versions, SUM(status = 'pending') AS pending FROM lib_revisions WHERE entry_id = ?`).bind(id).first();
    const myPending = await db.prepare(`SELECT id FROM lib_revisions WHERE entry_id = ? AND author_key = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).bind(id, reader.who.key).first();
    return json({ success: true,
        entry: { ...shapeRow(e), body: d.body || '', credits: d.credits || [], files: d.files || [],
            collection: d.collection, section: d.section || '', type: d.type, title: d.title, summary: d.summary || '', tags: d.tags || [],
            version: { id: rev.id, by: rev.author_name, at: rev.created_at, note: rev.note || '', status: rev.status },
            versions: counts.versions || 0, pendingEdits: reader.staff ? (counts.pending || 0) : undefined, myPendingEdit: myPending ? myPending.id : null },
        stats: { views: st ? st.views : 0, helpful: st ? st.helpful : 0 }, voted,
        comments: (cm || []).map(c => ({ id: c.id, body: c.body, author: c.author_name, batch: c.author_batch || '', staff: !!c.by_admin, status: c.status, createdAt: c.created_at, kind: c.kind || 'comment', done: c.review_note === 'done' })),
        can: { edit: e.status !== 'archived' && reader.contributor && (!!e.live_rev || e.author_key === reader.who.key || reader.admin), staff: reader.staff, admin: reader.admin } });
}

const shapeRev = (r, withData) => ({ id: r.id, entryId: r.entry_id, status: r.status, note: r.note || '', author: r.author_name, batch: r.author_batch || '',
    authorKey: r.author_key, staff: !!r.by_staff, createdAt: r.created_at, reviewNote: r.review_note || '', reviewedBy: r.reviewed_by || '', reviewedAt: r.reviewed_at || '',
    ...(withData ? { data: JSON.parse(r.data) } : { title: JSON.parse(r.data).title }) });

async function history({ db, reader }, id) {
    const e = await db.prepare(`SELECT * FROM lib_entries WHERE id = ?`).bind(id).first();
    if (!e || !canSeeEntry(e, reader)) return fail('That entry isn’t available.', 404);
    const { results } = await db.prepare(`SELECT * FROM lib_revisions WHERE entry_id = ? ORDER BY id DESC`).bind(id).all();
    const visible = (results || []).filter(r => reader.staff || ['live', 'superseded'].includes(r.status) || r.author_key === reader.who.key);
    return json({ success: true, entry: shapeRow(e), versions: visible.map(r => shapeRev(r, false)) });
}

async function getRevision({ db, reader }, revId) {
    const r = await db.prepare(`SELECT * FROM lib_revisions WHERE id = ?`).bind(revId).first();
    if (!r) return fail('That version no longer exists.', 404);
    const e = await db.prepare(`SELECT * FROM lib_entries WHERE id = ?`).bind(r.entry_id).first();
    const ok = reader.staff || r.author_key === reader.who.key || (e && canSeeEntry(e, reader) && ['live', 'superseded'].includes(r.status));
    if (!ok) return fail('That version isn’t available.', 404);
    const live = e && e.live_rev ? await db.prepare(`SELECT * FROM lib_revisions WHERE id = ?`).bind(e.live_rev).first() : null;
    return json({ success: true, version: shapeRev(r, true), live: live ? shapeRev(live, true) : null, entry: e ? shapeRow(e) : null });
}

async function reviewQueue({ db, reader }) {
    if (!reader.staff) return fail('Reviewer access required.', 403);
    const { results: revs } = await db.prepare(`SELECT r.*, e.status AS entry_status, e.title AS entry_title, e.live_rev FROM lib_revisions r
        JOIN lib_entries e ON e.id = r.entry_id WHERE r.status = 'pending' ORDER BY r.id LIMIT 300`).all();
    const { results: cm } = await db.prepare(`SELECT c.*, e.title AS entry_title FROM kb_comments c
        LEFT JOIN lib_entries e ON 'e:' || e.id = c.article_ref WHERE c.status = 'pending' AND c.article_ref LIKE 'e:%' ORDER BY c.id LIMIT 300`).all();
    const { results: terms } = await db.prepare(`SELECT c.*, t.term AS current_term, t.definition AS current_definition, t.example AS current_example, t.category AS current_category
        FROM lib_term_changes c LEFT JOIN lib_terms t ON t.id = c.term_id WHERE c.status = 'pending' ORDER BY c.id LIMIT 300`).all();
    return json({ success: true,
        terms: (terms || []).map(c => ({ ...shapeChange(c), current: c.current_term ? { term: c.current_term, definition: c.current_definition, example: c.current_example || '', category: c.current_category } : null })),
        revisions: (revs || []).map(r => ({ ...shapeRev(r, true), isNew: r.entry_status === 'pending' || r.entry_status === 'rejected', entryTitle: r.entry_title, entryStatus: r.entry_status })),
        comments: (cm || []).map(c => ({ id: c.id, entryId: Number(c.article_ref.slice(2)), entryTitle: c.entry_title || '', body: c.body, author: c.author_name, batch: c.author_batch || '', createdAt: c.created_at, kind: c.kind || 'comment' })) });
}

async function people({ db }) {
    const { results } = await db.prepare(`SELECT e.author_name AS name, e.author_batch AS batch, e.author_key AS key, COUNT(*) AS entries,
        SUM(COALESCE(s.helpful, 0)) AS helpful, MAX(e.published_at) AS last
        FROM lib_entries e LEFT JOIN kb_stats s ON s.article_ref = 'e:' || e.id
        WHERE e.status = 'published' GROUP BY e.author_key ORDER BY entries DESC, helpful DESC LIMIT 200`).all();
    const { results: roles } = await db.prepare(`SELECT person_key FROM lib_roles WHERE role = 'reviewer'`).all();
    const rev = new Set((roles || []).map(r => r.person_key));
    return json({ success: true, people: (results || []).map(p => ({ ...p, reviewer: rev.has(p.key), staff: p.key.startsWith('admin|') })) });
}

/* =====================================================================
   WRITING ENTRIES
   ===================================================================== */
async function fields(db, body, reader, current) {
    // The collection, by slug or name (the editor sends what was typed); a name no shelf has yet makes a new one.
    const colIn = oneLine(body.collection, 80);
    if (colIn.length < 2) return { error: 'Choose where this belongs in the library, or type a new collection.' };
    let col = await db.prepare(`SELECT slug, archived FROM lib_collections WHERE slug = ? OR slug = ? OR lower(name) = lower(?)`)
        .bind(colIn, slugOf(colIn), colIn).first();
    if (!col) {
        const slug = slugOf(colIn);
        const top = await db.prepare(`SELECT COALESCE(MAX(sort), 0) + 10 AS s FROM lib_collections`).first();
        await db.prepare(`INSERT INTO lib_collections (slug, name, blurb, sort, archived, created_at) VALUES (?, ?, '', ?, 0, ?)
            ON CONFLICT(slug) DO NOTHING`).bind(slug, colIn, top.s, nowIso()).run();
        col = { slug, archived: 0 };
    } else if (col.archived) {   // writing into an archived shelf brings it back
        await db.prepare(`UPDATE lib_collections SET archived = 0 WHERE slug = ?`).bind(col.slug).run();
    }
    // The type: one of the usual kinds (any case), or whatever was typed.
    const typeIn = oneLine(body.type, 40);
    if (typeIn.length < 2) return { error: 'Say what kind of entry this is (SOP, Guide, Checklist…), or type your own.' };
    const type = TYPES.find(t => t.toLowerCase() === typeIn.toLowerCase()) || typeIn;
    const title = fixTitle(oneLine(body.title, 200));   // an ALL-CAPS title is saved in sentence case
    if (title.length < 5) return { error: 'Give it a title of at least 5 characters.' };
    const text = clean(body.body, 100000);
    const tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(','))
        .map(t => oneLine(t, 40).toLowerCase()).filter(Boolean))].slice(0, 12);
    const credits = [...new Set((Array.isArray(body.credits) ? body.credits : String(body.credits || '').split(','))
        .map(t => oneLine(t, 80)).filter(Boolean))].slice(0, 8);
    // Files: the reader's own uploads, files the entry already shows, or anything for staff.
    const ids = [...new Set((Array.isArray(body.files) ? body.files : []).map(String))].slice(0, 40);
    const currentIds = new Set(current ? (current.files || []).map(f => f.id) : []);
    const files = [];
    for (const fid of ids) {
        const f = await db.prepare(`SELECT * FROM lib_files WHERE id = ?`).bind(fid).first();
        if (!f || f.status !== 'ready') return { error: 'One of the files hasn’t finished uploading. Wait for it, or remove it.' };
        if (!reader.staff && f.uploader_key !== reader.who.key && !currentIds.has(fid)) return { error: 'You can only attach files you uploaded yourself.' };
        files.push({ id: f.id, name: f.name, size: f.size, mime: f.mime || '', kind: f.kind });
    }
    if (text.length < 20 && !files.length) return { error: 'Add a description of at least a couple of sentences, or attach a file or video.' };
    const official = reader.admin ? !!body.official : !!(current && current.official);
    return { data: { collection: col.slug, section: oneLine(body.section, 120), type, title, summary: oneLine(body.summary, 500),
        body: text, tags, credits, files, official }, note: oneLine(body.note, 300) };
}

async function addRevision(db, entryId, data, note, reader, status) {
    const r = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(entryId, JSON.stringify(data), status, note || null,
        reader.who.name, reader.who.batch, reader.who.key, reader.staff ? 1 : 0, nowIso()).run();
    return r.meta.last_row_id;
}

async function createEntry({ request, db, reader }) {
    if (!reader.contributor) return infoOnly();
    if (!reader.admin && await overLimit(request, db, 'entry', 15)) return fail('You’ve added a lot in a short time. Wait a few minutes and try again.', 429);
    const body = await readJson(request) || {};
    const f = await fields(db, body, reader, null);
    if (f.error) return fail(f.error);
    const d = f.data, now = nowIso();
    const r = await db.prepare(`INSERT INTO lib_entries (status, collection, section, type, title, summary, tags, official, has_video, file_count,
        author_name, author_batch, author_key, by_staff, created_at, updated_at) VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(d.collection, d.section, d.type, d.title, d.summary, d.tags.join(','), d.official ? 1 : 0, d.files.some(x => x.kind === 'video') ? 1 : 0,
            d.files.length, reader.who.name, reader.who.batch, reader.who.key, reader.staff ? 1 : 0, now, now).run();
    const id = r.meta.last_row_id;
    const revId = await addRevision(db, id, d, f.note, reader, 'pending');
    if (reader.admin) await makeLive(db, id, revId, { reviewer: reader.adminUser || reader.who.name });   // everyone else's new entry waits for approval
    return json({ success: true, id, status: reader.admin ? 'published' : 'pending' });
}

async function entryAction({ request, db, reader, env }, id) {
    const body = await readJson(request) || {};
    if (!reader.contributor && body.action !== 'helpful') return infoOnly();
    const e = await db.prepare(`SELECT * FROM lib_entries WHERE id = ?`).bind(id).first();
    if (!e) return fail('That entry no longer exists.', 404);
    const reviewer = reader.adminUser || reader.who.name, now = nowIso();
    const liveData = async () => e.live_rev ? JSON.parse((await db.prepare(`SELECT data FROM lib_revisions WHERE id = ?`).bind(e.live_rev).first()).data) : null;

    if (body.action === 'edit') {
        // Edits come from tenured VAs, reviewers and admins. Only an admin's edit goes live straight away; every other edit waits for approval.
        if (e.status === 'archived' && !reader.admin) return fail('This entry is archived. Ask an admin to restore it first.', 403);
        const own = e.author_key === reader.who.key;
        if (!e.live_rev && !own && !reader.admin) return fail('This entry is still waiting for review. Approve it, or send it back with a note, from the review queue.', 403);
        if (!reader.admin && await overLimit(request, db, 'edit', 30)) return fail('You’ve made a lot of edits in a short time. Wait a few minutes and try again.', 429);
        const current = await liveData() || JSON.parse((await db.prepare(`SELECT data FROM lib_revisions WHERE entry_id = ? ORDER BY id DESC LIMIT 1`).bind(id).first()).data);
        const f = await fields(db, body, reader, current);
        if (f.error) return fail(f.error);
        if (reader.admin) {
            const revId = await addRevision(db, id, f.data, f.note, reader, 'pending');
            await makeLive(db, id, revId, { publish: e.status !== 'archived', reviewer });
            return json({ success: true, status: 'live' });
        }
        // Anyone else's edit is a suggestion: it waits for approval and replaces their own earlier suggestion.
        await db.prepare(`UPDATE lib_revisions SET status = 'withdrawn' WHERE entry_id = ? AND author_key = ? AND status = 'pending'`).bind(id, reader.who.key).run();
        await addRevision(db, id, { ...f.data, base: e.live_rev || null }, f.note, reader, 'pending');   // base: the live version this was written against
        if (!e.live_rev) {   // their own new entry, fixed after it was sent back
            await db.prepare(`UPDATE lib_entries SET status = 'pending', collection = ?, section = ?, type = ?, title = ?, summary = ?, tags = ?, updated_at = ? WHERE id = ?`)
                .bind(f.data.collection, f.data.section, f.data.type, f.data.title, f.data.summary, f.data.tags.join(','), now, id).run();
        }
        return json({ success: true, status: 'pending' });
    }

    if (body.action === 'helpful') {
        if (e.status !== 'published') return fail('Only published entries can be voted on.');
        const ref = refOf(id);
        const had = await db.prepare(`SELECT 1 AS v FROM kb_votes WHERE article_ref = ? AND voter = ?`).bind(ref, reader.who.key).first();
        if (had) {
            await db.batch([db.prepare(`DELETE FROM kb_votes WHERE article_ref = ? AND voter = ?`).bind(ref, reader.who.key),
                db.prepare(`UPDATE kb_stats SET helpful = MAX(0, helpful - 1) WHERE article_ref = ?`).bind(ref)]);
        } else {
            const r = await db.prepare(`INSERT OR IGNORE INTO kb_votes (article_ref, voter, created_at) VALUES (?, ?, ?)`).bind(ref, reader.who.key, now).run();
            if (r.meta.changes) await db.prepare(`INSERT INTO kb_stats (article_ref, helpful) VALUES (?, 1) ON CONFLICT(article_ref) DO UPDATE SET helpful = helpful + 1`).bind(ref).run();
        }
        const st = await db.prepare(`SELECT helpful FROM kb_stats WHERE article_ref = ?`).bind(ref).first();
        return json({ success: true, voted: !had, helpful: st ? st.helpful : 0 });
    }

    if (body.action === 'withdraw') {   // an author takes back their own entry that is still waiting
        if (e.author_key !== reader.who.key || e.live_rev) return fail('You can only withdraw your own entry while it’s waiting for review.', 403);
        await db.batch([db.prepare(`UPDATE lib_entries SET status = 'withdrawn', updated_at = ? WHERE id = ?`).bind(now, id),
            db.prepare(`UPDATE lib_revisions SET status = 'withdrawn' WHERE entry_id = ? AND status = 'pending'`).bind(id)]);
        return json({ success: true });
    }

    if (!reader.staff) return fail('Reviewer access required.', 403);

    if (body.action === 'feature' || body.action === 'unfeature') {
        await db.prepare(`UPDATE lib_entries SET featured = ? WHERE id = ?`).bind(body.action === 'feature' ? 1 : 0, id).run();
        return json({ success: true });
    }
    if (body.action === 'archive') {
        await db.prepare(`UPDATE lib_entries SET status = 'archived', updated_at = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind(now, reviewer, now, id).run();
        await reindex(db, id);
        return json({ success: true });
    }
    if (body.action === 'unarchive') {
        if (!reader.admin) return fail('Only admins can bring an archived entry back.', 403);
        if (!e.live_rev) return fail('This entry was never published, so there is nothing to restore.');
        await db.prepare(`UPDATE lib_entries SET status = 'published', updated_at = ? WHERE id = ?`).bind(now, id).run();
        await reindex(db, id);
        return json({ success: true });
    }
    if (body.action === 'official') {
        if (!reader.admin) return fail('Only admins can mark entries official.', 403);
        const d = await liveData();
        if (!d) return fail('Publish the entry first.');
        d.official = !!body.official;
        const revId = await addRevision(db, id, d, d.official ? 'Marked official' : 'No longer marked official', reader, 'pending');
        await makeLive(db, id, revId, { publish: e.status === 'published', reviewer });
        return json({ success: true });
    }
    if (body.action === 'restore') {
        if (!e.live_rev && !reader.admin) return fail('This entry is not live yet. Approve it or send it back from the review queue.', 403);
        const old = await db.prepare(`SELECT * FROM lib_revisions WHERE id = ? AND entry_id = ?`).bind(Number(body.revision), id).first();
        if (!old) return fail('That version no longer exists.', 404);
        const d = JSON.parse(old.data);
        d.title = fixTitle(d.title); d.base = e.live_rev || null;
        if (!reader.admin) d.official = !!e.official;
        const revId = await addRevision(db, id, d, `Restored the version from ${old.created_at.slice(0, 10)} by ${old.author_name}`, reader, 'pending');
        if (!reader.admin) return json({ success: true, status: 'pending' });   // a restore changes the page, so it needs approval like any other edit
        await makeLive(db, id, revId, { publish: e.status !== 'archived', reviewer });
        return json({ success: true, status: 'live' });
    }
    if (body.action === 'purge') {
        if (!reader.admin) return fail('Only admins can delete entries permanently.', 403);
        if (body.confirm !== 'DELETE') return fail('Type DELETE to confirm.');
        const { results: revs } = await db.prepare(`SELECT data FROM lib_revisions WHERE entry_id = ?`).bind(id).all();
        const fileIds = new Set();
        (revs || []).forEach(r => (JSON.parse(r.data).files || []).forEach(f => fileIds.add(f.id)));
        await db.batch([db.prepare(`DELETE FROM lib_revisions WHERE entry_id = ?`).bind(id), db.prepare(`DELETE FROM lib_entries WHERE id = ?`).bind(id),
            db.prepare(`DELETE FROM lib_entry_files WHERE entry_id = ?`).bind(id), db.prepare(`DELETE FROM lib_fts WHERE rowid = ?`).bind(id),
            db.prepare(`DELETE FROM kb_stats WHERE article_ref = ?`).bind(refOf(id)), db.prepare(`DELETE FROM kb_votes WHERE article_ref = ?`).bind(refOf(id)),
            db.prepare(`UPDATE kb_comments SET status = 'deleted' WHERE article_ref = ?`).bind(refOf(id))]);
        // Files go too, unless another entry's version still uses them.
        for (const fid of fileIds) {
            const used = await db.prepare(`SELECT 1 AS u FROM lib_revisions WHERE data LIKE ? LIMIT 1`).bind(`%"id":"${fid}"%`).first();
            if (used) continue;
            const f = await db.prepare(`SELECT r2_key FROM lib_files WHERE id = ?`).bind(fid).first();
            if (f) { await env.FILES.delete(f.r2_key); await db.prepare(`DELETE FROM lib_files WHERE id = ?`).bind(fid).run(); }
        }
        return json({ success: true });
    }
    return fail('Unknown action.');
}

async function revisionAction({ request, db, reader }, revId) {
    if (!reader.staff) return fail('Reviewer access required.', 403);
    const body = await readJson(request) || {};
    const r = await db.prepare(`SELECT * FROM lib_revisions WHERE id = ?`).bind(revId).first();
    if (!r || r.status !== 'pending') return fail('That version is no longer waiting for review.', 409);
    if (!reader.admin && r.author_key === reader.who.key && body.decision === 'approve') return fail('You can’t approve your own change. Another reviewer or an admin needs to.', 403);
    const e = await db.prepare(`SELECT * FROM lib_entries WHERE id = ?`).bind(r.entry_id).first();
    const reviewer = reader.adminUser || reader.who.name, now = nowIso();
    const note = oneLine(body.note, 600);
    if (body.decision === 'approve') {
        const d = JSON.parse(r.data);
        const base = d.base === undefined ? undefined : d.base;
        if (!reader.admin && base !== undefined && (base || null) !== (e.live_rev || null)) return fail('The page changed after this was suggested. Send it back so the author can redo it on the current version.', 409);
        d.official = !!e.official;   // an approval never changes Official; only the Official action and admins' own edits do
        d.title = fixTitle(d.title); delete d.base;
        await db.prepare(`UPDATE lib_revisions SET review_note = ?, data = ? WHERE id = ?`).bind(note || null, JSON.stringify(d), revId).run();
        await makeLive(db, r.entry_id, revId, { publish: e.status !== 'archived', reviewer });
        await db.prepare(`UPDATE lib_entries SET review_note = NULL, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind(reviewer, now, r.entry_id).run();
        return json({ success: true });
    }
    if (body.decision === 'reject') {
        if (!note) return fail('Tell the author what to change. They’ll see this note.');
        await db.prepare(`UPDATE lib_revisions SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind(note, reviewer, now, revId).run();
        if (!e.live_rev) await db.prepare(`UPDATE lib_entries SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`).bind(note, reviewer, now, e.id).run();
        return json({ success: true });
    }
    return fail('Unknown decision.');
}

/* =====================================================================
   REPLIES ("add your experience")
   ===================================================================== */
async function comments({ request, db, reader }) {
    if (request.method !== 'POST') return fail('POST only.', 405);
    const body = await readJson(request) || {};
    if (body.action === 'submit') {
        const kind = body.kind === 'update' ? 'update' : 'comment';
        if (!reader.contributor) return infoOnly();   // notes about out-of-date information are suggested edits, so they come from tenured VAs and above only
        if (!reader.staff && await overLimit(request, db, 'comment', 20)) return fail('You’ve replied a lot in a short time. Wait a few minutes and try again.', 429);
        const e = await db.prepare(`SELECT status FROM lib_entries WHERE id = ?`).bind(Number(body.entryId)).first();
        if (!e || e.status !== 'published') return fail('Replies are open on published entries only.');
        const text = clean(body.body, 5000);
        if (text.length < 5) return fail('Write a little more before sending.');
        const status = reader.admin ? 'approved' : 'pending';   // a reviewer's own note waits for another reviewer or an admin
        await db.prepare(`INSERT INTO kb_comments (article_ref, body, author_name, author_batch, author_key, by_admin, status, created_at, ip, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(refOf(Number(body.entryId)), text, reader.who.name, reader.who.batch, reader.who.key, reader.staff ? 1 : 0, status, nowIso(), request.headers.get('CF-Connecting-IP') || null, kind).run();
        return json({ success: true, status });
    }
    if (body.action === 'review') {
        if (!reader.staff) return fail('Reviewer access required.', 403);
        const status = { approve: 'approved', reject: 'rejected', delete: 'deleted', done: 'approved' }[body.decision];
        if (!status) return fail('Unknown decision.');
        const c = await db.prepare(`SELECT status, author_key FROM kb_comments WHERE id = ?`).bind(Number(body.id)).first();
        if (!c || c.status === 'deleted') return fail('That note is gone.', 404);
        if (['approve', 'reject'].includes(body.decision) && c.status !== 'pending') return fail('That note is no longer waiting for review.', 409);
        if (body.decision === 'done' && c.status !== 'approved') return fail('Approve the note first.', 409);
        if (body.decision === 'approve' && !reader.admin && c.author_key === reader.who.key) return fail('You can’t approve your own note. Another reviewer or an admin needs to.', 403);
        // 'done': the page has been updated for this comment (it stays shown, marked as done)
        await db.prepare(`UPDATE kb_comments SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = CASE WHEN ? = 'done' THEN 'done' ELSE review_note END WHERE id = ?`)
            .bind(status, reader.adminUser || reader.who.name, nowIso(), body.decision, Number(body.id)).run();
        return json({ success: true });
    }
    return fail('Unknown action.');
}

/* =====================================================================
   UPLOADS
   ===================================================================== */
async function files(ctx) {
    const body = await readJson(ctx.request) || {};
    if (body.action === 'start') return startUpload(ctx, body);
    if (body.action === 'complete') return finishUpload(ctx, body);
    if (body.action === 'abort') return abortUpload(ctx, body);
    if (body.action === 'text') return saveFileText(ctx, body);
    return fail('Unknown action.');
}

/* =====================================================================
   ADMIN
   ===================================================================== */
async function adminInfo({ db }) {
    const { results: roles } = await db.prepare(`SELECT * FROM lib_roles ORDER BY name`).all();
    const { results: cols } = await db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM lib_entries e WHERE e.collection = c.slug) AS n FROM lib_collections c ORDER BY c.sort, c.name`).all();
    let legacy = 0;
    try { legacy = (await db.prepare(`SELECT COUNT(*) AS n FROM kb_articles`).first()).n; } catch (e) { legacy = 0; }
    const imported = (await db.prepare(`SELECT COUNT(*) AS n FROM lib_entries WHERE legacy_ref IS NOT NULL`).first()).n;
    const storage = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM lib_files WHERE status = 'ready'`).first();
    return json({ success: true, codeSet: !!(await getSetting(db, 'code_hash')), codeChangedAt: await getSetting(db, 'code_changed_at'),
        roles: (roles || []).map(r => ({ key: r.person_key, name: r.name, batch: r.batch || '', role: r.role, grantedBy: r.granted_by, grantedAt: r.granted_at })),
        collections: (cols || []).map(c => ({ slug: c.slug, name: c.name, blurb: c.blurb || '', sort: c.sort, archived: !!c.archived, count: c.n })),
        legacy: { total: legacy, imported }, storage: { files: storage.n, bytes: storage.bytes } });
}

async function adminAction({ request, env, db, reader }) {
    const body = await readJson(request) || {};
    const now = nowIso();
    if (body.action === 'set-code') {
        const code = String(body.code || '').trim();
        if (code.length < 6 || code.length > 64) return fail('Use an access code of 6 to 64 characters.');
        await setSetting(db, 'code_hash', await hashPassword(code));
        await setSetting(db, 'code_version', crypto.randomUUID());
        await setSetting(db, 'code_changed_at', now);
        await setSetting(db, 'code_changed_by', reader.adminUser);
        return json({ success: true });
    }
    if (body.action === 'grant-reviewer' || body.action === 'grant-role') {
        const role = body.role === 'tenured' ? 'tenured' : 'reviewer';
        const name = oneLine(body.name, 80), batch = oneLine(body.batch, 40);
        if (name.length < 2) return fail('Enter the person’s full name exactly as it shows in the LSH Training Portal.');
        await db.prepare(`INSERT INTO lib_roles (person_key, name, batch, role, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(person_key) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at`)
            .bind(personKey(name, batch), name, batch, role, reader.adminUser, now).run();
        return json({ success: true });
    }
    if (body.action === 'revoke-reviewer') {
        await db.prepare(`DELETE FROM lib_roles WHERE person_key = ?`).bind(String(body.key || '')).run();
        return json({ success: true });
    }
    if (body.action === 'save-collection') {
        const name = oneLine(body.name, 80);
        if (name.length < 2) return fail('Give the collection a name.');
        let slug = String(body.slug || '').trim();
        if (!slug) slug = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'collection';
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) return fail('That collection id isn’t valid.');
        await db.prepare(`INSERT INTO lib_collections (slug, name, blurb, sort, archived, created_at) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET name = excluded.name, blurb = excluded.blurb, sort = excluded.sort, archived = excluded.archived`)
            .bind(slug, name, oneLine(body.blurb, 300), Number(body.sort) || 0, body.archived ? 1 : 0, now).run();
        return json({ success: true, slug });
    }
    if (body.action === 'import-legacy') return importLegacy(db, reader);
    if (body.action === 'import-bundled') return importBundled(request, env, db, reader);
    if (body.action === 'sync-course-handouts') return json({ success: true, results: await syncCourseHandouts(env, db) });   // also runs on the schedule
    if (body.action === 'reindex') {   // rebuilds the search for every published entry, 40 per call; the collection's name is searchable too
        const after = Number(body.after) || 0;
        const { results } = await db.prepare(`SELECT id FROM lib_entries WHERE status = 'published' AND id > ? ORDER BY id LIMIT 40`).bind(after).all();
        for (const r of results || []) await reindex(db, r.id);
        const next = results && results.length ? results[results.length - 1].id : after;
        const left = await db.prepare(`SELECT COUNT(*) AS n FROM lib_entries WHERE status = 'published' AND id > ?`).bind(next).first();
        return json({ success: true, indexed: (results || []).length, next, remaining: left.n });
    }
    if (body.action === 'archive-empty') {   // every collection with no entries in it (archived, not deleted)
        const r = await db.prepare(`UPDATE lib_collections SET archived = 1 WHERE archived = 0 AND NOT EXISTS (SELECT 1 FROM lib_entries e WHERE e.collection = lib_collections.slug)`).run();
        return json({ success: true, archived: (r.meta && r.meta.changes) || 0 });
    }
    if (body.action === 'tidy-titles') {   // entries whose title is in ALL CAPS get it in sentence case (12 per call; run again until none remain)
        const { results } = await db.prepare(`SELECT id, title, live_rev, status FROM lib_entries WHERE live_rev IS NOT NULL`).all();
        const todo = (results || []).filter(e => fixTitle(e.title) !== e.title);
        let fixed = 0;
        for (const e of todo.slice(0, 12)) {
            const live = await db.prepare(`SELECT data FROM lib_revisions WHERE id = ?`).bind(e.live_rev).first();
            const d = JSON.parse(live.data); d.title = fixTitle(d.title);
            const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', 'Title put in sentence case', ?, ?, ?, 1, ?)`).bind(e.id, JSON.stringify(d), reader.who.name, reader.who.batch || '', reader.who.key, now).run();
            await makeLive(db, e.id, rev.meta.last_row_id, { publish: e.status === 'published', reviewer: reader.adminUser });
            fixed++;
        }
        return json({ success: true, fixed, remaining: todo.length - fixed });
    }
    if (body.action === 'autoformat-body') {   // a plain-text table or an unbolded "Label:" line in an entry's body gets this library's own markdown (12 per call; run again until none remain)
        const { results } = await db.prepare(`SELECT e.id, e.status, r.data FROM lib_entries e JOIN lib_revisions r ON r.id = e.live_rev WHERE e.live_rev IS NOT NULL`).all();
        const todo = [];
        for (const row of results || []) {
            const d = JSON.parse(row.data);
            const formatted = autoformatBody(d.body);
            if (formatted !== d.body) todo.push({ id: row.id, status: row.status, data: d, formatted });
        }
        let fixed = 0;
        for (const t of todo.slice(0, 12)) {
            t.data.body = t.formatted;
            const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', 'Autoformatted: tables and bold labels', ?, ?, ?, 1, ?)`).bind(t.id, JSON.stringify(t.data), reader.who.name, reader.who.batch || '', reader.who.key, now).run();
            await makeLive(db, t.id, rev.meta.last_row_id, { publish: t.status === 'published', reviewer: reader.adminUser });
            fixed++;
        }
        return json({ success: true, fixed, remaining: todo.length - fixed });
    }
    if (body.action === 'import-glossary') return importGlossary(request, env, db);
    if (body.action === 'import-training') return importTraining(request, env, db, reader);
    if (body.action === 'import-tettra') return importTettra(request, env, db, reader);
    if (body.action === 'copy-images') return copyImages(env, db);
    return fail('Unknown action.');
}

// Publishes the handouts bundled in public/seed/docs.json as pages of the library (their text, headings, lists and tables), not as
// files in a PDF viewer. Safe to run again: a handout already imported is skipped, and one that was imported earlier as a PDF
// attachment is rewritten as a text page.
async function importBundled(request, env, db, reader) {
    const origin = new URL(request.url).origin;
    const m = await env.ASSETS.fetch(new Request(origin + '/seed/docs.json'));
    if (!m.ok) return json({ success: true, imported: 0, updated: 0, remaining: 0, note: 'There are no bundled documents to import.' });
    const docs = await m.json();
    const have = new Map(((await db.prepare(`SELECT e.legacy_ref AS ref, e.id, r.data FROM lib_entries e LEFT JOIN lib_revisions r ON r.id = e.live_rev WHERE e.legacy_ref LIKE 'seed:%'`).all()).results || [])
        .map(r => [r.ref, { id: r.id, data: r.data ? JSON.parse(r.data) : {} }]));
    // what still needs doing: a document not imported yet, or one whose text, section or attachments changed
    const todo = docs.filter(d => { const h = have.get('seed:' + d.file); return !h || (h.data.files || []).length || h.data.body !== d.body || h.data.title !== d.title || (h.data.section || '') !== (d.section || ''); });
    let imported = 0, updated = 0;
    for (const d of todo.slice(0, 10)) {   // 10 per call; the page calls again until none remain
        const ref = 'seed:' + d.file, now = nowIso();
        const data = { collection: d.collection, section: d.section || '', type: d.type || 'Guide', title: d.title, summary: d.summary || '',
            body: d.body, tags: d.tags || [], credits: [], files: [], official: false };
        const old = have.get(ref);
        if (old) {
            const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', 'Updated from the bundled document', ?, ?, ?, 1, ?)`).bind(old.id, JSON.stringify({ ...old.data, ...data, official: !!old.data.official }), reader.who.name, reader.who.batch || '', reader.who.key, now).run();
            await makeLive(db, old.id, rev.meta.last_row_id, { reviewer: reader.adminUser });
            updated++;
            continue;
        }
        const r = await db.prepare(`INSERT INTO lib_entries (status, collection, section, type, title, summary, tags, author_name, author_batch, author_key, by_staff, legacy_ref, created_at, updated_at)
            VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(data.collection, data.section, data.type, data.title, data.summary, data.tags.join(','),
                reader.who.name, reader.who.batch || '', reader.who.key, ref, now, now).run();
        const id = r.meta.last_row_id;
        const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
            VALUES (?, ?, 'pending', 'Added from the bundled documents', ?, ?, ?, 1, ?)`).bind(id, JSON.stringify(data), reader.who.name, reader.who.batch || '', reader.who.key, now).run();
        await makeLive(db, id, rev.meta.last_row_id, { reviewer: reader.adminUser });
        imported++;
    }
    const targets = [...new Set(docs.map(d => d.collection))];   // the documents' collections show again, even if the starters were tidied away
    if (targets.length) await db.prepare(`UPDATE lib_collections SET archived = 0 WHERE slug IN (${targets.map(() => '?').join(',')})`).bind(...targets).run();
    return json({ success: true, imported, updated, remaining: todo.length - imported - updated });
}

// ---- Glossary: a dictionary of terms (public/seed/glossary.json, made by scripts/tettra_convert.py), kept apart from the entries ----
async function glossary({ request, env, db, reader }) {
    // First time it is opened with nothing in it: load the bundled terms, so nobody has to find the Admin import.
    const have = await db.prepare(`SELECT COUNT(*) AS n FROM lib_terms`).first();
    if (!have || !have.n) await importGlossary(request, env, db);
    const { results } = await db.prepare(`SELECT id, term, definition, example, category, source FROM lib_terms ORDER BY term COLLATE NOCASE`).all();
    // The reader's own suggestions that are still waiting, or were sent back with a note.
    const { results: mine } = await db.prepare(`SELECT * FROM lib_term_changes WHERE author_key = ? AND status IN ('pending', 'rejected') ORDER BY id DESC LIMIT 60`).bind(reader.who.key).all();
    const waiting = reader.staff ? (await db.prepare(`SELECT COUNT(*) AS n FROM lib_term_changes WHERE status = 'pending'`).first()).n : undefined;
    return json({ success: true, terms: results || [], mine: (mine || []).map(shapeChange), waiting });
}
const shapeChange = (c) => ({ id: c.id, termId: c.term_id, action: c.action, term: c.term || '', definition: c.definition || '', example: c.example || '', category: c.category || '',
    status: c.status, author: c.author_name, batch: c.author_batch || '', authorKey: c.author_key, reviewNote: c.review_note || '', createdAt: c.created_at });

// Glossary changes follow the same rule as entries: tenured VAs, reviewers and admins can suggest; an admin's change is applied straight away;
// everyone else's waits for an admin or another reviewer (never the person who made it).
async function glossaryAction({ request, db, reader }) {
    const body = await readJson(request) || {};
    const now = nowIso(), reviewer = reader.adminUser || reader.who.name;
    const fieldsOf = () => ({ term: oneLine(body.term, 120), definition: clean(body.definition, 4000), example: clean(body.example, 1000), category: oneLine(body.category, 40) || 'General' });
    const apply = async (c) => {   // c: { action, term_id, term, definition, example, category }
        if (c.action === 'delete') {
            const t = await db.prepare(`SELECT ref FROM lib_terms WHERE id = ?`).bind(c.term_id).first();
            if (t && t.ref) await db.prepare(`INSERT OR IGNORE INTO lib_term_gone (ref) VALUES (?)`).bind(t.ref).run();
            const r = await db.prepare(`DELETE FROM lib_terms WHERE id = ?`).bind(c.term_id).run();
            return !!r.meta.changes;
        }
        if (c.action === 'edit') {
            const r = await db.prepare(`UPDATE lib_terms SET term = ?, definition = ?, example = ?, category = ?, edited = 1, updated_at = ? WHERE id = ?`).bind(c.term, c.definition, c.example || '', c.category, now, c.term_id).run();
            return !!r.meta.changes;
        }
        if (await db.prepare(`SELECT 1 AS x FROM lib_terms WHERE term = ? COLLATE NOCASE AND definition = ?`).bind(c.term, c.definition).first()) return true;   // already there
        await db.prepare(`INSERT INTO lib_terms (term, definition, example, category, source, edited, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
            .bind(c.term, c.definition, c.example || '', c.category, 'Added by ' + (c.author_name || reviewer), now, now).run();
        return true;
    };

    if (body.action === 'save' || body.action === 'delete') {   // direct changes: admins only
        if (!reader.admin) return fail('Glossary changes need approval. Use “Suggest” instead.', 403);
        if (body.action === 'delete') {
            if (!(await apply({ action: 'delete', term_id: Number(body.id) }))) return fail('That term is already gone.', 404);
            return json({ success: true });
        }
        const f = fieldsOf();
        if (!f.term || f.definition.length < 3) return fail('Give the term and its meaning.');
        const ok = await apply({ action: body.id ? 'edit' : 'add', term_id: Number(body.id) || null, author_name: reader.who.name, ...f });
        return ok ? json({ success: true }) : fail('That term is no longer in the Glossary.', 404);
    }

    if (body.action === 'suggest') {
        if (!reader.admin && await overLimit(request, db, 'term', 20)) return fail('You’ve sent a lot in a short time. Wait a few minutes and try again.', 429);
        const action = ['add', 'edit', 'delete'].includes(body.change) ? body.change : null;
        if (!action) return fail('Unknown change.');
        let termId = null, base = null, f = { term: '', definition: '', example: '', category: '' };
        if (action !== 'add') {
            const t = await db.prepare(`SELECT * FROM lib_terms WHERE id = ?`).bind(Number(body.id)).first();
            if (!t) return fail('That term is no longer in the Glossary.', 404);
            termId = t.id; base = t.updated_at;
            f = action === 'delete' ? { term: t.term, definition: t.definition, example: t.example || '', category: t.category } : fieldsOf();
        } else f = fieldsOf();
        if (action !== 'delete' && (!f.term || f.definition.length < 3)) return fail('Give the term and its meaning.');
        if (action === 'delete' && !oneLine(body.note, 300)) return fail('Say why this term should be removed.');
        if (action === 'add' && await db.prepare(`SELECT 1 AS x FROM lib_terms WHERE term = ? COLLATE NOCASE AND definition = ?`).bind(f.term, f.definition).first()) return fail('That term is already in the Glossary.');
        // A new suggestion replaces the same person's earlier one for the same term.
        if (termId) await db.prepare(`UPDATE lib_term_changes SET status = 'withdrawn' WHERE term_id = ? AND author_key = ? AND status = 'pending'`).bind(termId, reader.who.key).run();
        const mineCount = (await db.prepare(`SELECT COUNT(*) AS n FROM lib_term_changes WHERE author_key = ? AND status = 'pending'`).bind(reader.who.key).first()).n;
        if (mineCount >= 50) return fail('You have 50 suggestions waiting. Wait for them to be reviewed first.', 429);
        const note = oneLine(body.note, 300);
        await db.prepare(`INSERT INTO lib_term_changes (term_id, action, term, definition, example, category, status, author_name, author_batch, author_key, review_note, created_at, base)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`).bind(termId, action, f.term, f.definition, f.example, f.category, reader.who.name, reader.who.batch, reader.who.key, action === 'delete' ? note : null, now, base).run();
        return json({ success: true, status: 'pending' });
    }

    if (body.action === 'withdraw') {
        const r = await db.prepare(`UPDATE lib_term_changes SET status = 'withdrawn' WHERE id = ? AND author_key = ? AND status = 'pending'`).bind(Number(body.id), reader.who.key).run();
        return r.meta.changes ? json({ success: true }) : fail('That suggestion is no longer waiting.', 409);
    }

    if (body.action === 'review') {
        if (!reader.staff) return fail('Reviewer access required.', 403);
        const c = await db.prepare(`SELECT * FROM lib_term_changes WHERE id = ?`).bind(Number(body.id)).first();
        if (!c || c.status !== 'pending') return fail('That suggestion is no longer waiting for review.', 409);
        const note = oneLine(body.note, 600);
        if (body.decision === 'approve') {
            if (!reader.admin && c.author_key === reader.who.key) return fail('You can’t approve your own change. Another reviewer or an admin needs to.', 403);
            if (c.term_id && !reader.admin) {   // the term changed after this was suggested: the author redoes it on the current wording
                const cur = await db.prepare(`SELECT updated_at FROM lib_terms WHERE id = ?`).bind(c.term_id).first();
                if (cur && c.base && cur.updated_at !== c.base) return fail('That term changed after this was suggested. Send it back so the author can redo it.', 409);
            }
            // Claim it first, so two reviewers can't both apply it.
            const claim = await db.prepare(`UPDATE lib_term_changes SET status = 'approved', review_note = COALESCE(?, review_note), reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`).bind(note || null, reviewer, now, c.id).run();
            if (!claim.meta.changes) return fail('That suggestion is no longer waiting for review.', 409);
            if (!(await apply(c))) {
                await db.prepare(`UPDATE lib_term_changes SET status = 'rejected', review_note = 'The term was changed or removed before this was reviewed.' WHERE id = ?`).bind(c.id).run();
                return fail('That term is no longer in the Glossary, so there is nothing to change.', 409);
            }
            return json({ success: true });
        }
        if (body.decision === 'reject') {
            if (!note) return fail('Tell the author what to change. They’ll see this note.');
            await db.prepare(`UPDATE lib_term_changes SET status = 'rejected', review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'`).bind(note, reviewer, now, c.id).run();
            return json({ success: true });
        }
        return fail('Unknown decision.');
    }
    return fail('Unknown action.');
}
// Adds the bundled terms; a term already there is left alone if someone edited it, otherwise brought up to date.
async function importGlossary(request, env, db) {
    const res = await env.ASSETS.fetch(new Request(new URL(request.url).origin + '/seed/glossary.json'));
    if (!res.ok) return json({ success: true, imported: 0, remaining: 0, note: 'There are no glossary terms to import.' });
    const { terms } = await res.json();
    const now = nowIso();
    const { results: gone } = await db.prepare(`SELECT ref FROM lib_term_gone`).all();
    const skip = new Set((gone || []).map(g => g.ref));
    for (let i = 0; i < terms.length; i += 40) {
        await db.batch(terms.slice(i, i + 40).filter(t => !skip.has(t.ref)).map(t => db.prepare(`INSERT INTO lib_terms (term, definition, example, category, source, ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ref) DO UPDATE SET term = excluded.term, definition = excluded.definition, example = excluded.example, category = excluded.category, source = excluded.source, updated_at = excluded.updated_at
            WHERE lib_terms.edited = 0`).bind(t.term, t.definition, t.example || '', t.category, t.source || '', t.ref, now, now)));
    }
    return json({ success: true, imported: terms.length, remaining: 0 });
}

// ---- Training topics (public/seed/training.json, made by scripts/training_topics.mjs) ----
// One page per topic of the Foundational Training lessons, in the Foundational Training collection, one section per lesson.
// 12 pages per call; run again until none remain. Safe to run again: a page already imported is skipped, or updated if its text changed.
async function importTraining(request, env, db, reader) {
    const res = await env.ASSETS.fetch(new Request(new URL(request.url).origin + '/seed/training.json'));
    if (!res.ok) return json({ success: true, imported: 0, remaining: 0, note: 'There are no training topics to import.' });
    const { pages } = await res.json();
    const have = new Map(((await db.prepare(`SELECT e.legacy_ref AS ref, e.id, r.data FROM lib_entries e LEFT JOIN lib_revisions r ON r.id = e.live_rev WHERE e.legacy_ref LIKE 'train:%'`).all()).results || [])
        .map(r => [r.ref, { id: r.id, data: r.data ? JSON.parse(r.data) : {} }]));
    const dataOf = (p) => ({ collection: 'foundational', section: `Lesson ${p.lesson} · ${p.lessonTitle}`, type: 'Guide', title: p.title, summary: p.summary || '', body: p.body,
        tags: ['training', 'lesson ' + p.lesson], credits: [], files: [], official: false });
    const todo = pages.filter(p => { const h = have.get('train:' + p.id); return !h || h.data.body !== p.body || h.data.title !== p.title; });
    let done = 0;
    for (const p of todo.slice(0, 12)) {
        const now = nowIso(), data = dataOf(p), old = have.get('train:' + p.id);
        if (old) {
            const rv = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', 'Training topic updated from the lesson', ?, ?, ?, 1, ?)`).bind(old.id, JSON.stringify({ ...old.data, ...data }), reader.who.name, reader.who.batch || '', reader.who.key, now).run();
            await makeLive(db, old.id, rv.meta.last_row_id, { reviewer: reader.adminUser });
        } else {
            const r = await db.prepare(`INSERT INTO lib_entries (status, collection, section, type, title, summary, tags, author_name, author_batch, author_key, by_staff, legacy_ref, created_at, updated_at)
                VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(data.collection, data.section, data.type, data.title, data.summary, data.tags.join(','),
                    reader.who.name, reader.who.batch || '', reader.who.key, 'train:' + p.id, now, now).run();
            const rv = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', 'Made from the Foundational Training lesson', ?, ?, ?, 1, ?)`).bind(r.meta.last_row_id, JSON.stringify(data), reader.who.name, reader.who.batch || '', reader.who.key, now).run();
            await makeLive(db, r.meta.last_row_id, rv.meta.last_row_id, { reviewer: reader.adminUser });
        }
        done++;
    }
    await db.prepare(`UPDATE lib_collections SET archived = 0 WHERE slug = 'foundational'`).run();   // the training topics live here, even if the starter shelves were tidied away
    return json({ success: true, imported: done, remaining: todo.length - done });
}

// ---- Tettra import (public/seed/tettra.json, made by scripts/tettra_convert.py) ----
const slugOf = (name) => String(name).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'collection';
const tettraTime = (t) => String(t || '').replace(' ', 'T') + 'Z';

// Each Tettra category becomes a collection and its subcategory a section. 12 pages per call; run again until none remain.
// Safe to run again: a page already imported (legacy_ref 'tettra:<id>') is skipped.
async function importTettra(request, env, db, reader) {
    const res = await env.ASSETS.fetch(new Request(new URL(request.url).origin + '/seed/tettra.json'));
    if (!res.ok) return json({ success: true, imported: 0, remaining: 0, note: 'There are no Tettra pages to import.' });
    const { pages, images } = await res.json();
    // Pages not imported yet, and pages imported earlier whose text has since been corrected, are both still to do.
    const have = new Map(((await db.prepare(`SELECT e.legacy_ref AS ref, e.id, e.status, r.data FROM lib_entries e LEFT JOIN lib_revisions r ON r.id = e.live_rev WHERE e.legacy_ref LIKE 'tettra:%'`).all()).results || [])
        .map(r => [r.ref, { id: r.id, status: r.status, data: r.data ? JSON.parse(r.data) : {} }]));
    const wanted = new Set(pages.map(p => 'tettra:' + p.id));
    // pages that were imported earlier but are no longer part of the Knowledge Base (company policies and management) are archived
    const gone = [...have].filter(([ref, h]) => !wanted.has(ref) && h.status !== 'archived');
    const todo = pages.filter(p => { const h = have.get('tettra:' + p.id); return !h || h.data.body !== p.body || h.data.title !== p.title || (h.data.tags || []).join() !== (p.tags || []).join(); });
    const now = nowIso();
    if (!have.size || todo.some(p => !have.has('tettra:' + p.id))) {   // the shelves and the image list, for any page not yet imported
        const cats = [...new Set(pages.map(p => p.category))].sort();
        await db.batch(cats.map((c, i) => db.prepare(`INSERT INTO lib_collections (slug, name, blurb, sort, archived, created_at) VALUES (?, ?, '', ?, 0, ?)
            ON CONFLICT(slug) DO NOTHING`).bind(collectionOf(c), c === 'Test. Test' ? 'General' : c, 1000 + i, now)));
        const rows = Object.entries(images || {});
        for (let i = 0; i < rows.length; i += 90) await db.batch(rows.slice(i, i + 90).map(([h, u]) => db.prepare(`INSERT OR IGNORE INTO lib_images (hash, src) VALUES (?, ?)`).bind(h, u)));
    }
    let imported = 0, budget = 12;
    for (const [, h] of gone.slice(0, budget)) {
        await db.prepare(`UPDATE lib_entries SET status = 'archived', updated_at = ? WHERE id = ?`).bind(nowIso(), h.id).run();
        await reindex(db, h.id);
        imported++; budget--;
    }
    for (const p of todo.slice(0, Math.max(0, budget))) {
        const old = have.get('tettra:' + p.id);
        if (old) {   // already imported: a new version with the corrected text
            const d = { ...old.data, collection: collectionOf(p.category), section: p.subcategory || '', title: p.title, summary: p.summary || '', body: p.body, tags: p.tags || [] };
            const rv = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', 'Updated', ?, '', ?, 1, ?)`).bind(old.id, JSON.stringify(d), p.owner || 'LSH Team', 'tettra|' + p.id, nowIso()).run();
            await makeLive(db, old.id, rv.meta.last_row_id, { reviewer: reader.adminUser });
            await db.prepare(`UPDATE lib_entries SET created_at = ?, updated_at = ?, published_at = ?, author_batch = '', tags = ? WHERE id = ?`).bind(tettraTime(p.created), tettraTime(p.updated), tettraTime(p.updated), (p.tags || []).join(','), old.id).run();
            imported++;
            continue;
        }
        const data = { collection: collectionOf(p.category), section: p.subcategory || '', type: 'Guide', title: p.title, summary: p.summary || '', body: p.body,
            tags: p.tags || [], credits: p.owner ? [p.owner] : [], files: [], official: false };
        const key = 'tettra|' + p.id, created = tettraTime(p.created), updated = tettraTime(p.updated);
        const r = await db.prepare(`INSERT INTO lib_entries (status, collection, section, type, title, summary, tags, author_name, author_batch, author_key, by_staff, legacy_ref, created_at, updated_at)
            VALUES ('pending', ?, ?, 'Guide', ?, ?, ?, ?, '', ?, 1, ?, ?, ?)`).bind(data.collection, data.section, data.title, data.summary, data.tags.join(','), p.owner || 'LSH Team', key, 'tettra:' + p.id, created, updated).run();
        const id = r.meta.last_row_id;
        const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
            VALUES (?, ?, 'pending', 'Imported', ?, '', ?, 1, ?)`).bind(id, JSON.stringify(data), p.owner || 'LSH Team', key, created).run();
        await makeLive(db, id, rev.meta.last_row_id, { reviewer: reader.adminUser });
        await db.prepare(`UPDATE lib_entries SET created_at = ?, updated_at = ?, published_at = ? WHERE id = ?`).bind(created, updated, updated, id).run();
        imported++;
    }
    const left = gone.length + todo.length - imported;
    if (left === 0) await archiveEmptyStarters(db);
    return json({ success: true, imported, remaining: left });
}
// Once the knowledge is saved, the starter collections that have nothing in them are archived (hidden, not deleted; Admin can bring one back).
async function archiveEmptyStarters(db) {
    const slugs = DEFAULT_COLLECTIONS.map(c => c[0]);
    await db.prepare(`UPDATE lib_collections SET archived = 1 WHERE slug IN (${slugs.map(() => '?').join(',')})
        AND NOT EXISTS (SELECT 1 FROM lib_entries e WHERE e.collection = lib_collections.slug)`).bind(...slugs).run();
}
const collectionOf = (cat) => cat === 'Test. Test' ? 'general' : slugOf(cat);

const IMG_HOSTS = /^https:\/\/(tettra-production\.s3\.us-west-2\.amazonaws\.com|tettra-staging\.s3-us-west-2\.amazonaws\.com|d33v4339jhl8k0\.cloudfront\.net|lh[0-9]\.googleusercontent\.com)\//;

// Copies one imported image from where Tettra kept it into R2 (kb/img/<hash>). Returns the R2 object, or null when the original is gone.
async function storeImage(env, db, hash) {
    const row = await db.prepare(`SELECT src, status FROM lib_images WHERE hash = ?`).bind(hash).first();
    if (!row) return null;
    const key = 'kb/img/' + hash;
    if (row.status === 'ready') return await env.FILES.get(key);
    if (row.status === 'gone' || !IMG_HOSTS.test(row.src)) return null;
    let res;
    try { res = await fetch(row.src); } catch (e) { return null; }
    const type = (res.headers.get('content-type') || '').split(';')[0];
    if (!res.ok || !/^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/mp4)$/.test(type)) {
        if (res.status === 404 || res.status === 403 || res.ok) await db.prepare(`UPDATE lib_images SET status = 'gone' WHERE hash = ?`).bind(hash).run();
        return null;
    }
    await env.FILES.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: type } });
    await db.prepare(`UPDATE lib_images SET status = 'ready' WHERE hash = ?`).bind(hash).run();
    return await env.FILES.get(key);
}

async function serveImage({ env, db }, hash, attachment) {
    if (!/^[0-9a-f]{16}$/.test(String(hash || '')) || !env.FILES) return fail('Not found.', 404);
    const obj = await storeImage(env, db, hash);
    if (!obj) return new Response('', { status: 404 });
    const headers = { 'Content-Type': obj.httpMetadata.contentType || 'image/png', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' };
    if (attachment) headers['Content-Disposition'] = 'inline';   // a PDF or a video attached to an imported page, opened in its own tab
    return new Response(obj.body, { headers });
}

// Copies the imported images into R2 ahead of time, 15 per call, so they survive Tettra being closed.
async function copyImages(env, db) {
    if (!env.FILES) return fail('File storage isn’t connected: the R2 bucket (FILES) is not bound to this Worker.', 500);
    const { results } = await db.prepare(`SELECT hash FROM lib_images WHERE status = 'pending' LIMIT 15`).all();
    let copied = 0;
    for (const r of results || []) if (await storeImage(env, db, r.hash)) copied++;
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM lib_images WHERE status = 'pending'`).first();
    const gone = await db.prepare(`SELECT COUNT(*) AS n FROM lib_images WHERE status = 'gone'`).first();
    return json({ success: true, copied, remaining: left.n, missing: gone.n });
}

// Copies the old Knowledge Base's posts (with their replies, votes and views)
// into the library, 40 at a time. Safe to run again: imported posts are skipped.
async function importLegacy(db, reader) {
    let rows;
    try {
        ({ results: rows } = await db.prepare(`SELECT a.* FROM kb_articles a WHERE NOT EXISTS (SELECT 1 FROM lib_entries e WHERE e.legacy_ref = 'a:' || a.id)
            AND a.status IN ('published', 'pending', 'rejected', 'hidden') ORDER BY a.id LIMIT 40`).all());
    } catch (e) {
        return json({ success: true, imported: 0, remaining: 0, note: 'There is no old Knowledge Base to import.' });
    }
    for (const a of rows || []) {
        const status = { published: 'published', pending: 'pending', rejected: 'rejected', hidden: 'archived' }[a.status];
        const body = a.body + (a.link_url ? `\n\n**Link:** ${a.link_url}` : '');
        const data = { collection: LEGACY_COLLECTION[a.category] || 'general', section: '', type: LEGACY_TYPE[a.type] || 'Tip', title: a.title,
            summary: a.summary || '', body, tags: [...(a.tags ? a.tags.split(',') : []), ...(LEGACY_COLLECTION[a.category] === 'practice-areas' ? [a.category.toLowerCase()] : [])].slice(0, 12),
            credits: a.credits ? a.credits.split(',') : [], files: [], official: false };
        const r = await db.prepare(`INSERT INTO lib_entries (status, collection, section, type, title, summary, tags, featured, author_name, author_batch, author_key, by_staff,
            legacy_ref, created_at, updated_at, review_note, reviewed_by, reviewed_at) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(status === 'archived' ? 'pending' : status, data.collection, data.type, data.title, data.summary, data.tags.join(','), a.featured ? 1 : 0,
                a.author_name, a.author_batch, a.author_key, a.by_admin ? 1 : 0, 'a:' + a.id, a.created_at, a.updated_at, a.review_note, a.reviewed_by, a.reviewed_at).run();
        const id = r.meta.last_row_id;
        const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at, review_note, reviewed_by, reviewed_at)
            VALUES (?, ?, ?, 'Imported from the old Knowledge Base', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, JSON.stringify(data), status === 'rejected' ? 'rejected' : 'pending',
                a.author_name, a.author_batch, a.author_key, a.by_admin ? 1 : 0, a.created_at, a.review_note, a.reviewed_by, a.reviewed_at).run();
        if (status === 'published' || status === 'archived') {
            await makeLive(db, id, rev.meta.last_row_id, { reviewer: a.reviewed_by || reader.adminUser });
            await db.prepare(`UPDATE lib_entries SET published_at = ?, updated_at = ?, status = ? WHERE id = ?`).bind(a.reviewed_at || a.updated_at, a.updated_at, status, id).run();
            if (status === 'archived') await reindex(db, id);
        }
        const oldRef = 'a:' + a.id, newRef = refOf(id);
        await db.batch([
            db.prepare(`INSERT OR IGNORE INTO kb_stats (article_ref, views, helpful) SELECT ?, views, helpful FROM kb_stats WHERE article_ref = ?`).bind(newRef, oldRef),
            db.prepare(`INSERT OR IGNORE INTO kb_votes (article_ref, voter, created_at) SELECT ?, voter, created_at FROM kb_votes WHERE article_ref = ?`).bind(newRef, oldRef),
            db.prepare(`INSERT INTO kb_comments (article_ref, body, author_name, author_batch, author_key, by_admin, status, review_note, reviewed_by, reviewed_at, created_at, ip)
                SELECT ?, body, author_name, author_batch, author_key, by_admin, status, review_note, reviewed_by, reviewed_at, created_at, ip FROM kb_comments WHERE article_ref = ?`).bind(newRef, oldRef)
        ]);
    }
    const left = await db.prepare(`SELECT COUNT(*) AS n FROM kb_articles a WHERE NOT EXISTS (SELECT 1 FROM lib_entries e WHERE e.legacy_ref = 'a:' || a.id)
        AND a.status IN ('published', 'pending', 'rejected', 'hidden')`).first();
    return json({ success: true, imported: (rows || []).length, remaining: left.n });
}

// Everything in the library as one JSON file: entries with every version,
// file details (the files themselves stay in R2 under kb/files/) and replies.
async function exportAll({ db }) {
    const all = async (sql) => (await db.prepare(sql).all()).results || [];
    const out = {
        exportedAt: nowIso(),
        collections: await all(`SELECT * FROM lib_collections ORDER BY sort`),
        entries: await all(`SELECT * FROM lib_entries ORDER BY id`),
        versions: (await all(`SELECT * FROM lib_revisions ORDER BY id`)).map(r => ({ ...r, data: JSON.parse(r.data) })),
        files: await all(`SELECT id, r2_key, name, size, mime, kind, status, uploader_name, created_at, completed_at FROM lib_files ORDER BY created_at`),
        replies: await all(`SELECT id, article_ref, body, author_name, author_batch, status, created_at FROM kb_comments WHERE article_ref LIKE 'e:%' ORDER BY id`),
        stats: await all(`SELECT * FROM kb_stats WHERE article_ref LIKE 'e:%'`)
    };
    return new Response(JSON.stringify(out, null, 1), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="lsh-knowledge-base-${out.exportedAt.slice(0, 10)}.json"` } });
}

