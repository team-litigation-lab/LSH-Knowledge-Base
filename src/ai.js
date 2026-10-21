import { json, fail, clean, oneLine } from './util.js';
import { overLimit } from './db.js';

// The AI Editor. One card at a time: the editor's "✨ AI Editor" panel sends a single card
// (a heading and the text under it, or the whole entry when it has no headings) and gets back
// the same text with the grammar fixed, or the same content reorganised, plus a short list of
// what changed. Nothing is saved here: the writer reads each card's suggestion and applies the
// ones they want, so the AI never changes the library by itself.
//
// It runs on Workers AI (the AI binding in wrangler.jsonc) — no API key to keep, and the text
// never leaves Cloudflare. AI_MODEL (a plain-text var) can point at another model.

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const LIMIT = 8000;   // characters of one card; the panel splits a long entry by heading

const HOUSE = `You are the copy editor for the LSH Knowledge Base, the library a team of legal virtual assistants writes for itself.
House style:
- US English, sentence case headings, plain words, short sentences, the second person ("call the adjuster", not "the adjuster should be called").
- Markdown only: # ## ### headings, - bullets, 1. numbered steps, - [ ] checklists, **bold**, *italic*, ++underline++, | pipe | tables |, > quotes.
- Keep every fact, name, number, deadline, link, file name, table cell and markdown mark exactly as it is. Never add information, never remove a step, never shorten the content.
- Leave legal and medical terms, firm names and software names alone.`;

const TASK = {
    grammar: `Fix only the writing: spelling, grammar, punctuation, verb tense, subject-verb agreement, capitalisation, duplicated words and sentence case in headings.
Do not reorganise, retitle, merge or split anything. Keep the same paragraphs, list items, rows and order.`,
    structure: `Improve only the structure: make the heading levels consistent, turn a run of steps into a numbered list and a run of items into bullets,
split a wall of text into short paragraphs under clear sentence-case headings, and put a stray line in the section it belongs to.
Keep every sentence's wording as it is unless the structure forces a change, and keep all the content.`
};

const envelope = (mode) => `${HOUSE}

Your task: ${TASK[mode]}

Answer with JSON only, in this shape, and nothing else:
{"text": "the full corrected markdown of the card", "notes": ["what you changed, one short line each, at most 6"]}
If the card already reads well, give back the text unchanged and an empty notes list.`;

// The model sometimes wraps its JSON in a code fence or adds a sentence before it.
function parseReply(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : s;
    const start = body.indexOf('{'), end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const o = JSON.parse(body.slice(start, end + 1));
        if (typeof o.text !== 'string') return null;
        return { text: o.text, notes: Array.isArray(o.notes) ? o.notes : [] };
    } catch (e) {
        return null;
    }
}

export async function assist({ request, env, db, reader }) {
    if (request.method !== 'POST') return fail('POST only.', 405);
    if (!env.AI) return fail('The AI Editor isn’t switched on for this site yet. An admin adds the Workers AI binding (“ai” in wrangler.jsonc) and deploys.', 503, { code: 'NO_AI' });
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }
    const mode = body.mode === 'structure' ? 'structure' : 'grammar';
    const text = String(body.text == null ? '' : body.text);
    if (text.trim().length < 3) return fail('There is nothing to check in this card yet.');
    if (text.length > LIMIT) return fail('This card is too long to check in one go. Check it a heading at a time.', 413);
    if (!reader.admin && await overLimit(request, db, 'assist', 60)) return fail('You’ve run the AI Editor a lot in a short time. Wait a few minutes and try again.', 429);

    const where = [oneLine(body.title, 200) ? `Entry title: ${oneLine(body.title, 200)}` : '', oneLine(body.heading, 200) ? `This card: ${oneLine(body.heading, 200)}` : '']
        .filter(Boolean).join('\n');
    let out;
    try {
        out = await env.AI.run(String(env.AI_MODEL || MODEL), {
            messages: [
                { role: 'system', content: envelope(mode) },
                { role: 'user', content: `${where}\n\nThe card, as markdown:\n${text}` }
            ],
            max_tokens: 4096, temperature: 0.1
        });
    } catch (e) {
        return fail('The AI Editor couldn’t be reached just now. Try again in a moment.', 502);
    }
    const parsed = parseReply(out && (out.response !== undefined ? out.response : out));
    if (!parsed) return fail('The AI Editor answered in a way this page couldn’t read. Try again, or check this card a heading at a time.', 502);
    const suggestion = clean(parsed.text, LIMIT + 2000);
    return json({
        success: true, mode,
        text: suggestion,
        changed: suggestion.trim() !== text.trim(),
        notes: parsed.notes.map(n => oneLine(n, 200)).filter(Boolean).slice(0, 6)
    });
}
