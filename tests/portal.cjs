// Single sign-on: people sign in once, on the LSH Training Portal, and open the Knowledge Base from there.
// A mock Portal answers /api/verify-ticket (the real one is functions/api/verify-ticket.js in the Training Portal).
// Run against a Worker started WITHOUT KB_CODE_LOGIN and with PORTAL_URL=http://127.0.0.1:8788:  node tests/portal.cjs
const http = require('http');
const B = process.env.BASE || 'http://127.0.0.1:8790';
const failures = []; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) failures.push(m); };
const answers = { 'good-trainee': { ok: true, first: 'Ann', last: 'Lee', batch: 'B300926' }, 'good-admin': { ok: true, admin: true }, 'good-system': { ok: true, system: true } };
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    let t = ''; try { t = JSON.parse(b).ticket; } catch (e) {}
    const a = answers[t] || { ok: false, code: 'signature' };
    res.writeHead(a.ok ? 200 : 401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(a));
  });
}).listen(8788);
const post = (body, cookie) => fetch(B + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
(async () => {
  let r = await fetch(B + '/api/library'); check(r.status === 401, 'no sign-in: the library is closed');
  let s = await (await fetch(B + '/api/session')).json(); check(s.codeLogin === false && s.unlocked === false, 'the team access code sign-in is off');
  r = await post({ action: 'unlock', name: 'Jo Cruz', batch: 'B1', code: 'lsh-team-2026' }); check(r.status === 403 && (await r.json()).code === 'PORTAL_ONLY', 'a name and code no longer sign anyone in');
  r = await post({ action: 'portal-ticket', ticket: 'forged' }); check(r.status === 401, 'a ticket the Portal does not accept is refused');
  r = await post({ action: 'portal-ticket', ticket: 'good-admin' }); check(r.status === 403 && (await r.json()).code === 'ADMIN_PASSWORD_REQUIRED', 'an admin ticket never signs anyone in');
  r = await post({ action: 'portal-ticket', ticket: 'good-system' }); check(r.status === 403, 'a system ticket never signs anyone in');
  r = await post({ action: 'portal-ticket', ticket: 'good-trainee' }); check(r.status === 200, 'a trainee ticket signs the trainee in');
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  s = await (await fetch(B + '/api/session', { headers: { Cookie: cookie } })).json();
  check(s.unlocked === true && s.admin === false && s.who && s.who.name === 'Ann Lee' && s.who.batch === 'B300926', 'the session carries the name and batch from the Portal');
  r = await fetch(B + '/api/library', { headers: { Cookie: cookie } }); check(r.status === 200, 'the trainee opens the library');
  r = await fetch(B + '/api/admin', { headers: { Cookie: cookie } }); check(r.status === 403, 'the trainee cannot open an admin API');
  mock.close();
  console.log(failures.length ? `\n${failures.length} failed` : '\nall passed'); process.exit(failures.length ? 1 : 0);
})();
