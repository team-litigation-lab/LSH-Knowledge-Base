/* 📊 Server request meter, for admins only.
   Every LSH site shares one Cloudflare account, and the account's Workers and Pages Functions share
   one monthly request allowance (Workers Paid: 10,000,000 a billing month, then charged). The Request
   budget workflow (EA-PA-TRAINING, every 10 minutes) reads the month's requests and, at the limit,
   pauses the sites' server parts until the next billing month. This meter shows its numbers:
   - a small chip in a corner of the page: the share of the limit used, coloured by how close it is
     (green; amber from 75% or when this month's pace runs out before the month ends; red from 90%;
     dark red when paused; grey when there are no recent numbers);
   - a note above the chip when it's close (dismissed until it gets closer, or until next month);
   - click the chip: the total, the projection, each day, each site, and what happens at the limit.
   It asks this site's server once when an admin opens the page and then every 15 minutes while the tab
   is in view (the numbers change at most every 10 minutes), so it costs next to nothing.
   The SAME FILE is used by every LSH platform: change it in one, copy it to all.
   Usage: RequestBudget.start({
            load: () => Promise of the server's reply { usage: {...} | null },
            isAdmin: () => true when the page is in admin mode (checked every 2 s; no request),
            corner: 'bottom-left' (default) | 'bottom-right' | 'top-left' | 'top-right',
            offset: { x: 16, y: 16 },
            site: this site's Worker or Pages project name, highlighted in the list (default: the first part
                  of the address, which is the Worker's name on workers.dev) });
   Tests may set window.REQUEST_BUDGET_TIMINGS = { refresh, retry, adminCheck } (ms) first. */
