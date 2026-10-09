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
    const mineToo = (x) => !S.session.admin && x.authorKey === S.session.who.key;   // your own change: someone else has to approve it
    const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
    const TYPE_ICON = { 'Training video': '▶', 'SOP': '📘', 'Guide': '🧭', 'Checklist': '☑️', 'Template': '🧩', 'Reference': '📚', 'Tip': '💡', 'Lesson learned': '🎓', 'Question': '❓' };
    const FILE_ICON = { video: '🎬', audio: '🎧', pdf: '📄', image: '🖼️', doc: '📝', sheet: '📊', slides: '📽️', archive: '🗜️', other: '📎' };
    const fileUrl = (f) => `/files/${f.id}/${encodeURIComponent(f.name)}`;   // shown in the page; the library has no downloads
    const colName = (slug) => ((S.lib && S.lib.collections.find(c => c.slug === slug)) || {}).name || slug;
    const setTitle = (t) => { document.title = t ? `${t} · LSH Knowledge Base` : 'LSH Knowledge Base'; };
    const view = (html) => { app.innerHTML = html; window.scrollTo(0, 0); };
    const errorView = (e) => view(`<div class="card"><h2>That didn’t load</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to the library</a></div>`);

    let libAt = 0;   // when the library last came back, so one visit doesn't read it twice
    async function ensureLib(force) {
        if (!S.lib || (force && Date.now() - libAt > 1500)) { S.lib = await api('/api/library'); libAt = Date.now(); }
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
                ${e.official ? '<span class="badge official">✓ Official</span>' : ''}${e.hasVideo ? '<span class="badge video">Video</span>' : ''}${(e.tags || []).includes('from-tettra') ? '<span class="badge">From our Tettra</span>' : ''}
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
    // "Switch view": an admin can see the Knowledge Base exactly as a trainee (Info Access) sees it.
    // The real session stays in S.real; the pages read S.session, which is the masked copy while the switch is on.
    const maskedSession = () => ({ ...S.real, admin: false, reviewer: false, contributor: false, tier: 'info' });
    async function loadSession() {
        S.real = await api('/api/session');
        try { S.vaView = !!S.real.admin && sessionStorage.getItem('kb-va-view') === '1'; } catch (e) { S.vaView = false; }
        S.session = S.vaView ? maskedSession() : S.real;
    }

    function chrome(on) {
        const nav = document.getElementById('top-nav');
        nav.hidden = !on;
        if (!on) return;
        const s = S.session, real = S.real || s, q = S.lib && S.lib.queue;
        const waiting = q ? q.revisions + q.comments + (q.terms || 0) : 0;
        const here = location.hash.split('?')[0];
        const link = (href, label, extra = '') => `<a href="${href}"${here === href || (href !== '#/' && here.startsWith(href)) ? ' class="on"' : ''}${extra}>${label}</a>`;
        // Home: back to the LSH Training Portal's main screen (same address as the other LSH sites).
        const portalHome = ((s && s.portalUrl) || 'https://cm-training-activity.pages.dev').replace(/\/+$/, '') + '/index.html?stay=1';
        nav.innerHTML = [
            `<a href="${esc(portalHome)}" title="Back to the LSH Training Portal's main screen">🏠 Home</a>`,
            link('#/', 'Library'), link('#/featured', 'Featured'), link('#/glossary', 'Glossary'), link('#/videos', 'Videos'), link('#/people', 'Contributors'), link('#/mine', 'My contributions'),
            (s.admin || s.reviewer) ? link('#/review', `Review${waiting ? `<span class="count">${waiting}</span>` : ''}`) : '',
            s.admin ? link('#/admin', 'Admin') : '',
            s.contributor ? `<a class="cta" href="#/new">+ Add to the library</a>` : '',
            real.admin ? `<button type="button" id="switch-view" aria-pressed="${!!S.vaView}" title="${S.vaView ? 'Back to the admin view' : 'See the Knowledge Base as a trainee sees it'}">${S.vaView ? 'Admin view' : 'Switch view'}</button>` : '',
            `<button type="button" id="signout" title="Signed in as ${esc(s.who.name)}${s.who.batch ? ' (' + esc(s.who.batch) + ')' : ''}">Sign out</button>`
        ].join('');
        if (window.LSHBlueprint) LSHBlueprint.refresh();   // 🧭 Blueprint, before Sign out
        const sw = document.getElementById('switch-view');
        if (sw) sw.onclick = () => {
            S.vaView = !S.vaView;
            try { S.vaView ? sessionStorage.setItem('kb-va-view', '1') : sessionStorage.removeItem('kb-va-view'); } catch (e) { /* private window */ }
            S.session = S.vaView ? maskedSession() : S.real;
            route();
        };
        document.getElementById('signout').onclick = async () => {
            await post('/api/session', { action: real.admin ? 'admin-logout' : 'signout' }).catch(() => {});
            try { sessionStorage.removeItem('kb-va-view'); } catch (e) { /* private window */ }
            S.session = null; S.real = null; S.vaView = false; S.lib = null; location.hash = '#/'; route();
        };
    }

    function gate(msg) {
        chrome(false); setTitle('Sign in');
        const portal = (S.session && S.session.portalUrl) || 'https://cm-training-activity.pages.dev';
        const wantAdmin = new URLSearchParams(location.search).get('admin') === '1';
        const codeLogin = !!(S.session && S.session.codeLogin), open = !!(S.session && S.session.configured);
        view(`<div class="gate">
            <h1>LSH Knowledge Base</h1>
            <p class="lead">SOPs, training videos and know-how from the whole LSH VA community.</p>
            <div class="card">
                <div class="tabs" role="tablist">
                    <button type="button" role="tab" aria-selected="${!wantAdmin}" data-tab="va">Trainee Portal</button>
                    <button type="button" role="tab" aria-selected="${wantAdmin}" data-tab="admin">Admin Portal</button>
                </div>
                ${codeLogin ? `<form id="f-va" autocomplete="on"${wantAdmin ? ' hidden' : ''}>
                    ${open ? '' : '<p class="note">The Knowledge Base isn’t open yet. An admin needs to sign in and set the team access code.</p>'}
                    <label class="f">Full name<input class="i" id="g-name" name="name" required autocomplete="name"></label>
                    <label class="f">Batch <small>(optional)</small><input class="i" id="g-batch" name="batch" placeholder="e.g. Batch 12"></label>
                    <label class="f">Team access code<input class="i" id="g-code" name="code" type="password" required autocomplete="off"><small>Your trainer or team lead gives you this code.</small></label>
                    <button class="btn primary" type="submit"${open ? '' : ' disabled'}>Open the library</button>
                    <p class="muted" id="g-err" role="alert"></p>
                </form>` : `<div id="f-va"${wantAdmin ? ' hidden' : ''} style="display:grid;gap:12px">
                    <p style="margin:0">Sign in once, on the LSH Training Portal. Open the Knowledge Base from there and you come straight in: there is no second sign-in here.</p>
                    ${msg ? `<p class="note" role="alert">${esc(msg)}</p>` : ''}
                    <a class="btn primary" href="${esc(portal)}/programs.html">Go to the LSH Training Portal</a>
                </div>`}
                <form id="f-admin"${wantAdmin ? '' : ' hidden'}>
                    <p class="muted" style="margin:0">Administrators type the admin password, the same one as on every LSH platform.</p>
                    ${codeLogin ? '<label class="f">Username <small>(test mode)</small><input class="i" id="g-user" autocomplete="username"></label>' : ''}
                    <label class="f">Admin password<input class="i" id="g-pass" type="password" required autocomplete="current-password"></label>
                    <button class="btn primary" type="submit">Sign in as admin</button>
                    <p class="muted" id="g-err2" role="alert"></p>
                </form>
            </div></div>`);
        app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
            app.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
            document.getElementById('f-va').hidden = b.dataset.tab !== 'va';
            document.getElementById('f-admin').hidden = b.dataset.tab !== 'admin';
        });
        if (codeLogin) document.getElementById('f-va').onsubmit = async (ev) => {
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
        let gateMsg = '';
        try {
            // Opened from the LSH Training Portal: it hands over a short-lived signed ticket, which signs the trainee in.
            const tk = new URLSearchParams(location.search).get('ticket');
            if (tk) {
                // window.history: the plain name is shadowed by the history(id) view below
                window.history.replaceState(null, '', location.pathname + location.hash);
                try { await post('/api/session', { action: 'portal-ticket', ticket: tk }); S.session = null; } catch (e) { gateMsg = e.message; }
            }
            if (!S.session) await loadSession();
        } catch (e) { return errorView(e); }
        if (!S.session.unlocked) return gate(gateMsg);
        const { parts, q } = parseHash();
        try {
            await ensureLib();
            chrome(true);
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
                case 'go': {   // a link from an imported Tettra page to another one
                    const r = await api('/api/resolve?ref=' + encodeURIComponent('tettra:' + parts[1]));
                    return location.replace('#/e/' + r.id);
                }
                case 'featured': return await featuredView();
                case 'glossary': return await glossaryView(q);
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
        window.history.replaceState(null, '', leaveGuard);
        return false;
    }
    window.addEventListener('beforeunload', (e) => { if (leaveGuard) { e.preventDefault(); e.returnValue = ''; } });

    /* ---------- home ---------- */
    async function home() {
        // Every published entry, A to Z by title, read each time the home page opens so new uploads slot
        // into place on their own. It doesn't depend on the library, so the two are asked for together.
        const [L, all] = await Promise.all([ensureLib(true), api('/api/entries?all=1&sort=az')]);
        chrome(true); setTitle('');
        const t = L.totals;
        // The search takes the place of the list's heading, in line with the category picker: the two
        // controls the list is driven by, side by side above it.
        const libBar = `<div class="lib-bar">
            <form id="lib-search-form" role="search" class="lib-search"><label class="sr" for="lib-q">Search the library</label>
                <input id="lib-q" type="search" placeholder="Search the library: “lien reduction”, “intake call”, “itemized bills”…" autocomplete="off">
                <button class="btn primary" type="submit">Search</button></form>
            <label class="sr" for="az-cat">Category</label>
            <select class="i lib-cat" id="az-cat"><option value="">All categories</option>${L.collections.filter(c => c.count).map(c => `<option value="${c.slug}">${esc(c.name)} (${c.count})</option>`).join('')}</select>
            <span class="muted lib-count" id="az-count">${plural(all.total, 'entry', 'entries')}</span>
        </div>`;
        view(`
        <section class="hero">
            <h1>LSH Community Library</h1>
            <p>Official SOPs, training videos, guides and hard-won know-how from across LSH, kept in one place and never lost.</p>
            <div class="stats"><span><b>${t.entries}</b>entries</span><span><b>${t.videos}</b>training videos</span><span><b>${t.files}</b>files</span><span><b>${t.people}</b>contributors</span></div>
        </section>
        ${!S.session.contributor ? '<p class="note" style="margin-top:16px"><b>Info Access:</b> you can read and search everything here. Only tenured team members can add to or edit the library, and every change is approved before it goes live. Ask an admin if you should have tenured access.</p>' : ''}
        ${L.mine.pending || L.mine.rejected ? `<p class="note" style="margin-top:16px">You have ${L.mine.pending ? plural(L.mine.pending, 'contribution') + ' waiting for review' : ''}${L.mine.pending && L.mine.rejected ? ' and ' : ''}${L.mine.rejected ? plural(L.mine.rejected, 'contribution') + ' sent back with a note' : ''}. <a href="#/mine">See my contributions</a></p>` : ''}
        ${(S.session.admin || S.session.reviewer) && L.queue && (L.queue.revisions || L.queue.comments || L.queue.terms) ? `<p class="note" style="margin-top:12px">${plural(L.queue.revisions, 'entry or edit', 'entries and edits')}${L.queue.terms ? `, ${plural(L.queue.terms, 'Glossary change')}` : ''} and ${plural(L.queue.comments, 'note')} are waiting for review. <a href="#/review">Open the review queue</a></p>` : ''}
        ${!t.entries ? `<div class="card section"><h2>The library is empty</h2><p>Add the first SOP, video or guide.${S.session.admin ? ' If the old Knowledge Base had posts, import them from <a href="#/admin">Admin</a>.' : ''}</p>${S.session.contributor ? '<a class="btn accent" href="#/new">+ Add to the library</a>' : ''}</div>` : ''}
        ${t.entries ? `<section class="section">${libBar}<div id="az-list">${listHTML(all.entries)}</div></section>` : ''}
        ${L.featured.length ? `<section class="section"><h2>Featured</h2>${listHTML(L.featured)}</section>` : ''}
        ${L.videos.length ? `<section class="section"><div class="spread"><h2>Latest training videos</h2><a href="#/videos">All videos</a></div>${listHTML(L.videos)}</section>` : ''}
        ${t.entries ? `<section class="section two"><div><h2>Recently added</h2>${listHTML(L.recent)}</div><div><h2>Most helpful</h2>${listHTML(L.popular)}</div></section>` : ''}`);
        const azCat = document.getElementById('az-cat');
        if (azCat && document.getElementById('az-list')) azCat.onchange = () => {
            const rows = azCat.value ? all.entries.filter(e => e.collection === azCat.value) : all.entries;
            document.getElementById('az-list').innerHTML = listHTML(rows);
            document.getElementById('az-count').textContent = plural(rows.length, 'entry', 'entries');
        };
        const libForm = document.getElementById('lib-search-form');   // not drawn while the library is empty
        if (libForm) libForm.onsubmit = (ev) => {
            ev.preventDefault();
            location.hash = '#/search?q=' + encodeURIComponent(document.getElementById('lib-q').value.trim());
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
                ${S.session.contributor ? `<a class="btn accent" href="#/new?collection=${slug}">+ Add to ${esc(c.name)}</a>` : ''}</div>
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
                    : `<div class="card"><p>Nothing here yet${q.toString().includes('=1') || q.get('type') ? ' with these filters' : ''}.</p>${S.session.contributor ? `<a class="btn accent" href="#/new?collection=${slug}">+ Add the first entry</a>` : ''}</div>`}
                ${r.total > r.entries.length ? `<p class="muted">Showing the first ${r.entries.length}. Use search to find the rest.</p>` : ''}</div>
            </div>`);
        document.getElementById('c-type').onchange = (ev) => { const p = new URLSearchParams(q); ev.target.value ? p.set('type', ev.target.value) : p.delete('type'); location.hash = `#/c/${slug}?${p}`; };
        app.querySelectorAll('[data-jump]').forEach(a => a.onclick = (ev) => { ev.preventDefault(); document.getElementById(a.dataset.jump).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    }

    /* ---------- search & videos ---------- */
    async function search(q, videos) {
        const base = videos ? '#/videos' : '#/search';
        let gloss = [];
        if (!videos && q.get('q')) {   // dictionary terms that match, shown above the entries
            try {
                const g = (await api('/api/glossary')).terms, words = q.get('q').toLowerCase().split(/\s+/).filter(Boolean);
                gloss = g.filter(t => words.every(w => (t.term + ' ' + t.definition).toLowerCase().includes(w))).slice(0, 5);
            } catch (e) { gloss = []; }
        }
        const params = new URLSearchParams();
        ['q', 'collection', 'type', 'official', 'video', 'tag', 'sort', 'page'].forEach(k => { if (q.get(k)) params.set(k, q.get(k)); });
        const r = await api('/api/entries?' + params);
        const title = videos ? 'Training videos' : q.get('q') ? `Results for “${q.get('q')}”` : q.get('tag') ? `Tagged “${q.get('tag')}”` : 'Everything in the library';
        setTitle(title);
        const link = (k, v) => { const p = new URLSearchParams(q); if (videos) p.delete('video'); p.delete('page'); if (v === null || p.get(k) === v) p.delete(k); else p.set(k, v); return `${base}?${p}`; };
        const pages = Math.ceil(r.total / r.pageSize);
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><span>${videos ? 'Videos' : 'Search'}</span></div>
            <h1>${esc(title)}</h1>
            <form class="page-search" id="s-form" role="search"><label class="sr" for="s-q">Search the library</label>
                <input class="i" id="s-q" type="search" placeholder="${videos ? 'Search the training videos…' : 'Search SOPs, videos, guides…'}" value="${esc(q.get('q') || '')}" autocomplete="off">
                <button class="btn primary" type="submit">Search</button></form>
            ${gloss.length ? `<section class="card" style="margin-bottom:14px"><b>In the glossary</b>${gloss.map(t => `<p style="margin:6px 0 0"><a href="#/glossary?q=${encodeURIComponent(t.term)}"><b>${esc(t.term)}</b></a> · ${esc(t.definition.length > 160 ? t.definition.slice(0, 157) + '…' : t.definition)}</p>`).join('')}</section>` : ''}
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
                ${S.session.contributor ? '<p class="muted" style="margin:0">Know the answer? <a href="#/new">Add it to the library</a> so the next person finds it.</p>' : ''}</div>`}
            ${pages > 1 ? `<div class="pager">${r.page > 1 ? `<a class="btn small" href="${link('page', String(r.page - 1))}">← Previous</a>` : ''}<span class="muted">Page ${r.page} of ${pages}</span>${r.page < pages ? `<a class="btn small" href="${link('page', String(r.page + 1))}">Next →</a>` : ''}</div>` : ''}`);
        const sel = (id, k) => { const el = document.getElementById(id); if (el) el.onchange = () => { location.hash = link(k, el.value || null); }; };
        sel('s-col', 'collection'); sel('s-type', 'type'); sel('s-sort', 'sort');
        document.getElementById('s-form').onsubmit = (ev) => {
            ev.preventDefault();
            location.hash = link('q', document.getElementById('s-q').value.trim() || null);
        };
    }

    /* ---------- featured ---------- */
    async function featuredView() {
        const L = await ensureLib(true);
        chrome(true); setTitle('Featured');
        view(`<h1>Featured</h1><p class="muted" style="margin-top:0">The articles the team has starred as front-page reading.</p>
            ${L.featured.length ? listHTML(L.featured) : `<div class="card"><p>Nothing is featured yet.${S.session.admin || S.session.reviewer ? ' Star an article from its page (“★ Feature Article”, under the reviewer tools).' : ''}</p><a class="btn" href="#/">Back to the library</a></div>`}`);
    }

    /* ---------- glossary (a dictionary of terms) ---------- */
    async function glossaryView(q) {
        const direct = !!S.session.admin, canSuggest = !!S.session.contributor && !direct;   // admins change terms at once; tenured VAs and reviewers suggest changes; Info Access reads
        const { terms, mine } = await api('/api/glossary');
        const pendingFor = new Map((mine || []).filter(m => m.status === 'pending' && m.termId).map(m => [m.termId, m]));
        setTitle('Glossary');
        const cats = [...new Set(terms.map(t => t.category))].sort();
        const state = { q: q.get('q') || '', cat: q.get('category') || '' };
        const letterOf = (t) => /^[a-z]/i.test(t.term) ? t.term[0].toUpperCase() : '#';
        const form = (t) => `<form class="editor gl-form" data-id="${t ? t.id : ''}"><div class="row"><input class="i" name="term" required maxlength="120" placeholder="Term" value="${t ? esc(t.term) : ''}" style="max-width:260px">
            <input class="i" name="category" maxlength="40" placeholder="Category (Legal, Medical…)" list="gl-cats" value="${t ? esc(t.category) : ''}" style="max-width:220px"></div>
            <textarea class="i" name="definition" rows="3" required placeholder="What it means">${t ? esc(t.definition) : ''}</textarea>
            <input class="i" name="example" maxlength="1000" placeholder="Example (optional)" value="${t ? esc(t.example || '') : ''}">
            <div class="row"><button class="btn primary" type="submit">${direct ? (t ? 'Save' : 'Add the term') : 'Send for approval'}</button>${t ? '<button class="btn" type="button" data-cancel>Cancel</button>' : ''}</div></form>`;
        view(`<h1>Glossary</h1><p class="lead" style="margin-top:0">Plain-English meanings of the legal and medical terms you meet at work. ${plural(terms.length, 'term')}. Many are general US meanings; rules differ by state and court, so confirm with the attorney.</p>
            <datalist id="gl-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
            <div class="gl-tools"><label class="sr" for="gl-q">Search the glossary</label><input class="i" id="gl-q" type="search" placeholder="Look up a term or a word in its meaning…" value="${esc(state.q)}" autocomplete="off">
                <div class="gl-cats" id="gl-cat-chips"><button class="chip" data-cat="" aria-pressed="${!state.cat}">All</button>${cats.map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${state.cat === c}">${esc(c)}</button>`).join('')}</div>
                <div class="gl-letters" id="gl-letters"></div></div>
            ${direct || canSuggest ? `<details class="card" style="margin:12px 0"><summary><b>${direct ? '+ Add a term' : '+ Suggest a term'}</b></summary>${canSuggest ? '<p class="muted">An admin or another reviewer approves it before it appears in the Glossary.</p>' : ''}${form(null)}</details>` : ''}
            ${(mine || []).length ? `<section class="card" style="margin:12px 0"><b>Your Glossary suggestions</b><div class="gl-mine">${mine.map(m => `<div class="gl-mine-row"><span class="badge ${m.status === 'pending' ? 'pending' : 'rejected'}">${m.status === 'pending' ? 'Waiting for approval' : 'Sent back'}</span> <b>${esc(m.term)}</b> · ${{ add: 'new term', edit: 'edit', delete: 'removal' }[m.action]}${m.status === 'rejected' && m.reviewNote ? `<br><span class="muted">Reviewer: ${esc(m.reviewNote)}</span>` : ''}${m.status === 'pending' ? ` <button class="btn small" data-withdraw="${m.id}">Withdraw</button>` : ''}</div>`).join('')}</div></section>` : ''}
            <div id="gl-list"></div>`);
        const list = document.getElementById('gl-list'), letters = document.getElementById('gl-letters');
        const paint = () => {
            const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
            const rows = terms.filter(t => (!state.cat || t.category === state.cat) && words.every(w => (t.term + ' ' + t.definition + ' ' + (t.example || '')).toLowerCase().includes(w)));
            const by = new Map();
            rows.forEach(t => { const l = letterOf(t); if (!by.has(l)) by.set(l, []); by.get(l).push(t); });
            const keys = [...by.keys()].sort((a, b) => (a === '#') - (b === '#') || a.localeCompare(b));
            letters.innerHTML = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(l => by.has(l) ? `<a href="#/glossary" data-l="${l}">${l}</a>` : `<span>${l}</span>`).join('');
            list.innerHTML = rows.length ? keys.map(l => `<section class="gl-group" id="gl-${l === '#' ? 'num' : l}"><h2>${l}</h2>${by.get(l).map(t => `<div class="gl-term" id="t${t.id}">
                <div class="gl-head"><b>${esc(t.term)}</b><span class="badge">${esc(t.category)}</span>${direct ? `<span class="gl-act"><button class="btn small" data-edit="${t.id}">Edit</button> <button class="btn small danger" data-del="${t.id}">Delete</button></span>`
                    : canSuggest ? `<span class="gl-act">${pendingFor.has(t.id) ? '<span class="badge pending">Change waiting for approval</span>' : `<button class="btn small" data-edit="${t.id}">Suggest an edit</button> <button class="btn small" data-del="${t.id}">Suggest removal</button>`}</span>` : ''}</div>
                <p>${esc(t.definition)}</p>${t.example ? `<p class="muted"><i>${esc(t.example)}</i></p>` : ''}</div>`).join('')}</section>`).join('')
                : `<div class="card"><p>No term matches${state.q ? ` “${esc(state.q)}”` : ''}.</p>${canSuggest ? '<p class="muted" style="margin:0">Know it? Use “Suggest a term” above. It goes live once it’s approved.</p>' : ''}</div>`;
        };
        paint();
        document.getElementById('gl-q').oninput = (ev) => { state.q = ev.target.value; paint(); };
        document.getElementById('gl-cat-chips').onclick = (ev) => { const b = ev.target.closest('[data-cat]'); if (!b) return; state.cat = b.dataset.cat; app.querySelectorAll('#gl-cat-chips .chip').forEach(x => x.setAttribute('aria-pressed', String(x === b))); paint(); };
        letters.onclick = (ev) => { const a = ev.target.closest('[data-l]'); if (!a) return; ev.preventDefault(); const el = document.getElementById('gl-' + (a.dataset.l === '#' ? 'num' : a.dataset.l)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        const save = async (f) => {
            const d = Object.fromEntries(new FormData(f));
            try {
                if (direct) await post('/api/glossary', { action: 'save', id: f.dataset.id || undefined, term: d.term, category: d.category, definition: d.definition, example: d.example });
                else await post('/api/glossary', { action: 'suggest', change: f.dataset.id ? 'edit' : 'add', id: f.dataset.id || undefined, term: d.term, category: d.category, definition: d.definition, example: d.example });
                toast(direct ? 'Saved.' : 'Sent. It’s in the Glossary once it’s approved.'); glossaryView(q);
            } catch (e) { toast(e.message, true); }
        };
        app.querySelectorAll('.gl-form').forEach(f => f.onsubmit = (ev) => { ev.preventDefault(); save(f); });
        list.onclick = async (ev) => {
            const ed = ev.target.closest('[data-edit]'), del = ev.target.closest('[data-del]');
            if (ed) { const t = terms.find(x => x.id === Number(ed.dataset.edit)), box = document.getElementById('t' + t.id); box.innerHTML = form(t); box.querySelector('form').onsubmit = (e2) => { e2.preventDefault(); save(box.querySelector('form')); }; box.querySelector('[data-cancel]').onclick = () => paint(); }
            if (del && direct && confirm('Delete this term?')) { try { await post('/api/glossary', { action: 'delete', id: Number(del.dataset.del) }); toast('Deleted.'); glossaryView(q); } catch (e) { toast(e.message, true); } }
            if (del && !direct) {
                const why = prompt('Why should this term be removed? (An admin or another reviewer will read this.)');
                if (why && why.trim()) { try { await post('/api/glossary', { action: 'suggest', change: 'delete', id: Number(del.dataset.del), note: why.trim() }); toast('Sent. The term stays until the removal is approved.'); glossaryView(q); } catch (e) { toast(e.message, true); } }
            }
        };
        app.querySelectorAll('[data-withdraw]').forEach(b => b.onclick = async () => {
            try { await post('/api/glossary', { action: 'withdraw', id: Number(b.dataset.withdraw) }); toast('Withdrawn.'); glossaryView(q); } catch (e) { toast(e.message, true); }
        });
    }

    /* ---------- entry ---------- */
    function mediaHTML(files, body) {
        if (!files.length) return '';
        // A photo placed in the text with the editor's 🖼️ Photo button shows where it was placed, not again up here.
        const inBody = (f) => String(body || '').includes(`/files/${f.id}/`);
        const videos = files.filter(f => f.kind === 'video'), pdfs = files.filter(f => f.kind === 'pdf'), images = files.filter(f => f.kind === 'image' && !inBody(f));
        const rest = files.filter(f => !['video', 'pdf', 'image'].includes(f.kind));
        return `<div class="media">
            ${videos.map(f => `<figure class="player" style="margin:0"><video controls preload="metadata" playsinline src="${fileUrl(f)}"></video>
                <figcaption><span>${esc(f.name)} · ${fmtSize(f.size)}</span></figcaption></figure>`).join('')}
            ${pdfs.map((f, i) => i === 0 ? `<div><iframe class="pdf" title="${esc(f.name)}" src="${fileUrl(f)}#view=FitH" loading="lazy"></iframe></div>` : '').join('')}
            ${images.map(f => `<figure class="shot" style="margin:0"><a href="${fileUrl(f)}" target="_blank" rel="noopener"><img src="${fileUrl(f)}" alt="${esc(f.name)}" loading="lazy"></a></figure>`).join('')}
            <div class="files">${[...pdfs, ...rest].map(f => `<div class="file"><span class="nm"><span aria-hidden="true">${FILE_ICON[f.kind] || '📎'}</span><span>${esc(f.name)}</span> <small>${fmtSize(f.size)}</small></span>
                <span class="row">${['pdf', 'image', 'audio', 'video'].includes(f.kind) || f.name.toLowerCase().endsWith('.txt')
                    ? `<a class="btn small" href="${fileUrl(f)}" target="_blank" rel="noopener">Open</a>`
                    : '<span class="muted">Shown in the page only</span>'}</span></div>`).join('')}</div>
        </div>`;
    }

    async function entry(id) {
        const r = await api(`/api/entries/${id}`);
        const e = r.entry, s = S.session, own = e.authorKey === s.who.key;
        setTitle(e.title);
        // In "Switch view" (an admin previewing the trainee view) the staff tools stay hidden.
        const staff = r.can.staff && (s.admin || s.reviewer), adminUser = r.can.admin && s.admin;
        let banner = '';
        if (e.status === 'pending') banner = `<p class="note">This entry is waiting for review. Until a reviewer approves it, only you and the reviewers can see it.</p>`;
        if (e.status === 'rejected') banner = `<p class="note bad"><b>Sent back:</b> ${esc(e.reviewNote)}${own ? ` <a href="#/e/${id}/edit">Edit and resend</a>` : ''}</p>`;
        if (e.status === 'archived') banner = `<p class="note">This entry is archived. It’s hidden from the library and search, and every version is kept.</p>`;
        if (e.status === 'withdrawn') banner = `<p class="note">You withdrew this entry.</p>`;
        if (e.myPendingEdit) banner += `<p class="note">Your suggested edit is waiting for review. <a href="#/v/${e.myPendingEdit}">See your changes</a></p>`;
        if (staff && e.pendingEdits) banner += `<p class="note">${plural(e.pendingEdits, 'suggested edit is', 'suggested edits are')} waiting for review. <a href="#/review">Open the review queue</a></p>`;
        const editLabel = adminUser || (own && !e.publishedAt) ? 'Edit' : 'Suggest an edit';
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span><a href="#/c/${e.collection}">${esc(colName(e.collection))}</a>${e.section ? `<span>›</span><span>${esc(e.section)}</span>` : ''}</div>
            ${banner}
            <div class="entry-layout">
                <article>
                    <header class="entry-head">
                        <div class="row">${e.official ? '<span class="badge official">✓ Official</span>' : ''}${e.hasVideo ? '<span class="badge video">Video</span>' : ''}<span class="badge">${esc(e.type)}</span>${(e.tags || []).includes('from-tettra') ? '<a class="badge" href="#/search?tag=from-tettra" title="See every page that came from our Tettra">From our Tettra</a>' : ''}${e.featured ? '<span class="badge">★ Featured</span>' : ''}${statusBadge(e.status)}</div>
                        <h1>${esc(e.title)}</h1>
                        ${e.summary ? `<p class="lead">${esc(e.summary)}</p>` : ''}
                    </header>
                    ${mediaHTML(e.files, e.body)}
                    <div class="md">${window.KBmd.render(e.body)}</div>
                    ${e.tags.filter(t => t !== 'from-tettra').length ? `<div class="tags" style="margin-top:18px">${e.tags.filter(t => t !== 'from-tettra').map(t => `<a href="#/search?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
                    ${e.credits.length ? `<p class="muted">With help from ${e.credits.map(esc).join(', ')}.</p>` : ''}
                    ${e.status === 'published' ? `<div class="row" style="margin-top:18px"><button class="btn" id="helpful" aria-pressed="${r.voted}">👍 ${r.voted ? 'You found this helpful' : 'Helpful'} · <span id="helpful-n">${r.stats.helpful}</span></button><span class="muted">${plural(r.stats.views, 'view')}</span></div>` : ''}
                    <section class="section" id="replies"><h2>Comments · update current info</h2>
                        <p class="muted" style="margin-top:0">${s.contributor ? 'Is something on this page out of date, or have you used it? Tell us what’s current. A reviewer reads every note and updates the page.' : 'Tenured team members can send notes about what needs updating. You can read the notes others have left.'}</p>
                        <div class="replies">${r.comments.length ? r.comments.map(c => `<div class="reply"><div class="who"><b>${esc(c.author)}</b>${c.batch ? ' · ' + esc(c.batch) : ''} · ${fmtDate(c.createdAt)} ${c.kind === 'update' ? '<span class="badge">Update to current info</span> ' : ''}${c.done ? '<span class="badge official">✓ Page updated</span> ' : ''}${c.status === 'pending' ? '<span class="badge pending">Waiting for review</span>' : c.status === 'rejected' ? '<span class="badge rejected">Not approved</span>' : ''}</div>
                            <div class="md">${window.KBmd.render(c.body)}</div>
                            ${staff && c.status === 'pending' ? `<div class="row" style="margin-top:6px"><button class="btn small primary" data-reply="${c.id}" data-d="approve">Approve</button><button class="btn small" data-reply="${c.id}" data-d="reject">Don’t publish</button></div>` : ''}
                            ${staff && c.status === 'approved' ? `<div class="row" style="margin-top:6px">${c.kind === 'update' && !c.done ? `<button class="btn small primary" data-reply="${c.id}" data-d="done">Mark page updated</button>` : ''}<button class="btn small danger" data-reply="${c.id}" data-d="delete">Remove</button></div>` : ''}</div>`).join('') : '<p class="muted" style="margin:0">No comments yet.</p>'}</div>
                        ${e.status === 'published' && s.contributor ? `<form id="reply-form" class="editor" style="margin-top:12px">
                            <div class="row"><label><input type="radio" name="reply-kind" value="update" checked> Something needs updating</label> <label><input type="radio" name="reply-kind" value="comment"> Just a comment</label></div>
                            <label class="f">Your note<textarea class="i" id="reply-body" rows="3" required placeholder="What is out of date, and what should it say now? Add the source or date if you have one."></textarea></label>
                            <div class="row"><button class="btn primary" type="submit">Send</button>${staff ? '' : '<span class="muted">Notes appear after a reviewer approves them.</span>'}</div></form>` : ''}
                    </section>
                </article>
                <aside class="side">
                    <div class="card on-page" id="on-page" hidden></div>
                    <div class="card"><dl>
                        <dt>Collection</dt><dd><a href="#/c/${e.collection}">${esc(colName(e.collection))}</a></dd>
                        ${e.section ? `<dt>Section</dt><dd>${esc(e.section)}</dd>` : ''}
                        <dt>Added by</dt><dd><a href="#/people/${encodeURIComponent(e.authorKey)}">${esc(e.author)}</a>${e.batch ? ` · ${esc(e.batch)}` : ''}</dd>
                        <dt>Date published</dt><dd>${fmtDate(e.publishedAt || e.createdAt)}</dd>
                        <dt>Last updated</dt><dd>${fmtDate(e.version.at)} by ${esc(e.version.by)}</dd>
                        <dt>Version</dt><dd><a href="#/e/${id}/history">v${e.versions} · ${plural(e.versions, 'version')}</a></dd>
                    </dl></div>
                    <div class="card row">
                        ${r.can.edit && s.contributor ? `<a class="btn primary" href="#/e/${id}/edit">${editLabel}</a>` : ''}
                        <a class="btn" href="#/e/${id}/history">History</a>
                        ${own && e.status === 'pending' && !e.publishedAt ? `<button class="btn danger" data-act="withdraw">Withdraw</button>` : ''}
                    </div>
                    ${staff ? `<div class="card"><h3>Reviewer tools</h3><div class="row">
                        ${e.status === 'published' ? `<button class="btn small" data-act="${e.featured ? 'unfeature' : 'feature'}">${e.featured ? 'Unfeature' : '★ Feature Article'}</button>` : ''}
                        ${adminUser && e.publishedAt ? `<button class="btn small" data-act="official" data-v="${e.official ? '0' : '1'}">${e.official ? 'Remove Official' : '✓ Mark Official'}</button>` : ''}
                        ${e.status === 'archived' ? (adminUser ? `<button class="btn small" data-act="unarchive">Restore to the library</button>` : '') : e.publishedAt ? `<button class="btn small" data-act="archive">Mark obsolete (archive)</button>` : ''}
                    </div>
                    ${adminUser ? `<div style="margin-top:12px"><b>Delete this article</b>
                        <p class="muted" style="font-size:13px">Removes the article, every version and its files for good. Use Archive instead if you might need it again.</p>
                        <div class="row"><input class="i" id="purge-confirm" placeholder="Type DELETE" style="max-width:140px"><button class="btn small danger" data-act="purge">Delete article</button></div></div>` : ''}</div>` : ''}
                </aside>
            </div>`);
        // "On this page": the entry's own headings, as links.
        const heads = [...app.querySelectorAll('article .md')[0] ? app.querySelectorAll('article .md')[0].querySelectorAll('h2, h3, h4') : []].filter(h => h.textContent.trim());
        const op = document.getElementById('on-page');
        if (op && heads.length > 2) {
            heads.forEach((h, i) => { h.id = 'h-' + i; });
            op.innerHTML = '<b>On this page</b>' + heads.map((h, i) => `<a class="${h.tagName === 'H2' ? '' : 'l3'}" href="#/e/${id}" data-h="h-${i}">${esc(h.textContent.trim())}</a>`).join('');
            op.hidden = false;
            op.onclick = (ev) => { const a = ev.target.closest('a[data-h]'); if (!a) return; ev.preventDefault(); document.getElementById(a.dataset.h).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
        }
        const hb = document.getElementById('helpful');
        if (hb) hb.onclick = async () => {
            try { const v = await post(`/api/entries/${id}`, { action: 'helpful' }); hb.setAttribute('aria-pressed', v.voted); hb.innerHTML = `👍 ${v.voted ? 'You found this helpful' : 'Helpful'} · <span id="helpful-n">${v.helpful}</span>`; }
            catch (e) { toast(e.message, true); }
        };
        const rf = document.getElementById('reply-form');
        if (rf) rf.onsubmit = async (ev) => {
            ev.preventDefault();
            try { const v = await post('/api/comments', { action: 'submit', entryId: id, body: val('reply-body'), kind: (document.querySelector('input[name=reply-kind]:checked') || {}).value || 'update' }); toast(v.status === 'approved' ? 'Comment published.' : 'Thanks. A reviewer will read your note.'); entry(id); }
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
        if (!S.session.contributor) { setTitle('Info Access'); return view(`<div class="card section"><h1>Info Access is view-only</h1><p>Your Portal sign-in gives you Info Access: you can read everything in the library. Only tenured team members can add or edit, and every change is approved before it goes live. To get tenured access, ask an admin.</p><p><a class="btn" href="#/">Back to the library</a></p></div>`); }
        let e = null;
        if (id) e = (await api(`/api/entries/${id}`)).entry;
        const own = e && e.authorKey === s.who.key;
        const direct = !!s.admin;   // only an admin's changes go live at once; everyone else's wait for approval
        const suggesting = e && !direct && !(own && !e.publishedAt);
        setTitle(e ? (suggesting ? 'Suggest an edit' : 'Edit') + ': ' + e.title : 'Add to the library');
        const d = e || { collection: (q && q.get('collection')) || '', section: '', type: '', title: '', summary: '', body: '', tags: [], credits: [], files: [], official: false };
        const files = d.files.map(f => ({ ...f, state: 'ready' }));
        view(`<div class="crumbs"><a href="#/">Library</a><span>›</span>${e ? `<a href="#/e/${id}">${esc(e.title)}</a><span>›</span><span>${suggesting ? 'Suggest an edit' : 'Edit'}</span>` : '<span>Add to the library</span>'}</div>
            <h1>${e ? (suggesting ? 'Suggest an edit' : 'Edit this entry') : 'Add to the library'}</h1>
            <p class="muted" style="margin-top:0">${direct ? 'Your changes go live as soon as you save. The previous version stays in the history.'
                : suggesting ? 'Your changes are saved as a suggestion. They need approval, and the current version stays up until then.'
                : 'New entries need approval before they appear in the library. You’ll see the status under My contributions.'}${!direct && staff ? ' Another reviewer or an admin has to approve your changes.' : ''}</p>
            <form class="editor card" id="ed" novalidate>
                <div class="grid2">
                    <label class="f">Collection <small>(pick one, or type a new one)</small><input class="i" id="ed-col" list="ed-cols" required maxlength="80" placeholder="Choose or type a new collection" value="${esc(d.collection ? colName(d.collection) : '')}"><datalist id="ed-cols">${S.lib.collections.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
                    <label class="f">Section <small>(optional, e.g. “Day 17 · Lien Negotiator Training”)</small><input class="i" id="ed-sec" list="ed-secs" value="${esc(d.section)}" maxlength="120"><datalist id="ed-secs"></datalist></label>
                    <label class="f">Type <small>(pick one, or type your own)</small><input class="i" id="ed-type" list="ed-types" required maxlength="40" placeholder="SOP, Guide, Checklist…" value="${esc(d.type)}"><datalist id="ed-types">${S.lib.types.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
                    <label class="f">Tags <small>(comma-separated)</small><input class="i" id="ed-tags" value="${esc(d.tags.join(', '))}" placeholder="medicare, reduction letter"></label>
                </div>
                <label class="f">Title<input class="i" id="ed-title" value="${esc(d.title)}" maxlength="200" required placeholder="Say what someone will be able to do"></label>
                <label class="f">Summary <small>(one or two sentences shown in lists and search)</small><input class="i" id="ed-sum" value="${esc(d.summary)}" maxlength="500"></label>
                <div class="f" style="display:grid;gap:5px">
                    <span style="font-size:13px;font-weight:600;color:var(--ink)">Files and videos <small style="font-weight:400;color:var(--muted)">(PDF, Word, Excel, PowerPoint, images, videos; up to 5 GB each)</small></span>
                    <div class="drop" id="drop" tabindex="0" role="button" aria-label="Add files">Drop files here, or <u>choose files</u><input type="file" id="ed-file" multiple hidden></div>
                    <div class="up" id="up"></div>
                </div>
                <div>
                    <div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-t="write">Write</button><button type="button" role="tab" aria-selected="false" data-t="preview">Preview</button></div>
                    <label class="sr" for="ed-body">Content</label>
                    <div class="mdbar" id="mdbar" role="toolbar" aria-label="Formatting">
                        <button type="button" data-f="bold" title="Bold (select text first)"><b>B</b></button>
                        <button type="button" data-f="italic" title="Italic"><i>I</i></button>
                        <button type="button" data-f="underline" title="Underline"><u>U</u></button>
                        <span class="mdbar-sep" aria-hidden="true"></span>
                        <button type="button" id="mdbar-color" title="Colored text" aria-expanded="false"><span style="color:#C0392B;font-weight:700">A</span> Color</button>
                        <span class="pal" id="mdbar-pal" hidden>
                            ${['#C0392B', '#D97706', '#1E8449', '#1D4ED8', '#6D28D9', '#DB2777', '#6B7280', '#000000'].map(c => `<button type="button" class="sw" data-c="${c}" style="background:${c}" title="${c}" aria-label="Color ${c}"></button>`).join('')}
                            <input type="color" id="mdbar-custom" value="#C0392B" title="Pick any color">
                        </span>
                        <span class="mdbar-sep" aria-hidden="true"></span>
                        <button type="button" data-f="link" title="Link to a page or site">🔗 Link</button>
                        <button type="button" data-f="photo" title="Put a photo here in the text">🖼️ Photo</button>
                        <input type="file" id="mdbar-photo" accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp" hidden>
                    </div>
                    <textarea class="i" id="ed-body" rows="16" placeholder="Steps, examples and the pitfalls you ran into. Use the buttons above, or type: # heading, **bold**, *italic*, ++underline++, - list, - [ ] checklist, | table |">${esc(d.body)}</textarea>
                    <div class="preview md" id="ed-prev" hidden></div>
                </div>
                <label class="f">Credits <small>(teammates who helped, comma-separated)</small><input class="i" id="ed-cred" value="${esc(d.credits.join(', '))}"></label>
                ${s.admin ? `<label class="check"><input type="checkbox" id="ed-off"${d.official ? ' checked' : ''}> Official: an approved LSH SOP or resource</label>` : ''}
                ${e ? `<label class="f">What did you change? <small>(shown in the history)</small><input class="i" id="ed-note" maxlength="300" placeholder="e.g. Updated the Medicare step for 2026 forms"></label>` : ''}
                <p class="muted" id="ed-err" role="alert" style="margin:0"></p>
                <div class="row"><button class="btn primary" type="submit" id="ed-save">${direct ? (e ? 'Save changes' : 'Publish') : e ? (suggesting ? 'Send suggestion' : 'Resend for review') : 'Send for review'}</button>
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
        async function add(list, onReady) {
            for (const file of list) {
                const kind = guessKind(file.name);
                const f = { name: file.name, size: file.size, kind, state: 'uploading', progress: 0, ctl: new AbortController() };
                files.push(f); paint();
                window.KBUpload.upload(file, { signal: f.ctl.signal, onProgress: (p) => { f.progress = p; paint(); } })
                    .then(meta => { Object.assign(f, meta, { state: 'ready' }); delete f.ctl; paint(); if (onReady && files.includes(f)) onReady(f); })
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

        // The formatting toolbar: it writes the markup around whatever is selected, so the Preview shows exactly what readers get.
        const ta = document.getElementById('ed-body');
        function wrapSel(before, after, fallback) {
            const s = ta.selectionStart || 0, e2 = ta.selectionEnd || 0;
            const sel = ta.value.slice(s, e2) || fallback;
            ta.setRangeText(before + sel + after, s, e2);
            ta.focus();
            ta.setSelectionRange(s + before.length, s + before.length + sel.length);
        }
        const insertAt = (text) => { const s = ta.selectionStart || ta.value.length; ta.setRangeText(text, s, ta.selectionEnd || s, 'end'); ta.focus(); };
        const pal = document.getElementById('mdbar-pal'), colorBtn = document.getElementById('mdbar-color');
        colorBtn.onclick = () => { pal.hidden = !pal.hidden; colorBtn.setAttribute('aria-expanded', String(!pal.hidden)); };
        const applyColor = (c) => { pal.hidden = true; colorBtn.setAttribute('aria-expanded', 'false'); wrapSel(`{color:${c}}`, '{/color}', 'colored text'); };
        pal.querySelectorAll('[data-c]').forEach(b => b.onclick = () => applyColor(b.dataset.c));
        document.getElementById('mdbar-custom').onchange = (ev) => applyColor(ev.target.value);
        const photoInput = document.getElementById('mdbar-photo');
        document.getElementById('mdbar').addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-f]');
            if (!b) return;
            if (b.dataset.f === 'bold') wrapSel('**', '**', 'bold text');
            if (b.dataset.f === 'italic') wrapSel('*', '*', 'italic text');
            if (b.dataset.f === 'underline') wrapSel('++', '++', 'underlined text');
            if (b.dataset.f === 'link') {
                const url = (prompt('Where should the link go? (https://… , or a path like /files/…)') || '').trim();
                if (!url) return;
                if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) { toast('A link has to start with https://, mailto: or /.', true); return; }
                wrapSel('[', `](${url})`, 'link text');
            }
            if (b.dataset.f === 'photo') photoInput.click();
        });
        photoInput.onchange = () => {
            const picked = [...photoInput.files];
            photoInput.value = '';
            if (!picked.length) return;
            if (picked.some(f => guessKind(f.name) !== 'image')) { toast('Photos only here: PNG, JPG, GIF or WebP. Other files go in the Files box above.', true); return; }
            toast('Uploading the photo… it drops into the text when it’s done.');
            add(picked, (f) => {
                const src = encodeURIComponent(f.name).replace(/\(/g, '%28').replace(/\)/g, '%29');   // parens would end the markdown link early
                insertAt(`\n![${f.name.replace(/[\[\]]/g, '')}](/files/${f.id}/${src})\n`); toast('Photo added to the text.');
            });
        };

        const colSel = document.getElementById('ed-col');
        // The typed collection: an existing one's slug (matched by name or slug, any case), or '' when it's new.
        const colSlug = () => {
            const v = colSel.value.trim().toLowerCase();
            const c = S.lib.collections.find(x => x.slug === v || x.name.toLowerCase() === v);
            return c ? c.slug : '';
        };
        const fillSections = async () => {
            const dl = document.getElementById('ed-secs'), slug = colSlug();
            dl.innerHTML = slug ? (await sectionsFor(slug).catch(() => [])).map(x => `<option value="${esc(x)}">`).join('') : '';
        };
        colSel.onchange = fillSections; fillSections();

        app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
            app.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
            const prev = b.dataset.t === 'preview';
            document.getElementById('ed-body').hidden = prev;
            document.getElementById('mdbar').hidden = prev;
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
                const slug = colSlug();
                leaveGuard = null; S.lib = null; delete S.sections[slug || body.collection];
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
            <p class="muted" style="margin-top:0">Nothing is overwritten. Each save adds a version, and ${S.session.admin ? 'you can restore any earlier one.' : S.session.reviewer ? 'a restore waits for approval like any other edit.' : 'reviewers and admins can restore any earlier one.'}</p>
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
    // The exact words that changed inside a line: the old line with the removed words struck,
    // the new line with the added words highlighted. Null when the two lines share too little
    // (then the plain removed/added lines read better than a sea of marks).
    function diffWordsHTML(a, b) {
        const A = String(a).split(/(\s+)/).filter(Boolean), B = String(b).split(/(\s+)/).filter(Boolean);
        if (!A.length || !B.length || A.length * B.length > 250000) return null;
        const n = A.length, m = B.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        const delM = new Array(n).fill(false), addM = new Array(m).fill(false);
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (A[i] === B[j]) { i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) delM[i++] = true;
            else addM[j++] = true;
        }
        while (i < n) delM[i++] = true;
        while (j < m) addM[j++] = true;
        if (delM.filter(Boolean).length + addM.filter(Boolean).length > (n + m) * 0.6) return null;
        const mark = (toks, marks, tag) => {
            let html = '', run = [], on = null;
            const flush = () => { if (run.length) { const t = esc(run.join('')); html += on ? `<${tag}>${t}</${tag}>` : t; run = []; } };
            toks.forEach((tk, k) => { if (marks[k] !== on) { flush(); on = marks[k]; } run.push(tk); });
            flush();
            return html;
        };
        return { del: mark(A, delM, 'del'), add: mark(B, addM, 'ins') };
    }

    // The content diff, line by line, with three things on top of the raw lines:
    //   · a removed line followed by its replacement is compared word by word, so the exact edit shows;
    //   · nothing is struck through whole — only the words that actually went away;
    //   · long unchanged stretches fold away behind a "show" line, so the edits stand out.
    function diffHTML(a, b) {
        const lines = diffLines(a, b);
        const blocks = [];
        let k = 0;
        while (k < lines.length) {
            if (lines[k].t === 'same') {
                const run = [];
                while (k < lines.length && lines[k].t === 'same') run.push(lines[k++].s);
                blocks.push({ same: run });
            } else {
                const dels = [], adds = [];
                while (k < lines.length && lines[k].t === 'del') dels.push(lines[k++].s);
                while (k < lines.length && lines[k].t === 'add') adds.push(lines[k++].s);
                blocks.push({ dels, adds });
            }
        }
        const row = (cls, prefix, html) => `<div${cls ? ` class="${cls}"` : ''}>${prefix}${html || '&nbsp;'}</div>`;
        const out = [];
        blocks.forEach((blk, idx) => {
            if (blk.same) {
                const L = blk.same;
                const keepTop = idx === 0 ? 0 : 2, keepEnd = idx === blocks.length - 1 ? 0 : 2;
                if (blocks.length > 1 && L.length > keepTop + keepEnd + 4) {
                    L.slice(0, keepTop).forEach(s => out.push(row('', '  ', esc(s))));
                    const mid = L.slice(keepTop, L.length - keepEnd);
                    out.push(`<button type="button" class="fold" data-fold>⋯ ${plural(mid.length, 'unchanged line')} — show</button>`);
                    out.push(`<div hidden>${mid.map(s => row('', '  ', esc(s))).join('')}</div>`);
                    if (keepEnd) L.slice(-keepEnd).forEach(s => out.push(row('', '  ', esc(s))));
                } else L.forEach(s => out.push(row('', '  ', esc(s))));
            } else {
                const pairs = Math.min(blk.dels.length, blk.adds.length);
                for (let p = 0; p < pairs; p++) {
                    const w = diffWordsHTML(blk.dels[p], blk.adds[p]);
                    out.push(row('del', '− ', w ? w.del : esc(blk.dels[p])));
                    out.push(row('add', '+ ', w ? w.add : esc(blk.adds[p])));
                }
                blk.dels.slice(pairs).forEach(s => out.push(row('del', '− ', esc(s))));
                blk.adds.slice(pairs).forEach(s => out.push(row('add', '+ ', esc(s))));
            }
        });
        return `<div class="diff">${out.join('')}</div>`;
    }

    function changesHTML(from, to) {
        if (!from) return '<p class="muted">This is the first version.</p>';
        const rows = [];
        const field = (label, a, b) => {
            if ((a || '') === (b || '')) return;
            const w = a && b ? diffWordsHTML(a, b) : null;
            rows.push(w ? `<div><b>${label}:</b> <span class="wdiff">${w.del}</span> → <span class="wdiff">${w.add}</span></div>`
                : `<div><b>${label}:</b> <span style="text-decoration:line-through;color:var(--muted)">${esc(a || '(empty)')}</span> → ${esc(b || '(empty)')}</div>`);
        };
        field('Title', from.title, to.title); field('Summary', from.summary, to.summary); field('Collection', colName(from.collection), colName(to.collection));
        field('Section', from.section, to.section); field('Type', from.type, to.type); field('Tags', (from.tags || []).join(', '), (to.tags || []).join(', '));
        if (!!from.official !== !!to.official) rows.push(`<div><b>Official:</b> ${to.official ? 'marked official' : 'no longer official'}</div>`);
        const fa = new Set((from.files || []).map(f => f.id)), fb = new Set((to.files || []).map(f => f.id));
        (to.files || []).filter(f => !fa.has(f.id)).forEach(f => rows.push(`<div><b>File added:</b> ${esc(f.name)}</div>`));
        (from.files || []).filter(f => !fb.has(f.id)).forEach(f => rows.push(`<div><b>File removed:</b> ${esc(f.name)}</div>`));
        const bodyChanged = (from.body || '') !== (to.body || '');
        return `<div class="changes">${rows.join('') || (bodyChanged ? '' : '<div class="muted">No changes to the details.</div>')}</div>
            ${bodyChanged ? `<h3>Content</h3><p class="muted" style="margin:4px 0 8px;font-size:13px"><span class="key del-key">struck out</span> was removed, <span class="key add-key">highlighted</span> was added — word for word, nothing is cut short.</p>${diffHTML(from.body, to.body)}` : ''}`;
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
                    ${staff && v.status === 'pending' ? `<input class="i" id="v-note" placeholder="Note to the author (needed to send back)" style="min-width:260px">${mineToo(v) ? '<span class="muted">Another reviewer or an admin has to approve your own change.</span>' : '<button class="btn primary" data-d="approve">Approve</button>'}<button class="btn" data-d="reject">Send back</button>` : ''}
                    ${staff && ['superseded', 'rejected', 'withdrawn'].includes(v.status) ? `<button class="btn primary" id="v-restore">Restore this version</button>` : ''}
                </div></div>
            <section class="section card"><h2>${compareTo ? 'Changes compared with the current version' : v.status === 'pending' && !live ? 'New entry' : 'Details'}</h2>
                ${compareTo ? changesHTML(compareTo.data, v.data) : `<div class="changes"><div><b>Collection:</b> ${esc(colName(v.data.collection))}${v.data.section ? ' › ' + esc(v.data.section) : ''}</div><div><b>Type:</b> ${esc(v.data.type)}</div>${v.data.tags.length ? `<div><b>Tags:</b> ${esc(v.data.tags.join(', '))}</div>` : ''}</div>`}</section>
            <section class="section"><h2>This version</h2>${v.data.summary ? `<p class="lead">${esc(v.data.summary)}</p>` : ''}${mediaHTML(v.data.files || [], v.data.body)}<div class="md">${window.KBmd.render(v.data.body)}</div></section>`);
        app.querySelectorAll('[data-fold]').forEach(b => b.onclick = () => { b.nextElementSibling.hidden = false; b.remove(); });
        app.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
            try {
                await post(`/api/revisions/${revId}`, { decision: b.dataset.d, note: val('v-note') });
                toast(b.dataset.d === 'approve' ? 'Approved. It’s live now.' : 'Sent back to the author with your note.');
                S.lib = null; location.hash = '#/review';
            } catch (e) { toast(e.message, true); }
        });
        const rb = document.getElementById('v-restore');
        if (rb) rb.onclick = async () => {
            try { const x = await post(`/api/entries/${v.entryId}`, { action: 'restore', revision: revId }); toast(x.status === 'pending' ? 'Sent for approval. The page stays as it is until it’s approved.' : 'Restored. The version it replaced stays in the history.'); S.lib = null; location.hash = `#/e/${v.entryId}`; }
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
            ${!r.entries.length ? `<div class="card"><p>You haven’t added anything yet.</p>${S.session.contributor ? '<a class="btn accent" href="#/new">+ Add to the library</a>' : ''}</div>` : ''}
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
                ${mineToo(v) ? '<span class="muted">Yours: another reviewer or an admin has to approve it.</span>' : `<button class="btn primary" data-rev="${v.id}" data-d="approve">Approve</button>`}<button class="btn" data-rev="${v.id}" data-d="reject">Send back</button></div></div>`;
        const termCard = (c) => `<div class="card"><div class="row"><span class="badge ${c.action === 'add' ? 'pending' : ''}">${{ add: 'New term', edit: 'Edit to a term', delete: 'Removal of a term' }[c.action]}</span></div>
                <h3 style="margin:6px 0 0">${esc(c.term)} <small class="muted">${esc(c.category)}</small></h3>
                <p class="muted" style="margin:0">${esc(c.author)}${c.batch ? ' · ' + esc(c.batch) : ''} · ${fmtWhen(c.createdAt)}</p>
                ${c.action === 'delete' ? `<p style="margin:6px 0 0"><b>Why:</b> ${esc(c.reviewNote)}</p>` : ''}
                ${c.action === 'edit' && c.current ? `<div class="changes"><div><b>Now:</b> ${esc(c.current.definition)}</div><div><b>Suggested:</b> ${esc(c.definition)}</div>${c.example !== c.current.example ? `<div><b>Example:</b> ${esc(c.example) || '(none)'}</div>` : ''}${c.category !== c.current.category ? `<div><b>Category:</b> ${esc(c.current.category)} → ${esc(c.category)}</div>` : ''}${c.term !== c.current.term ? `<div><b>Term:</b> ${esc(c.current.term)} → ${esc(c.term)}</div>` : ''}</div>`
                    : c.action === 'add' ? `<p style="margin:6px 0 0">${esc(c.definition)}</p>${c.example ? `<p class="muted"><i>${esc(c.example)}</i></p>` : ''}` : ''}
                <div class="row" style="margin-top:10px"><input class="i" data-tnote="${c.id}" placeholder="Note to the author (needed to send back)" style="flex:1;min-width:220px">
                    ${mineToo(c) ? '<span class="muted">Yours: another reviewer or an admin has to approve it.</span>' : `<button class="btn primary" data-term="${c.id}" data-d="approve">${c.action === 'delete' ? 'Remove the term' : 'Approve'}</button>`}<button class="btn" data-term="${c.id}" data-d="reject">Send back</button></div></div>`;
        view(`<h1>Review queue</h1><p class="muted" style="margin-top:0">New entries, suggested edits, Glossary changes and notes from tenured team members. Approving makes them live; the history keeps every version. You can’t approve your own change.</p>
            ${!r.revisions.length && !r.comments.length && !r.terms.length ? '<div class="card"><p>Nothing is waiting. 🎉</p></div>' : ''}
            ${r.terms.length ? `<section class="section"><h2>Glossary changes (${r.terms.length})</h2><div class="queue">${r.terms.map(termCard).join('')}</div></section>` : ''}
            ${newOnes.length ? `<section class="section"><h2>New entries (${newOnes.length})</h2><div class="queue">${newOnes.map(card).join('')}</div></section>` : ''}
            ${edits.length ? `<section class="section"><h2>Suggested edits (${edits.length})</h2><div class="queue">${edits.map(card).join('')}</div></section>` : ''}
            ${r.comments.length ? `<section class="section"><h2>Comments (${r.comments.length})</h2><div class="queue">${r.comments.map(c => `<div class="card">
                <p class="muted" style="margin:0 0 6px">${c.kind === 'update' ? '<span class="badge">Update to current info</span> ' : ''}${esc(c.author)}${c.batch ? ' · ' + esc(c.batch) : ''} on <a href="#/e/${c.entryId}">${esc(c.entryTitle)}</a> · ${fmtWhen(c.createdAt)}</p>
                <div class="md">${window.KBmd.render(c.body)}</div>
                <div class="row" style="margin-top:8px"><button class="btn small primary" data-cm="${c.id}" data-d="approve">Approve</button><button class="btn small" data-cm="${c.id}" data-d="reject">Don’t publish</button></div></div>`).join('')}</div></section>` : ''}`);
        app.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
            const note = (app.querySelector(`[data-note="${b.dataset.rev}"]`) || {}).value || '';
            try { await post(`/api/revisions/${b.dataset.rev}`, { decision: b.dataset.d, note }); toast(b.dataset.d === 'approve' ? 'Approved.' : 'Sent back with your note.'); S.lib = null; review(); }
            catch (e) { toast(e.message, true); }
        });
        app.querySelectorAll('[data-term]').forEach(b => b.onclick = async () => {
            const note = (app.querySelector(`[data-tnote="${b.dataset.term}"]`) || {}).value || '';
            try { await post('/api/glossary', { action: 'review', id: Number(b.dataset.term), decision: b.dataset.d, note }); toast(b.dataset.d === 'approve' ? 'Approved.' : 'Sent back with your note.'); S.lib = null; review(); }
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
            ${S.session && S.session.codeLogin ? `            <section class="section card"><h2>Team access code</h2>
                <p>${r.codeSet ? `VAs open the library with the team access code. Last changed ${fmtWhen(r.codeChangedAt) || 'earlier'}. Changing it signs every VA out until they enter the new code.` : '<b>No code is set, so VAs can’t get in yet.</b> Set one and share it with the community.'}</p>
                <form class="row" id="code-form"><label class="sr" for="code">New code</label><input class="i" id="code" type="text" minlength="6" maxlength="64" placeholder="At least 6 characters" style="max-width:280px" autocomplete="off">
                    <button class="btn primary" type="submit">${r.codeSet ? 'Change the code' : 'Set the code'}</button></form>
                <p class="muted" style="font-size:13px">This is the same code as the Knowledge Base in the LSH Training Portal.</p></section>` : ''}
            <section class="section card"><h2>Who can add to the library</h2>
                <p class="muted" style="margin-top:0"><b>Info Access</b> is the default for everyone who opens the Knowledge Base from the Portal: they can read, search and play videos, and nothing else. <b>Tenured</b> team members are the only ones who can add or edit: new entries, edits, Glossary terms and update notes, and every one waits for approval. <b>Reviewers</b> are trusted VAs who approve other people’s changes (never their own; their own edits wait for another reviewer or an admin) and can archive. Only admins’ own edits go live at once, and only admins can mark entries official, delete permanently or change settings. Type the name exactly as it shows in the LSH Training Portal.</p>
                ${r.roles.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Batch</th><th>Access</th><th>Added</th><th></th></tr></thead><tbody>${r.roles.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.batch)}</td><td>${x.role === 'tenured' ? 'Tenured' : 'Reviewer'}</td><td>${fmtDate(x.grantedAt)} by ${esc(x.grantedBy || '')}</td><td><button class="btn small danger" data-revoke="${esc(x.key)}">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<p>Nobody has tenured or reviewer access yet: everyone has Info Access.</p>'}
                <form class="row" id="rev-form" style="margin-top:10px"><input class="i" id="rev-name" placeholder="Full name, as in the Portal" style="max-width:260px"><input class="i" id="rev-batch" placeholder="Batch, as in the Portal" style="max-width:180px"><select class="i" id="rev-role" style="max-width:150px"><option value="tenured">Tenured</option><option value="reviewer">Reviewer</option></select><button class="btn" type="submit">Give access</button></form></section>
            <section class="section card"><h2>Collections</h2>
                <p class="muted" style="margin-top:0">The library’s shelves. Lower numbers show first. Archiving a collection hides it from the home page; its entries stay.</p>
                <div class="row" style="margin-bottom:10px"><button class="btn" id="hide-empty">Remove the empty collections</button>
                    ${r.collections.filter(c => c.archived).length ? `<label class="muted"><input type="checkbox" id="show-arch"> Show ${r.collections.filter(c => c.archived).length} removed (archived)</label>` : ''}<span class="muted" id="hide-empty-status"></span></div>
                <div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>Description</th><th>Order</th><th>Entries</th><th>Archived</th><th></th></tr></thead><tbody>
                ${r.collections.map(c => `<tr data-col="${c.slug}"${c.archived ? ' class="arch" hidden' : ''}><td><input class="i" data-k="name" value="${esc(c.name)}"></td><td><input class="i" data-k="blurb" value="${esc(c.blurb)}"></td>
                    <td><input class="i" data-k="sort" type="number" value="${c.sort}" style="width:80px"></td><td>${c.count}</td><td><input type="checkbox" data-k="archived"${c.archived ? ' checked' : ''} aria-label="Archived"></td>
                    <td><button class="btn small" data-save="${c.slug}">Save</button></td></tr>`).join('')}
                <tr data-col=""><td><input class="i" data-k="name" placeholder="New collection"></td><td><input class="i" data-k="blurb" placeholder="What goes in it"></td><td><input class="i" data-k="sort" type="number" value="${(r.collections.length + 1) * 10}" style="width:80px"></td><td></td><td></td><td><button class="btn small primary" data-save="">Add</button></td></tr>
                </tbody></table></div></section>
            <section class="section card"><h2>Storage and backup</h2>
                <p>${plural(r.storage.files, 'file')} stored, ${fmtSize(r.storage.bytes)} in all. Files are kept in the <code>lshtraining</code> R2 bucket under <code>kb/files/</code>.</p>
                <a class="btn" href="/api/admin/export">Download a backup of every entry and version (JSON)</a></section>`);
        const codeForm = document.getElementById('code-form');   // not drawn when the team access code sign-in is off
        if (codeForm) codeForm.onsubmit = async (ev) => {
            ev.preventDefault();
            try { await post('/api/admin', { action: 'set-code', code: val('code') }); toast('Team access code saved.'); admin(); } catch (e) { toast(e.message, true); }
        };
        document.getElementById('rev-form').onsubmit = async (ev) => {
            ev.preventDefault();
            try { await post('/api/admin', { action: 'grant-role', role: val('rev-role'), name: val('rev-name'), batch: val('rev-batch') }); toast('Access saved.'); admin(); } catch (e) { toast(e.message, true); }
        };
        app.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
            try { await post('/api/admin', { action: 'revoke-reviewer', key: b.dataset.revoke }); admin(); } catch (e) { toast(e.message, true); }
        });
        const sa = document.getElementById('show-arch');
        if (sa) sa.onchange = () => app.querySelectorAll('tr.arch').forEach(tr => { tr.hidden = !sa.checked; });
        document.getElementById('hide-empty').onclick = async () => {
            try { const x = await post('/api/admin', { action: 'archive-empty' }); toast(x.archived ? `Removed ${plural(x.archived, 'empty collection')}.` : 'There are no empty collections.'); S.lib = null; admin(); } catch (e) { toast(e.message, true); }
        };
        app.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
            const tr = b.closest('tr'), get = (k) => tr.querySelector(`[data-k="${k}"]`);
            try {
                await post('/api/admin', { action: 'save-collection', slug: tr.dataset.col, name: get('name').value, blurb: get('blurb').value, sort: get('sort').value, archived: get('archived') ? get('archived').checked : false });
                toast('Collection saved.'); S.lib = null; admin();
            } catch (e) { toast(e.message, true); }
        });
    }


    route();
})();
