import base64, hashlib, json, re, sys
from playwright.sync_api import sync_playwright

import os, tempfile
# End-to-end test against `npm run dev` with the seeds in tests/ (see README).
#   pip install playwright; npm pack pdfjs-dist@3.11.174 and unpack it to tests/.cache/pdfjs (for PDF text)
HERE = os.path.dirname(os.path.abspath(__file__)) + '/'
D = tempfile.mkdtemp() + '/'
CHROME = os.environ.get('CHROME')  # optional path to a Chromium binary
B = 'http://127.0.0.1:8787'
ok = []
def check(cond, label):
    ok.append((bool(cond), label))
    print(('PASS ' if cond else 'FAIL ') + label, flush=True)


def jget(pg, url):
    return pg.evaluate("async u => (await fetch(u)).json()", url)
def jpost(pg, url, data, origin=None):
    return pg.evaluate("""async ([u, d]) => { const r = await fetch(u, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(d)});
        let b = {}; try { b = await r.json(); } catch (e) {} return {status: r.status, ok: r.ok, body: b}; }""", [url, data])
def fetchinfo(pg, url, headers=None):
    return pg.evaluate("""async ([u, h]) => { const r = await fetch(u, {headers: h || {}}); const buf = await r.arrayBuffer();
        const d = await crypto.subtle.digest('SHA-256', buf); const hex = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2,'0')).join('');
        return {status: r.status, len: buf.byteLength, sha: hex, cd: r.headers.get('content-disposition') || '', ct: r.headers.get('content-type') || '', cr: r.headers.get('content-range') || ''}; }""", [url, headers])

