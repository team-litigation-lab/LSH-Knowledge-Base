// Auto-formatting for pasted material (entries, replies): when what's on the clipboard carries its own
// bold, italic, underline or table formatting (from Word, Google Docs, Excel or a web page), turn that
// formatting into this library's own markdown (see js/md.js) instead of losing it to plain text.
// Regex-based, like js/md.js, so it needs no DOM parser and runs the same in a browser or in Node.
(function () {
    const ENTITIES = {
        nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
        mdash: '—', ndash: '–', hellip: '…',
        lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    };
    function decodeEntities(s) {
        return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
            if (body[0] === '#') {
                const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
                return Number.isFinite(code) ? String.fromCodePoint(code) : m;
            }
            return ENTITIES.hasOwnProperty(body) ? ENTITIES[body] : m;
        });
    }

    // Replaces matches of `re` with `fn(match)`, repeating until nothing changes, so a style like
    // bold-inside-italic (nested spans) is fully unwrapped from the innermost tag outward.
    function peel(html, re, fn) {
        let prev;
        do { prev = html; html = html.replace(re, fn); } while (html !== prev);
        return html;
    }

    function styledSpans(html) {
        return peel(html, /<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (_, attrs, inner) => {
            const style = (attrs.match(/style\s*=\s*"([^"]*)"/i) || [, ''])[1];
            let t = inner;
            if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) t = `**${t}**`;
            if (/font-style\s*:\s*italic/i.test(style)) t = `*${t}*`;
            if (/text-decoration[a-z-]*\s*:\s*[^;"]*underline/i.test(style)) t = `++${t}++`;
            return t;
        });
    }

    function basicInline(html) {
        html = peel(html, /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `**${t}**`);
        html = peel(html, /<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `*${t}*`);
        html = peel(html, /<u\b[^>]*>([\s\S]*?)<\/u>/gi, (_, t) => `++${t}++`);
        html = html.replace(/<a\b[^>]*\bhref\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) =>
            /^(https?:|mailto:)/i.test(href) ? `[${t}](${href})` : t);
        return html;
    }

    // Strips every remaining tag and turns entities back into literal characters, leaving plain text
    // (with whatever **bold**/*italic*/++underline++/[link](url) markup the steps above already added).
    function stripTags(html) {
        return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').trim();
    }

    // A table cell's own content: inline formatting applied, block tags flattened, no leading/trailing blanks.
    function cellMarkdown(html) {
        html = html.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<p\b[^>]*>/gi, '');
        html = styledSpans(html);
        html = basicInline(html);
        return stripTags(html).replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
    }

    function htmlTableToMarkdown(tableHtml) {
        const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
            .map(m => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cellMarkdown(c[1])));
        const grid = rows.filter(r => r.length);
        if (grid.length < 1) return null;
        const width = Math.max(...grid.map(r => r.length));
        const row = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`;
        return [row(grid[0]), `|${Array.from({ length: width }, () => ' --- ').join('|')}|`, ...grid.slice(1).map(row)].join('\n');
    }

    function listsToMarkdown(html) {
        html = html.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) =>
            '\n' + inner.replace(/<li\b[^>]*>/gi, '\n1. ').replace(/<\/li>/gi, '') + '\n');
        html = html.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) =>
            '\n' + inner.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '') + '\n');
        return html.replace(/<\/?[ou]l\b[^>]*>/gi, '').replace(/<\/?li\b[^>]*>/gi, '\n- ');
    }

    function htmlToMarkdown(rawHtml) {
        let html = String(rawHtml || '')
            .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '')               // Word's conditional comments
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
            .replace(/<\/?o:p>/gi, '').replace(/<xml>[\s\S]*?<\/xml>/gi, '');

        // Tables come out as their own markdown block first (and are protected from every later
        // text-level step with a placeholder) because a table's rows must stay exactly as built.
        const tables = [];
        html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (m) => {
            const md = htmlTableToMarkdown(m);
            if (md == null) return '';
            tables.push(md);
            return `\n\u0000TBL${tables.length - 1}\u0000\n`;
        });

        html = html.replace(/<br\s*\/?>/gi, '\n');
        html = listsToMarkdown(html);
        html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n${'#'.repeat(Math.min(4, Number(n)))} ${t}\n`);
        html = styledSpans(html);
        html = basicInline(html);
        html = html.replace(/<\/p>/gi, '\n\n').replace(/<p\b[^>]*>/gi, '').replace(/<\/?div\b[^>]*>/gi, '\n');

        let md = stripTags(html).replace(/\n{3,}/g, '\n\n').trim();
        md = md.replace(/\u0000TBL(\d+)\u0000/g, (_, i) => tables[Number(i)]);
        return md;
    }

    // True when the clipboard's HTML carries formatting this library's markdown can represent
    // (bold, italic, underline or a table) — the signal to convert instead of pasting plain text.
    function hasRichFormatting(html) {
        return /<(strong|b|em|i|u|table)\b/i.test(html) ||
            /style\s*=\s*"[^"]*(font-weight\s*:\s*(bold|[6-9]00)|font-style\s*:\s*italic|text-decoration[a-z-]*\s*:\s*[^;"]*underline)/i.test(html);
    }

    // Plain-text paste with no HTML (or HTML with nothing to convert): tab-separated rows, the shape
    // a spreadsheet's plain-text clipboard takes, still become a table when there are at least two
    // rows with the same number of tab-separated columns (more than one, so a single tab stop doesn't count).
    function looksLikeTabTable(text) {
        const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim());
        if (lines.length < 2) return false;
        const cols = lines[0].split('\t').length;
        return cols > 1 && lines.every(l => l.split('\t').length === cols);
    }

    function tabTextToMarkdown(text) {
        const rows = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim())
            .map(l => l.split('\t').map(c => c.trim().replace(/\|/g, '/')));
        const width = rows[0].length;
        const row = (r) => `| ${r.join(' | ')} |`;
        return [row(rows[0]), `|${Array.from({ length: width }, () => ' --- ').join('|')}|`, ...rows.slice(1).map(row)].join('\n');
    }

    window.KBPasteFormat = { htmlToMarkdown, hasRichFormatting, looksLikeTabTable, tabTextToMarkdown };
})();
