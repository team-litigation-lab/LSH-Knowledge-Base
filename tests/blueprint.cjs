// The 🧭 Blueprint (public/js/lsh-blueprint.js with public/js/blueprint-content.js), against `npm run dev` like
// e2e.py; run it after e2e.py. jsPDF is served from node_modules in place of cdnjs.
// Checks: a VA has 🧭 Blueprint in the top bar and gets the VA (trainee) deck only, with no admin words; an admin gets
// both decks as tabs; ◀ ▶ and the keys go through every slide; every slide fits its frame on a laptop and on a phone;
// ⬇ Download PDF saves each deck with a page per slide and the deploy stamp; the button survives a page change.
// Usage: node tests/blueprint.cjs   (needs Node Playwright and jsPDF: npm install --no-save playwright jspdf@4.2.1)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const B = process.env.BASE || 'http://127.0.0.1:8787';
const CODE = 'lsh-team-2026';
const JSPDF = fs.readFileSync(path.join(path.dirname(require.resolve('jspdf')), 'jspdf.umd.min.js'));
const failures = []; const fail = (m) => failures.push(m);
function inspect(buf) {
  let raw = buf.toString('latin1'), at = 0; const parts = [raw];
  while ((at = raw.indexOf('stream', at)) >= 0) {
    const start = raw.indexOf('\n', at) + 1, end = raw.indexOf('endstream', start);
    if (start <= 0 || end < 0) break;
    try { parts.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1')); } catch (e) { /* not a Flate stream */ }
    at = end + 9;
  }
  raw = parts.join('\n');
  const text = (raw.match(/\((?:\\.|[^\\)])*\)\s*Tj/g) || []).map(s => s.replace(/\)\s*Tj$/, '').slice(1).replace(/\\(.)/g, '$1')).join('\n');
  return { pdf: parts[0].startsWith('%PDF'), pages: (raw.match(/\/Type \/Page\b(?!s)/g) || []).length, text };
}
const ADMIN_WORDS = /access code \(|download a backup|import the old|delete for good, by typing|chartswap|casepeer/i;
async function walk(page, label) {
  return page.evaluate(async (label) => {
    const out = [], texts = [];
    const total = Number(document.getElementById('lbp-count').textContent.split('/')[1]);
    for (let i = 0; i < total; i++) {
      LSHBlueprint.go(i, true); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const slide = document.getElementById('lbp-slide'), card = slide.firstElementChild;
      texts.push(slide.innerText);
      const over = [card, ...card.querySelectorAll('.lbp-main, .lbp-points, .lbp-side, .lbp-contents')].filter(e => e.scrollHeight - e.clientHeight > 2 || e.scrollWidth - e.clientWidth > 2);
      if (over.length) out.push(`${label} slide ${i + 1}: cut off (${over.map(e => e.className).join(', ')})`);
      const sr = slide.getBoundingClientRect(), stage = document.getElementById('lbp-stage').getBoundingClientRect();
      if (sr.left < stage.left - 1 || sr.right > stage.right + 1 || sr.top < stage.top - 1 || sr.bottom > stage.bottom + 1) out.push(`${label} slide ${i + 1}: bigger than the screen`);
    }
    return { out, total, texts };
  }, label);
}
(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const mk = async (viewport) => {
    const c = await browser.newContext({ viewport, acceptDownloads: true }); const p = await c.newPage();
    p.on('pageerror', (e) => fail(`${viewport.width}px page error: ${e.message}`));
    await p.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf\/4\.2\.1\/jspdf\.umd\.min\.js/, r => r.fulfill({ contentType: 'text/javascript', body: JSPDF }));
    return p;
  };
  const pdfOf = async (page) => { const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#lbp-pdf-btn')]); return { name: dl.suggestedFilename(), ...inspect(fs.readFileSync(await dl.path())) }; };

  // ---- an admin (and the team code, so a VA can sign in) ----
  const a = await mk({ width: 1366, height: 768 });
  await a.goto(B + '/'); await a.waitForSelector('#f-va');
  await a.click('[data-tab="admin"]'); await a.fill('#g-user', 'trainer1'); await a.fill('#g-pass', 'admin-pass');
  await a.click('#f-admin button[type=submit]'); await a.waitForSelector('.hero');
  await a.evaluate(async (code) => fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set-code', code }) }), CODE);
  await a.waitForSelector('#lbp-open-btn', { timeout: 5000 }).catch(() => fail('an admin has no 🧭 Blueprint button'));
  await a.click('#lbp-open-btn'); await a.waitForTimeout(300);
  const at = await a.evaluate(() => ({ deck: document.getElementById('lbp-slide').dataset.deck, tabs: [...document.querySelectorAll('#lbp-tabs button')].filter(b => b.offsetParent).map(b => b.textContent.trim()) }));
  if (at.deck !== 'trainer' || at.tabs.join() !== 'Trainer blueprint,Trainee blueprint') fail(`an admin should get both decks: ${JSON.stringify(at)}`);
  const aw = await walk(a, 'admin 1366px'); aw.out.forEach(fail);
  let pdf = await pdfOf(a);
  if (pdf.name !== 'LSH_Knowledge_Base_Blueprint_Trainer.pdf' || !pdf.pdf || pdf.pages !== aw.total || !/review queue/.test(pdf.text)) fail(`the admin PDF: ${pdf.name}, ${pdf.pages} pages for ${aw.total} slides`);
  if (!/made /.test(pdf.text)) fail('the admin PDF isn\'t stamped with the date');
  await a.setViewportSize({ width: 390, height: 844 }); await a.waitForTimeout(300);
  (await walk(a, 'admin 390px')).out.forEach(fail);
  await a.context().close();

  // ---- a VA ----
  const v = await mk({ width: 1366, height: 768 });
  await v.goto(B + '/'); await v.waitForSelector('#f-va');
  await v.fill('#g-name', 'Blue Print'); await v.fill('#g-batch', 'Batch 9'); await v.fill('#g-code', CODE);
  await v.click('#f-va button[type=submit]'); await v.waitForSelector('.hero');
  await v.waitForSelector('#lbp-open-btn', { timeout: 5000 }).catch(() => fail('a VA has no 🧭 Blueprint button'));
  await v.click('#lbp-open-btn'); await v.waitForTimeout(300);
  const t = await v.evaluate(() => ({ deck: document.getElementById('lbp-slide').dataset.deck, tabs: !!document.getElementById('lbp-tabs').offsetParent }));
  if (t.deck !== 'trainee' || t.tabs) fail(`a VA should get the VA deck only: ${JSON.stringify(t)}`);
  if (await v.evaluate(() => { LSHBlueprint.deck('trainer'); return document.getElementById('lbp-slide').dataset.deck; }) !== 'trainee') fail('a VA could switch to the admin deck');
  await v.keyboard.press('ArrowRight'); await v.keyboard.press('ArrowRight');
  if (!(await v.textContent('#lbp-count')).startsWith('3 /')) fail('← → didn\'t move through the slides');
  const tw = await walk(v, 'VA 1366px'); tw.out.forEach(fail);
  const bad = tw.texts.filter(x => ADMIN_WORDS.test(x)); if (bad.length) fail('the VA deck names admin-only things');
  pdf = await pdfOf(v);
  if (pdf.name !== 'LSH_Knowledge_Base_Blueprint_Trainee.pdf' || pdf.pages !== tw.total) fail(`the VA PDF: ${pdf.name}, ${pdf.pages} pages`);
  await v.keyboard.press('Escape');
  if (await v.evaluate(() => LSHBlueprint.isOpen())) fail('Esc didn\'t close the Blueprint');
  await v.click('#top-nav a[href="#/videos"]'); await v.waitForTimeout(400);
  if (!(await v.isVisible('#lbp-open-btn'))) fail('the 🧭 Blueprint button went missing on another page');
  await v.setViewportSize({ width: 390, height: 844 }); await v.evaluate(() => LSHBlueprint.open()); await v.waitForTimeout(300);
  (await walk(v, 'VA 390px')).out.forEach(fail);
  await v.context().close();

  await browser.close();
  if (failures.length) { console.log(`\n${failures.length} failure(s):`); failures.forEach((f, i) => console.log(`${i + 1}. ${f}`)); process.exit(1); }
  console.log(`PASS Blueprint: VA deck ${tw.total} slides and its PDF, admin deck ${aw.total} slides and its PDF; every slide fits on a laptop and a phone.`);
})().catch(e => { console.error(e); process.exit(1); });
