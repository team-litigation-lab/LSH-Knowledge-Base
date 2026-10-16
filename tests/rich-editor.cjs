// The Word-style editor (public/js/rich.js inside the editor in public/js/app.js), against `npm run dev` like e2e.py.
// 1. Round trip: every bundled article (public/seed/docs.json, tettra.json, training.json) and a sample of each
//    construct md.js knows is rendered into a box, turned back into markdown, and rendered again. The second
//    rendering must match the first (what readers see never changes), and a second round trip must give the same
//    markdown as the first (a re-saved article never drifts, so its review diff stays quiet).
// 2. The editor: typing, the toolbar and its keys, the link dialog, pasting from Word and from a spreadsheet, and
//    pasting and dropping a photo, which uploads and is saved as ![…](/files/<id>/<name>).
// Usage: node tests/rich-editor.cjs   (needs Node Playwright, like tests/blueprint.cjs)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const B = process.env.BASE || 'http://127.0.0.1:8787';
const ROOT = path.join(__dirname, '..');
const failures = []; const fail = (m) => failures.push(m);
let checks = 0, lastMd = ''; const check = (ok, label) => { checks++; if (!ok) fail(label + (process.env.DEBUG ? `\n      markdown then: ${JSON.stringify(lastMd.slice(-260))}` : '')); };

// Every bundled article body, labelled for the report.
function corpus() {
  const out = [];
  const seed = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/seed', f), 'utf8'));
  for (const d of seed('docs.json')) out.push([`docs: ${d.title}`, d.body]);
  for (const p of seed('tettra.json').pages) out.push([`tettra: ${p.title}`, p.body]);
  for (const p of seed('training.json').pages) out.push([`training: ${p.title}`, p.body]);
  return out;
}
// One of each construct, and the combinations md.js can and cannot nest.
const SAMPLES = [
  ['headings', '# One\n\n## Two\n\n### Three'],
  ['paragraph with line breaks', 'first line\nsecond line\nthird line'],
  ['inline marks', 'Some **bold**, *italic*, ++underlined++ and `code` text.'],
  ['bold and italic together', '***both*** and **bold _with italic_ inside**'],
  ['italic around bold', '*italic with **bold** inside*'],
  ['color', 'A {color:#C0392B}red{/color} word and {color:navy}a named one{/color}.'],
  ['color with bold', '{color:#1D4ED8}**blue bold**{/color} and **{color:#1E8449}green{/color} in bold**'],
  ['underline with bold', '++**both**++ and **++both again++**'],
  ['links', 'See [the guide](https://example.com/guide) or [mail us](mailto:a@b.co) or [a page](/e/12).'],
  ['bare link', 'Open https://example.com/a/b and (https://example.com/c), or https://example.com/d.'],
  ['link with bold text', '[**Bold link**](https://example.com)'],
  ['bold link', '**[Bold link](https://example.com)**'],
  ['photo', 'Before\n\n![a photo](/files/0123456789abcdef0123456789abcdef0123/photo%281%29.png)\n\nAfter'],
  ['library image', '![chart](/img/0123456789abcdef)'],
  ['bullet list', '- one\n- two\n- three'],
  ['numbered list', '1. one\n2. two\n3. three'],
  ['nested list', '- a\n  - b\n    - c\n  - d\n- e'],
  ['mixed list', '1. step\n   - detail\n2. step two'],
  ['checklist', '- [ ] to do\n- [x] done\n- [ ] **bold** item'],
  ['quote', '> A quoted line\n> with a second line'],
  ['quote with blocks', '> # Heading\n>\n> - item\n> - item two'],
  ['code block', '```\nconst x = 1;\nif (x < 2) { y(); }\n```'],
  ['rule', 'Above\n\n---\n\nBelow'],
  ['table', '| Name | **Role** |\n|---|---|\n| Ann | Lead |\n| Bo | *Help* |'],
  ['all together', '# Title\n\nIntro with **bold**.\n\n- [ ] check\n- [x] done\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> note\n\n---\n\n```\ncode\n```'],
];

