import json, os, subprocess, sys, tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

# The server request meter (README → Server request meter), against `npm run dev` like e2e.py; run it after e2e.py.
# - /api/request-budget: refused before signing in (401), to a VA and to a reviewer (403); an admin gets usage: null
#   until the Request budget workflow has saved its numbers to LSH_KV ("_request-usage"), then the month's numbers
#   without the workflow's own working data;
# - in the browser: a VA's pages have no meter and never ask for it; an admin's page shows it after one request and
#   keeps it from page to page, clear of the toasts on a phone; signing out removes it.
# The meter itself (every level, the note, the details): request-meter-widget.cjs.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get('CHROME')  # optional path to a Chromium binary
B = 'http://127.0.0.1:8787'
CODE = 'lsh-team-2026'
ok = []
def check(cond, label):
    ok.append((bool(cond), label))
    print(('PASS ' if cond else 'FAIL ') + label, flush=True)

def kv(*args):
    # the local LSH_KV that `npm run dev` uses
    return subprocess.run(['npx', 'wrangler', 'kv', 'key', *args, '--binding', 'LSH_KV', '--local'], cwd=ROOT, capture_output=True, text=True)

def call(pg, url, data=None):
    return pg.evaluate("""async ([u, d]) => { const r = await fetch(u, d ? {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d)} : {});
        let b = null; try { b = await r.json(); } catch (e) {} return {status: r.status, body: b}; }""", [url, data])

