/* =========================================================
   🧭 LSH BLUEPRINT — the same file on every LSH platform (change it in one, copy it to all)
   A full-screen slide deck that explains a platform, in two versions (three where a platform has an Admin deck):
   - the Trainee blueprint, for trainees;
   - the Trainer blueprint, for admins only;
   - the Admin blueprint (optional), for whoever canAdmin() says: the person who runs the platform itself.
   Trainees (and an admin in Trainee view) get the trainee deck only; admins get both as tabs,
   so they can share the Trainee blueprint in Google Meet. ◀ ▶, the ← → keys or the contents strip
   move through it; Esc closes it. ⬇ Download PDF saves the deck that's showing: a landscape PDF,
   one page a slide, real text (jsPDF from cdnjs, loaded the first time). The PDF is made from the
   deployed platform each time, and its cover and footers carry the platform's version, so a new
   deploy always gives an up-to-date PDF.

   Each platform sets window.LSH_BLUEPRINT (its blueprint-content.js) before or after this file:
     product   the platform's name on the cover, e.g. "Case Management System"
     site      the footer line, e.g. "LSH Case Management System"
     file      the PDF file name's start, e.g. "LSH_CMS" → LSH_CMS_Blueprint_Trainee.pdf
     logo      an image for the navy cover band (the white-lettered LSH logo, or with brand: the LSH mark)
     brand     optional: the name shown as real text under the logo, e.g. "Legal Support Help" (sharp at any
               size; a name drawn into the logo image blurs when it's scaled down)
     trainee   { sub, slides } or null      trainer   { sub, slides } or null
     admin     { sub, slides } or null (optional), shown only when canAdmin() returns true
               a slide is { icon, title, points: [...], where, tip, shot, shotAlt }
               shot (optional): a screenshot of the platform for that slide (a .jpg or .png path), shown
               beside the points and in the PDF; a click on it shows it full size. shotAlt describes it.
     canAdmin()   optional: may this admin see the Admin blueprint? (no function: nobody does)
     role()    'trainer' (an admin, not in Trainee view), 'trainee', or null (signed out)
     version() the platform's version (a string, or a Promise of one)
     mount(html)  optional: puts the "🧭 Blueprint" button (html) where the platform wants it
     traineeTab   optional { label, open() }: the trainee deck lives elsewhere (the courses'
                  Orientation); the tab calls open() instead of showing a deck
   Numbering: the cover is the Cover (★); the slides are 1 to n, the same on the buttons, the counter, the
   slide's kicker and footer, and the PDF's footers.
   API: LSHBlueprint.open('admin'|'trainer'|'trainee'), .close(), .go(n, absolute), .deck(which), .pdf(), .zoom(src)
   ========================================================= */
