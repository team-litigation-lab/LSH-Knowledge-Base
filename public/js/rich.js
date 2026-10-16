// Word-style editing for the Knowledge Base. The editor's surface shows an entry exactly as readers see it
// (js/md.js renders it into a contenteditable box), and this file turns that surface back into the library's own
// markdown, the format every entry is stored, searched, compared and backed up in.
//   toMarkdown(root)  the surface → markdown, using only what js/md.js renders (its header lists the set)
//   sanitize(html)    pasted HTML (Word, Google Docs, a web page) → that same set, as safe elements
// md.js has no escape syntax, so the measure of a good conversion is the rendered page: rendering what this returns
// gives the same page the surface showed (tests/rich-editor.cjs checks that on every bundled article).
(function () {
    const FILES_IMG = /^\/files\/[0-9a-f-]{36}\/[^\s)]+$/;   // a photo uploaded to the library
    const LIB_IMG = /^\/img\/[0-9a-f]{16}$/;                 // an image the library copied in
    const COLOR = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|[a-zA-Z]{3,20})$/;
    const LINK = /^(https?:\/\/|mailto:|\/)/i;
    const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE',
        'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'FIGURE']);
    const isBlock = (n) => n.nodeType === 1 && BLOCK.has(n.tagName);

    // ---- colors ----
    const hex2 = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0');
    function cssColor(v) {   // a CSS color value → a token md.js accepts, or null
        v = String(v || '').trim();
        if (COLOR.test(v)) return v;
        const m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
        if (m && !(m[4] !== undefined && parseFloat(m[4]) === 0)) return '#' + hex2(m[1]) + hex2(m[2]) + hex2(m[3]);
        return null;
    }
    // The text color an element sets: the raw token from its style attribute (so #C0392B stays #C0392B, where
    // el.style.color would turn it into rgb()), or a <font color> from the browser's own Color command.
    function colorOf(el) {
        if (el.tagName === 'FONT' && el.getAttribute('color')) return cssColor(el.getAttribute('color'));
        const m = (el.getAttribute('style') || '').match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
        return m ? cssColor(m[1]) : null;
    }

    // ---- inline content → one or more source lines ----
    // Markers are wrapped around each line on its own, since md.js reads formatting a line at a time. Spaces stay
    // where they were (inside "**Walgreens **" as the source had it), so a line nobody touched comes back unchanged
    // and the review diff shows only real edits. Italic markers are placed later (placeItalics), where they can see
    // their neighbours.
    function wrap(open, close, inner) {
        return inner.split('\n').map(seg => seg.trim() ? open + seg + close : seg).join('\n');
    }
    const IT_OPEN = '\u0002', IT_CLOSE = '\u0003';
    function inline(nodes, ctx, links) {
        let s = '';
        for (const n of nodes) s += inlineNode(n, ctx, links);
        return s;
    }
    function inlineNode(n, ctx, links) {
        // The browser types a no-break space wherever a plain one would collapse (after bold, at a line's end); the
        // saved text gets a plain space, which reads the same.
        if (n.nodeType === 3) return n.nodeValue.replace(/\n/g, ' ').replace(/\u00a0/g, ' ');
        if (n.nodeType !== 1) return '';
        const kids = () => inline(n.childNodes, ctx, links);
        const t = n.tagName;
        if (t === 'BR') return '\n';
        if (t === 'IMG') {
            const src = n.getAttribute('src') || '';
            return FILES_IMG.test(src) || LIB_IMG.test(src) ? `![${(n.getAttribute('alt') || '').replace(/[\]\n]/g, '')}](${src})` : '';
        }
        if (n.classList && n.classList.contains('md-box')) return '';   // a checklist's box is written as [ ] / [x]
        if (t === 'CODE') return ctx.code ? n.textContent : '`' + n.textContent.replace(/[`\n]/g, ' ') + '`';
        if (t === 'A') {
            const href = (n.getAttribute('href') || '').trim();
            const text = inline(n.childNodes, Object.assign({}, ctx, { link: true }), links).replace(/\n/g, ' ');
            if (ctx.link || !LINK.test(href) || !text.trim()) return text;
            links.push({ href, text });
            return `\u0001${links.length - 1}\u0001`;
        }
        if ((t === 'STRONG' || t === 'B') && !/font-weight\s*:\s*(normal|[1-4]00)\b/i.test(n.getAttribute('style') || ''))
            return ctx.bold ? kids() : wrap('**', '**', inline(n.childNodes, Object.assign({}, ctx, { bold: true }), links));
        // Italic inside bold is written _like this_: md.js reads **…** only when there is no * between, but an _ is fine.
        // md.js reads _…_ over its own output, though, so an _ italic may hold neither an underscore nor a link
        // (whose target="_blank" would pair with it); such a run stays roman rather than corrupt the line.
        if (t === 'EM' || t === 'I') {
            if (ctx.italic) return kids();
            const inner = inline(n.childNodes, Object.assign({}, ctx, { italic: true }), links);
            if (!ctx.bold) return wrap(IT_OPEN + '*', IT_CLOSE + '*', inner);
            if (/_|\u0001/.test(inner)) return inner;
            return wrap(IT_OPEN + '_', IT_CLOSE + '_', inner);
        }
        if (t === 'U') return ctx.under ? kids() : wrap('++', '++', inline(n.childNodes, Object.assign({}, ctx, { under: true }), links));
        if (t === 'SPAN' || t === 'FONT') {
            const c = colorOf(n);
            if (c && !ctx.color) return wrap(`{color:${c}}`, '{/color}', inline(n.childNodes, Object.assign({}, ctx, { color: true }), links));
        }
        return kids();
    }
    // A link was left as a placeholder until its line was built: a bare https:// address is written bare where md.js
    // would link it again (a space or "(" before it, a space or punctuation after), and as [text](address) otherwise.
    function placeLinks(s, links) {
        return s.replace(/\u0001(\d+)\u0001/g, (m, i, at) => {
            const { href, text } = links[Number(i)];
            const before = at === 0 ? '' : s[at - 1], rest = s.slice(at + m.length);
            const bare = text === href && /^https:\/\/[^\s<)&'"]*[^\s<).,;:!?'&]$/.test(href)
                && (before === '' || /[\s(]/.test(before)) && /^($|[\s)]|[.,;:!?'](\s|$))/.test(rest);
            return bare ? href : `[${text.replace(/\]/g, '')}](${href.replace(/\)/g, '%29').replace(/\s/g, '%20')})`;
        });
    }
    // md.js only reads *…* (or _…_) as italic with no letter or digit just outside it, and no * just before. The
    // source already met that, so its markers go back as they were; an edit that italicised the middle of a phrase
    // ("foo<i> bar</i>") gets its edge spaces moved outside the markers, which is what makes it read.
    function placeItalics(s) {
        return s.replace(/\u0002([*_])([\s\S]*?)\u0003\1/g, (m, mk, inner, at) => {
            const before = s[at - 1] || '', after = s[at + m.length] || '';
            const okBefore = (b) => b === '' || (mk === '*' ? !/[*\w]/.test(b) : !/\w/.test(b));
            const okAfter = (a) => a === '' || !/\w/.test(a);
            if (okBefore(before) && okAfter(after)) return mk + inner + mk;
            const lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0], core = inner.slice(lead.length, inner.length - trail.length);
            return lead + mk + core + mk + trail;
        });
    }
    const lineOf = (nodes, ctx) => { const links = []; return placeItalics(placeLinks(inline(nodes, ctx || {}, links), links)); };

    // ---- blocks ----
    function paragraph(nodes) {
        const lines = lineOf(nodes).split('\n');
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();   // the browser's trailing <br>
        while (lines.length && !lines[0].trim()) lines.shift();
        return lines.length ? lines.join('\n') : null;
    }
    // Numbers carry on across the lists of one section: steps split up by a screenshot are written 1., 2., 3. as the
    // source had them (md.js shows every list from 1 either way, so this only keeps the source's own lines intact).
    function listLines(list, level, start) {
        const out = [];
        let n = start || 0;
        for (const li of list.children) {
            if (li.tagName === 'UL' || li.tagName === 'OL') { out.push(...listLines(li, level + 1)); continue; }   // a list the browser nested without an <li>
            const own = [], nested = [];
            for (const c of li.childNodes) (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL') ? nested : own).push(c);
            let box = '';
            if (li.classList && li.classList.contains('md-check')) {
                const b = li.querySelector('.md-box');
                box = b && b.classList.contains('on') ? '[x] ' : '[ ] ';
            }
            const marker = list.tagName === 'OL' ? `${++n}.` : '-';
            out.push(`${'  '.repeat(level)}${marker} ${box}${lineOf(own).replace(/\n/g, ' ').trim()}`);   // an item is one line
            for (const sub of nested) out.push(...listLines(sub, level + 1));
        }
        return out;
    }
    function tableMd(table) {
        const rows = [...table.querySelectorAll('tr')].filter(tr => tr.closest('table') === table)
            .map(tr => [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH')
                .map(c => lineOf(c.childNodes).replace(/\n/g, ' ').replace(/\|/g, '/').trim()));
        if (!rows.length || !rows[0].length) return null;
        const head = rows[0], line = (r) => `| ${head.map((_, i) => r[i] || '').join(' | ')} |`;
        return [line(head), `|${head.map(() => '---').join('|')}|`, ...rows.slice(1).map(line)].join('\n');
    }
    function blocks(parent) {
        const out = [];
        let run = [], steps = 0;   // ordered items so far in this section
        const flush = () => { if (run.length) { const p = paragraph(run); if (p != null) out.push(p); run = []; } };
        for (const n of parent.childNodes) {
            if (!isBlock(n)) { run.push(n); continue; }
            flush();
            const t = n.tagName;
            if (/^H[1-6]$/.test(t)) {
                steps = 0;
                const text = lineOf(n.childNodes).replace(/\n/g, ' ').trim();
                if (text) out.push(`${'#'.repeat({ H1: 1, H2: 1, H3: 2 }[t] || 3)} ${text}`);
            } else if (t === 'UL' || t === 'OL') {
                const l = listLines(n, 0, t === 'OL' ? steps : 0);
                if (t === 'OL') steps += [...n.children].filter(c => c.tagName === 'LI').length;
                if (l.length) out.push(l.join('\n'));
            } else if (t === 'BLOCKQUOTE') {
                const inner = blocks(n).join('\n\n');
                if (inner.trim()) out.push(inner.split('\n').map(l => l ? '> ' + l : '>').join('\n'));
            } else if (t === 'PRE') {
                out.push('```\n' + n.textContent.replace(/\n$/, '') + '\n```');
            } else if (t === 'HR') {
                out.push('---');
            } else if (t === 'TABLE' || (t === 'DIV' && n.querySelector(':scope > table') && !n.querySelector(':scope > :not(table)'))) {
                const md = tableMd(t === 'TABLE' ? n : n.querySelector(':scope > table'));
                if (md) out.push(md);
            } else if ([...n.childNodes].some(isBlock)) {
                out.push(...blocks(n));   // a wrapper (a pasted <div>, a stray <li>) holding blocks of its own
            } else {
                const p = paragraph(n.childNodes);
                if (p != null) out.push(p);
            }
        }
        flush();
        return out;
    }
    const toMarkdown = (root) => blocks(root).join('\n\n');

    // ---- paste ----
    // Rebuilt from scratch rather than filtered: the clipboard's HTML is parsed into an inert document (nothing in it
    // runs or loads), and only the formatting md.js knows is copied out, as fresh elements with no other attributes.
    const DROP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
        'SVG', 'MATH', 'CANVAS', 'VIDEO', 'AUDIO', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'CAPTION', 'COLGROUP', 'XML']);
    const SAME = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', P: 'p', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote',
        BR: 'br', HR: 'hr', TABLE: 'table', THEAD: 'thead', TBODY: 'tbody', TFOOT: 'tbody', TR: 'tr', TH: 'th', TD: 'td', CODE: 'code',
        H1: 'h2', H2: 'h3', H3: 'h4', H4: 'h4', H5: 'h4', H6: 'h4' };
    // Word and Google Docs color every run, mostly in black; only a real color is kept.
    const PLAIN = /^(#0{3}(0{3})?|#1[0-9a-f]1[0-9a-f]1[0-9a-f]|windowtext|black|inherit|initial|auto|currentcolor|unset)$/i;
    function sanitize(html) {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        const out = document.createElement('div');
        let images = 0;
        const walk = (src, dst) => {
            for (const n of [...src.childNodes]) {
                if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
                if (n.nodeType !== 1) continue;
                const t = n.tagName.toUpperCase(), style = n.getAttribute('style') || '';
                if (DROP.has(t) || t.includes(':') || /mso-list\s*:\s*ignore/i.test(style)) continue;   // <o:p>, Word's own bullet text
                if (t === 'IMG') {
                    const s = n.getAttribute('src') || '';
                    if (FILES_IMG.test(s) || LIB_IMG.test(s)) { const i = document.createElement('img'); i.className = 'md-img'; i.src = s; i.alt = n.getAttribute('alt') || ''; dst.appendChild(i); }
                    else images++;
                    continue;
                }
                if (t === 'PRE') { const p = document.createElement('pre'); p.textContent = n.textContent; dst.appendChild(p); continue; }
                if (t === 'A') {
                    const href = (n.getAttribute('href') || '').trim();
                    if (LINK.test(href)) { const a = document.createElement('a'); a.setAttribute('href', href); walk(n, a); dst.appendChild(a); }
                    else walk(n, dst);
                    continue;
                }
                let el = null;
                if (t === 'B' && /font-weight\s*:\s*(normal|[1-4]00)\b/i.test(style)) el = null;   // Google Docs' wrapper <b> is not bold
                else if (SAME[t]) el = document.createElement(SAME[t]);
                // A Word list paragraph becomes a list item; the lists are put together below.
                const wordList = (t === 'P' || t === 'DIV') && style.match(/mso-list\s*:\s*l\d+\s+level(\d+)/i);
                if (wordList) {
                    el = document.createElement('li');
                    el.dataset.level = String(Number(wordList[1]) - 1);
                    const ignored = n.querySelector('[style*="mso-list"]');
                    el.dataset.ordered = ignored && /^\s*[0-9a-z]{1,4}[.)]/i.test(ignored.textContent) ? '1' : '';
                }
                // Styled runs (Google Docs, web pages): weight, slant, underline and color become their own elements.
                let target = dst, top = null;
                const add = (tag) => { const e = document.createElement(tag); if (top) target.appendChild(e); else top = e; target = e; return e; };
                if (el) { top = el; target = el; }
                if (!SAME[t] || t === 'P') {
                    if (/font-weight\s*:\s*(bold|[6-9]00)\b/i.test(style) && t !== 'B' && t !== 'STRONG') add('strong');
                    if (/font-style\s*:\s*italic/i.test(style) && t !== 'I' && t !== 'EM') add('em');
                    if (/text-decoration[a-z-]*\s*:[^;]*underline/i.test(style) && t !== 'U') add('u');
                    const cm = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i) || (t === 'FONT' && [null, n.getAttribute('color')]);
                    const c = cm && cssColor(cm[1]);
                    if (c && !PLAIN.test(c)) add('span').setAttribute('style', `color:${c}`);
                }
                walk(n, target);
                if (top) dst.appendChild(top);
            }
        };
        walk(doc.body, out);
        groupWordLists(out);
        return { html: out.innerHTML, droppedImages: images };
    }
    // Word pastes a list as a run of paragraphs, each carrying its level; they become one nested <ul>/<ol>.
    function groupWordLists(root) {
        for (const p of [...root.querySelectorAll('li[data-level]')]) {
            if (!p.parentNode || p.parentNode.closest && p.parentNode.closest('ul,ol')) continue;
            const run = [p];
            let nx = p.nextSibling;
            while (nx && (nx.nodeType === 3 && !nx.nodeValue.trim() || nx.nodeType === 1 && nx.matches('li[data-level]'))) { if (nx.nodeType === 1) run.push(nx); nx = nx.nextSibling; }
            const stack = [];
            const top = document.createElement(p.dataset.ordered ? 'ol' : 'ul');
            p.parentNode.insertBefore(top, p);
            stack.push(top);
            for (const li of run) {
                const lvl = Math.min(Number(li.dataset.level) || 0, stack.length);
                while (stack.length > lvl + 1) stack.pop();
                if (stack.length === lvl) {
                    const sub = document.createElement(li.dataset.ordered ? 'ol' : 'ul');
                    (stack[stack.length - 1].lastElementChild || stack[stack.length - 1]).appendChild(sub);
                    stack.push(sub);
                }
                delete li.dataset.level; delete li.dataset.ordered;
                stack[stack.length - 1].appendChild(li);
            }
        }
    }

    window.KBRich = { toMarkdown, sanitize, cssColor };
})();
