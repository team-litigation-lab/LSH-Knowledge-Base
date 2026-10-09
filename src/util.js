// Shared helpers. Token signing and password hashing use the same formats as
// the LSH Training Portal (functions/_utils.js), so the portal's admin
// passwords and the Knowledge Base team access code work here unchanged.

export function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
    });
}
export const fail = (error, status = 400, extra = {}) => json({ success: false, error, ...extra }, status);

export const nowIso = () => new Date().toISOString();
export const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
export const oneLine = (v, n) => clean(v, n * 2).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// An ALL-CAPS title becomes sentence case ("WRITE A WINNING DEMAND LETTER" -> "Write a winning demand letter"). Mixed-case titles are left alone.
// Same rules as scripts/sentence_case.py: keep the two lists in step.
const ACRONYMS = new Set(('SOP SOPS SOL PI VA VAS LSH TAM HIPAA ERISA MRI CT DUI ADR CME PIP UM UIM BI PD EOB HCFA CMS FAQ USA EMG NCV ER ID IME DV HR IP MVA ' +
    'RFP PDF CPT ICD HMO PPO SSI SSDI CPA IRS DOB SSN PHI POA ASAP ETA OCR EHR EMR ICU DME PT OT PCP OB GYN ENT NP PA MD DC RN LPN EA AI FL CA TX NY NJ GA').split(' '));
const PROPER = { medicare: 'Medicare', medicaid: 'Medicaid', tricare: 'Tricare', florida: 'Florida', california: 'California', texas: 'Texas', chartswap: 'Chartswap',
    compex: 'Compex', filevine: 'Filevine', clio: 'Clio', american: 'American', americans: 'Americans' };
const lettersOf = (t) => t.replace(/[^\p{L}]/gu, '');
export function isAllCaps(t) {
    const L = lettersOf(String(t).replace(/\b[A-Z]{1,3}\b(?=\s*[.)])/g, ''));
    return L.length >= 4 && (L.replace(/[^\p{Lu}]/gu, '').length / L.length) > 0.8;
}
export function sentenceCase(t) {
    t = String(t).replace(/\b(I{1,3}|IV|VI{0,3}|IX|X{1,3})\.(?=[A-Za-z])/g, '$1. ');
    let first = true;
    const out = t.split(' ').map(w => {
        const core = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
        if (!core) return w;
        if (!/[A-Za-z]/.test(core)) return w;
        if (first && (/^(?:\d{1,3}|[A-Z])[.)]$/.test(w) || (/^(?:I{1,3}|IV|VI{0,3}|IX|X{1,3})$/.test(core) && /[.)]$/.test(w)))) return w;   // numbering: "1." "A." "IV."
        const up = core.toUpperCase();
        let next;
        if (ACRONYMS.has(up) && core.length > 1) next = up;
        else if (PROPER[core.toLowerCase()]) next = PROPER[core.toLowerCase()];
        else if (/^(?:I{1,3}|IV|VI{0,3}|IX|X{1,3})$/.test(core) && core.length > 1 && !first) next = up;
        else { next = core.toLowerCase(); if (first) next = next[0].toUpperCase() + next.slice(1); }
        first = false;
        return w.replace(core, () => next);
    }).join(' ');
    return out.replace(/\bunited states\b/gi, 'United States').replace(/\bsocial security\b/gi, 'Social Security');
}
export function fixTitle(t) {
    t = String(t).trim();
    const one = t.toUpperCase().replace(/^[.:]+|[.:]+$/g, '');
    return isAllCaps(t) && !(t.split(/\s+/).length === 1 && ACRONYMS.has(one)) ? sentenceCase(t) : t;
}