(function () {
    'use strict';
    if (window.RequestBudget) return;
    const DAY = 86400000;
    const T = Object.assign({ refresh: 15 * 60000, retry: 2 * 60000, adminCheck: 2000, stale: 3 * 3600000 }, window.REQUEST_BUDGET_TIMINGS || {});
    const NAMES = [
        ['ea-pa-training', 'EA-PA Training'], ['foundational-training', 'Foundational Training'],
        ['propertydamageclaimstraining', 'Property Damage Claims'], ['medsumanddemandtraining', 'Medsum & Demand'],
        ['case-management-training', 'Case Management course'], ['lshringchannel', 'Ring Channel'],
        ['lsh-knowledge-base', 'Knowledge Base'], ['trainingcrm', 'CMS'], ['lshtraining-portal', 'Training Portal'], ['portal', 'Training Portal']
    ];
    const DISMISS_KEY = 'rqb-dismissed-v1';
    let opts = null, res = null, error = '', loadedAt = 0, nextLoadAt = 0, loading = null, chip = null, panel = null, note = null, shown = false;

    const nf = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
    const short = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : nf(n); };
    const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const ago = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
    const siteName = (s) => { const n = String(s.name || ''); const hit = NAMES.find(([k]) => n === k) || NAMES.find(([k]) => n.includes(k)); return hit ? hit[1] : n; };
    let dismissed = '';   // kept here too, for when the browser won't store it (a private window)
    const store = { get() { try { return localStorage.getItem(DISMISS_KEY) || dismissed; } catch (e) { return dismissed; } }, set(v) { dismissed = v; try { localStorage.setItem(DISMISS_KEY, v); } catch (e) { /* private window */ } } };

    // What the numbers mean: { level, pct, ... }. level: ok | warn | danger | paused | unset | stale | error
    function assess(u, now) {
        if (error && !u) return { level: 'error' };
        if (!u || !u.month || !u.at) return { level: 'unset' };
        const limit = Number(u.limit) || 9990000, total = Number(u.total) || 0, pct = 100 * total / limit;
        const start = Date.parse(u.month.start + 'T00:00:00Z'), end = Date.parse(u.month.end + 'T00:00:00Z'), at = Date.parse(u.at);
        const elapsed = Math.max(0, at - start), monthMs = end - start;
        const rate = elapsed > 0 ? total / elapsed : 0;                       // requests a millisecond so far
        const runsOutAt = rate > 0 ? start + limit / rate : null;
        const projected = Number(u.projected) || Math.round(rate * monthMs);
        const days = u.days || {}, today = new Date(Math.min(now, end - 1)).toISOString().slice(0, 10);
        const a = { u, limit, total, pct, start, end, at, projected, runsOutAt, days, today, todayCount: Number(days[today]) || 0,
            avgDay: elapsed >= DAY ? total / (elapsed / DAY) : null, fairDay: limit / (monthMs / DAY), stale: now - at > T.stale, ended: now >= end };
        if (a.ended) a.level = 'stale';
        else if (u.paused) a.level = 'paused';
        else if (pct >= 90) a.level = 'danger';
        else if (pct >= 75 || (elapsed >= 3 * DAY && runsOutAt && runsOutAt < end)) a.level = 'warn';
        else a.level = 'ok';
        if (a.stale && a.level === 'ok') a.level = 'stale';
        return a;
    }
    function label(a) {
        switch (a.level) {
            case 'ok': return 'OK';
            case 'warn': return a.pct >= 75 ? 'Getting close' : `On pace to run out ${day(a.runsOutAt)}`;
            case 'danger': return 'Nearly used up';
            case 'paused': return `Paused until ${day(a.end)}`;
            case 'stale': return a.ended ? 'No numbers this month yet' : `Last checked ${ago(Date.now() - a.at)}`;
            case 'unset': return 'Not set up';
            default: return 'Couldn\'t load';
        }
    }

    function css() {
        if (document.getElementById('rqb-css')) return;
        const st = document.createElement('style'); st.id = 'rqb-css';
        st.textContent = `
.rqb-chip{position:fixed;z-index:9990;display:inline-flex;align-items:center;gap:7px;padding:6px 11px 6px 9px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 4px 14px rgba(15,23,42,.14);cursor:pointer;max-width:calc(100vw - 32px)}
.rqb-chip:hover{border-color:#94a3b8}.rqb-chip:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
.rqb-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--rqb-c)}
.rqb-chip .rqb-l{font-weight:500;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rqb-ok{--rqb-c:#16a34a}.rqb-warn{--rqb-c:#d97706}.rqb-danger{--rqb-c:#dc2626}.rqb-paused{--rqb-c:#7f1d1d}.rqb-unset,.rqb-stale,.rqb-error{--rqb-c:#94a3b8}
.rqb-chip.rqb-warn{border-color:#fcd34d;background:#fffbeb}.rqb-chip.rqb-danger,.rqb-chip.rqb-paused{border-color:#fca5a5;background:#fef2f2}
.rqb-chip.rqb-danger .rqb-dot,.rqb-chip.rqb-paused .rqb-dot{animation:rqb-pulse 1.6s ease-in-out infinite}
@keyframes rqb-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.55)}50%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}
@media (prefers-reduced-motion:reduce){.rqb-chip .rqb-dot{animation:none!important}}
.rqb-panel,.rqb-note{position:fixed;z-index:9991;background:#fff;color:#0f172a;border:1px solid #cbd5e1;border-radius:14px;box-shadow:0 14px 40px rgba(15,23,42,.22);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left}
.rqb-panel{width:min(400px,calc(100vw - 24px));max-height:min(78vh,720px);overflow:auto;padding:16px 16px 12px}
.rqb-panel h2{font-size:15px;margin:0;font-weight:700}.rqb-panel .rqb-x,.rqb-note .rqb-x{border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:#64748b;padding:2px 4px}
.rqb-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.rqb-sub{color:#64748b;font-size:12px;margin:2px 0 10px}
.rqb-big{font-size:26px;font-weight:800;letter-spacing:-.5px}.rqb-of{color:#475569;font-size:13px}
.rqb-bar{position:relative;height:12px;border-radius:999px;background:#e2e8f0;margin:8px 0 4px;overflow:hidden}
.rqb-fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;background:var(--rqb-c)}
.rqb-tick{position:absolute;top:0;bottom:0;width:2px;background:rgba(15,23,42,.35)}
.rqb-scale{position:relative;height:14px;font-size:11px;color:#64748b}.rqb-scale span{position:absolute;top:0;transform:translateX(-50%)}.rqb-scale span:first-child{transform:none}
.rqb-msg{margin:10px 0;padding:9px 11px;border-radius:10px;background:#f1f5f9;font-size:13px}
.rqb-msg.rqb-warn{background:#fffbeb;border:1px solid #fde68a}.rqb-msg.rqb-danger,.rqb-msg.rqb-paused{background:#fef2f2;border:1px solid #fecaca}.rqb-msg.rqb-ok{background:#f0fdf4;border:1px solid #bbf7d0}
.rqb-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin:10px 0;font-size:12.5px}.rqb-stats b{display:block;font-size:14px}
.rqb-stats span{color:#64748b}
.rqb-h3{font-size:12px;font-weight:700;color:#334155;margin:12px 0 6px;text-transform:uppercase;letter-spacing:.04em}
.rqb-days{position:relative;display:flex;align-items:flex-end;gap:2px;height:64px;padding-top:4px;border-bottom:1px solid #cbd5e1}
.rqb-days i{flex:1;min-width:2px;border-radius:2px 2px 0 0;background:#60a5fa}.rqb-days i.rqb-hi{background:#f59e0b}.rqb-days i.rqb-now{background:#2563eb}
.rqb-fair{position:absolute;left:0;right:0;border-top:1px dashed #dc2626}
.rqb-dlab{display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-top:2px}
.rqb-sites{width:100%;border-collapse:collapse;font-size:12.5px}.rqb-sites td{padding:4px 0;border-bottom:1px solid #f1f5f9;vertical-align:middle}
.rqb-sites td.n{text-align:right;white-space:nowrap;padding-left:8px;font-variant-numeric:tabular-nums}.rqb-sites tr.rqb-me td{font-weight:700}
.rqb-share{height:5px;border-radius:3px;background:#93c5fd;margin-top:3px}.rqb-kind{color:#94a3b8;font-size:11px}
.rqb-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px;font-size:11.5px;color:#64748b}
.rqb-btn{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:4px 10px;font:600 12px system-ui,sans-serif;cursor:pointer;color:#0f172a}.rqb-btn:hover{background:#f8fafc}
.rqb-note{width:min(330px,calc(100vw - 24px));padding:11px 12px;font-size:13px;display:flex;gap:8px;align-items:flex-start}
.rqb-note.rqb-warn{border-color:#fcd34d;background:#fffbeb}.rqb-note.rqb-danger,.rqb-note.rqb-paused{border-color:#fca5a5;background:#fef2f2}
.rqb-note p{margin:0 0 6px}.rqb-note .rqb-btn{margin-right:6px}
@media (max-width:520px){.rqb-panel{left:12px!important;right:12px!important;width:auto}.rqb-chip .rqb-l{max-width:46vw}}
@media print{.rqb-chip,.rqb-panel,.rqb-note{display:none!important}}`;
        document.head.appendChild(st);
    }

    function place(el, extra) {
        const c = (opts.corner || 'bottom-left').split('-'), o = Object.assign({ x: 16, y: 16 }, opts.offset || {});
        el.style[c[0]] = (o.y + (extra || 0)) + 'px'; el.style[c[1]] = o.x + 'px';
    }

    function renderChip() {
        if (!chip) {
            chip = document.createElement('button');
            chip.type = 'button'; chip.id = 'rqb-chip'; chip.setAttribute('aria-haspopup', 'dialog');
            chip.addEventListener('click', () => (panel ? close() : open()));
            place(chip); document.body.appendChild(chip);
        }
        const a = assess(res && res.usage, Date.now());
        chip.className = 'rqb-chip rqb-' + a.level;
        const pct = a.pct != null && !a.ended ? (a.pct >= 10 || a.pct === 0 ? Math.round(a.pct) : a.pct.toFixed(1)) + '%' : '';
        chip.innerHTML = `<span class="rqb-dot"></span><span>${pct ? 'Requests ' + pct : 'Requests'}</span>${a.level !== 'ok' ? `<span class="rqb-l">· ${esc(label(a))}</span>` : ''}`;
        chip.title = a.pct != null ? `Server requests this billing month: ${nf(a.total)} of ${nf(a.limit)} (${a.pct.toFixed(1)}%). Click for details.` : 'Server requests this billing month. Click for details.';
        chip.setAttribute('aria-label', chip.title);
        renderNote(a);
        if (panel) renderPanel();
    }

    // The note above the chip when it's close; dismissed until it gets closer or until next month.
    function renderNote(a) {
        const key = a.u && a.u.month ? a.u.month.start + ':' + a.level : '';
        const want = ['warn', 'danger', 'paused'].includes(a.level) && !panel && store.get().split(',').indexOf(key) < 0;
        if (!want) { if (note) { note.remove(); note = null; } return; }
        if (!note) { note = document.createElement('div'); note.id = 'rqb-note'; note.setAttribute('role', 'status'); document.body.appendChild(note); }
        note.className = 'rqb-note rqb-' + a.level;
        place(note, chip ? chip.offsetHeight + 8 : 44);
        const icon = a.level === 'warn' ? '⚠️' : a.level === 'danger' ? '🛑' : '⏸';
        note.innerHTML = `<span aria-hidden="true">${icon}</span><div><p>${message(a, true)}</p><button type="button" class="rqb-btn" data-rqb="open">Details</button><button type="button" class="rqb-btn" data-rqb="dismiss">Dismiss</button></div>`;
        note.querySelector('[data-rqb=open]').onclick = () => open();
        note.querySelector('[data-rqb=dismiss]').onclick = () => {
            store.set(store.get().split(',').filter((k) => k && k.split(':')[0] === a.u.month.start).concat(key).join(','));
            note.remove(); note = null;
        };
    }

    function message(a, brief) {
        const reset = day(a.end);
        switch (a.level) {
            case 'ok': return `On track: at this rate about <b>${short(a.projected)}</b> by ${reset} (${Math.round(100 * a.projected / a.limit)}% of the limit).`;
            case 'warn': return a.pct >= 75
                ? `<b>${a.pct.toFixed(1)}%</b> of this month's server requests used.${a.runsOutAt && a.runsOutAt < a.end ? ` At this rate the limit is reached around <b>${day(a.runsOutAt)}</b>.` : ''}${brief ? '' : ` At the limit the sites' server parts pause until ${reset}.`}`
                : `At this month's pace the limit is reached around <b>${day(a.runsOutAt)}</b>, before the allowance resets on ${reset}.${brief ? '' : ' Then the sites\' server parts pause until it resets.'}`;
            case 'danger': return `<b>${a.pct.toFixed(1)}%</b> of this month's server requests used. At ${nf(a.limit)} the sites' server parts pause until ${reset}${brief ? '.' : ' (the pages show a notice; saved work is kept).'}`;
            case 'paused': return `The sites' server parts are <b>paused</b> until ${reset}: this month's request limit was reached${a.u.pausedAt ? ' on ' + day(Date.parse(a.u.pausedAt)) : ''}.${brief ? '' : ' Saved work is kept. To switch them back on sooner, raise REQUEST_LIMIT and run Actions → Request budget → resume in EA-PA-TRAINING (Cloudflare then charges $0.30 per extra million).'}`;
            case 'stale': return a.ended
                ? 'The numbers are from last billing month. The Request budget workflow (EA-PA-TRAINING → Actions) hasn\'t saved this month\'s yet: it may be off or failing.'
                : `These numbers are from ${ago(Date.now() - a.at)}. The Request budget workflow (EA-PA-TRAINING → Actions) normally saves them every hour: it may be delayed, off or failing.`;
            case 'unset': return 'There are no numbers yet: the monthly request check isn\'t set up. In EA-PA-TRAINING, add the Cloudflare token (secret <code>CLOUDFLARE_BUDGET_TOKEN</code>), then run Actions → Request budget → <i>test</i>. Steps: README → Monthly request budget.';
            default: return `The numbers couldn't be loaded${error ? ` (${esc(error)})` : ''}. It tries again in a few minutes.`;
        }
    }

    function renderPanel() {
        const a = assess(res && res.usage, Date.now()), u = a.u;
        let h = `<div class="rqb-head"><div><h2>Server requests this billing month</h2><div class="rqb-sub">All LSH sites share one Cloudflare allowance.</div></div><button type="button" class="rqb-x" aria-label="Close" data-rqb="close">✕</button></div>`;
        if (u && u.month) {
            const fill = Math.min(100, a.pct);
            h += `<div class="rqb-big">${nf(a.total)}</div><div class="rqb-of">of ${nf(a.limit)} (${a.pct.toFixed(1)}%) · ${day(a.start)} – ${day(a.end - DAY)}</div>
<div class="rqb-bar rqb-${a.level}" role="img" aria-label="${a.pct.toFixed(1)}% used"><div class="rqb-fill" style="width:${fill}%"></div><div class="rqb-tick" style="left:75%"></div><div class="rqb-tick" style="left:90%"></div></div>
<div class="rqb-scale"><span style="left:0">0</span><span style="left:75%">75%</span><span style="left:90%">90%</span></div>`;
        }
        h += `<div class="rqb-msg rqb-${a.level}">${message(a, false)}</div>`;
        if (u && u.month) {
            const left = Math.max(0, Math.ceil((a.end - Date.now()) / DAY));
            h += `<div class="rqb-stats">
<div><span>Today so far</span><b>${nf(a.todayCount)}</b></div>
<div><span>Average a day</span><b>${a.avgDay != null ? nf(a.avgDay) : '—'}</b></div>
<div><span>At this rate by ${day(a.end)}</span><b>${short(a.projected)}</b></div>
<div><span>Resets</span><b>${day(a.end)}${a.ended ? '' : ` (in ${left} day${left === 1 ? '' : 's'})`}</b></div>
<div><span>Left before the limit</span><b>${nf(Math.max(0, a.limit - a.total))}</b></div>
<div><span>A day, to last the month</span><b>${nf(a.fairDay)}</b></div></div>`;
            const list = [];
            for (let t = a.start; t < a.end && t <= Math.max(a.at, a.start); t += DAY) list.push(new Date(t).toISOString().slice(0, 10));
            if (list.length) {
                const max = Math.max(a.fairDay, ...list.map((d) => Number(a.days[d]) || 0)) || 1;
                h += `<div class="rqb-h3">Each day</div><div class="rqb-days" aria-label="Requests each day">${list.map((d) => { const n = Number(a.days[d]) || 0; return `<i class="${d === a.today ? 'rqb-now' : n > a.fairDay ? 'rqb-hi' : ''}" style="height:${Math.max(1, Math.round(58 * n / max))}px" title="${day(Date.parse(d + 'T00:00:00Z'))}: ${nf(n)}"></i>`; }).join('')}<div class="rqb-fair" style="bottom:${Math.round(58 * a.fairDay / max)}px" title="A day, to last the month: ${nf(a.fairDay)}"></div></div><div class="rqb-dlab"><span>${day(a.start)}</span><span>dashed: a day's share of the limit</span><span>${day(Date.parse(list[list.length - 1] + 'T00:00:00Z'))}</span></div>`;
            }
            const sites = (u.sites || []).filter((s) => s.requests > 0);
            if (sites.length) {
                const top = sites[0].requests || 1;
                const me = String(opts.site || location.hostname.split('.')[0] || '');
                h += `<div class="rqb-h3">Each site</div><table class="rqb-sites">${sites.map((s) => `<tr class="${me && String(s.name).includes(me) ? 'rqb-me' : ''}"><td>${esc(siteName(s))} <span class="rqb-kind">${s.kind === 'pages' ? 'Pages' : 'Worker'}</span><div class="rqb-share" style="width:${Math.max(2, Math.round(100 * s.requests / top))}%"></div></td><td class="n">${nf(s.requests)}<br><span class="rqb-kind">${a.total ? (100 * s.requests / a.total).toFixed(1) : 0}%</span></td></tr>`).join('')}</table>`;
            }
            (u.notes || []).forEach((n) => { h += `<div class="rqb-msg rqb-warn">⚠️ ${esc(n)}</div>`; });
        }
        h += `<div class="rqb-foot"><span>${u && u.at ? `Checked ${ago(Date.now() - a.at)}; Cloudflare's numbers lag a few minutes. Saved about hourly, every 10 minutes from 75%.` : ''}${error && u ? ` Last refresh failed: ${esc(error)}.` : ''}</span><button type="button" class="rqb-btn" data-rqb="refresh">${loading ? 'Refreshing…' : 'Refresh'}</button></div>`;
        panel.innerHTML = h;
        panel.querySelector('[data-rqb=close]').onclick = close;
        panel.querySelector('[data-rqb=refresh]').onclick = () => refresh(true);
    }

    function open() {
        if (!shown) return;
        if (!panel) {
            panel = document.createElement('div'); panel.id = 'rqb-panel'; panel.className = 'rqb-panel';
            panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Server requests this billing month');
            place(panel, chip ? chip.offsetHeight + 8 : 44); document.body.appendChild(panel);
        }
        if (note) { note.remove(); note = null; }
        if (chip) chip.setAttribute('aria-expanded', 'true');
        renderPanel();
        if (Date.now() - loadedAt > 60000) refresh(true);
    }
    function close() {
        if (panel) { panel.remove(); panel = null; }
        if (chip) { chip.setAttribute('aria-expanded', 'false'); renderChip(); }
    }

    function refresh(now) {
        if (loading) return loading;
        if (!opts || (!now && Date.now() < nextLoadAt)) return Promise.resolve();
        loading = Promise.resolve().then(() => opts.load()).then((r) => {
            if (!r || typeof r !== 'object' || r.error) throw new Error((r && r.error) || 'no reply');
            res = { usage: r.usage || null }; error = ''; loadedAt = Date.now(); nextLoadAt = loadedAt + T.refresh;
        }).catch((e) => { error = String((e && e.message) || e).slice(0, 120); nextLoadAt = Date.now() + T.retry; })
            .then(() => { loading = null; if (shown) renderChip(); });
        if (panel) renderPanel();
        return loading;
    }

    function tick() {
        let admin = false;
        try { admin = !!opts.isAdmin(); } catch (e) { admin = false; }
        if (!admin) {
            if (shown) { shown = false; close(); if (chip) { chip.remove(); chip = null; } if (note) { note.remove(); note = null; } }
            return;
        }
        if (!shown) { shown = true; css(); renderChip(); }
        if (!document.hidden) refresh(false);
    }

    window.RequestBudget = {
        start(o) {
            if (opts || !o || typeof o.load !== 'function' || typeof o.isAdmin !== 'function') return;
            opts = o;
            const go = () => { tick(); setInterval(tick, T.adminCheck); };
            document.body ? go() : document.addEventListener('DOMContentLoaded', go);
            document.addEventListener('visibilitychange', () => { if (!document.hidden && opts) tick(); });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel) close(); });
        },
        refresh: () => refresh(true), open, close,
        state: () => ({ shown, loading: !!loading, error, loadedAt, usage: res ? res.usage : undefined, level: assess(res && res.usage, Date.now()).level }),
        assess: (u, now) => assess(u, now == null ? Date.now() : now)
    };
})();
