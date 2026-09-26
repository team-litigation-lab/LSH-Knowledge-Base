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
