// Safe Markdown for the Knowledge Base (entries, replies and version previews).
// Everything is HTML-escaped first; only this small set of formatting is turned
// back into markup, so nothing a VA types can run as code on the page:
//   # / ## / ### headings, **bold**, *italic* / _italic_, ++underline++,
//   {color:#D33}colored text{/color} (a #hex code or a CSS color name), `code`, [text](https://…),
//   ```fenced code```, ![image](/img/<id>) (images the library has copied) and
//   ![photo](/files/<id>/<name>) (photos uploaded to the library), - / * / 1. lists,
//   - [ ] / - [x] checklists, > quotes, --- rules, | pipe | tables |
(function () {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function inline(text) {
        let s = esc(text);
        const code = [];
        s = s.replace(/`([^`\n]+)`/g, (_, c) => { code.push(c); return `\u0000${code.length - 1}\u0000`; });
        s = s.replace(/!\[([^\]\n]*)\]\((\/img\/[0-9a-f]{16})\)/g, (_, t, u) => `<img class="md-img" loading="lazy" src="${u}" alt="${t}">`);
        // Photos uploaded to the library: the editor's 🖼️ Photo button writes ![name](/files/<id>/<name>).
        s = s.replace(/!\[([^\]\n]*)\]\((\/files\/[0-9a-f-]{36}\/[^\s)]+)\)/g, (_, t, u) => `<img class="md-img" loading="lazy" src="${u}" alt="${t}">`);
        s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, (_, t, u) =>
            `<a href="${u}"${/^https?:/.test(u) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${t}</a>`);
        s = s.replace(/(^|[\s(])(https:\/\/[^\s<)]*[^\s<).,;:!?'&])/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
        // Colored text: {color:#D33}…{/color} with a 3- or 6-digit hex code, or a plain color name (letters only,
        // so nothing can escape the style attribute). An unknown name simply isn't colored by the browser.
        s = s.replace(/\{color:(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})|[a-zA-Z]{3,20})\}([^\n{]+)\{\/color\}/g, '<span style="color:$1">$2</span>');
        s = s.replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>');
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
            if (/^```/.test(line)) {
                const code = []; i++;
                while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
                i++; out.push(`<pre class="md-code"><code>${esc(code.join('\n'))}</code></pre>`); continue;
            }
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
                // a list, with sub-lists where lines are indented by two spaces per level
                const items = [];
                while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
                    const m2 = lines[i].match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
                    let t = m2[3]; i++;
                    while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) { t += ' ' + lines[i].trim(); i++; }
                    items.push({ level: Math.floor(m2[1].replace(/\t/g, '  ').length / 2), ordered: /\d/.test(m2[2]), text: t });
                }
                const li = (t) => { const cb = t.match(/^\[( |x|X)\]\s+(.*)$/);
                    return cb ? `<li class="md-check"><span class="md-box${cb[1] === ' ' ? '' : ' on'}" aria-hidden="true">${cb[1] === ' ' ? '' : '✓'}</span>${inline(cb[2])}` : `<li>${inline(t)}`; };
                let html = '', stack = [];   // stack of open list tags
                for (const it of items) {
                    const lvl = Math.min(it.level, stack.length);   // never jump more than one level deeper
                    while (stack.length > lvl + 1) html += `</li></${stack.pop()}>`;
                    const want = it.ordered ? 'ol' : 'ul';
                    if (stack.length === lvl + 1 && stack[lvl] !== want) html += `</li></${stack.pop()}>`;   // a different kind of list starts at this level
                    if (stack.length === lvl + 1) html += '</li>';
                    if (stack.length === lvl) { const tag = it.ordered ? 'ol' : 'ul'; html += `<${tag}>`; stack.push(tag); }
                    html += li(it.text);
                }
                while (stack.length) html += `</li></${stack.pop()}>`;
                out.push(html); continue;
            }
            const para = [];
            while (i < lines.length && lines[i].trim() && !/^```|^(#{1,4})\s|^\s*([-*]|\d+[.)])\s+|^\s*>|^\s*\|.*\|\s*$|^\s*(---|\*\*\*|___)\s*$/.test(lines[i])) { para.push(inline(lines[i])); i++; }
            if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
            else { out.push(`<p>${inline(line)}</p>`); i++; }
        }
        return out.join('\n');
    }

    // Plain text for search and snippets.
    function plain(md) {
        return String(md || '').replace(/`/g, '').replace(/\{color:[^}\n]{1,24}\}/g, '').replace(/\{\/color\}/g, '')
            .replace(/\+\+/g, '').replace(/\[( |x|X)\]\s*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[#>\s-]+|\*\*|__|\|/gm, ' ').replace(/\s+/g, ' ').trim();
    }

    window.KBmd = { render, plain, esc };
})();