async function roundTrip(page) {
  const md = fs.readFileSync(path.join(ROOT, 'public/js/md.js'), 'utf8');
  const rich = fs.readFileSync(path.join(ROOT, 'public/js/rich.js'), 'utf8');
  await page.setContent('<!doctype html><meta charset="utf-8"><div id="box"></div>');
  await page.addScriptTag({ content: md }); await page.addScriptTag({ content: rich });
  const all = [...corpus(), ...SAMPLES.map(([k, v]) => [`sample: ${k}`, v])];
  const res = await page.evaluate((all) => {
    const box = document.getElementById('box');
    // Compared as a browser shows them: a no-break space reads as a space, an empty or blank <em> shows nothing,
    // and a run of spaces shows as one
    // (outside code blocks, where spacing is kept and compared exactly).
    const flat = (h) => h.split(/(<pre[\s\S]*?<\/pre>)/).map((part, i) => i % 2 ? part
      : part.replace(/\u00a0/g, ' ').replace(/<(em|strong|u)>(\s*)<\/\1>/g, '$2').replace(/>\s+</g, '><').replace(/[ \t]{2,}/g, ' ')).join('').trim();
    const toMd = (src) => { box.innerHTML = window.KBmd.render(src); return window.KBRich.toMarkdown(box); };
    // md.js reads _italic_ over its own output, so a link's target="_blank" can pair with an underscore in a later
    // address and put <em> inside an attribute. Such a page is already broken for readers; it is listed, not failed.
    const corrupt = (h) => /="[^"]*<\/?(em|strong|u|span|code|a)\b/.test(h);
    const out = { same: 0, n: all.length, bad: [], broken: [] };
    for (const [label, src] of all) {
      if (corrupt(window.KBmd.render(src))) { out.broken.push(label); continue; }
      const once = toMd(src), twice = toMd(once);
      const a = flat(window.KBmd.render(src)), b = flat(window.KBmd.render(once));
      if (once === src) out.same++;
      if (a !== b) {
        let i = 0; while (i < a.length && a[i] === b[i]) i++;
        out.bad.push(`${label}: renders differently after a round trip, at …${a.slice(Math.max(0, i - 50), i + 70)}… vs …${b.slice(Math.max(0, i - 50), i + 70)}…`);
      } else if (twice !== once) {
        let i = 0; while (i < once.length && once[i] === twice[i]) i++;
        out.bad.push(`${label}: a second round trip changes the markdown, at ${JSON.stringify(once.slice(Math.max(0, i - 40), i + 60))} vs ${JSON.stringify(twice.slice(Math.max(0, i - 40), i + 60))}`);
      }
    }
    return out;
  }, all);
  res.bad.forEach(fail);
  const n = res.n - res.broken.length;
  checks += n * 2;
  console.log(`round trip: ${n} articles and samples; ${n - res.bad.length} render the same and are stable; ${res.same} come back byte-for-byte`);
  if (res.broken.length) console.log(`  already broken by md.js before any editing (an _ in an address pairs with target="_blank"): ${res.broken.join('; ')}`);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    await roundTrip(await browser.newPage());
    if (process.env.ROUNDTRIP_ONLY) return;
    await editorChecks(browser);
  } catch (e) {
    fail(`the editor checks stopped early: ${e.message.split('\n')[0]}`);   // a crash is a failure, never a quiet PASS
  } finally {
    await browser.close();
    if (failures.length) { console.log(`FAIL ${failures.length} of ${checks} checks:\n  ` + failures.join('\n  ')); process.exitCode = 1; }
    else console.log(`PASS ${checks} checks`);
  }
})();

