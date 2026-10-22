import { nowIso } from './util.js';
import { makeLive } from './db.js';

// Course handouts kept in step with their source. A handout written in a course repository (an HTML page that is also
// rendered to the course's PDF) is fetched from GitHub, turned into the library's Markdown and published as a new version
// of its page whenever the text has changed. It runs on the Worker's schedule (wrangler.jsonc "triggers") and from
// Admin → POST /api/admin {action: 'sync-course-handouts'}; scripts/sync_course_handouts.mjs writes the same text into
// public/seed/docs.json, so the bundled copy (Import documents) never brings an older version back.
// A page someone edited by hand is left alone: it is only updated while its live version is one a machine wrote.
export const COURSE_HANDOUTS = [
    {
        ref: 'seed:cc1dd740-operational-conflict-resolution-intake-planning-treatment.docx.pdf',
        url: 'https://raw.githubusercontent.com/team-litigation-lab/Case-Management-Training/main/build/case-flow/documents/handouts/OPERATIONAL_CONFLICT_RESOLUTION_INTAKE_PLANNING_TREATMENT.html'
    }
];
export const SYNC_NOTE = 'Updated from the course handout';
// Versions written by the Knowledge Base's own tools, not by a person.
const MACHINE_NOTES = new Set([SYNC_NOTE, 'Updated from the bundled document', 'Added from the bundled documents',
    'Title put in sentence case', 'Autoformatted: tables and bold labels']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', middot: '·', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
});
// inline markup: <b>/<strong> → **, <i>/<em> → *, everything else dropped, whitespace collapsed
const inline = (h) => decode(String(h)
    .replace(/<(b|strong)\b[^>]*>\s*([\s\S]*?)\s*<\/\1>/gi, (_, t, x) => `**${x.replace(/<[^>]+>/g, '')}**`)
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ').trim();

// The handout HTML (headings, paragraphs, nested lists, one table) as the library's Markdown. The page's own title block
// (.handout-head) becomes the opening lines; h2 → ###, h3 and h4 → ####, as the converted handouts already read.
export function handoutToMd(html) {
    const body = String(html).replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '').replace(/<!--[\s\S]*?-->/g, '');
    const out = [];
    const head = body.match(/<div class="handout-head">[\s\S]*?<\/h1>[\s\S]*?(?:<div class="sub">[\s\S]*?<\/div>\s*)?<\/div>/i);
    let rest = body;
    if (head) {
        const h = head[0];
        const kicker = (h.match(/class="kicker">([\s\S]*?)<\/div>/i) || [])[1];
        const title = (h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
        const sub = (h.match(/class="sub">([\s\S]*?)<\/div>/i) || [])[1];
        if (kicker) out.push(`## ${inline(kicker)}`);
        if (title) out.push(`#### ${inline(title)}`);
        if (sub) out.push(inline(sub));
        rest = body.replace(h, '');
    }
    // a nested list's items, each with its own nested list under it
    const list = (inner, depth) => {
        const lines = [];
        let level = 0, start = -1, m;
        const tag = /<(\/?)(li|ul|ol)\b[^>]*>/gi;
        while ((m = tag.exec(inner))) {
            const close = m[1] === '/', name = m[2].toLowerCase();
            if (name === 'li' && !close && level === 0) start = tag.lastIndex;
            if (name === 'ul' || name === 'ol') level += close ? -1 : 1;
            if (name === 'li' && close && level === 0 && start >= 0) {
                const item = inner.slice(start, m.index), open = item.search(/<(ul|ol)\b/i);
                lines.push(`${'  '.repeat(depth)}- ${inline(open < 0 ? item : item.slice(0, open))}`);
                if (open >= 0) { const sub = balanced(item, open); lines.push(...list(sub.inner, depth + 1)); }
                start = -1;
            }
        }
        return lines;
    };
    // the element that opens at index `at`, up to its own closing tag (lists may hold lists of the same kind)
    const balanced = (s, at) => {
        const open = /^<([a-z0-9]+)\b[^>]*>/i.exec(s.slice(at)), name = open[1].toLowerCase(), from = at + open[0].length;
        const t = new RegExp(`<(\\/?)${name}\\b[^>]*>`, 'gi'); t.lastIndex = from;
        let depth = 1, m;
        while ((m = t.exec(s))) { depth += m[1] ? -1 : 1; if (!depth) return { tag: name, inner: s.slice(from, m.index), end: t.lastIndex }; }
        return { tag: name, inner: s.slice(from), end: s.length };
    };
    // walk the blocks in order
    const blockStart = /<(h[1-6]|p|ul|ol|table)\b[^>]*>/gi;
    let bm;
    while ((bm = blockStart.exec(rest))) {
        const { tag: t, inner, end } = balanced(rest, bm.index);
        blockStart.lastIndex = end;
        if (t === 'h1' || t === 'h2') out.push(`### ${inline(inner)}`);
        else if (t[0] === 'h') out.push(`#### ${inline(inner)}`);
        else if (t === 'p') { const x = inline(inner); if (x) out.push(x); }
        else if (t === 'ul' || t === 'ol') out.push(list(inner, 0).join('\n'));
        else if (t === 'table') {
            const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => inline(c[1]).replace(/\|/g, '/')));
            if (rows.length) out.push([`| ${rows[0].join(' | ')} |`, `|${rows[0].map(() => '---').join('|')}|`, ...rows.slice(1).map(r => `| ${r.join(' | ')} |`)].join('\n'));
        }
    }
    return out.join('\n\n');
}

// Brings each course handout's page up to date with its source. Returns what happened to each, for the admin and the logs.
export async function syncCourseHandouts(env, db, { fetchImpl = fetch } = {}) {
    const results = [];
    for (const h of COURSE_HANDOUTS) {
        try {
            const res = await fetchImpl(h.url, { headers: { 'User-Agent': 'lsh-knowledge-base' } });
            if (!res.ok) { results.push({ ref: h.ref, status: 'source-unavailable', http: res.status }); continue; }
            const body = handoutToMd(await res.text());
            if (body.length < 200) { results.push({ ref: h.ref, status: 'source-empty' }); continue; }
            const e = await db.prepare(`SELECT e.id, r.data, r.note FROM lib_entries e JOIN lib_revisions r ON r.id = e.live_rev WHERE e.legacy_ref = ?`).bind(h.ref).first();
            if (!e) { results.push({ ref: h.ref, status: 'not-in-library' }); continue; }   // Import documents adds it first
            const data = JSON.parse(e.data);
            if (data.body === body) { results.push({ ref: h.ref, status: 'up-to-date' }); continue; }
            if (!MACHINE_NOTES.has(e.note || '')) { results.push({ ref: h.ref, status: 'edited-by-hand', note: e.note || '' }); continue; }
            const rev = await db.prepare(`INSERT INTO lib_revisions (entry_id, data, status, note, author_name, author_batch, author_key, by_staff, created_at)
                VALUES (?, ?, 'pending', ?, 'LSH Case Management Training', '', 'sync:course-handouts', 1, ?)`)
                .bind(e.id, JSON.stringify({ ...data, body, files: [] }), SYNC_NOTE, nowIso()).run();
            await makeLive(db, e.id, rev.meta.last_row_id, { reviewer: 'Automatic update from the course' });
            results.push({ ref: h.ref, status: 'updated', entry: e.id });
        } catch (err) {
            results.push({ ref: h.ref, status: 'error', error: String((err && err.message) || err) });
        }
    }
    return results;
}
