// LSH Knowledge Base: one page, hash routes.
//   #/                     library home          #/c/<collection>    a collection, grouped by section
//   #/search?q=…           search                #/videos            training videos
//   #/e/<id>               an entry              #/e/<id>/edit       edit (or suggest an edit)
//   #/e/<id>/history       every version         #/v/<version>       one version, compared with the live one
//   #/new?collection=…     add to the library    #/mine              my contributions
//   #/people[/<key>]       contributors          #/review            review queue (reviewers, admins)
//   #/admin                admin
(function () {
    const app = document.getElementById('app');
    const esc = window.KBmd.esc;
    const S = { session: null, lib: null, sections: {} };
    window.KB_SESSION = () => S.session;   // for the 🧭 Blueprint (blueprint-content.js): who is signed in
    let leaveGuard = null;   // set while uploads are running

    /* ---------- helpers ---------- */
    async function api(path, opts = {}) {
        const init = { credentials: 'same-origin', method: opts.method || (opts.body ? 'POST' : 'GET') };
        if (opts.body) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opts.body); }
        const res = await fetch(path, init);
        let data = {};
        try { data = await res.json(); } catch (e) { data = { success: false, error: `The server answered ${res.status}.` }; }
        if (res.status === 401 && data.code === 'KB_LOCKED') { S.session = null; route(); }
        if (!res.ok || data.success === false) throw new Error(data.error || `Something went wrong (${res.status}).`);
        return data;
    }
    const post = (path, body) => api(path, { body });
    let toastTimer;
    function toast(msg, bad) {
        const t = document.getElementById('toast');
        t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
    }
    const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const fmtWhen = (iso) => iso ? new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    function fmtSize(n) {
        if (!n) return '0 B';
        const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + ' ' + u[i];
    }
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
    const TYPE_ICON = { 'Training video': '▶', 'SOP': '📘', 'Guide': '🧭', 'Checklist': '☑️', 'Template': '🧩', 'Reference': '📚', 'Tip': '💡', 'Lesson learned': '🎓', 'Question': '❓' };
    const FILE_ICON = { video: '🎬', audio: '🎧', pdf: '📄', image: '🖼️', doc: '📝', sheet: '📊', slides: '📽️', archive: '🗜️', other: '📎' };
    const fileUrl = (f, dl) => `/files/${f.id}/${encodeURIComponent(f.name)}${dl ? '?download=1' : ''}`;
    const colName = (slug) => ((S.lib && S.lib.collections.find(c => c.slug === slug)) || {}).name || slug;
    const setTitle = (t) => { document.title = t ? `${t} · LSH Knowledge Base` : 'LSH Knowledge Base'; };
    const view = (html) => { app.innerHTML = html; window.scrollTo(0, 0); };
    const errorView = (e) => view(`<div class="card"><h2>That didn’t load</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to the library</a></div>`);

    async function ensureLib(force) {
        if (!S.lib || force) S.lib = await api('/api/library');
        return S.lib;
    }

    function statusBadge(status) {
        const label = { pending: 'Waiting for review', rejected: 'Sent back', archived: 'Archived', withdrawn: 'Withdrawn' }[status];
        return label ? `<span class="badge ${status === 'withdrawn' ? 'archived' : status}">${label}</span>` : '';
    }
    function itemHTML(e, { showCollection = true, showStatus = false } = {}) {
        const snip = e.snippet ? `<p class="snip">${esc(e.snippet).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>')}</p>` : (e.summary ? `<p>${esc(e.summary)}</p>` : '');
        return `<a class="item" href="#/e/${e.id}">
            <span class="ic${e.hasVideo ? ' video' : e.official ? ' official' : ''}" aria-hidden="true">${e.hasVideo ? '▶' : TYPE_ICON[e.type] || '📄'}</span>
            <span><h3>${esc(e.title)}</h3>${snip}
            <span class="meta-line">
                ${e.official ? '<span class="badge official">✓ Official</span>' : ''}${e.hasVideo ? '<span class="badge video">Video</span>' : ''}
                ${showStatus ? statusBadge(e.status) : ''}
                <span>${esc(e.type)}</span>
                ${showCollection ? `<span>${esc(colName(e.collection))}${e.section ? ' › ' + esc(e.section) : ''}</span>` : ''}
                <span>${esc(e.author)}</span><span>${fmtDate(e.updatedAt)}</span>
                ${e.fileCount ? `<span>${plural(e.fileCount, 'file')}</span>` : ''}
                ${e.helpful ? `<span>👍 ${e.helpful}</span>` : ''}${e.views ? `<span>${plural(e.views, 'view')}</span>` : ''}
            </span></span></a>`;
    }
    const listHTML = (items, opts) => items.length ? `<div class="list">${items.map(e => itemHTML(e, opts)).join('')}</div>` : '';

    /* ---------- session / chrome ---------- */
    async function loadSession() { S.session = await api('/api/session'); }

    function chrome(on) {
        document.getElementById('top-search').hidden = !on;
        const nav = document.getElementById('top-nav');
        nav.hidden = !on;
        if (!on) return;
        const s = S.session, q = S.lib && S.lib.queue;
        const waiting = q ? q.revisions + q.comments : 0;
        const here = location.hash.split('?')[0];
        const link = (href, label, extra = '') => `<a href="${href}"${here === href || (href !== '#/' && here.startsWith(href)) ? ' class="on"' : ''}${extra}>${label}</a>`;
        nav.innerHTML = [
            link('#/', 'Library'), link('#/videos', 'Videos'), link('#/people', 'Contributors'), link('#/mine', 'My contributions'),
            (s.admin || s.reviewer) ? link('#/review', `Review${waiting ? `<span class="count">${waiting}</span>` : ''}`) : '',
            s.admin ? link('#/admin', 'Admin') : '',
            `<a class="cta" href="#/new">+ Add to the library</a>`,
            `<button type="button" id="signout" title="Signed in as ${esc(s.who.name)}${s.who.batch ? ' (' + esc(s.who.batch) + ')' : ''}">Sign out</button>`
        ].join('');
        if (window.LSHBlueprint) LSHBlueprint.refresh();   // 🧭 Blueprint, before Sign out
        document.getElementById('signout').onclick = async () => {
            await post('/api/session', { action: s.admin ? 'admin-logout' : 'signout' }).catch(() => {});
            S.session = null; S.lib = null; location.hash = '#/'; route();
        };
    }

    function gate() {
        chrome(false); setTitle('Sign in');
        const open = S.session && S.session.configured;
        view(`<div class="gate">
            <h1>LSH Knowledge Base</h1>
            <p class="lead">SOPs, training videos and know-how from the whole LSH VA community.</p>
            <div class="card">
                <div class="tabs" role="tablist">
                    <button type="button" role="tab" aria-selected="true" data-tab="va">VA community</button>
                    <button type="button" role="tab" aria-selected="false" data-tab="admin">Admin</button>
                </div>
                <form id="f-va" autocomplete="on">
                    ${open ? '' : '<p class="note">The Knowledge Base isn’t open yet. An admin needs to sign in and set the team access code.</p>'}
                    <label class="f">Full name<input class="i" id="g-name" name="name" required autocomplete="name"></label>
                    <label class="f">Batch <small>(optional)</small><input class="i" id="g-batch" name="batch" placeholder="e.g. Batch 12"></label>
                    <label class="f">Team access code<input class="i" id="g-code" name="code" type="password" required autocomplete="off"><small>Your trainer or team lead gives you this code.</small></label>
                    <button class="btn primary" type="submit"${open ? '' : ' disabled'}>Open the library</button>
                    <p class="muted" id="g-err" role="alert"></p>
                </form>
                <form id="f-admin" hidden>
                    <p class="muted" style="margin:0">Use your LSH Training Portal admin login.</p>
                    <label class="f">Username<input class="i" id="g-user" required autocomplete="username"></label>
                    <label class="f">Password<input class="i" id="g-pass" type="password" required autocomplete="current-password"></label>
                    <button class="btn primary" type="submit">Sign in as admin</button>
                    <p class="muted" id="g-err2" role="alert"></p>
                </form>
            </div></div>`);
        app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
            app.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
            document.getElementById('f-va').hidden = b.dataset.tab !== 'va';
            document.getElementById('f-admin').hidden = b.dataset.tab !== 'admin';
        });
        document.getElementById('f-va').onsubmit = async (ev) => {
            ev.preventDefault();
            try {
                await post('/api/session', { action: 'unlock', name: val('g-name'), batch: val('g-batch'), code: val('g-code') });
                S.session = null; route();
            } catch (e) { document.getElementById('g-err').textContent = e.message; }
        };
        document.getElementById('f-admin').onsubmit = async (ev) => {
            ev.preventDefault();
            try {
                await post('/api/session', { action: 'admin-login', username: val('g-user'), password: val('g-pass') });
                S.session = null; route();
            } catch (e) { document.getElementById('g-err2').textContent = e.message; }
        };
    }
    const val = (id) => (document.getElementById(id) || {}).value || '';

    /* ---------- router ---------- */
    function parseHash() {
        const h = location.hash.slice(1) || '/';
        const [path, qs] = h.split('?');
        return { parts: path.split('/').filter(Boolean), q: new URLSearchParams(qs || '') };
    }
    async function route() {
        try {
            if (!S.session) await loadSession();
        } catch (e) { return errorView(e); }
        if (!S.session.unlocked) return gate();
        const { parts, q } = parseHash();
        try {
            await ensureLib();
            chrome(true);
            document.getElementById('top-q').value = parts[0] === 'search' ? (q.get('q') || '') : '';
            const id = Number(parts[1]);
            switch (parts[0]) {
                case undefined: return await home();
                case 'c': return await collection(parts[1], q);
                case 'search': return await search(q, false);
                case 'videos': q.set('video', '1'); return await search(q, true);
                case 'e':
                    if (parts[2] === 'edit') return await editor(id);
                    if (parts[2] === 'history') return await history(id);
                    return await entry(id);
                case 'v': return await version(id);
                case 'new': return await editor(null, q);
                case 'mine': return await mine();
                case 'people': return parts[1] ? await person(decodeURIComponent(parts[1])) : await people();
                case 'review': return await review();
                case 'admin': return await admin();
            }
            view(`<div class="card"><h2>Page not found</h2><a class="btn" href="#/">Back to the library</a></div>`);
        } catch (e) { errorView(e); }
    }
    window.addEventListener('hashchange', () => {
        if (leaveGuard && !confirmLeave()) return;
        route();
    });
    function confirmLeave() {
        // Uploads still running: stay on the editor (the browser's own prompt covers closing the tab).
        toast('Wait for the uploads to finish, or remove them, before leaving this page.', true);
        history.replaceState(null, '', leaveGuard);
        return false;
    }
    window.addEventListener('beforeunload', (e) => { if (leaveGuard) { e.preventDefault(); e.returnValue = ''; } });
    document.getElementById('top-search').onsubmit = (ev) => {
        ev.preventDefault();
        const v = document.getElementById('top-q').value.trim();
        location.hash = '#/search?q=' + encodeURIComponent(v);
    };

    /* ---------- home ---------- */
    async function home() {
        const L = await ensureLib(true);
        chrome(true); setTitle('');
        const t = L.totals;
        view(`
        <section class="hero">
            <h1>The LSH VA community library</h1>
            <p>Official SOPs, training videos, guides and hard-won know-how from across LSH, kept in one place and never lost.</p>
            <form id="hero-search" role="search"><label class="sr" for="hero-q">Search the library</label>
                <input id="hero-q" type="search" placeholder="Try “lien reduction”, “intake call”, “itemized bills”…" autocomplete="off"></form>
            <div class="stats"><span><b>${t.entries}</b>entries</span><span><b>${t.videos}</b>training videos</span><span><b>${t.files}</b>files</span><span><b>${t.people}</b>contributors</span></div>
        </section>
        ${L.mine.pending || L.mine.rejected ? `<p class="note" style="margin-top:16px">You have ${L.mine.pending ? plural(L.mine.pending, 'contribution') + ' waiting for review' : ''}${L.mine.pending && L.mine.rejected ? ' and ' : ''}${L.mine.rejected ? plural(L.mine.rejected, 'contribution') + ' sent back with a note' : ''}. <a href="#/mine">See my contributions</a></p>` : ''}
        ${L.queue && (L.queue.revisions || L.queue.comments) ? `<p class="note" style="margin-top:12px">${plural(L.queue.revisions, 'entry or edit', 'entries and edits')} and ${plural(L.queue.comments, 'reply', 'replies')} are waiting for review. <a href="#/review">Open the review queue</a></p>` : ''}
        ${!t.entries ? `<div class="card section"><h2>The library is empty</h2><p>Add the first SOP, video or guide.${S.session.admin ? ' If the old Knowledge Base had posts, import them from <a href="#/admin">Admin</a>.' : ''}</p><a class="btn accent" href="#/new">+ Add to the library</a></div>` : ''}
        <section class="section"><div class="spread"><h2>Collections</h2></div>
            <div class="cols">${L.collections.map(c => `<a class="col" href="#/c/${c.slug}"><h3>${esc(c.name)}</h3><p>${esc(c.blurb)}</p>
                <span class="meta">${plural(c.count, 'entry', 'entries')}${c.videos ? ' · ' + plural(c.videos, 'video') : ''}</span></a>`).join('')}</div></section>
        ${L.featured.length ? `<section class="section"><h2>Featured</h2>${listHTML(L.featured)}</section>` : ''}
        ${L.videos.length ? `<section class="section"><div class="spread"><h2>Latest training videos</h2><a href="#/videos">All videos</a></div>${listHTML(L.videos)}</section>` : ''}
        ${t.entries ? `<section class="section two"><div><h2>Recently added</h2>${listHTML(L.recent)}</div><div><h2>Most helpful</h2>${listHTML(L.popular)}</div></section>` : ''}`);
        document.getElementById('hero-search').onsubmit = (ev) => {
            ev.preventDefault();
            location.hash = '#/search?q=' + encodeURIComponent(document.getElementById('hero-q').value.trim());
        };
    }

    /* ---------- collection ---------- */
    async function collection(slug, q) {
        const c = S.lib.collections.find(x => x.slug === slug);
        if (!c) return view(`<div class="card"><h2>That collection doesn’t exist</h2><a class="btn" href="#/">Back to the library</a></div>`);
        setTitle(c.name);
        const params = new URLSearchParams({ collection: slug, all: '1', sort: 'section' });
        ['type', 'official', 'video'].forEach(k => { if (q.get(k)) params.set(k, q.get(k)); });
        const r = await api('/api/entries?' + params);
        const groups = new Map();
        r.entries.forEach(e => { const k = e.section || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
        const keys = [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, undefined, { numeric: true }));
        S.sections[slug] = keys.filter(Boolean);
        const anchor = (k) => 'sec-' + (k ? k.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'other');
        const chipHref = (k, v) => { const p = new URLSearchParams(q); if (p.get(k) === v) p.delete(k); else p.set(k, v); return `#/c/${slug}?${p}`; };
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><span>${esc(c.name)}</span></div>
            <div class="spread"><div><h1>${esc(c.name)}</h1><p class="muted" style="margin:0">${esc(c.blurb)}</p></div>
                <a class="btn accent" href="#/new?collection=${slug}">+ Add to ${esc(c.name)}</a></div>
            <div class="filters">
                <a class="chip" aria-pressed="${q.get('video') === '1'}" href="${chipHref('video', '1')}">Videos</a>
                <a class="chip" aria-pressed="${q.get('official') === '1'}" href="${chipHref('official', '1')}">Official only</a>
                <label class="sr" for="c-type">Type</label>
                <select class="i" id="c-type"><option value="">All types</option>${S.lib.types.map(t => `<option${q.get('type') === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
                <span class="muted">${plural(r.total, 'entry', 'entries')}</span>
            </div>
            <div class="layout">
                <nav class="toc" aria-label="Sections">${keys.length ? `<b>Sections</b>${keys.map(k => `<a href="#/c/${slug}" data-jump="${anchor(k)}">${esc(k || 'Other')}<span>${groups.get(k).length}</span></a>`).join('')}` : ''}</nav>
                <div>${keys.length ? keys.map(k => `<section class="group" id="${anchor(k)}"><h2>${esc(k || 'Other')} <span>${groups.get(k).length}</span></h2>${listHTML(groups.get(k), { showCollection: false })}</section>`).join('')
                    : `<div class="card"><p>Nothing here yet${q.toString().includes('=1') || q.get('type') ? ' with these filters' : ''}.</p><a class="btn accent" href="#/new?collection=${slug}">+ Add the first entry</a></div>`}
                ${r.total > r.entries.length ? `<p class="muted">Showing the first ${r.entries.length}. Use search to find the rest.</p>` : ''}</div>
            </div>`);
        document.getElementById('c-type').onchange = (ev) => { const p = new URLSearchParams(q); ev.target.value ? p.set('type', ev.target.value) : p.delete('type'); location.hash = `#/c/${slug}?${p}`; };
        app.querySelectorAll('[data-jump]').forEach(a => a.onclick = (ev) => { ev.preventDefault(); document.getElementById(a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }

    /* ---------- search & videos ---------- */
    async function search(q, videos) {
        const base = videos ? '#/videos' : '#/search';
        const params = new URLSearchParams();
        ['q', 'collection', 'type', 'official', 'video', 'tag', 'sort', 'page'].forEach(k => { if (q.get(k)) params.set(k, q.get(k)); });
        const r = await api('/api/entries?' + params);
        const title = videos ? 'Training videos' : q.get('q') ? `Results for “${q.get('q')}”` : q.get('tag') ? `Tagged “${q.get('tag')}”` : 'Everything in the library';
        setTitle(title);
        const link = (k, v) => { const p = new URLSearchParams(q); if (videos) p.delete('video'); p.delete('page'); if (v === null || p.get(k) === v) p.delete(k); else p.set(k, v); return `${base}?${p}`; };
        const pages = Math.ceil(r.total / r.pageSize);
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><span>${videos ? 'Videos' : 'Search'}</span></div>
            <h1>${esc(title)}</h1>
            <div class="filters">
                ${videos ? '' : `<a class="chip" aria-pressed="${q.get('video') === '1'}" href="${link('video', '1')}">Videos</a>`}
                <a class="chip" aria-pressed="${q.get('official') === '1'}" href="${link('official', '1')}">Official only</a>
                <label class="sr" for="s-col">Collection</label>
                <select class="i" id="s-col"><option value="">All collections</option>${S.lib.collections.map(c => `<option value="${c.slug}"${q.get('collection') === c.slug ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
                <label class="sr" for="s-type">Type</label>
                <select class="i" id="s-type"><option value="">All types</option>${S.lib.types.map(t => `<option${q.get('type') === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
                ${q.get('q') ? '' : `<label class="sr" for="s-sort">Sort</label><select class="i" id="s-sort">${[['', 'Newest first'], ['helpful', 'Most helpful'], ['views', 'Most viewed'], ['title', 'Title A–Z']].map(([v, l]) => `<option value="${v}"${(q.get('sort') || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`}
                <span class="muted">${plural(r.total, 'result')}</span>
            </div>
            ${r.entries.length ? listHTML(r.entries) : `<div class="card"><p>Nothing matches${q.get('q') ? ` “${esc(q.get('q'))}”` : ''}. Try fewer or different words${q.get('collection') || q.get('type') || q.get('official') ? ', or clear the filters' : ''}.</p>
                <p class="muted" style="margin:0">Know the answer? <a href="#/new">Add it to the library</a> so the next person finds it.</p></div>`}
            ${pages > 1 ? `<div class="pager">${r.page > 1 ? `<a class="btn small" href="${link('page', String(r.page - 1))}">← Previous</a>` : ''}<span class="muted">Page ${r.page} of ${pages}</span>${r.page < pages ? `<a class="btn small" href="${link('page', String(r.page + 1))}">Next →</a>` : ''}</div>` : ''}`);
        const sel = (id, k) => { const el = document.getElementById(id); if (el) el.onchange = () => { location.hash = link(k, el.value || null); }; };
        sel('s-col', 'collection'); sel('s-type', 'type'); sel('s-sort', 'sort');
    }

    /* ---------- entry ---------- */
    function mediaHTML(files) {
        if (!files.length) return '';
        const videos = files.filter(f => f.kind === 'video'), pdfs = files.filter(f => f.kind === 'pdf'), images = files.filter(f => f.kind === 'image');
        const rest = files.filter(f => !['video', 'pdf', 'image'].includes(f.kind));
        return `<div class="media">
            ${videos.map(f => `<figure class="player" style="margin:0"><video controls preload="metadata" playsinline src="${fileUrl(f)}"></video>
                <figcaption><span>${esc(f.name)} · ${fmtSize(f.size)}</span><a href="${fileUrl(f, true)}">Download</a></figcaption></figure>`).join('')}
            ${pdfs.map((f, i) => i === 0 ? `<div><iframe class="pdf" title="${esc(f.name)}" src="${fileUrl(f)}#view=FitH" loading="lazy"></iframe></div>` : '').join('')}
            ${images.map(f => `<figure class="shot" style="margin:0"><a href="${fileUrl(f)}" target="_blank" rel="noopener"><img src="${fileUrl(f)}" alt="${esc(f.name)}" loading="lazy"></a></figure>`).join('')}
            <div class="files">${[...pdfs, ...rest].map(f => `<div class="file"><span class="nm"><span aria-hidden="true">${FILE_ICON[f.kind] || '📎'}</span><span>${esc(f.name)}</span> <small>${fmtSize(f.size)}</small></span>
                <span class="row">${['pdf', 'image', 'audio'].includes(f.kind) || f.name.toLowerCase().endsWith('.txt') ? `<a class="btn small" href="${fileUrl(f)}" target="_blank" rel="noopener">Open</a>` : ''}<a class="btn small" href="${fileUrl(f, true)}">Download</a></span></div>`).join('')}</div>
        </div>`;
    }

    async function entry(id) {
        const r = await api(`/api/entries/${id}`);
        const e = r.entry, s = S.session, own = e.authorKey === s.who.key;
        setTitle(e.title);
        const staff = r.can.staff, adminUser = r.can.admin;
        let banner = '';
        if (e.status === 'pending') banner = `<p class="note">This entry is waiting for review. Until a reviewer approves it, only you and the reviewers can see it.</p>`;
        if (e.status === 'rejected') banner = `<p class="note bad"><b>Sent back:</b> ${esc(e.reviewNote)}${own ? ` <a href="#/e/${id}/edit">Edit and resend</a>` : ''}</p>`;
        if (e.status === 'archived') banner = `<p class="note">This entry is archived. It’s hidden from the library and search, and every version is kept.</p>`;
        if (e.status === 'withdrawn') banner = `<p class="note">You withdrew this entry.</p>`;
        if (e.myPendingEdit) banner += `<p class="note">Your suggested edit is waiting for review. <a href="#/v/${e.myPendingEdit}">See your changes</a></p>`;
        if (staff && e.pendingEdits) banner += `<p class="note">${plural(e.pendingEdits, 'suggested edit is', 'suggested edits are')} waiting for review. <a href="#/review">Open the review queue</a></p>`;
        const editLabel = staff || (own && !e.publishedAt) ? 'Edit' : 'Suggest an edit';
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><a href="#/c/${e.collection}">${esc(colName(e.collection))}</a>${e.section ? `<span>›</span><span>${esc(e.section)}</span>` : ''}</div>
            ${banner}
            <div class="entry-layout">
                <article>
                    <header class="entry-head">
                        <div class="row">${e.official ? '<span class="badge official">✓ Official</span>' : ''}${e.hasVideo ? '<span class="badge video">Video</span>' : ''}<span class="badge">${esc(e.type)}</span>${e.featured ? '<span class="badge">★ Featured</span>' : ''}${statusBadge(e.status)}</div>
                        <h1>${esc(e.title)}</h1>
                        ${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
                    </header>
                    ${mediaHTML(e.files)}
                    <div class="md">${window.KBmd.render(e.body)}</div>
                    ${e.tags.length ? `<div class="tags" style="margin-top:18px">${e.tags.map(t => `<a href="#/search?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
                    ${e.credits.length ? `<p class="muted">With help from ${e.credits.map(esc).join(', ')}.</p>` : ''}
                    ${e.status === 'published' ? `<div class="row" style="margin-top:18px"><button class="btn" id="helpful" aria-pressed="${r.voted}">👍 ${r.voted ? 'You found this helpful' : 'Helpful'} · <span id="helpful-n">${r.stats.helpful}</span></button><span class="muted">${plural(r.stats.views, 'view')}</span></div>` : ''}
                    <section class="section" id="replies"><h2>Experience from the team</h2>
                        <div class="replies">${r.comments.length ? r.comments.map(c => `<div class="reply"><div class="who"><b>${esc(c.author)}</b>${c.batch ? ' · ' + esc(c.batch) : ''} · ${fmtDate(c.createdAt)} ${c.status === 'pending' ? '<span class="badge pending">Waiting for review</span>' : c.status === 'rejected' ? '<span class="badge rejected">Not approved</span>' : ''}</div>
                            <div class="md">${window.KBmd.render(c.body)}</div>
                            ${staff && c.status === 'pending' ? `<div class="row" style="margin-top:6px"><button class="btn small primary" data-reply="${c.id}" data-d="approve">Approve</button><button class="btn small" data-reply="${c.id}" data-d="reject">Don’t publish</button></div>` : ''}
                            ${staff && c.status === 'approved' ? `<div class="row" style="margin-top:6px"><button class="btn small danger" data-reply="${c.id}" data-d="delete">Remove</button></div>` : ''}</div>`).join('') : '<p class="muted" style="margin:0">No replies yet. Used this? Add what worked for you.</p>'}</div>
                        ${e.status === 'published' ? `<form id="reply-form" class="editor" style="margin-top:12px"><label class="f">Add your experience<textarea class="i" id="reply-body" rows="3" required placeholder="What worked, what to watch out for, an example…"></textarea></label>
                            <div class="row"><button class="btn primary" type="submit">Send reply</button>${staff ? '' : '<span class="muted">Replies appear after a reviewer approves them.</span>'}</div></form>` : ''}
                    </section>
                </article>
                <aside class="side">
                    <div class="card"><dl>
                        <dt>Collection</dt><dd><a href="#/c/${e.collection}">${esc(colName(e.collection))}</a></dd>
                        ${e.section ? `<dt>Section</dt><dd>${esc(e.section)}</dd>` : ''}
                        <dt>Added by</dt><dd><a href="#/people/${encodeURIComponent(e.authorKey)}">${esc(e.author)}</a>${e.batch ? ` · ${esc(e.batch)}` : ''}</dd>
                        <dt>Added</dt><dd>${fmtDate(e.createdAt)}</dd>
                        <dt>Updated</dt><dd>${fmtDate(e.version.at)} by ${esc(e.version.by)}</dd>
                        <dt>Versions</dt><dd><a href="#/e/${id}/history">${plural(e.versions, 'version')}</a></dd>
                    </dl></div>
                    <div class="card row">
                        ${r.can.edit ? `<a class="btn primary" href="#/e/${id}/edit">${editLabel}</a>` : ''}
                        <a class="btn" href="#/e/${id}/history">History</a>
                        ${own && e.status === 'pending' && !e.publishedAt ? `<button class="btn danger" data-act="withdraw">Withdraw</button>` : ''}
                    </div>
                    ${staff ? `<div class="card"><h3>Reviewer tools</h3><div class="row">
                        ${e.status === 'published' ? `<button class="btn small" data-act="${e.featured ? 'unfeature' : 'feature'}">${e.featured ? 'Unfeature' : '★ Feature'}</button>` : ''}
                        ${adminUser && e.publishedAt ? `<button class="btn small" data-act="official" data-v="${e.official ? '0' : '1'}">${e.official ? 'Remove Official' : '✓ Mark Official'}</button>` : ''}
                        ${e.status === 'archived' ? `<button class="btn small" data-act="unarchive">Restore to the library</button>` : e.publishedAt ? `<button class="btn small" data-act="archive">Archive</button>` : ''}
                    </div>
                    ${adminUser ? `<details style="margin-top:12px"><summary class="muted">Delete permanently</summary>
                        <p class="muted" style="font-size:13px">Removes the entry, every version and its files for good. Archive instead if you might need it again.</p>
                        <div class="row"><input class="i" id="purge-confirm" placeholder="Type DELETE" style="max-width:140px"><button class="btn small danger" data-act="purge">Delete</button></div></details>` : ''}</div>` : ''}
                </aside>
            </div>`);
        const hb = document.getElementById('helpful');
        if (hb) hb.onclick = async () => {
            try { const v = await post(`/api/entries/${id}`, { action: 'helpful' }); hb.setAttribute('aria-pressed', v.voted); hb.innerHTML = `👍 ${v.voted ? 'You found this helpful' : 'Helpful'} · <span id="helpful-n">${v.helpful}</span>`; }
            catch (e) { toast(e.message, true); }
        };
        const rf = document.getElementById('reply-form');
        if (rf) rf.onsubmit = async (ev) => {
            ev.preventDefault();
            try { const v = await post('/api/comments', { action: 'submit', entryId: id, body: val('reply-body') }); toast(v.status === 'approved' ? 'Reply published.' : 'Thanks. Your reply will appear after review.'); entry(id); }
            catch (e) { toast(e.message, true); }
        };
        app.querySelectorAll('[data-reply]').forEach(b => b.onclick = async () => {
            try { await post('/api/comments', { action: 'review', id: Number(b.dataset.reply), decision: b.dataset.d }); entry(id); } catch (e) { toast(e.message, true); }
        });
        app.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
            const act = b.dataset.act;
            const body = { action: act };
            if (act === 'official') body.official = b.dataset.v === '1';
            if (act === 'purge') body.confirm = val('purge-confirm').trim();
            try {
                await post(`/api/entries/${id}`, body);
                const msg = { feature: 'Featured on the library home.', unfeature: 'No longer featured.', archive: 'Archived. Every version is kept.', unarchive: 'Back in the library.',
                    official: 'Updated.', withdraw: 'Withdrawn.', purge: 'Deleted permanently.' }[act];
                toast(msg); S.lib = null;
                if (act === 'purge' || act === 'withdraw') location.hash = '#/mine'; else entry(id);
            } catch (e) { toast(e.message, true); }
        });
    }

    /* ---------- editor ---------- */
    async function sectionsFor(slug) {
        if (!S.sections[slug]) {
            const r = await api(`/api/entries?collection=${encodeURIComponent(slug)}&all=1&sort=section`);
            S.sections[slug] = [...new Set(r.entries.map(e => e.section).filter(Boolean))].sort();
        }
        return S.sections[slug];
    }

    async function editor(id, q) {
        const s = S.session, staff = s.admin || s.reviewer;
        let e = null;
        if (id) e = (await api(`/api/entries/${id}`)).entry;
        const own = e && e.authorKey === s.who.key;
        const suggesting = e && !staff && !(own && !e.publishedAt);
        setTitle(e ? (suggesting ? 'Suggest an edit' : 'Edit') + ': ' + e.title : 'Add to the library');
        const d = e || { collection: (q && q.get('collection')) || '', section: '', type: '', title: '', summary: '', body: '', tags: [], credits: [], files: [], official: false };
        const files = d.files.map(f => ({ ...f, state: 'ready' }));
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span>${e ? `<a href="#/e/${id}">${esc(e.title)}</a><span>›</span><span>${suggesting ? 'Suggest an edit' : 'Edit'}</span>` : '<span>Add to the library</span>'}</div>
            <h1>${e ? (suggesting ? 'Suggest an edit' : 'Edit this entry') : 'Add to the library'}</h1>
            <p class="muted" style="margin-top:0">${staff ? 'Your changes go live as soon as you save. The previous version stays in the history.'
                : suggesting ? 'Your changes are saved as a suggestion. A reviewer checks it, and the current version stays up until they approve it.'
                : 'A reviewer checks new entries before they appear in the library. You’ll see the status under My contributions.'}</p>
            <form class="editor card" id="ed" novalidate>
                <div class="grid2">
                    <label class="f">Collection<select class="i" id="ed-col" required><option value="">Choose…</option>${S.lib.collections.map(c => `<option value="${c.slug}"${d.collection === c.slug ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
                    <label class="f">Section <small>(optional, e.g. “Day 17 · Lien Negotiator Training”)</small><input class="i" id="ed-sec" list="ed-secs" value="${esc(d.section)}" maxlength="120"><datalist id="ed-secs"></datalist></label>
                    <label class="f">Type<select class="i" id="ed-type" required><option value="">Choose…</option>${S.lib.types.map(t => `<option${d.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
                    <label class="f">Tags <small>(comma-separated)</small><input class="i" id="ed-tags" value="${esc(d.tags.join(', '))}" placeholder="medicare, reduction letter"></label>
                </div>
                <label class="f">Title<input class="i" id="ed-title" value="${esc(d.title)}" maxlength="200" required placeholder="Say what someone will be able to do"></label>
                <label class="f">Summary <small>(one or two sentences shown in lists and search)</small><input class="i" id="ed-sum" value="${esc(d.summary)}" maxlength="500"></label>
                <div class="f" style="display:grid;gap:5px">
                    <span style="font-size:13px;font-weight:600;color:var(--navy)">Files and videos <small style="font-weight:400;color:var(--muted)">(PDF, Word, Excel, PowerPoint, images, videos; up to 5 GB each)</small></span>
                    <div class="drop" id="drop" tabindex="0" role="button" aria-label="Add files">Drop files here, or <u>choose files</u><input type="file" id="ed-file" multiple hidden></div>
                    <div class="up" id="up"></div>
                </div>
                <div>
                    <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-t="write">Write</button><button type="button" role="tab" aria-selected="false" data-t="preview">Preview</button></div>
                    <label class="sr" for="ed-body">Content</label>
                    <textarea class="i" id="ed-body" rows="16" placeholder="Steps, examples and the pitfalls you ran into. Formatting: # heading, **bold**, - list, - [ ] checklist, | table |">${esc(d.body)}</textarea>
                    <div class="preview md" id="ed-prev" hidden></div>
                </div>
                <label class="f">Credits <small>(teammates who helped, comma-separated)</small><input class="i" id="ed-cred" value="${esc(d.credits.join(', '))}"></label>
                ${s.admin ? `<label class="check"><input type="checkbox" id="ed-off"${d.official ? ' checked' : ''}> Official: an approved LSH SOP or resource</label>` : ''}
                ${e ? `<label class="f">What did you change? <small>(shown in the history)</small><input class="i" id="ed-note" maxlength="300" placeholder="e.g. Updated the Medicare step for 2026 forms"></label>` : ''}
                <p class="muted" id="ed-err" role="alert" style="margin:0"></p>
                <div class="row"><button class="btn primary" type="submit" id="ed-save">${staff ? (e ? 'Save changes' : 'Publish') : e ? (suggesting ? 'Send suggestion' : 'Resend for review') : 'Send for review'}</button>
                    <a class="btn" href="${e ? '#/e/' + id : '#/'}">Cancel</a></div>
            </form>`);

        const up = document.getElementById('up'), save = document.getElementById('ed-save');
        const here = location.hash;
        function paint() {
            up.innerHTML = files.map((f, i) => `<div class="file"><span class="nm"><span aria-hidden="true">${FILE_ICON[f.kind] || '📎'}</span><span>${esc(f.name)}</span><small>${fmtSize(f.size)}</small></span>
                <span class="row">${f.state === 'uploading' ? `<span class="bar" aria-label="Uploading"><i style="width:${Math.round((f.progress || 0) * 100)}%"></i></span><small>${Math.round((f.progress || 0) * 100)}%</small>`
                    : f.state === 'error' ? `<small style="color:var(--bad)">${esc(f.error)}</small>` : '<small>Ready</small>'}
                <button type="button" class="btn small" data-rm="${i}">${f.state === 'uploading' ? 'Cancel' : 'Remove'}</button></span></div>`).join('');
            up.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
                const f = files[Number(b.dataset.rm)];
                if (f.ctl) f.ctl.abort();
                files.splice(Number(b.dataset.rm), 1); paint();
            });
            const busy = files.some(f => f.state === 'uploading');
            save.disabled = busy;
            leaveGuard = busy ? here : null;
        }
        paint();
        async function add(list) {
            for (const file of list) {
                const kind = guessKind(file.name);
                const f = { name: file.name, size: file.size, kind, state: 'uploading', progress: 0, ctl: new AbortController() };
                files.push(f); paint();
                window.KBUpload.upload(file, { signal: f.ctl.signal, onProgress: (p) => { f.progress = p; paint(); } })
                    .then(meta => { Object.assign(f, meta, { state: 'ready' }); delete f.ctl; paint(); })
                    .catch(err => { if (files.includes(f)) { f.state = 'error'; f.error = err.message; paint(); } });
            }
        }
        const drop = document.getElementById('drop'), input = document.getElementById('ed-file');
        drop.onclick = () => input.click();
        drop.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); } };
        input.onchange = () => { add([...input.files]); input.value = ''; };
        drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add('over'); };
        drop.ondragleave = () => drop.classList.remove('over');
        drop.ondrop = (ev) => { ev.preventDefault(); drop.classList.remove('over'); add([...ev.dataTransfer.files]); };

        const colSel = document.getElementById('ed-col');
        const fillSections = async () => {
            const dl = document.getElementById('ed-secs');
            dl.innerHTML = colSel.value ? (await sectionsFor(colSel.value).catch(() => [])).map(x => `<option value="${esc(x)}">`).join('') : '';
        };
        colSel.onchange = fillSections; fillSections();

        app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
            app.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
            const prev = b.dataset.t === 'preview';
            document.getElementById('ed-body').hidden = prev;
            const pv = document.getElementById('ed-prev');
            pv.hidden = !prev;
            if (prev) pv.innerHTML = window.KBmd.render(val('ed-body')) || '<p class="muted">Nothing to preview yet.</p>';
        });

        document.getElementById('ed').onsubmit = async (ev) => {
            ev.preventDefault();
            const err = document.getElementById('ed-err');
            if (files.some(f => f.state === 'error')) { err.textContent = 'Remove the files that failed to upload, or add them again.'; return; }
            const body = { collection: colSel.value, section: val('ed-sec'), type: val('ed-type'), title: val('ed-title'), summary: val('ed-sum'),
                body: val('ed-body'), tags: val('ed-tags'), credits: val('ed-cred'), files: files.filter(f => f.state === 'ready').map(f => f.id),
                official: !!(document.getElementById('ed-off') || {}).checked, note: val('ed-note') };
            save.disabled = true;
            try {
                const r = e ? await post(`/api/entries/${id}`, { action: 'edit', ...body }) : await post('/api/entries', body);
                leaveGuard = null; S.lib = null; delete S.sections[body.collection];
                toast(r.status === 'pending' ? 'Sent for review. Thanks for adding to the library.' : 'Saved.');
                location.hash = `#/e/${e ? id : r.id}`;
            } catch (x) { err.textContent = x.message; save.disabled = false; }
        };
    }
    function guessKind(name) {
        const e = (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
        const map = { video: 'mp4 m4v mov webm mkv avi wmv', audio: 'mp3 m4a wav ogg aac', pdf: 'pdf', image: 'png jpg jpeg gif webp heic', doc: 'doc docx odt rtf txt md', sheet: 'xls xlsx csv ods', slides: 'ppt pptx odp key', archive: 'zip' };
        return Object.keys(map).find(k => map[k].split(' ').includes(e)) || 'other';
    }

    /* ---------- history & versions ---------- */
    const REV_LABEL = { live: ['Current', 'official'], superseded: ['Earlier', ''], pending: ['Waiting for review', 'pending'], rejected: ['Sent back', 'rejected'], withdrawn: ['Withdrawn', 'archived'] };
    async function history(id) {
        const r = await api(`/api/entries/${id}/history`);
        setTitle('History: ' + r.entry.title);
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><a href="#/e/${id}">${esc(r.entry.title)}</a><span>›</span><span>History</span></div>
            <h1>Every version</h1>
            <p class="muted" style="margin-top:0">Nothing is overwritten. Each save adds a version, and ${S.session.admin || S.session.reviewer ? 'you can restore any earlier one.' : 'reviewers can restore any earlier one.'}</p>
            <div class="versions">${r.versions.map(v => { const [l, c] = REV_LABEL[v.status] || [v.status, '']; return `<div class="version">
                <span><span class="badge ${c}">${l}</span> <b>${esc(v.author)}</b>${v.batch ? ' · ' + esc(v.batch) : ''} · ${fmtWhen(v.createdAt)}${v.note ? `<br><span class="muted">${esc(v.note)}</span>` : ''}${v.reviewNote ? `<br><span class="muted">Reviewer: ${esc(v.reviewNote)}</span>` : ''}</span>
                <a class="btn small" href="#/v/${v.id}">View${v.status === 'live' ? '' : ' and compare'}</a></div>`; }).join('')}</div>`);
    }

    function diffLines(a, b) {
        const A = String(a || '').split('\n'), B = String(b || '').split('\n');
        if (A.length * B.length > 4e6) return [...A.map(s => ({ t: 'del', s })), ...B.map(s => ({ t: 'add', s }))];
        const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        const out = []; let i = 0, j = 0;
        while (i < n && j < m) {
            if (A[i] === B[j]) { out.push({ t: 'same', s: A[i] }); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: 'del', s: A[i++] });
            else out.push({ t: 'add', s: B[j++] });
        }
        while (i < n) out.push({ t: 'del', s: A[i++] });
        while (j < m) out.push({ t: 'add', s: B[j++] });
        return out;
    }
    function changesHTML(from, to) {
        if (!from) return '<p class="muted">This is the first version.</p>';
        const rows = [];
        const field = (label, a, b) => { if ((a || '') !== (b || '')) rows.push(`<div><b>${label}:</b> <span style="text-decoration:line-through;color:var(--muted)">${esc(a || '(empty)')}</span> → ${esc(b || '(empty)')}</div>`); };
        field('Title', from.title, to.title); field('Summary', from.summary, to.summary); field('Collection', colName(from.collection), colName(to.collection));
        field('Section', from.section, to.section); field('Type', from.type, to.type); field('Tags', (from.tags || []).join(', '), (to.tags || []).join(', '));
        if (!!from.official !== !!to.official) rows.push(`<div><b>Official:</b> ${to.official ? 'marked official' : 'no longer official'}</div>`);
        const fa = new Set((from.files || []).map(f => f.id)), fb = new Set((to.files || []).map(f => f.id));
        (to.files || []).filter(f => !fa.has(f.id)).forEach(f => rows.push(`<div><b>File added:</b> ${esc(f.name)}</div>`));
        (from.files || []).filter(f => !fb.has(f.id)).forEach(f => rows.push(`<div><b>File removed:</b> ${esc(f.name)}</div>`));
        const bodyChanged = (from.body || '') !== (to.body || '');
        return `<div class="changes">${rows.join('') || (bodyChanged ? '' : '<div class="muted">No changes to the details.</div>')}</div>
            ${bodyChanged ? `<h3>Content</h3><div class="diff">${diffLines(from.body, to.body).map(l => `<div class="${l.t === 'same' ? '' : l.t}">${l.t === 'add' ? '+ ' : l.t === 'del' ? '− ' : '  '}${esc(l.s) || '&nbsp;'}</div>`).join('')}</div>` : ''}`;
    }

    async function version(revId) {
        const r = await api(`/api/revisions/${revId}`);
        const v = r.version, live = r.live, staff = S.session.admin || S.session.reviewer;
        const e = r.entry;
        setTitle('Version: ' + v.data.title);
        const [l, c] = REV_LABEL[v.status] || [v.status, ''];
        const compareTo = v.status === 'live' ? null : live && live.id !== v.id ? live : null;
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><a href="#/e/${v.entryId}">${esc(e ? e.title : v.data.title)}</a><span>›</span><a href="#/e/${v.entryId}/history">History</a><span>›</span><span>Version</span></div>
            <div class="spread"><div><span class="badge ${c}">${l}</span><h1 style="margin-top:6px">${esc(v.data.title)}</h1>
                <p class="muted" style="margin:0">${esc(v.author)} · ${fmtWhen(v.createdAt)}${v.note ? ' · ' + esc(v.note) : ''}</p></div>
                <div class="row" id="v-actions">
                    ${staff && v.status === 'pending' ? `<input class="i" id="v-note" placeholder="Note to the author (needed to send back)" style="min-width:260px"><button class="btn primary" data-d="approve">Approve</button><button class="btn" data-d="reject">Send back</button>` : ''}
                    ${staff && ['superseded', 'rejected', 'withdrawn'].includes(v.status) ? `<button class="btn primary" id="v-restore">Restore this version</button>` : ''}
                </div></div>
            <section class="section card"><h2>${compareTo ? 'Changes compared with the current version' : v.status === 'pending' && !live ? 'New entry' : 'Details'}</h2>
                ${compareTo ? changesHTML(compareTo.data, v.data) : `<div class="changes"><div><b>Collection:</b> ${esc(colName(v.data.collection))}${v.data.section ? ' › ' + esc(v.data.section) : ''}</div><div><b>Type:</b> ${esc(v.data.type)}</div>${v.data.tags.length ? `<div><b>Tags:</b> ${esc(v.data.tags.join(', '))}</div>` : ''}</div>`}</section>
            <section class="section"><h2>This version</h2>${v.data.summary ? `<p class="lead">${esc(v.data.summary)}</p>` : ''}${mediaHTML(v.data.files || [])}<div class="md">${window.KBmd.render(v.data.body)}</div></section>`);
        app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
            try {
                await post(`/api/revisions/${revId}`, { decision: b.dataset.d, note: val('v-note') });
                toast(b.dataset.d === 'approve' ? 'Approved. It’s live now.' : 'Sent back to the author with your note.');
                S.lib = null; location.hash = '#/review';
            } catch (e) { toast(e.message, true); }
        });
        const rb = document.getElementById('v-restore');
        if (rb) rb.onclick = async () => {
            try { await post(`/api/entries/${v.entryId}`, { action: 'restore', revision: revId }); toast('Restored. The version it replaced stays in the history.'); location.hash = `#/e/${v.entryId}`; }
            catch (e) { toast(e.message, true); }
        };
    }

    /* ---------- my contributions, people ---------- */
    async function mine() {
        setTitle('My contributions');
        const r = await api('/api/entries?status=mine&all=1');
        const by = (st) => r.entries.filter(e => st.includes(e.status));
        const sec = (title, items, note) => items.length ? `<section class="section"><h2>${title}</h2>${note ? `<p class="muted" style="margin-top:-6px">${note}</p>` : ''}${listHTML(items, { showStatus: true })}</section>` : '';
        view(`<h1>My contributions</h1><p class="muted" style="margin-top:0">Signed in as <b>${esc(S.session.who.name)}</b>${S.session.who.batch ? ' · ' + esc(S.session.who.batch) : ''}. Suggested edits to other entries show in each entry’s history.</p>
            ${!r.entries.length ? `<div class="card"><p>You haven’t added anything yet.</p><a class="btn accent" href="#/new">+ Add to the library</a></div>` : ''}
            ${sec('Sent back to you', by(['rejected']), 'A reviewer left a note. Open the entry, make the changes and resend it.')}
            ${sec('Waiting for review', by(['pending']))}
            ${sec('In the library', by(['published']))}
            ${sec('Archived or withdrawn', by(['archived', 'withdrawn']))}`);
    }

    async function people() {
        setTitle('Contributors');
        const r = await api('/api/people');
        view(`<h1>Contributors</h1><p class="muted" style="margin-top:0">Everyone who has added to the library.</p>
            ${r.people.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Batch</th><th>Entries</th><th>👍 Helpful</th><th>Latest</th></tr></thead><tbody>
            ${r.people.map(p => `<tr><td><a href="#/people/${encodeURIComponent(p.key)}">${esc(p.name)}</a> ${p.reviewer ? '<span class="badge">Reviewer</span>' : ''}${p.staff ? '<span class="badge">Admin</span>' : ''}</td>
                <td>${esc(p.batch || '')}</td><td>${p.entries}</td><td>${p.helpful || 0}</td><td>${fmtDate(p.last)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card"><p>No one yet. Be the first.</p></div>'}`);
    }
    async function person(key) {
        const r = await api('/api/entries?author=' + encodeURIComponent(key) + '&all=1');
        const name = r.entries[0] ? r.entries[0].author : key.split('|')[0];
        setTitle(name);
        view(`<div class="crumbs"><a href="#/people">Contributors</a><span>›</span><span>${esc(name)}</span></div><h1>${esc(name)}</h1>
            <p class="muted" style="margin-top:0">${plural(r.total, 'entry', 'entries')} in the library</p>${listHTML(r.entries) || '<div class="card"><p>Nothing published yet.</p></div>'}`);
    }

    /* ---------- review ---------- */
    async function review() {
        setTitle('Review');
        const r = await api('/api/review');
        const newOnes = r.revisions.filter(v => v.isNew), edits = r.revisions.filter(v => !v.isNew);
        const card = (v) => `<div class="card"><div class="spread"><div>
                <div class="row">${v.isNew ? '<span class="badge pending">New entry</span>' : '<span class="badge">Suggested edit</span>'}${v.data.official ? '<span class="badge official">Official</span>' : ''}${(v.data.files || []).some(f => f.kind === 'video') ? '<span class="badge video">Video</span>' : ''}</div>
                <h3 style="margin-top:6px"><a href="#/v/${v.id}">${esc(v.data.title)}</a></h3>
                <p class="muted" style="margin:0">${esc(v.author)}${v.batch ? ' · ' + esc(v.batch) : ''} · ${fmtWhen(v.createdAt)} · ${esc(colName(v.data.collection))}${v.data.section ? ' › ' + esc(v.data.section) : ''} · ${esc(v.data.type)}${(v.data.files || []).length ? ' · ' + plural(v.data.files.length, 'file') : ''}</p>
                ${v.note ? `<p style="margin:6px 0 0">“${esc(v.note)}”</p>` : ''}</div>
                <a class="btn" href="#/v/${v.id}">${v.isNew ? 'Open' : 'Compare'}</a></div>
            <div class="row" style="margin-top:10px"><input class="i" data-note="${v.id}" placeholder="Note to the author (needed to send back)" style="flex:1;min-width:220px">
                <button class="btn primary" data-rev="${v.id}" data-d="approve">Approve</button><button class="btn" data-rev="${v.id}" data-d="reject">Send back</button></div></div>`;
        view(`<h1>Review queue</h1><p class="muted" style="margin-top:0">New entries, suggested edits and replies from the community. Approving makes them live; the history keeps every version.</p>
            ${!r.revisions.length && !r.comments.length ? '<div class="card"><p>Nothing is waiting. 🎉</p></div>' : ''}
            ${newOnes.length ? `<section class="section"><h2>New entries (${newOnes.length})</h2><div class="queue">${newOnes.map(card).join('')}</div></section>` : ''}
            ${edits.length ? `<section class="section"><h2>Suggested edits (${edits.length})</h2><div class="queue">${edits.map(card).join('')}</div></section>` : ''}
            ${r.comments.length ? `<section class="section"><h2>Replies (${r.comments.length})</h2><div class="queue">${r.comments.map(c => `<div class="card">
                <p class="muted" style="margin:0 0 6px">${esc(c.author)}${c.batch ? ' · ' + esc(c.batch) : ''} on <a href="#/e/${c.entryId}">${esc(c.entryTitle)}</a> · ${fmtWhen(c.createdAt)}</p>
                <div class="md">${window.KBmd.render(c.body)}</div>
                <div class="row" style="margin-top:8px"><button class="btn small primary" data-cm="${c.id}" data-d="approve">Approve</button><button class="btn small" data-cm="${c.id}" data-d="reject">Don’t publish</button></div></div>`).join('')}</div></section>` : ''}`);
        app.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
            const note = (app.querySelector(`[data-note="${b.dataset.rev}"]`) || {}).value || '';
            try { await post(`/api/revisions/${b.dataset.rev}`, { decision: b.dataset.d, note }); toast(b.dataset.d === 'approve' ? 'Approved.' : 'Sent back with your note.'); S.lib = null; review(); }
            catch (e) { toast(e.message, true); }
        });
        app.querySelectorAll('[data-cm]').forEach(b => b.onclick = async () => {
            try { await post('/api/comments', { action: 'review', id: Number(b.dataset.cm), decision: b.dataset.d }); S.lib = null; review(); } catch (e) { toast(e.message, true); }
        });
    }

    /* ---------- admin ---------- */
    async function admin() {
        if (!S.session.admin) return view('<div class="card"><p>Admins only.</p></div>');
        setTitle('Admin');
        const r = await api('/api/admin');
        view(`<h1>Admin</h1>
            <section class="section card"><h2>Team access code</h2>
                <p>${r.codeSet ? `VAs open the library with the team access code. Last changed ${fmtWhen(r.codeChangedAt) || 'earlier'}. Changing it signs every VA out until they enter the new code.` : '<b>No code is set, so VAs can’t get in yet.</b> Set one and share it with the community.'}</p>
                <form class="row" id="code-form"><label class="sr" for="code">New code</label><input class="i" id="code" type="text" minlength="6" maxlength="64" placeholder="At least 6 characters" style="max-width:280px" autocomplete="off">
                    <button class="btn primary" type="submit">${r.codeSet ? 'Change the code' : 'Set the code'}</button></form>
                <p class="muted" style="font-size:13px">This is the same code as the Knowledge Base in the LSH Training Portal.</p></section>
            <section class="section card"><h2>Reviewers</h2>
                <p class="muted" style="margin-top:0">Trusted VAs who can approve entries, edits and replies, archive and restore. Only admins can mark entries official, delete permanently or change settings.</p>
                ${r.roles.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Batch</th><th>Added</th><th></th></tr></thead><tbody>${r.roles.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.batch)}</td><td>${fmtDate(x.grantedAt)} by ${esc(x.grantedBy || '')}</td><td><button class="btn small danger" data-revoke="${esc(x.key)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p>No reviewers yet.</p>'}
                <form class="row" id="rev-form" style="margin-top:10px"><input class="i" id="rev-name" placeholder="Full name, as they sign in" style="max-width:260px"><input class="i" id="rev-batch" placeholder="Batch, as they sign in" style="max-width:180px"><button class="btn" type="submit">Add reviewer</button></form></section>
            <section class="section card"><h2>Collections</h2>
                <p class="muted" style="margin-top:0">The library’s shelves. Lower numbers show first. Archiving a collection hides it from the home page; its entries stay.</p>
                <div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Description</th><th>Order</th><th>Entries</th><th>Archived</th><th></th></tr></thead><tbody>
                ${r.collections.map(c => `<tr data-col="${c.slug}"><td><input class="i" data-k="name" value="${esc(c.name)}"></td><td><input class="i" data-k="blurb" value="${esc(c.blurb)}"></td>
                    <td><input class="i" data-k="sort" type="number" value="${c.sort}" style="width:80px"></td><td>${c.count}</td><td><input type="checkbox" data-k="archived"${c.archived ? ' checked' : ''} aria-label="Archived"></td>
                    <td><button class="btn small" data-save="${c.slug}">Save</button></td></tr>`).join('')}
                <tr data-col=""><td><input class="i" data-k="name" placeholder="New collection"></td><td><input class="i" data-k="blurb" placeholder="What goes in it"></td><td><input class="i" data-k="sort" type="number" value="${(r.collections.length + 1) * 10}" style="width:80px"></td><td></td><td></td><td><button class="btn small primary" data-save="">Add</button></td></tr>
                </tbody></table></div></section>
            <section class="section card"><h2>Import from the old Knowledge Base</h2>
                <p>${r.legacy.total ? `The Training Portal’s Knowledge Base has ${plural(r.legacy.total, 'post')}; ${r.legacy.imported} ${r.legacy.imported === 1 ? 'is' : 'are'} already here. Importing copies each post with its replies, votes and views. It’s safe to run again.` : 'The old Knowledge Base has no posts to import.'}</p>
                ${r.legacy.total ? `<button class="btn primary" id="import">Import posts</button> <span class="muted" id="import-status"></span>` : ''}</section>
            <section class="section card"><h2>Storage and backup</h2>
                <p>${plural(r.storage.files, 'file')} stored, ${fmtSize(r.storage.bytes)} in all. Files are kept in the <code>lshtraining</code> R2 bucket under <code>kb/files/</code>.</p>
                <a class="btn" href="/api/admin/export">Download a backup of every entry and version (JSON)</a></section>`);
        document.getElementById('code-form').onsubmit = async (ev) => {
            ev.preventDefault();
            try { await post('/api/admin', { action: 'set-code', code: val('code') }); toast('Team access code saved.'); admin(); } catch (e) { toast(e.message, true); }
        };
        document.getElementById('rev-form').onsubmit = async (ev) => {
            ev.preventDefault();
            try { await post('/api/admin', { action: 'grant-reviewer', name: val('rev-name'), batch: val('rev-batch') }); toast('Reviewer added.'); admin(); } catch (e) { toast(e.message, true); }
        };
        app.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
            try { await post('/api/admin', { action: 'revoke-reviewer', key: b.dataset.revoke }); admin(); } catch (e) { toast(e.message, true); }
        });
        app.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
            const tr = b.closest('tr'), get = (k) => tr.querySelector(`[data-k="${k}"]`);
            try {
                await post('/api/admin', { action: 'save-collection', slug: tr.dataset.col, name: get('name').value, blurb: get('blurb').value, sort: get('sort').value, archived: get('archived') ? get('archived').checked : false });
                toast('Collection saved.'); S.lib = null; admin();
            } catch (e) { toast(e.message, true); }
        });
        const imp = document.getElementById('import');
        if (imp) imp.onclick = async () => {
            imp.disabled = true;
            const st = document.getElementById('import-status');
            let total = 0;
            try {
                for (;;) {
                    const x = await post('/api/admin', { action: 'import-legacy' });
                    total += x.imported; st.textContent = `Imported ${total}${x.remaining ? `, ${x.remaining} to go…` : '. Done.'}`;
                    if (!x.remaining || !x.imported) break;
                }
                S.lib = null;
            } catch (e) { st.textContent = e.message; }
            imp.disabled = false;
        };
    }


    route();
})();