// ---- the editor, driven as a writer would ----
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
async function editorChecks(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  // What will be saved: #ed-body, read once the surface has written into it (it does so a moment after typing stops).
  const md = async () => { await p.waitForTimeout(400); return (lastMd = await p.$eval('#ed-body', t => t.value)); };
  // The caret at the very end of the text, in the last thing written.
  const toEnd = () => p.evaluate(() => {
    const r = document.getElementById('ed-rich'); r.focus();
    let n = r; while (n.lastChild && n.lastChild.nodeType === 1 && !/^(BR|IMG|HR)$/.test(n.lastChild.tagName)) n = n.lastChild;
    const g = document.createRange(); g.selectNodeContents(n); g.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(g);
  });
  await p.goto(B + '/'); await p.waitForSelector('#f-va');
  await p.click('[data-tab="admin"]'); await p.fill('#g-user', 'trainer1'); await p.fill('#g-pass', 'admin-pass');
  await p.click('#f-admin button[type=submit]'); await p.waitForSelector('#top-nav');

  // An article opened and left alone, through every tab, is saved exactly as it was.
  const { entries } = await p.evaluate(async () => (await fetch('/api/entries?q=medicare')).json());
  const pick = entries.find(x => x.id) || entries[0];
  const before = (await p.evaluate(async (id) => (await fetch('/api/entries/' + id)).json(), pick.id)).entry.body;
  await p.evaluate((id) => { location.hash = `#/e/${id}/edit`; }, pick.id); await p.waitForSelector('#ed-rich');
  check(await p.evaluate(() => !!document.querySelector('#ed-rich').textContent.trim()), 'the surface shows the article being edited');
  for (const t of ['preview', 'write', 'markdown', 'write', 'markdown']) await p.click(`[data-t="${t}"]`);
  check(await p.inputValue('#ed-body') === before, 'an article opened and left alone keeps its exact markdown, through every tab');

  // A new entry, written on the surface.
  await p.evaluate(() => { location.hash = '#/new'; }); await p.waitForSelector('#ed-rich');
  await p.fill('#ed-col', 'Lien Resolution'); await p.fill('#ed-type', 'Guide'); await p.fill('#ed-title', 'Rich editor check');
  await p.click('#ed-rich');
  await p.keyboard.type('Hello world');
  await p.keyboard.press(`Shift+${MOD}+ArrowLeft`); await p.click('[data-f="bold"]');
  check((await md()).includes('Hello **world**'), 'the B button bolds the selection');
  await toEnd(); await p.keyboard.press(`${MOD}+b`);   // bold off, as in Word: typed text otherwise carries on bold
  await p.keyboard.type(' and more'); await p.keyboard.press(`Shift+${MOD}+ArrowLeft`);
  await p.keyboard.press(`${MOD}+i`);
  check(/Hello \*\*world\*\* and \*more\*/.test(await md()), 'Ctrl+I italicises the selection');
  check(await p.getAttribute('[data-f="italic"]', 'aria-pressed') === 'true', 'the I button is lit while the caret is in italic text');
  await toEnd(); await p.keyboard.press('Enter'); await p.keyboard.press(`${MOD}+i`); await p.keyboard.type('Steps');
  await p.selectOption('#mdbar-block', 'h2');
  check((await md()).includes('\n\n# Steps'), 'the paragraph style list makes a heading');
  await toEnd(); await p.keyboard.press('Enter');
  await p.selectOption('#mdbar-block', 'p'); await p.click('[data-f="ol"]'); await p.keyboard.type('Pull the bill'); await p.keyboard.press('Enter'); await p.keyboard.type('Apply the reduction');
  check(/1\. Pull the bill\n2\. Apply the reduction/.test(await md()), 'the numbered list button and Enter make numbered steps');
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter');   // out of the list
  await p.click('[data-f="check"]'); await p.keyboard.type('Send the letter');
  check((await md()).includes('- [ ] Send the letter'), 'the checklist button makes an unticked item');
  check(await p.$eval('#ed-rich li.md-check', li => li.firstChild && li.firstChild.classList && li.firstChild.classList.contains('md-box') && li.textContent.endsWith('Send the letter')),
    'a checklist item shows its box before the words typed into it');
  await p.click('#ed-rich li.md-check .md-box');
  check((await md()).includes('- [x] Send the letter'), 'clicking a box ticks it');
  await toEnd(); await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.keyboard.type('After the list');
  check(/- \[x\] Send the letter\n\nAfter the list/.test(await md()), 'Enter on an empty checklist item leaves the list, as in Word');

  // Links: Ctrl+K on a selection; a bare www. gets https://; a link can be edited and removed.
  await toEnd(); await p.keyboard.press('Enter');
  await p.keyboard.type('Read the guide'); await p.keyboard.press(`Shift+${MOD}+ArrowLeft`);
  await p.keyboard.press(`${MOD}+k`); await p.waitForSelector('#ed-link[open]');
  check(await p.inputValue('#ln-text') === 'guide', 'the link dialog starts from the selected words');
  check(!(await p.isVisible('#ln-remove')), 'a new link offers no Remove button');
  await p.fill('#ln-href', 'not an address'); await p.click('#ln-save');
  check(await p.isVisible('#ed-link') && /web address/.test(await p.innerText('#ln-err')), 'a link that is not an address is refused, and the dialog stays open');
  await p.fill('#ln-href', 'www.example.com/guide'); await p.click('#ln-save');
  check((await md()).includes('Read the [guide](https://www.example.com/guide)'), 'a www. address gets https:// and the words become a link');
  await p.click('#ed-rich a'); await p.keyboard.press(`${MOD}+k`); await p.waitForSelector('#ed-link[open]');
  check(await p.isVisible('#ln-remove') && await p.inputValue('#ln-href') === 'https://www.example.com/guide', 'Ctrl+K on a link opens it for editing');
  await p.fill('#ln-href', 'ops@example.com'); await p.click('#ln-save');
  check((await md()).includes('[guide](mailto:ops@example.com)'), 'an e-mail address becomes a mailto: link');
  await p.click('#ed-rich a'); await p.keyboard.press(`${MOD}+k`); await p.waitForSelector('#ed-link[open]'); await p.click('#ln-remove');
  check(!(await md()).includes('mailto:') && (await md()).includes('Read the guide'), 'Remove link keeps the words and drops the link');

  // Pasting: Word's formatting and lists come along; anything that could run is gone; a spreadsheet becomes a table.
  const paste = (data) => p.evaluate(async (data) => {
    const dt = new DataTransfer();
    for (const [type, v] of Object.entries(data.strings || {})) dt.setData(type, v);
    for (const f of data.files || []) {
      let blob;
      if (f.png) { const c = document.createElement('canvas'); c.width = 24; c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#DB8437'; g.fillRect(0, 0, 24, 16); blob = await new Promise(r => c.toBlob(r, 'image/png')); }
      else blob = new Blob(['not really a photo'], { type: f.type });
      dt.items.add(new File([blob], f.name, { type: f.type }));
    }
    const rich = document.getElementById('ed-rich');
    rich.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
  await toEnd(); await p.keyboard.press('Enter');
  await paste({ strings: { 'text/plain': 'x', 'text/html': '<html><head><style>p{}</style></head><body><!--[if gte mso 9]><xml></xml><![endif]-->'
    + '<p class=MsoNormal><b>Pasted bold</b> and <i>pasted italic</i><o:p></o:p></p>'
    + '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;</span></span>First point</p>'
    + '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;</span></span>Second point</p>'
    + '<p><span style="color:#C00000">Red words</span> <span style="color:windowtext">plain words</span></p>'
    + '<script>window.kbPwned = 1</script><img src=x onerror="window.kbPwned = 2"><p onclick="window.kbPwned = 3">safe text</p></body></html>' } });
  const afterWord = await md();
  check(afterWord.includes('**Pasted bold** and *pasted italic*'), 'Word bold and italic come along');
  check(/- First point\n- Second point/.test(afterWord), 'a Word list comes along as a list');
  check(/\{color:#[cC]00000\}Red words\{\/color\} plain words/.test(afterWord), 'a real color comes along; Word\'s everyday black does not');
  check(await p.evaluate(() => !window.kbPwned && !document.querySelector('#ed-rich script, #ed-rich [onerror], #ed-rich [onclick]')), 'nothing pasted can run: no script, no event attributes');
  // A list pasted into the middle of a sentence splits it, as in Word, and keeps its first item.
  await toEnd(); await p.keyboard.press('Enter'); await p.keyboard.type('Before after');
  for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowLeft');
  await paste({ strings: { 'text/plain': 'A\nB', 'text/html': '<ul><li>Alpha</li><li>Beta</li></ul>' } });
  check(/Before \n\n- Alpha\n- Beta\n\nafter/.test(await md()), 'a list pasted mid-sentence splits the paragraph and keeps every item');
  await toEnd(); await p.keyboard.press('Enter');
  await paste({ strings: { 'text/plain': 'Item\tAmount\nBill\t$12,000\n' } });
  check(/\| Item \| Amount \|\n\|---\|---\|\n\| Bill \| \$12,000 \|/.test(await md()), 'cells pasted from a spreadsheet become a table');

  // Photos: pasted, dropped, refused.
  const files = () => p.$$eval('#up .file', els => els.length);
  const before0 = await files();
  await paste({ files: [{ name: 'shot.heic', type: 'image/heic' }] });
  check(await files() === before0 && !(await p.$('#ed-rich img.uploading')), 'a .heic photo is refused before any upload');
  await toEnd(); await p.keyboard.press('Enter');
  await paste({ files: [{ name: 'image.png', type: 'image/png', png: true }] });
  check(!!(await p.$('#ed-rich img.uploading')), 'a pasted photo appears at once, marked as uploading');
  await p.waitForFunction(() => !document.querySelector('#ed-rich img[data-up]'), null, { timeout: 30000 });
  let body = await md();
  const pasted = body.match(/!\[(pasted-\d{8}-\d{6}[^\]]*\.png)\]\((\/files\/[0-9a-f-]{36}\/pasted-[^)]+\.png)\)/);
  check(!!pasted, 'a pasted screenshot is saved as ![pasted-….png](/files/<id>/pasted-….png)');
  await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d').fillRect(0, 0, 20, 20);
    const dt = new DataTransfer(); dt.items.add(new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'dropped.png', { type: 'image/png' }));
    const rich = document.getElementById('ed-rich'), box = rich.getBoundingClientRect();
    rich.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: box.left + 20, clientY: box.bottom - 20 }));
  });
  await p.waitForFunction(() => !document.querySelector('#ed-rich img[data-up]') && document.querySelectorAll('#ed-rich img').length >= 2, null, { timeout: 30000 });
  body = await md();
  check(/!\[dropped\.png\]\(\/files\/[0-9a-f-]{36}\/dropped\.png\)/.test(body), 'a dropped photo is uploaded and saved in the text');
  check(!/blob:/.test(body), 'no temporary blob: address ever reaches the saved markdown');
  if (process.env.SHOT_DIR) await p.screenshot({ path: path.join(process.env.SHOT_DIR, 'editor.png') });

  // Published: the photo shows once, in the text, not again among the files.
  await p.click('#ed-save'); await p.waitForSelector('.entry-head');
  if (pasted) check(await p.$$eval(`img[src="${pasted[2]}"]`, els => els.length) === 1, 'on the published page the pasted photo shows once, in the text');
  check(await p.$$eval('article .md h2', els => els.some(h => h.textContent === 'Steps')), 'the published page has the heading written in the editor');
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}
