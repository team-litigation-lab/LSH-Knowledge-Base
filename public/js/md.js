// Safe Markdown for the Knowledge Base (entries, replies and version previews).
// Everything is HTML-escaped first; only this small set of formatting is turned
// back into markup, so nothing a VA types can run as code on the page:
//   # / ## / ### headings, **bold**, *italic* / _italic_, `code`, [text](https://…),
//   - / * / 1. lists, - [ ] / - [x] checklists, > quotes, --- rules, | pipe | tables |
(function () {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function inline(text) {
        let s = esc(text);
        const code = [];
        s = s.replace(/`([^`\n]+)`/g, (_, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
        s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, (_, t, u) =>
            `<a href="${u}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${t}</a>`);
        s = s.replace(/(^|[\s(])(https:\/\/[^\s<)]*[^\s<).,;:!?'&])/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
        s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
        return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[i]}</code>`);
    }

    function table(lines) {
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(lines[0]), body = lines.slice(2).map(cells);
        return `<div class="md-table"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${
            body.map(r => `<tr>${head.map((_, i) => `<td>${inline(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }

    function render(md) {
        const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (!line.trim()) { i++; continue; }
            let m;
            if ((m = line.match(/^(#{1,4})\s+(.+)$/))) { const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
            if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
            if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
                const block = [lines[i], lines[i + 1]]; i += 2;
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { block.push(lines[i]); i++; }
                out.push(table(block)); continue;
            }
            if (/^\s*>/.test(line)) {
                const block = []; while (i < lines.length && /^\s*>/.test(lines[i])) { block.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
                out.push(`<blockquote>${render(block.join('\n'))}</blockquote>`); continue;
            }
            if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
                const ordered = /^\s*\d+[.)]\s+/.test(line), items = [];
                while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && (/^\s*\d+[.)]\s+/.test(lines[i]) === ordered)) {
                    let t = lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''); i++;
                    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) { t += ' ' + lines[i].trim(); i++; }
                    const cb = t.match(/^\[( |x|X)\]\s+(.*)$/);
                    items.push(cb ? `<li class="md-check"><span class="md-box${cb[1] === ' ' ? '' : ' on'}" aria-hidden="true">${cb[1] === ' ' ? '' : '✓'}</span>${inline(cb[2])}</li>` : `<li>${inline(t)}</li>`);
                }
                out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`); continue;
            }
            const para = [];
            while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s|^\s*([-*]|\d+[.)])\s+|^\s*>|^\s*\|.*\|\s*$|^\s*(---|\*\*\*|___)\s*$/.test(lines[i])) { para.push(inline(lines[i])); i++; }
            if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
            else { out.push(`<p>${inline(line)}</p>`); i++; }
        }
        return out.join('\n');
    }

    // Plain text for search and snippets.
    function plain(md) {
        return String(md || '').replace(/`/g, '').replace(/\[( |x|X)\]\s*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[#>\s-]+|\*\*|__|\|/gm, ' ').replace(/\s+/g, ' ').trim();
    }

    window.KBmd = { render, plain, esc };
})();