(function () {
    'use strict';
    if (window.LSHBlueprint) return;
    const $id = (id) => document.getElementById(id);
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const cfg = () => window.LSH_BLUEPRINT || {};
    const role = () => { try { return (cfg().role && cfg().role()) || null; } catch (e) { return null; } };
    const NAMES = { trainee: 'Trainee blueprint', trainer: 'Trainer blueprint', admin: 'Admin blueprint' };
    const FILES = { trainee: 'Trainee', trainer: 'Trainer', admin: 'Admin' };
    const canAdmin = () => { try { return typeof cfg().canAdmin === 'function' && !!cfg().canAdmin(); } catch (e) { return false; } };
    const deckOf = (which) => { const d = cfg()[which]; return d && d.slides && d.slides.length ? Object.assign({ key: which, name: NAMES[which] }, d) : null; };
    let cur = 'trainee', at = 0, version = '';

    const CSS = `
    #lbp-page{position:fixed;inset:0;z-index:100000;display:none;flex-direction:column;background:#e9eef5;font-family:Inter,'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:#1e293b}
    #lbp-page.open{display:flex}
    #lbp-page *{box-sizing:border-box}
    .lbp-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;background:#0f2148;color:#fff;padding:14px 24px;border-bottom:4px solid #f97316}
    .lbp-top h2{margin:0;font-size:19px;font-weight:800;color:#fff;font-family:inherit;letter-spacing:.01em;line-height:1.2}
    .lbp-top .lbp-sub{font-size:11.5px;color:#f97316;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
    .lbp-top button{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25);padding:9px 14px;border-radius:7px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;font-family:inherit}
    .lbp-top button:hover{background:rgba(255,255,255,.16)}
    .lbp-top button:disabled{opacity:.6;cursor:default}
    #lbp-tabs{display:flex;gap:2px;background:#e2e8f0;padding:0 20px;flex-shrink:0;overflow-x:auto}
    #lbp-tabs button{padding:12px 18px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#64748b;cursor:pointer;border:0;border-bottom:3px solid transparent;background:none;white-space:nowrap;font-family:inherit}
    #lbp-tabs button.on{color:#f97316;border-bottom-color:#f97316;background:#f8fafc}
    #lbp-body{flex:1;min-height:0;display:flex;flex-direction:column;padding:18px 22px 12px;gap:12px}
    #lbp-stage{flex:1;min-height:0;position:relative;overflow:hidden}
    #lbp-slide{position:absolute;left:50%;top:50%;transform-origin:center center;background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(15,33,72,.16);overflow:hidden;color:#1e293b;text-align:left}
    #lbp-nav{display:flex;align-items:center;justify-content:center;gap:10px;flex-shrink:0;flex-wrap:wrap}
    #lbp-nav>button{width:40px;height:34px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#0f2148;font-size:13px;font-weight:800;cursor:pointer}
    #lbp-nav>button:disabled{opacity:.35;cursor:default}
    #lbp-count{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;font-weight:700;color:#475569;min-width:52px;text-align:center;white-space:nowrap}
    #lbp-toc{display:flex;gap:4px;flex-wrap:wrap;justify-content:center}
    #lbp-toc button{min-width:26px;height:26px;padding:0 6px;border-radius:6px;border:1px solid #cbd5e1;background:#fff;color:#475569;font-size:11px;font-weight:800;cursor:pointer}
    #lbp-toc button.on{background:#0f2148;border-color:#0f2148;color:#fff;box-shadow:inset 0 -2px 0 #f97316}
    #lbp-slide .lbp-kicker{color:#f97316;font-size:15px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    #lbp-slide .lbp-label{color:#0f2148;font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
    #lbp-slide h1{font-family:inherit;letter-spacing:normal;text-transform:none}
    #lbp-slide li,#lbp-slide p,#lbp-slide div{font-weight:inherit}
    #lbp-slide{font-weight:500}
    .lbp-cover{height:100%;display:flex;flex-direction:column}
    .lbp-cover-top{display:flex;align-items:center;gap:48px;background:#0f2148;border-bottom:6px solid #f97316;padding:46px 70px 42px}
    .lbp-cover-logo{height:128px;width:auto;display:block;flex-shrink:0}
    .lbp-brand{display:flex;flex-direction:column;align-items:center;gap:12px;flex-shrink:0}
    .lbp-brand img{height:112px;width:auto;display:block}
    #lbp-slide .lbp-brand-name{color:#fff;font-size:17px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;line-height:1.1;-webkit-font-smoothing:antialiased}
    .lbp-cover h1{margin:8px 0 0;color:#fff;font-size:50px;font-weight:800;letter-spacing:.01em;line-height:1.1}
    .lbp-cover-body{flex:1;min-height:0;padding:34px 70px 24px;display:flex;flex-direction:column}
    .lbp-cover-sub{margin:0 0 26px;font-size:26px;color:#334155;font-weight:600}
    .lbp-contents{list-style:none;margin:0;padding:0;columns:2;column-gap:50px;flex:1}
    .lbp-contents li{break-inside:avoid;display:flex;align-items:center;gap:14px;font-size:calc(22px * var(--lbp-k,1));color:#1e293b;margin-bottom:calc(15px * var(--lbp-k,1))}
    .lbp-contents li span{flex:0 0 auto;width:calc(32px * var(--lbp-k,1));height:calc(28px * var(--lbp-k,1));border-radius:6px;background:#f97316;color:#fff;font-size:calc(15px * var(--lbp-k,1));font-weight:800;display:flex;align-items:center;justify-content:center}
    .lbp-version{font-size:14px;font-weight:700;color:#94a3b8;letter-spacing:.03em}
    .lbp-card{height:100%;display:flex;flex-direction:column}
    .lbp-head{display:flex;align-items:center;gap:24px;background:#0f2148;padding:30px 52px 28px;border-bottom:6px solid #f97316}
    .lbp-head h1{margin:6px 0 0;color:#fff;font-size:40px;font-weight:800;line-height:1.15}
    .lbp-icon{flex:0 0 auto;width:78px;height:78px;border-radius:18px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-size:42px}
    .lbp-main{flex:1;min-height:0;display:flex;gap:44px;padding:40px 52px 22px}
    .lbp-points{flex:1;list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:calc(22px * var(--lbp-k,1))}
    .lbp-points li{position:relative;padding-left:32px;font-size:calc(26px * var(--lbp-k,1));line-height:1.38;color:#1e293b}
    .lbp-points li::before{content:'';position:absolute;left:0;top:.5em;width:11px;height:11px;border-radius:2px;background:#f97316}
    .lbp-side{flex:0 0 360px;display:flex;flex-direction:column;gap:20px}
    .lbp-where,.lbp-tip{border-radius:12px;padding:calc(22px * var(--lbp-k,1)) 24px;font-size:calc(21px * var(--lbp-k,1));line-height:1.42;color:#1e293b}
    .lbp-where{background:#f1f5f9;border:1px solid #e2e8f0}
    .lbp-tip{background:#fff7ed;border:1px solid #fed7aa;border-left:6px solid #f97316}
    #lbp-slide .lbp-tip .lbp-label{color:#c2410c}
    .lbp-main.lbp-has-shot{gap:36px}
    .lbp-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;gap:calc(20px * var(--lbp-k,1))}
    .lbp-col.lbp-col-shot{flex:0 0 calc(560px * var(--lbp-k,1))}
    .lbp-col .lbp-points{flex:1 1 auto}
    .lbp-col .lbp-side{flex:0 0 auto}
    .lbp-shot{margin:0;display:block;border-radius:10px;overflow:hidden;border:1px solid #cbd5e1;box-shadow:0 6px 18px rgba(15,33,72,.14);cursor:zoom-in;background:#f8fafc;position:relative}
    .lbp-shot img{display:block;width:100%;height:auto}
    .lbp-shot span{position:absolute;right:8px;bottom:8px;background:rgba(15,33,72,.82);color:#fff;font-size:12px;font-weight:800;letter-spacing:.04em;padding:5px 9px;border-radius:6px}
    #lbp-zoom{position:absolute;inset:0;z-index:5;display:none;align-items:center;justify-content:center;background:rgba(15,33,72,.94);cursor:zoom-out;padding:44px 20px 16px}
    #lbp-zoom.open{display:flex}
    #lbp-zoom img{max-width:100%;max-height:100%;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.4);background:#fff}
    #lbp-zoom span{position:absolute;top:14px;right:20px;color:#fff;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
    .lbp-foot{display:flex;justify-content:space-between;gap:20px;padding:14px 52px 18px;border-top:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#94a3b8;letter-spacing:.04em}
    #lbp-slide.portrait .lbp-head{padding:28px 34px;gap:18px}
    #lbp-slide.portrait .lbp-head h1{font-size:36px}
    #lbp-slide.portrait .lbp-main{flex-direction:column;padding:28px 34px 16px;gap:22px}
    #lbp-slide.portrait .lbp-points li{font-size:calc(23px * var(--lbp-k,1))}
    #lbp-slide.portrait .lbp-side{flex:0 0 auto}
    #lbp-slide.portrait .lbp-col,#lbp-slide.portrait .lbp-col.lbp-col-shot{flex:0 0 auto}
    .lbp-shot .lbp-shot-btn{display:none}
    #lbp-slide.portrait .lbp-shot{background:#0f2148;border-color:#0f2148;box-shadow:none}
    #lbp-slide.portrait .lbp-shot img,#lbp-slide.portrait .lbp-shot .lbp-shot-hint{display:none}
    #lbp-slide.portrait .lbp-shot .lbp-shot-btn{display:block;position:static;background:none;padding:14px 16px;font-size:19px;text-align:center}
    #lbp-slide.portrait .lbp-foot{padding:12px 34px 16px}
    #lbp-slide.portrait .lbp-cover-top{flex-direction:column;align-items:flex-start;gap:24px;padding:40px 36px 34px}
    #lbp-slide.portrait .lbp-brand img{height:96px}
    #lbp-slide.portrait .lbp-cover h1{font-size:40px}
    #lbp-slide.portrait .lbp-cover-body{padding:30px 36px}
    #lbp-slide.portrait .lbp-cover-sub{font-size:23px}
    #lbp-slide.portrait .lbp-contents{columns:1}
    #lbp-slide.portrait .lbp-contents li{font-size:calc(21px * var(--lbp-k,1));margin-bottom:calc(12px * var(--lbp-k,1))}
    @media (max-width:760px){.lbp-top{padding:12px 14px}.lbp-top h2{font-size:16px}#lbp-body{padding:10px 10px 8px}#lbp-toc{display:none}}
    @media print{#lbp-page{display:none!important}}`;

    function build() {
        if ($id('lbp-page')) return;
        const st = document.createElement('style'); st.id = 'lbp-css'; st.textContent = CSS; document.head.appendChild(st);
        document.body.insertAdjacentHTML('beforeend', `
        <div id="lbp-page" class="no-print" role="dialog" aria-label="Blueprint">
            <div class="lbp-top">
                <div><h2 id="lbp-title">Blueprint</h2><div class="lbp-sub" id="lbp-sub"></div></div>
                <div style="display:flex;gap:10px;align-items:center">
                    <button id="lbp-pdf-btn" type="button" onclick="LSHBlueprint.pdf()">⬇ Download PDF</button>
                    <button id="lbp-close" type="button" onclick="LSHBlueprint.close()">✕ Close</button>
                </div>
            </div>
            <div id="lbp-tabs"></div>
            <div id="lbp-body">
                <div id="lbp-stage"><div id="lbp-slide"></div></div>
                <div id="lbp-nav">
                    <button id="lbp-prev" type="button" onclick="LSHBlueprint.go(-1)" aria-label="Previous slide">◀</button>
                    <div id="lbp-toc"></div>
                    <span id="lbp-count"></span>
                    <button id="lbp-next" type="button" onclick="LSHBlueprint.go(1)" aria-label="Next slide">▶</button>
                </div>
            </div>
            <div id="lbp-zoom" role="dialog" aria-label="Screenshot, full size" onclick="LSHBlueprint.zoom()"><img alt=""><span>✕ Close · Esc</span></div>
        </div>`);
        if (window.ResizeObserver) new ResizeObserver(() => fit()).observe($id('lbp-stage'));
        window.addEventListener('resize', fit);
    }

    // the sidebar / top-bar button, where the platform puts it
    function mount() {
        const c = cfg();
        if (typeof c.mount === 'function' && !$id('lbp-open-btn')) {
            try { c.mount(`<button id="lbp-open-btn" type="button" onclick="LSHBlueprint.open()">🧭 Blueprint</button>`); } catch (e) { /* the page isn't ready for it yet */ }
        }
        const b = $id('lbp-open-btn'); if (b) b.style.display = role() ? '' : 'none';
    }

    function slideHtml(d, i) {
        const total = d.slides.length + 1, c = cfg();
        if (i === 0) {
            return `<div class="lbp-cover">
                <div class="lbp-cover-top">
                    ${c.logo && c.brand ? `<div class="lbp-brand" role="img" aria-label="${esc(c.brand)}"><img src="${esc(c.logo)}" alt=""><div class="lbp-brand-name">${esc(c.brand)}</div></div>`
                      : c.logo ? `<img src="${esc(c.logo)}" alt="Legal Support Help" class="lbp-cover-logo">` : ''}
                    <div><div class="lbp-kicker">${esc(d.name)}</div><h1>${esc(c.product || 'LSH Platform')}</h1></div>
                </div>
                <div class="lbp-cover-body">
                    <p class="lbp-cover-sub">${esc(d.sub || '')}</p>
                    <ol class="lbp-contents">${d.slides.map((s, k) => `<li><span>${k + 1}</span>${esc(s.title)}</li>`).join('')}</ol>
                    <div class="lbp-version">${version ? 'Version ' + esc(version) : ''}</div>
                </div>
            </div>`;
        }
        const s = d.slides[i - 1];
        const points = `<ul class="lbp-points">${(s.points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
        const where = s.where ? `<div class="lbp-where"><div class="lbp-label">Where to find it</div>${esc(s.where)}</div>` : '';
        const tip = s.tip ? `<div class="lbp-tip"><div class="lbp-label">Tip</div>${esc(s.tip)}</div>` : '';
        // with a screenshot: the points and the tip on the left; the screenshot and where to find it on the right
        const main = s.shot
            ? `<div class="lbp-main lbp-has-shot">
                <div class="lbp-col">${points}${tip ? `<div class="lbp-side">${tip}</div>` : ''}</div>
                <div class="lbp-col lbp-col-shot">
                    <figure class="lbp-shot" title="Click to see it full size" onclick="LSHBlueprint.zoom(this.querySelector('img').getAttribute('src'))"><img src="${esc(s.shot)}" alt="${esc(s.shotAlt || 'A screenshot: ' + s.title)}"><span class="lbp-shot-hint">🔍 Click to enlarge</span><span class="lbp-shot-btn">🖼 See the screen</span></figure>
                    ${where ? `<div class="lbp-side">${where}</div>` : ''}
                </div>
            </div>`
            : `<div class="lbp-main">${points}<div class="lbp-side">${where}${tip}</div></div>`;
        return `<div class="lbp-card">
            <div class="lbp-head">
                <div class="lbp-icon">${esc(s.icon || '•')}</div>
                <div><div class="lbp-kicker">${esc(d.name)} · ${i} of ${total - 1}</div><h1>${esc(s.title)}</h1></div>
            </div>
            ${main}
            <div class="lbp-foot"><span>${esc(c.site || '')}</span><span>${i} / ${total - 1}</span></div>
        </div>`;
    }

    // The slide is laid out at a fixed size (landscape, or portrait on a narrow screen) and scaled to fit.
    function fit() {
        const stage = $id('lbp-stage'), slide = $id('lbp-slide'), page = $id('lbp-page');
        if (!stage || !slide || !page || !page.classList.contains('open')) return;
        const W = stage.clientWidth, H = stage.clientHeight;
        const portrait = W < 760;
        const BW = portrait ? 620 : 1280, BH = portrait ? 1000 : 720;
        slide.classList.toggle('portrait', portrait);
        slide.style.width = BW + 'px'; slide.style.height = BH + 'px';
        slide.style.transform = `translate(-50%, -50%) scale(${Math.max(0.1, Math.min(W / BW, H / BH))})`;
        // a slide with a lot to say: its text gets a little smaller until it all fits (down to 70%; a long
        // deck's cover, which is only its contents, down to 50%)
        const main = slide.querySelector('.lbp-main, .lbp-cover-body');
        const floor = main && main.classList.contains('lbp-cover-body') ? 0.5 : 0.7;
        let k = 1; slide.style.setProperty('--lbp-k', '1');
        const parts = main ? [...main.children, ...main.querySelectorAll('.lbp-points, .lbp-side')] : [];
        while (main && k > floor && (main.scrollHeight > main.clientHeight + 1 || parts.some(e => e.scrollHeight > e.clientHeight + 1))) {
            k = Math.round((k - 0.05) * 100) / 100; slide.style.setProperty('--lbp-k', String(k));
        }
    }

    // which decks this person may see
    function allowed() {
        const r = role(), out = [];
        if (r === 'trainer' && deckOf('admin') && canAdmin()) out.push('admin');
        if (r === 'trainer' && deckOf('trainer')) out.push('trainer');
        if (r && (deckOf('trainee') || (r === 'trainer' && cfg().traineeTab))) out.push('trainee');
        return out;
    }

    function paint() {
        const d = deckOf(cur); if (!d) return;
        const total = d.slides.length + 1;
        at = Math.max(0, Math.min(total - 1, at));
        const slide = $id('lbp-slide');
        slide.innerHTML = slideHtml(d, at); slide.dataset.deck = d.key;
        // the cover is ★ Cover; the slides are 1 to n, as on the buttons and the slides themselves
        $id('lbp-count').textContent = at === 0 ? `Cover · ${total - 1} slides` : `${at} / ${total - 1}`;
        $id('lbp-count').title = at === 0 ? 'The cover and contents' : `Slide ${at} of ${total - 1}`;
        API.zoom();
        $id('lbp-prev').disabled = at === 0; $id('lbp-next').disabled = at === total - 1;
        $id('lbp-toc').innerHTML = ['Cover'].concat(d.slides.map(s => s.title)).map((t, k) =>
            `<button type="button" class="${k === at ? 'on' : ''}" title="${esc(t)}" onclick="LSHBlueprint.go(${k}, true)">${k === 0 ? '★' : k}</button>`).join('');
        $id('lbp-title').textContent = (cfg().product || 'Platform') + ' Blueprint';
        $id('lbp-sub').textContent = d.name + (version ? ' · ' + version : '');
        const tabs = allowed();
        $id('lbp-tabs').style.display = tabs.length > 1 ? '' : 'none';
        $id('lbp-tabs').innerHTML = tabs.map(k => `<button type="button" data-deck="${k}" class="${k === cur ? 'on' : ''}" onclick="LSHBlueprint.deck('${k}')">${esc(k === 'trainee' && !deckOf('trainee') ? (cfg().traineeTab.label || NAMES.trainee) : NAMES[k])}</button>`).join('');
        fit();
    }

    async function loadVersion() {
        try { const v = cfg().version ? await cfg().version() : ''; version = v ? String(v) : ''; } catch (e) { version = ''; }
        if ($id('lbp-page') && $id('lbp-page').classList.contains('open')) paint();
    }

    const API = {
        open(which) {
            const tabs = allowed(); if (!tabs.length) return false;
            build();
            cur = which && tabs.includes(which) ? which : tabs[0];
            if (cur === 'trainee' && !deckOf('trainee')) { cfg().traineeTab.open(); return true; }
            at = 0;
            $id('lbp-page').classList.add('open');
            document.documentElement.classList.add('lbp-open');
            paint(); loadVersion();
            return true;
        },
        close() {
            const p = $id('lbp-page'); if (!p) return;
            p.classList.remove('open'); document.documentElement.classList.remove('lbp-open');
        },
        deck(which) {
            if (!allowed().includes(which)) return;
            if (which === 'trainee' && !deckOf('trainee')) { API.close(); cfg().traineeTab.open(); return; }
            cur = which; at = 0; paint();
        },
        go(n, absolute) { at = absolute ? n : at + n; paint(); },
        // a slide's screenshot, full size over the slide (no src, or a click on it: closes it)
        zoom(src) {
            const z = $id('lbp-zoom'); if (!z) return;
            if (src) { z.querySelector('img').src = src; z.classList.add('open'); } else z.classList.remove('open');
        },
        zoomed() { const z = $id('lbp-zoom'); return !!(z && z.classList.contains('open')); },
        isOpen() { const p = $id('lbp-page'); return !!(p && p.classList.contains('open')); },
        current() { return { deck: cur, slide: at }; },
        pdf: (which) => makePdf(which),
        decks: () => ({ trainee: deckOf('trainee'), trainer: deckOf('trainer'), admin: deckOf('admin') }),
        refresh: mount
    };
    window.LSHBlueprint = API;

    document.addEventListener('keydown', (e) => {
        if (!API.isOpen()) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); API.go(1); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); API.go(-1); }
        else if (e.key === 'Escape') { if (API.zoomed()) API.zoom(); else API.close(); }
    });

    /* ---------- the PDF (jsPDF, real text) ---------- */
    const JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js';
    let JsPDF = null;
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the PDF maker. Check your connection and try again.'));
            document.head.appendChild(s);
        });
    }
    // Our own jsPDF, whatever else the page has on window.jspdf (html2pdf bundles its own).
    async function loadJsPdf() {
        if (JsPDF) return JsPDF;
        const before = window.jspdf;
        await loadScript(JSPDF_SRC);
        JsPDF = window.jspdf && window.jspdf.jsPDF;
        if (before !== undefined) window.jspdf = before;
        if (!JsPDF) throw new Error('The PDF maker did not load. Try again.');
        return JsPDF;
    }
    // The built-in PDF fonts cover Windows-1252 only: drop the emoji, keep the words.
    const clean = (s) => String(s == null ? '' : s).replace(/→/g, '->').replace(/⇄/g, '<->').replace(/⇦/g, '<-')
        .replace(/[^\x00-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '').replace(/\(\s+/g, '(').replace(/ {2,}/g, ' ').trim();
    const NAVY = [15, 33, 72], ORANGE = [249, 115, 22], INK = [30, 41, 59], MUTED = [100, 116, 139], SOFT = [241, 245, 249], LINE = [226, 232, 240];
    async function imageData(src) {
        if (!src) return null;
        try {
            const blob = await (await fetch(src)).blob();
            return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => r(null); f.readAsDataURL(blob); });
        } catch (e) { return null; }
    }
    const today = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // an image's size in the PDF: w x h fitted inside a box, keeping its shape
    function fitImage(doc, data, boxW, boxH) {
        let r = boxW / boxH;
        try { const p = doc.getImageProperties(data); if (p.width && p.height) r = p.width / p.height; } catch (e) { /* the box's shape */ }
        return r > boxW / boxH ? { w: boxW, h: boxW / r } : { w: boxH * r, h: boxH };
    }
    // by the file's first bytes, whatever type the server gave it (JPEG starts /9j/ in base64)
    const imgType = (data) => /^data:[^,]*,\/9j\//.test(data) || /^data:image\/jpe?g/i.test(data) ? 'JPEG' : 'PNG';

    function buildPdf(d, logo, shots) {
        shots = shots || [];
        const c = cfg();
        const doc = new JsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape', compress: true });
        const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 46;
        const total = d.slides.length + 1;
        const font = (size, style, color) => { doc.setFont('helvetica', style || 'normal'); doc.setFontSize(size); doc.setTextColor(...(color || INK)); };
        const stamp = clean(`${version ? 'Version ' + version + ' · ' : ''}made ${today()}`);
        const footer = (i) => {
            doc.setDrawColor(...LINE); doc.setLineWidth(0.6); doc.line(M, H - 34, W - M, H - 34);
            font(8, 'normal', MUTED);
            doc.text(clean(`${c.site || ''} · ${d.name} · ${stamp}`), M, H - 20);
            doc.text(i === 0 ? 'Cover' : `${i} / ${total - 1}`, W - M, H - 20, { align: 'right' });
        };
        // the cover
        doc.setFillColor(...NAVY); doc.rect(0, 0, W, 150, 'F');
        doc.setFillColor(...ORANGE); doc.rect(0, 150, W, 5, 'F');
        let tx = M;
        if (logo && c.brand) {
            // the mark, and the name as text under it (as on the page)
            try {
                const f = fitImage(doc, logo, 120, 74), bw = Math.max(f.w, 130);
                doc.addImage(logo, imgType(logo), M + (bw - f.w) / 2, 26, f.w, f.h);
                font(9.5, 'bold', [255, 255, 255]); doc.text(clean(c.brand).toUpperCase(), M + bw / 2, 26 + f.h + 20, { align: 'center', charSpace: 0.9 });
                tx = M + bw + 30;
            } catch (e) { /* the cover works without it */ }
        } else if (logo) { try { const f = fitImage(doc, logo, 136, 85); doc.addImage(logo, imgType(logo), M, 32 + (85 - f.h) / 2, f.w, f.h); tx = M + f.w + 20; } catch (e) { /* the cover works without it */ } }
        font(11, 'bold', ORANGE); doc.text(clean(d.name).toUpperCase(), tx, 70, { charSpace: 1.2 });
        font(26, 'bold', [255, 255, 255]); doc.text(clean(c.product || 'LSH Platform'), tx, 102);
        font(13, 'normal', INK); doc.text(doc.splitTextToSize(clean(d.sub || ''), W - 2 * M), M, 190);
        font(10, 'bold', MUTED); doc.text('CONTENTS', M, 228, { charSpace: 1 });
        const half = Math.ceil(d.slides.length / 2), colW = (W - 2 * M - 30) / 2;
        d.slides.forEach((s, k) => {
            const x = k < half ? M : M + colW + 30, y = 254 + (k % half) * 26;
            doc.setFillColor(...ORANGE); doc.roundedRect(x, y - 12, 18, 16, 3, 3, 'F');
            font(9, 'bold', [255, 255, 255]); doc.text(String(k + 1), x + 9, y - 1, { align: 'center' });
            font(12, 'normal', INK); doc.text(clean(s.title), x + 28, y);
        });
        font(10, 'normal', MUTED); doc.text(stamp, M, H - 52);
        footer(0);
        // one page a slide
        d.slides.forEach((s, k) => {
            doc.addPage();
            doc.setFillColor(...NAVY); doc.rect(0, 0, W, 92, 'F');
            doc.setFillColor(...ORANGE); doc.rect(0, 92, W, 4, 'F');
            font(9.5, 'bold', ORANGE); doc.text(clean(`${d.name} · ${k + 1} of ${d.slides.length}`).toUpperCase(), M, 38, { charSpace: 1 });
            font(23, 'bold', [255, 255, 255]); doc.text(clean(s.title), M, 70);
            // a box: Where to find it, or the Tip (draw false: only measure it)
            const box = (label, text, x, top, bw, fill, stripe, draw) => {
                font(12, 'normal', INK);
                const lines = doc.splitTextToSize(clean(text), bw - 28);
                const h = 42 + lines.length * 16;
                if (draw === false) return top + h;
                doc.setFillColor(...fill); doc.roundedRect(x, top, bw, h, 6, 6, 'F');
                if (stripe) { doc.setFillColor(...stripe); doc.rect(x, top, 4, h, 'F'); }
                font(8.5, 'bold', stripe ? ORANGE : NAVY); doc.text(label.toUpperCase(), x + 14, top + 20, { charSpace: 1 });
                font(12, 'normal', INK); doc.text(lines, x + 14, top + 39, { lineHeightFactor: 1.3 });
                return top + h;
            };
            // the points (draw false: only measure them), smaller where they would run into the footer
            const points = (x, w, size, draw) => {
                let y = 142;
                (s.points || []).forEach(p => {
                    font(size, 'normal', INK);
                    const lines = doc.splitTextToSize(clean(p), w - 22);
                    if (draw !== false) {
                        doc.setFillColor(...ORANGE); doc.rect(x, y - size * 0.61, 7.5, 7.5, 'F');
                        doc.text(lines, x + 22, y, { lineHeightFactor: 1.3 });
                    }
                    y += lines.length * size * 1.3 + size;
                });
                return y;
            };
            const shot = shots[k];
            if (shot) {
                // the screenshot and Where to find it on the right; the points and the Tip on the left
                const colW = 318, rx = W - M - colW, lw = rx - M - 30, bottom = H - 46;
                const f = fitImage(doc, shot, colW, 200);
                let top = 122;
                try {
                    doc.addImage(shot, imgType(shot), rx, top, f.w, f.h);
                    doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.8); doc.rect(rx, top, f.w, f.h, 'S');
                    top += f.h + 14;
                } catch (e) { /* the page works without it */ }
                if (s.where) box('Where to find it', s.where, rx, top, colW, SOFT, null);
                let size = 15.5;
                const tipH = s.tip ? box('Tip', s.tip, M, 0, lw, null, null, false) + 14 : 0;
                while (size > 10 && points(M, lw, size, false) - size + tipH > bottom) size -= 0.5;
                const y = points(M, lw, size);
                if (s.tip) box('Tip', s.tip, M, Math.min(y - size + 4, bottom - tipH + 14), lw, [255, 247, 237], ORANGE);
            } else {
                const sideX = W - M - 230, textW = sideX - M - 40;
                points(M, textW, 15.5);
                let top = 128;
                if (s.where) top = box('Where to find it', s.where, sideX, top, 230, SOFT, null) + 16;
                if (s.tip) box('Tip', s.tip, sideX, top, 230, [255, 247, 237], ORANGE);
            }
            footer(k + 1);
        });
        doc.setProperties({ title: clean(`${c.site || 'LSH'} ${d.name}`), subject: clean(`How ${c.product || 'the platform'} works · ${stamp}`), creator: clean(c.site || 'LSH') });
        return doc;
    }

    async function makePdf(which) {
        const tabs = allowed();
        const key = which && tabs.includes(which) ? which : (API.isOpen() ? cur : tabs[0]);
        const d = key && deckOf(key);
        if (!d) return null;
        const btn = $id('lbp-pdf-btn');
        try {
            if (btn) { btn.disabled = true; btn.textContent = '⏳ Making the PDF…'; }
            await loadJsPdf();
            if (!version) await loadVersion();
            const [logo, shots] = await Promise.all([imageData(cfg().logo), Promise.all(d.slides.map(s => s.shot ? imageData(s.shot) : null))]);
            const doc = buildPdf(d, logo, shots);
            const name = `${cfg().file || 'LSH'}_Blueprint_${FILES[key] || 'Trainee'}.pdf`;
            doc.save(name);
            return { name, pages: doc.getNumberOfPages(), version };
        } catch (e) {
            const msg = e.message || 'The PDF could not be made.';
            if (typeof window.showToast === 'function') window.showToast(msg, 'error'); else if (typeof window.toast === 'function') window.toast(msg); else alert(msg);
            return null;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '⬇ Download PDF'; }
        }
    }

    // the button: now, when the page is ready, and again when sign-in changes the role
    function start() { mount(); setInterval(mount, 2000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