with sync_playwright() as p:
    br = p.chromium.launch(**({'executable_path': CHROME} if CHROME else {}))

    # ---- make a small real webm with MediaRecorder ----
    tmp = br.new_page()
    tmp.goto(B + '/favicon.png')
    b64 = tmp.evaluate("""async () => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d');
        const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm;codecs=vp8' }); const chunks = [];
        rec.ondataavailable = e => chunks.push(e.data); rec.start(200);
        let t = 0; const iv = setInterval(() => { g.fillStyle = `hsl(${t*20},70%,50%)`; g.fillRect(0,0,320,240); g.fillStyle='#fff'; g.font='40px sans-serif'; g.fillText('LSH '+t, 60, 130); t++; }, 66);
        await new Promise(r => setTimeout(r, 2500)); clearInterval(iv); rec.stop(); await new Promise(r => rec.onstop = r);
        const buf = await new Blob(chunks).arrayBuffer(); let s = ''; new Uint8Array(buf).forEach(b => s += String.fromCharCode(b)); return btoa(s);
    }""")
    open(D + 'demo.webm', 'wb').write(base64.b64decode(b64))
    tmp.close()

    # ================= ADMIN =================
    # test files: a real PDF with text, a 25 MB file (the video is recorded in the browser above)
    text = "BT /F1 18 Tf 72 720 Td (Hospital lien reduction worksheet: pro rata formula) Tj ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(text)} >>\nstream\n{text}\nendstream", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    pdf = b"%PDF-1.4\n"; offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(pdf)); pdf += f"{i} 0 obj\n{o}\nendobj\n".encode()
    x = len(pdf); pdf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    pdf += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n".encode()
    open(D + 'worksheet.pdf', 'wb').write(pdf)
    big = os.urandom(25 * 1024 * 1024 + 12345); open(D + 'big-handouts.zip', 'wb').write(big)
    BIG_SHA = hashlib.sha256(big).hexdigest()
    PJ = HERE + '.cache/pdfjs/package/build/'
    def cdn(route):
        name = route.request.url.rsplit('/', 1)[1]
        route.fulfill(path=PJ + name, content_type='application/javascript') if name.startswith('pdf') else route.abort()
    A = br.new_context(viewport={'width': 1360, 'height': 900})
    a = A.new_page()
    errs = []
    a.on('pageerror', lambda e: errs.append(str(e)))
    a.goto(B + '/')
    a.wait_for_selector('#f-va')
    check('isn’t open yet' in a.inner_text('#app'), 'gate says the library is not open before a code is set')
    a.click('[data-tab="admin"]')
    a.fill('#g-user', 'trainer1'); a.fill('#g-pass', 'wrong')
    a.click('#f-admin button[type=submit]'); a.wait_for_timeout(600)
    check('Incorrect' in a.inner_text('#g-err2'), 'wrong admin password is refused')
    a.fill('#g-pass', 'admin-pass'); a.click('#f-admin button[type=submit]')
    a.wait_for_selector('.hero')
    check('Admin' in a.inner_text('#top-nav'), 'admin signs in with portal credentials')

    a.goto(B + '/#/admin'); a.wait_for_selector('#code-form')
    a.fill('#code', 'lsh-team-2026'); a.click('#code-form button'); a.wait_for_timeout(700)
    a.fill('#rev-name', 'Kim Lee'); a.fill('#rev-batch', 'Batch 10'); a.click('#rev-form button'); a.wait_for_timeout(700)
    check('Kim Lee' in a.inner_text('#app'), 'reviewer added')
    a.click('#import'); a.wait_for_function("document.getElementById('import-status').textContent.includes('Done')", timeout=20000)
    check('Imported 3' in a.inner_text('#import-status'), 'old Knowledge Base posts imported (3)')
    a.click('#import'); a.wait_for_timeout(1200)
    lib = jget(a, B + '/api/library')
    check(lib['totals']['entries'] == 2, f"import is idempotent; 2 published entries (got {lib['totals']['entries']})")

    # imported entry keeps stats and reply
    res = jget(a, B + '/api/entries?q=medicare')
    check(res['total'] == 1 and '[[' in res['entries'][0].get('snippet', ''), 'full-text search finds the imported Medicare post with a highlighted snippet')
    med = res['entries'][0]
    e1 = jget(a, B + f"/api/entries/{med['id']}")
    check(e1['stats']['helpful'] == 7 and len(e1['comments']) == 1, 'imported post kept its helpful votes and reply')
    check('https://www.cob.cms.hhs.gov/MSPRP/' in e1['entry']['body'], 'old link carried into the body')

    # ================= VA =================
    V = br.new_context(viewport={'width': 1360, 'height': 900})
    V.route('https://cdnjs.cloudflare.com/**', cdn)
    v = V.new_page()
    v.on('pageerror', lambda e: errs.append(str(e)))
    v.goto(B + '/'); v.wait_for_selector('#f-va')
    v.fill('#g-name', 'Jo Cruz'); v.fill('#g-batch', 'Batch 11'); v.fill('#g-code', 'nope')
    v.click('#f-va button[type=submit]'); v.wait_for_timeout(600)
    check('isn’t right' in v.inner_text('#g-err'), 'wrong team code is refused')
    v.fill('#g-code', 'lsh-team-2026'); v.click('#f-va button[type=submit]'); v.wait_for_selector('.hero')
    check('Review' not in v.inner_text('#top-nav'), 'a VA has no review tab')
    check('waiting for review' in v.inner_text('#app'), 'VA sees their imported pending post on the home page')

    # add an entry with a video, a PDF and a 25 MB file
    v.goto(B + '/#/new?collection=lien'); v.wait_for_selector('#ed')
    v.select_option('#ed-type', 'Training video')
    v.fill('#ed-sec', 'Day 17 · Lien Negotiator Training')
    v.fill('#ed-title', 'Walkthrough: negotiating a hospital lien')
    v.fill('#ed-sum', 'A recorded session on reducing a hospital lien with the pro rata formula.')
    v.fill('#ed-body', '## Steps\n\n1. Pull the itemized bill\n2. Apply the **pro rata** reduction\n\n- [ ] Send the reduction letter\n\n| Item | Amount |\n|---|---|\n| Bill | $12,000 |')
    v.fill('#ed-tags', 'hospital lien, reduction')
    v.set_input_files('#ed-file', [D + 'demo.webm', D + 'worksheet.pdf', D + 'big-handouts.zip'])
    v.wait_for_function("[...document.querySelectorAll('#up .file')].length === 3 && ![...document.querySelectorAll('#up .file')].some(x => x.textContent.includes('%'))", timeout=120000)
    upText = v.inner_text('#up')
    check(upText.count('Ready') == 3, 'all three files uploaded (25 MB file in 3 parts)')
    v.screenshot(path=D + 'kb-editor.png', full_page=True)
    v.click('#ed-save'); v.wait_for_selector('.entry-head', timeout=15000)
    check('waiting for review' in v.inner_text('#app'), 'new VA entry waits for review')
    new_id = int(re.search(r'#/e/(\d+)', v.url).group(1))
    check(v.evaluate("document.querySelector('video') && document.querySelector('video').src.includes('/files/')"), 'the author can play their own pending video')

    # other VA can't see it yet
    O = br.new_context(); o = O.new_page(); o.goto(B + '/'); o.wait_for_selector('#f-va')
    o.fill('#g-name', 'Kim Lee'); o.fill('#g-batch', 'Batch 10'); o.fill('#g-code', 'lsh-team-2026'); o.click('#f-va button[type=submit]'); o.wait_for_selector('.hero')
    check('Review' in o.inner_text('#top-nav'), 'the reviewer VA sees the review tab')

    # suggest an edit on the imported Medicare post
    v.goto(B + f"/#/e/{med['id']}/edit"); v.wait_for_selector('#ed')
    check(v.inner_text('#ed-save') == 'Send suggestion', 'VA editing someone else’s entry sends a suggestion')
    v.fill('#ed-body', v.input_value('#ed-body').replace('65 days', '45 to 65 days'))
    v.fill('#ed-note', 'Updated the typical wait'); v.click('#ed-save'); v.wait_for_selector('.entry-head')
    check('Your suggested edit is waiting' in v.inner_text('#app'), 'suggestion waits; live version unchanged')
    check('45 to 65 days' not in v.inner_text('.md'), 'live body still shows the old text')
    v.fill('#reply-body', 'Called the lien unit first, saved a week.'); v.click('#reply-form button'); v.wait_for_timeout(800)

    # ================= REVIEWER (Kim, a VA) =================
    o.goto(B + '/#/review'); o.wait_for_selector('.queue')
    qtxt = o.inner_text('#app')
    check('New entries (2)' in qtxt and 'Suggested edits (1)' in qtxt and 'Replies (1)' in qtxt, 'review queue lists 2 new entries, 1 edit, 1 reply')
    # compare the suggestion
    sugg = [r for r in jget(o, B + '/api/review')['revisions'] if not r['isNew']][0]
    o.goto(B + f"/#/v/{sugg['id']}"); o.wait_for_selector('.diff')
    check('45 to 65 days' in o.inner_text('.diff'), 'comparison shows the changed line')
    o.screenshot(path=D + 'kb-compare.png', full_page=True)
    o.click('[data-d="approve"]'); o.wait_for_selector('.queue, .card')
    newrev = [r for r in jget(o, B + '/api/review')['revisions'] if r['entryId'] == new_id][0]
    r = jpost(o, B + f"/api/revisions/{newrev['id']}", {'decision': 'reject'})
    check(r['status'] == 400, 'sending back requires a note')
    r = jpost(o, B + f"/api/revisions/{newrev['id']}", {'decision': 'approve'})
    check(r['ok'], 'reviewer approves the new video entry')
    cm = jget(o, B + '/api/review')['comments'][0]
    jpost(o, B + '/api/comments', {'action': 'review', 'id': cm['id'], 'decision': 'approve'})
    r = jpost(o, B + f"/api/entries/{new_id}", {'action': 'official', 'official': True})
    check(r['status'] == 403, 'a reviewer cannot mark entries official')

    # ================= after approval =================
    e2 = jget(v, B + f"/api/entries/{med['id']}")
    check('45 to 65 days' in e2['entry']['body'] and e2['entry']['versions'] == 2, 'approved suggestion is live; 2 versions kept')
    ent = jget(v, B + f'/api/entries/{new_id}')['entry']
    files = {f['kind']: f for f in ent['files']}
    check(ent['status'] == 'published' and len(ent['files']) == 3, 'new entry published with its 3 files')

    # file integrity and range requests (as a third person, Kim)
    z = files['archive']
    full = fetchinfo(o, B + f"/files/{z['id']}/x?download=1")
    check(full['sha'] == BIG_SHA, '25 MB file comes back byte-for-byte')
    check('attachment' in full['cd'], 'zip downloads as an attachment')
    rg = fetchinfo(o, B + f"/files/{files['video']['id']}/v", {'Range': 'bytes=0-99'})
    check(rg['status'] == 206 and rg['len'] == 100 and rg['cr'].startswith('bytes 0-99/'), 'video supports Range requests (206)')
    check(fetchinfo(o, B + f"/files/{files['pdf']['id']}/p")['ct'] == 'application/pdf', 'PDF served inline as application/pdf')

    # search reaches text inside the PDF (extracted in the browser at upload)
    s = jget(o, B + '/api/entries?q=rata')
    check(any(x['id'] == new_id for x in s['entries']), 'search finds words inside the uploaded PDF')

    # video plays
    o.goto(B + f'/#/e/{new_id}'); o.wait_for_selector('video')
    o.wait_for_function("document.querySelector('video').readyState >= 1", timeout=15000)
    check(o.evaluate("document.querySelector('video').duration > 1"), 'the training video loads in the player')
    o.screenshot(path=D + 'kb-entry.png', full_page=True)

    # admin: history, restore, official, archive, purge
    a.goto(B + f"/#/e/{med['id']}/history"); a.wait_for_selector('.versions')
    check(a.inner_text('.versions').count('View') == 2, 'history lists both versions')
    first = jget(a, B + f"/api/entries/{med['id']}/history")['versions'][-1]['id']
    a.goto(B + f'/#/v/{first}'); a.wait_for_selector('#v-restore'); a.click('#v-restore'); a.wait_for_selector('.entry-head')
    e3 = jget(a, B + f"/api/entries/{med['id']}")['entry']
    check('45 to 65 days' not in e3['body'] and e3['versions'] == 3, 'restoring an old version adds a third version')
    jpost(a, B + f'/api/entries/{new_id}', {'action': 'official', 'official': True})
    check(jget(a, B + '/api/entries?official=1')['total'] == 1, 'admin marks the entry official')
    jpost(a, B + f'/api/entries/{new_id}', {'action': 'archive'})
    check(not any(x['id'] == new_id for x in jget(v, B + '/api/entries?q=hospital')['entries']), 'archived entry drops out of search')
    X = br.new_context(); x = X.new_page(); x.goto(B + '/'); x.wait_for_selector('#f-va')
    x.fill('#g-name', 'Sam Tan'); x.fill('#g-code', 'lsh-team-2026'); x.click('#f-va button[type=submit]'); x.wait_for_selector('.hero')
    check(fetchinfo(x, B + f"/files/{files['video']['id']}/v")['status'] == 404, 'an archived entry’s video is hidden from other VAs')
    check(fetchinfo(v, B + f"/files/{files['video']['id']}/v")['status'] == 200, 'the uploader can still open their own file')
    jpost(a, B + f'/api/entries/{new_id}', {'action': 'unarchive'})
    check(any(x['id'] == new_id for x in jget(v, B + '/api/entries?q=hospital')['entries']), 'restored entry is searchable again')

    # screenshots: home, collection, mobile
    a.goto(B + '/'); a.wait_for_selector('.hero'); a.screenshot(path=D + 'kb-home.png', full_page=True)
    a.goto(B + '/#/c/lien'); a.wait_for_selector('.toc'); a.screenshot(path=D + 'kb-collection.png', full_page=True)
    M = br.new_context(viewport={'width': 390, 'height': 844}); m = M.new_page()
    m.goto(B + '/'); m.wait_for_selector('#f-va'); m.fill('#g-name', 'Jo Cruz'); m.fill('#g-batch', 'Batch 11'); m.fill('#g-code', 'lsh-team-2026'); m.click('#f-va button[type=submit]'); m.wait_for_selector('.hero')
    check(m.evaluate('document.documentElement.scrollWidth') <= 390, 'no sideways scroll on a phone')
    m.goto(B + f'/#/e/{new_id}'); m.wait_for_selector('video'); m.screenshot(path=D + 'kb-mobile.png', full_page=False)

    r = jpost(a, B + f'/api/entries/{new_id}', {'action': 'purge', 'confirm': 'DELETE'})
    check(r['ok'] and fetchinfo(a, B + f"/files/{z['id']}/x")['status'] == 404, 'admin purge removes the entry and its files')
    ex = jget(a, B + '/api/admin/export')
    check('versions' in ex and len(ex['versions']) >= 5, 'backup export has every version')

    check(not errs, 'no page errors ' + '; '.join(errs[:3]))
    br.close()

bad = [l for c, l in ok if not c]
print(f'\n{len(ok) - len(bad)}/{len(ok)} passed')
sys.exit(1 if bad else 0)