# A billing month that started 5 days ago, checked 10 minutes ago: 25% used, at a pace that runs out before it resets.
day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
start = day - timedelta(days=5)
SNAPSHOT = {
    'v': 1, 'at': (datetime.now(timezone.utc) - timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
    'month': {'start': start.strftime('%Y-%m-%d'), 'end': (start + timedelta(days=30)).strftime('%Y-%m-%d')},
    'total': 2497500, 'limit': 9990000, 'included': 10000000, 'projected': 13600000, 'paused': False, 'pausedAt': None,
    'sites': [{'kind': 'worker', 'name': 'ea-pa-training', 'requests': 2000000}, {'kind': 'worker', 'name': 'lsh-knowledge-base', 'requests': 497500}],
    'days': {}, 'notes': [], 'cache': {'through': start.isoformat(), 'scripts': [], 'days': {}}
}

def watch(pg):
    pg.asked = []
    pg.on('request', lambda r: pg.asked.append(r.url) if urlparse(r.url).path == '/api/request-budget' else None)
    return pg

def sign_in_admin(pg):
    pg.goto(B + '/'); pg.wait_for_selector('#f-va')
    pg.click('[data-tab="admin"]'); pg.fill('#g-user', 'trainer1'); pg.fill('#g-pass', 'admin-pass')
    pg.click('#f-admin button[type=submit]'); pg.wait_for_selector('.hero')

def chip(pg):
    return pg.evaluate("(() => { const c = document.getElementById('rqb-chip'); return c ? c.textContent.replace(/\\s+/g, ' ').trim() + ' | ' + c.className : ''; })()")

kv('delete', '_request-usage')   # start from "the workflow hasn't run yet"

with sync_playwright() as p:
    br = p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))
    errs = []

    # ================= the endpoint =================
    N = br.new_context(); n = N.new_page(); n.goto(B + '/favicon.png')
    check(call(n, B + '/api/request-budget')['status'] == 401, 'the meter’s numbers are refused before signing in (401)')

    A = br.new_context(viewport={'width': 1360, 'height': 900}); a = watch(A.new_page())
    a.on('pageerror', lambda e: errs.append(str(e)))
    sign_in_admin(a)
    call(a, B + '/api/admin', {'action': 'set-code', 'code': CODE})
    call(a, B + '/api/admin', {'action': 'grant-reviewer', 'name': 'Rae Santos', 'batch': 'Batch 12'})
    none = call(a, B + '/api/request-budget')
    check(none['status'] == 200 and none['body'].get('ok') is True and none['body'].get('usage', 'missing') is None, f"an admin gets usage: null before the Request budget workflow has run ({none})")

    V = br.new_context(viewport={'width': 1360, 'height': 900}); v = watch(V.new_page())
    v.on('pageerror', lambda e: errs.append(str(e)))
    v.goto(B + '/'); v.wait_for_selector('#f-va')
    v.fill('#g-name', 'Jo Cruz'); v.fill('#g-batch', 'Batch 11'); v.fill('#g-code', CODE); v.click('#f-va button[type=submit]'); v.wait_for_selector('.hero')
    r = call(v, B + '/api/request-budget')
    check(r['status'] == 403 and 'usage' not in (r['body'] or {}), 'a VA is refused (403)')
    R = br.new_context(); rv = R.new_page(); rv.goto(B + '/'); rv.wait_for_selector('#f-va')
    rv.fill('#g-name', 'Rae Santos'); rv.fill('#g-batch', 'Batch 12'); rv.fill('#g-code', CODE); rv.click('#f-va button[type=submit]'); rv.wait_for_selector('.hero')
    check('Review' in rv.inner_text('#top-nav') and call(rv, B + '/api/request-budget')['status'] == 403, 'a reviewer is refused too (403): admins only')

    f = os.path.join(tempfile.mkdtemp(), 'usage.json'); open(f, 'w').write(json.dumps(SNAPSHOT))
    put = kv('put', '_request-usage', '--path', f)
    some = call(a, B + '/api/request-budget')
    u = (some['body'] or {}).get('usage') or {}
    check(put.returncode == 0 and u.get('total') == 2497500 and u.get('month') == SNAPSHOT['month'] and len(u.get('sites', [])) == 2 and 'cache' not in u,
          f"after it has run, an admin gets the month’s numbers without the workflow’s working data ({put.stderr[-200:] if put.returncode else list(u)})")

    # ================= the page =================
    v.asked.clear()   # the 403 above was this test's own request
    v.goto(B + '/'); v.wait_for_selector('.hero'); v.wait_for_timeout(2500)
    v.goto(B + '/#/mine'); v.wait_for_timeout(2500)
    check(not v.query_selector('#rqb-chip') and not v.asked, f"a VA’s pages show no meter and never ask for it ({len(v.asked)} requests)")

    A2 = br.new_context(viewport={'width': 1440, 'height': 900}); a2 = watch(A2.new_page())
    a2.on('pageerror', lambda e: errs.append(str(e)))
    sign_in_admin(a2)
    a2.wait_for_selector('#rqb-chip', timeout=6000); a2.wait_for_timeout(800)
    c = chip(a2)
    check('Requests 25%' in c and 'rqb-warn' in c, f"an admin’s page shows the meter: “{c}” (25%, amber: this pace runs out before the month ends)")
    check(len(a2.asked) == 1, f"it asked for the numbers once on opening ({len(a2.asked)})")
    for h in ['#/admin', '#/review', '#/c/lien', '#/mine', '#/']:
        a2.evaluate('h => { location.hash = h; }', h); a2.wait_for_timeout(700)
    check(a2.query_selector('#rqb-chip') is not None and len(a2.asked) == 1, f"it stays from page to page without asking again ({len(a2.asked)} requests)")
    a2.click('#rqb-chip')
    panel = a2.evaluate("(() => { const el = document.getElementById('rqb-panel'); return { text: el.textContent, me: (el.querySelector('tr.rqb-me') || {}).textContent || '' }; })()")
    check('2,497,500' in panel['text'] and 'Knowledge Base' in panel['me'], 'the details show the month’s total, with the Knowledge Base highlighted among the sites')
    a2.keyboard.press('Escape')
    a2.click('#signout'); a2.wait_for_selector('#f-va'); a2.wait_for_timeout(2500)
    check(not a2.query_selector('#rqb-chip'), 'signing out removes the meter')

    # a phone: the chip stays clear of the toasts (bottom centre)
    a.set_viewport_size({'width': 390, 'height': 844})
    a.goto(B + '/#/admin'); a.wait_for_selector('#code-form'); a.wait_for_selector('#rqb-chip', timeout=6000)
    a.evaluate("document.querySelector('#rqb-note [data-rqb=dismiss]') && document.querySelector('#rqb-note [data-rqb=dismiss]').click()")
    a.fill('#rev-name', 'Rae Santos'); a.fill('#rev-batch', 'Batch 12'); a.click('#rev-form button'); a.wait_for_selector('#toast:not([hidden])')
    gap = a.evaluate("document.getElementById('toast').getBoundingClientRect().top - document.getElementById('rqb-chip').getBoundingClientRect().bottom")
    check(gap > 0, f"on a phone the chip sits above the toast ({gap:.0f}px)")

    check(not errs, 'no page errors ' + '; '.join(errs[:3]))
    br.close()

bad = [l for c, l in ok if not c]
print(f'\n{len(ok) - len(bad)}/{len(ok)} passed')
sys.exit(1 if bad else 0)
