/* ✨ The AI Editor: a grammar and structure check for what you are writing, one card at a time.
   A card is a heading and the text under it (the text before the first heading is the opening card),
   so a long SOP is checked in the pieces people actually read, and you apply the cards you agree with
   and leave the rest. Nothing is saved by the check itself: applying a card only writes into the
   editor, and the entry still goes through Save (and through review, unless you are an admin).
   The thinking happens in the Worker (src/ai.js) on Workers AI; this file only splits, shows and applies.

   window.KBAiEditor
     splitCards(markdown)      -> [{ heading, level, text }]   (pure; tests/ai-editor.cjs)
     joinCards(cards)          -> markdown
     applyCard(md, i, text)    -> markdown with card i replaced
     open({ title, get, set, toast })   the panel
*/
(function () {
    'use strict';

    const HEADING = /^(#{1,4})\s+(.*)$/;

    // Splits on headings, but never inside a ``` fence or a table.
    function splitCards(markdown) {
        const lines = String(markdown == null ? '' : markdown).replace(/\r\n?/g, '\n').split('\n');
        const cards = [];
        let cur = { heading: '', level: 0, lines: [] }, fence = false;
        for (const line of lines) {
            if (/^\s*```/.test(line)) fence = !fence;
            const m = !fence && line.match(HEADING);
            if (m) {
                if (cur.lines.length || cur.heading) cards.push(cur);
                cur = { heading: m[2].trim(), level: m[1].length, lines: [line] };
                continue;
            }
            cur.lines.push(line);
        }
        if (cur.lines.length || cur.heading) cards.push(cur);
        return cards
            .map(c => ({ heading: c.heading, level: c.level, text: c.lines.join('\n') }))
            .filter((c, i, a) => c.text.trim() || a.length === 1);
    }
    const joinCards = (cards) => cards.map(c => c.text).join('\n');
    function applyCard(markdown, index, text) {
        const cards = splitCards(markdown);
        if (!cards[index]) return markdown;
        // The blank line that separated this card from the next one belongs to this card's text: keep it,
        // or the suggestion would run into the next heading.
        const gap = (cards[index].text.match(/\n*$/) || [''])[0];
        cards[index] = { ...cards[index], text: String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '') + (index < cards.length - 1 ? (gap || '\n\n') : gap) };
        return joinCards(cards);
    }

    window.KBAiEditor = { splitCards, joinCards, applyCard, open };

    /* ---------- the panel ---------- */
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const label = (c, i) => c.heading ? c.heading : (i === 0 ? 'Opening (before the first heading)' : 'Text with no heading');
    const words = (t) => (String(t).match(/[\p{L}\p{N}'’-]+/gu) || []).length;

    let dlg = null;
    function open(opts) {
        const get = opts.get, set = opts.set, toast = opts.toast || ((m) => console.log(m));
        if (!dlg) {
            dlg = document.createElement('dialog');
            dlg.className = 'aidlg';
            dlg.id = 'ai-editor';
            document.body.appendChild(dlg);
        }
        let mode = 'grammar';
        let cards = splitCards(get());
        const res = {};   // card index -> { busy, error, text, notes, changed, applied }

        function draw() {
            dlg.innerHTML = `<div class="ai-head">
                    <div><h2>✨ AI Editor</h2><p class="muted">Grammar and structure, one card at a time. You decide what to apply; nothing is saved until you save the entry.</p></div>
                    <button type="button" class="btn" data-x="close" aria-label="Close the AI Editor">Close</button>
                </div>
                <div class="ai-bar">
                    <div class="ai-modes" role="radiogroup" aria-label="What to check">
                        <button type="button" class="btn small${mode === 'grammar' ? ' primary' : ''}" data-mode="grammar" role="radio" aria-checked="${mode === 'grammar'}">Grammar &amp; spelling</button>
                        <button type="button" class="btn small${mode === 'structure' ? ' primary' : ''}" data-mode="structure" role="radio" aria-checked="${mode === 'structure'}">Structure</button>
                    </div>
                    <span class="muted">${cards.length === 1 ? '1 card' : cards.length + ' cards'} · ${words(get())} words</span>
                    <button type="button" class="btn" data-x="all">Check every card</button>
                </div>
                <div class="ai-cards">${cards.map((c, i) => card(c, i)).join('')}</div>`;
            wire();
        }
        function card(c, i) {
            const r = res[i] || {};
            const head = `<div class="ai-c-head"><span class="ai-c-t">${c.level ? '<span class="ai-lvl">H' + c.level + '</span> ' : ''}${esc(label(c, i))}</span>
                <span class="muted">${words(c.text)} words</span>
                <button type="button" class="btn small" data-check="${i}"${r.busy ? ' disabled' : ''}>${r.busy ? 'Checking…' : r.text ? 'Check again' : 'Check this card'}</button></div>`;
            if (r.busy) return `<section class="ai-c">${head}<p class="muted">Reading this card…</p></section>`;
            if (r.error) return `<section class="ai-c bad">${head}<p class="note bad">${esc(r.error)}</p></section>`;
            if (!r.text) return `<section class="ai-c">${head}</section>`;
            if (r.applied) return `<section class="ai-c ok">${head}<p class="note">Applied to the editor. Save the entry to keep it.</p></section>`;
            if (!r.changed) return `<section class="ai-c ok">${head}<p class="note">This card already reads well — nothing to change.</p></section>`;
            return `<section class="ai-c">${head}
                ${r.notes.length ? `<ul class="ai-notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
                <div class="ai-two">
                    <div><b class="ai-lab">Now</b><div class="preview md ai-prev">${window.KBmd.render(cards[i].text) || '<p class="muted">Empty.</p>'}</div></div>
                    <div><b class="ai-lab">Suggested</b><div class="preview md ai-prev">${window.KBmd.render(r.text) || '<p class="muted">Empty.</p>'}</div></div>
                </div>
                <details class="ai-md"><summary>See it as markdown</summary><pre>${esc(r.text)}</pre></details>
                <div class="row"><button type="button" class="btn primary" data-apply="${i}">Apply this card</button><button type="button" class="btn" data-skip="${i}">Leave it as it is</button></div></section>`;
        }

        async function check(i) {
            const c = cards[i];
            if (!c || !c.text.trim()) { res[i] = { error: 'There is nothing in this card yet.' }; return draw(); }
            res[i] = { busy: true }; draw();
            try {
                const r = await fetch('/api/assist', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode, text: c.text, title: opts.title || '', heading: c.heading }) });
                let d = {};
                try { d = await r.json(); } catch (e) { d = { success: false, error: 'The server answered ' + r.status + '.' }; }
                if (!r.ok || d.success === false) throw new Error(d.error || 'Something went wrong (' + r.status + ').');
                res[i] = { text: d.text, notes: d.notes || [], changed: !!d.changed };
            } catch (e) {
                res[i] = { error: e.message };
            }
            draw();
        }

        function wire() {
            dlg.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; for (const k of Object.keys(res)) delete res[k]; draw(); });
            dlg.querySelectorAll('[data-check]').forEach(b => b.onclick = () => check(Number(b.dataset.check)));
            dlg.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { delete res[Number(b.dataset.skip)]; draw(); });
            dlg.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => {
                const i = Number(b.dataset.apply), r = res[i];
                if (!r || !r.text) return;
                set(applyCard(get(), i, r.text));
                cards = splitCards(get());
                res[i] = { ...r, applied: true };
                toast('Applied. It is in the editor, not saved yet.');
                draw();
            });
            const close = dlg.querySelector('[data-x="close"]');
            if (close) close.onclick = () => dlg.close();
            const all = dlg.querySelector('[data-x="all"]');
            if (all) all.onclick = async () => { for (let i = 0; i < cards.length; i++) if (cards[i].text.trim()) await check(i); };
        }

        dlg.onclose = () => { dlg.innerHTML = ''; };
        draw();
        if (!dlg.open) dlg.showModal();
    }
})();