// Autoformats an existing entry's body the same way a rich paste does (public/js/paste-format.js): a run of
// plain-text lines that line up in the same number of columns (by tab, by a bare "|", or by two or more spaces)
// becomes a markdown pipe table, and a short "Label:" at the very start of a line is bolded — the house style
// already used by hand elsewhere in the library ("**Operational Note:**"). A heading, list, quote, code fence,
// or a table js/md.js already renders is left exactly as it is, and running this twice changes nothing the
// second time (the admin action that uses this keeps going until an entry needs no further change).
export function autoformatBody(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
    const isBlockStart = (l) => /^(#{1,4}\s|\s*([-*]|\d+[.)])\s+|\s*>|\s*(---|\*\*\*|___)\s*$|\s*```)/.test(l);
    const splitRow = (l) => (l.includes('\t') ? l.split('\t') : l.includes('|') ? l.split('|') : l.split(/ {2,}/))
        .map(c => c.trim()).filter(Boolean);

    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        if (!isBlockStart(line) && !isTableRow(line) && line.trim()) {
            const cols = splitRow(line);
            if (cols.length >= 2) {
                const block = [cols]; let j = i + 1;
                while (j < lines.length && lines[j].trim() && !isBlockStart(lines[j]) && !isTableRow(lines[j])) {
                    const next = splitRow(lines[j]);
                    if (next.length !== cols.length) break;
                    block.push(next); j++;
                }
                if (block.length >= 2) {
                    const cell = (c) => c.replace(/\|/g, '/');
                    out.push('| ' + block[0].map(cell).join(' | ') + ' |');
                    out.push('|' + block[0].map(() => ' --- ').join('|') + '|');
                    for (const row of block.slice(1)) out.push('| ' + row.map(cell).join(' | ') + ' |');
                    i = j; continue;
                }
            }
        }

        if (!isBlockStart(line) && !isTableRow(line)) {
            const m = line.match(/^([A-Z][A-Za-z0-9 /&'-]{1,28}:)(?=\s)/);
            if (m) { out.push(`**${m[1]}**${line.slice(m[1].length)}`); i++; continue; }
        }

        out.push(line); i++;
    }
    return out.join('\n');
}

export const personKey = (name, batch) => (oneLine(name, 80) + '|' + oneLine(batch, 40)).toLowerCase();

/* ---------- base64url ---------- */
function toB64u(bytes) {
    let s = '';
    bytes.forEach(b => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64u(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function sameBytes(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
}

/* ---------- signed tokens (HMAC-SHA256) ---------- */
async function hmacKey(secret) {
    if (!secret) throw new Error('SESSION_SECRET is not configured on this Worker.');
    return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function signToken(payload, secret, ttlSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const body = toB64u(new TextEncoder().encode(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds })));
    const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body));
    return `${body}.${toB64u(new Uint8Array(sig))}`;
}
export async function readToken(token, secret) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    try {
        const expected = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body)));
        if (!sameBytes(expected, fromB64u(sig))) return null;
        const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
        if (!p.exp || Math.floor(Date.now() / 1000) > p.exp) return null;
        return p;
    } catch (e) {
        return null;
    }
}

/* ---------- passwords (PBKDF2-SHA256, portal format) ---------- */
async function pbkdf2(password, salt, iterations) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, 256));
}
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2:100000:${toB64u(salt)}:${toB64u(await pbkdf2(password, salt, 100000))}`;
}
export async function verifyPassword(password, stored) {
    if (!stored) return false;
    if (!stored.startsWith('pbkdf2:')) return stored === password;   // legacy plaintext rows, as the portal accepts
    const [, it, salt, hash] = stored.split(':');
    if (!it || !salt || !hash) return false;
    return sameBytes(await pbkdf2(password, fromB64u(salt), parseInt(it, 10)), fromB64u(hash));
}

/* ---------- cookies ---------- */
export function getCookie(request, name) {
    const header = request.headers.get('Cookie') || '';
    const hit = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}
export const setCookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;

// Writes must come from this site's own pages.
export function sameOrigin(request) {
    const origin = request.headers.get('Origin');
    if (!origin) return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
    try { return new URL(origin).host === new URL(request.url).host; } catch (e) { return false; }
}

export async function readJson(request) {
    try { return await request.json(); } catch (e) { return null; }
}
