// The server request meter (request-budget.js; the same file and this same test in every LSH platform),
// in a blank page with a stand-in server reply:
// - nothing for a non-admin (no chip, no request); an admin gets the chip and one request;
// - each level: not set up, OK, getting close (75%, or this month's pace runs out before it resets),
//   nearly used up (90%), paused, old numbers, the server not answering (tried again later);
// - the note above the chip when it's close; dismissed, it stays away until it gets closer;
// - the details: the total, each day, each site by name, what happens at the limit; Esc closes them;
// - asks again only every so often, never in a background tab; signing out removes it.
// Usage: node .github/scripts/request-meter-widget.cjs [path/to/request-budget.js]   (needs Playwright)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const WIDGET = path.resolve(process.argv[2] || 'js/request-budget.js');
const failures = []; const fail = (m) => failures.push(m);
const DAY = 86400000;

// A billing month that started 10 days ago (UTC), 31 days long; numbers checked 5 minutes ago.
function usage(total, extra = {}) {
    const start = Math.floor(Date.now() / DAY) * DAY - 10 * DAY, end = start + 31 * DAY;
    const days = {}; for (let i = 0; i <= 10; i++) days[new Date(start + i * DAY).toISOString().slice(0, 10)] = Math.round(total / 11);
    return Object.assign({
        v: 1, at: new Date(Date.now() - 5 * 60000).toISOString(),
        month: { start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) },
        total, limit: 9990000, included: 10000000, projected: Math.round(total / 10.5 * 31), paused: false, pausedAt: null,
        sites: [{ kind: 'worker', name: 'ea-pa-training', requests: Math.round(total * 0.6) }, { kind: 'pages', name: 'lshcmtraining-trainingcrm', requests: Math.round(total * 0.4) }],
        days, notes: []
    }, extra);
}

(async () => {
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    page.on('pageerror', e => fail(`page error: ${e.message}`));
    await page.setContent('<!doctype html><html><head><title>t</title></head><body><h1>Admin page</h1></body></html>');
    await page.evaluate(() => {
        window.REQUEST_BUDGET_TIMINGS = { refresh: 1500, retry: 700, adminCheck: 100 };
        window.__admin = false; window.__calls = 0; window.__reply = { ok: true, usage: null }; window.__fail = false;
        window.__hidden = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hidden });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') });
    });
    await page.addScriptTag({ content: fs.readFileSync(WIDGET, 'utf8') });
    await page.evaluate(() => RequestBudget.start({
        load: () => { window.__calls++; return window.__fail ? Promise.reject(new Error('HTTP 429')) : Promise.resolve(JSON.parse(JSON.stringify(window.__reply))); },
        isAdmin: () => window.__admin, site: 'ea-pa-training'
    }));
    const calls = () => page.evaluate(() => window.__calls);
    const chip = () => page.evaluate(() => { const c = document.getElementById('rqb-chip'); return c ? { cls: c.className, text: c.textContent.replace(/\s+/g, ' ').trim() } : null; });
    const note = () => page.evaluate(() => { const n = document.getElementById('rqb-note'); return n ? n.textContent.replace(/\s+/g, ' ').trim() : null; });
    const show = async (reply) => { await page.evaluate((r) => { window.__reply = r; return RequestBudget.refresh(); }, reply); await page.waitForTimeout(50); };

    // not an admin: nothing, and no request
    await page.waitForTimeout(400);
    if (await chip() || await calls()) fail(`a non-admin page shows the meter or asks the server (${await calls()} requests)`);

    // an admin: the chip and one request
    await page.evaluate(() => { window.__admin = true; });
    await page.waitForTimeout(400);
    let c = await chip();
    if (!c || await calls() !== 1) fail(`an admin page: chip ${JSON.stringify(c)}, ${await calls()} requests (expected 1)`);
    if (c && (!/rqb-unset/.test(c.cls) || !/Not set up/.test(c.text))) fail(`no numbers yet: the chip says ${JSON.stringify(c)}`);
    await page.click('#rqb-chip');
    if (!/CLOUDFLARE_BUDGET_TOKEN/.test(await page.textContent('#rqb-panel'))) fail('no numbers yet: the details don\'t say how to set it up');
    await page.keyboard.press('Escape');
    if (await page.$('#rqb-panel')) fail('Esc doesn\'t close the details');

    // OK
    await show({ ok: true, usage: usage(1200000) });
    c = await chip();
    if (!/rqb-ok/.test(c.cls) || !/Requests 12%/.test(c.text) || /·/.test(c.text) || await note()) fail(`12% used: chip ${JSON.stringify(c)}, note ${await note()}`);
    await page.click('#rqb-chip');
    const p = await page.evaluate(() => { const el = document.getElementById('rqb-panel'); return { text: el.textContent, bars: el.querySelectorAll('.rqb-days i').length, me: (el.querySelector('tr.rqb-me') || {}).textContent || '' }; });
    if (!/1,200,000/.test(p.text) || !/of 9,990,000 \(12\.0%\)/.test(p.text) || !/On track/.test(p.text)) fail(`the details for 12%: ${p.text.slice(0, 300)}`);
    if (!/EA-PA Training/.test(p.text) || !/CMS/.test(p.text) || !/EA-PA Training/.test(p.me)) fail(`the details don't list each site by name (this one highlighted): ${p.text}`);
    if (p.bars !== 11) fail(`the details show ${p.bars} days (expected 11: the month so far)`);
    await page.click('#rqb-panel [data-rqb=close]');

    // getting close (80%): the note; dismissed, it stays away at the same level
    await show({ ok: true, usage: usage(7992000) });
    c = await chip();
    if (!/rqb-warn/.test(c.cls) || !/80%/.test(c.text) || !/Getting close/.test(c.text)) fail(`80% used: chip ${JSON.stringify(c)}`);
    if (!/80\.0%/.test(await note() || '')) fail(`80% used: no note above the chip (${await note()})`);
    await page.click('#rqb-note [data-rqb=dismiss]');
    await show({ ok: true, usage: usage(8100000) });
    if (await note()) fail('a dismissed note came back at the same level');

    // nearly used up (92%): the note again
    await show({ ok: true, usage: usage(9190000) });
    c = await chip();
    if (!/rqb-danger/.test(c.cls) || !/Nearly used up/.test(c.text) || !/92\.0%/.test(await note() || '')) fail(`92% used: chip ${JSON.stringify(c)}, note ${await note()}`);

    // this month's pace runs out before it resets (40% after 10 days of 31)
    await show({ ok: true, usage: usage(4000000) });
    c = await chip();
    if (!/rqb-warn/.test(c.cls) || !/On pace to run out/.test(c.text)) fail(`40% after 10 days: chip ${JSON.stringify(c)}`);
    // the same pace on day 2 is too early to tell
    await show({ ok: true, usage: usage(300000, { month: { start: new Date(Math.floor(Date.now() / DAY) * DAY - DAY).toISOString().slice(0, 10), end: new Date(Math.floor(Date.now() / DAY) * DAY + 30 * DAY).toISOString().slice(0, 10) } }) });
    if (!/rqb-ok/.test((await chip()).cls)) fail(`a busy first day already warns: ${JSON.stringify(await chip())}`);

    // paused
    await show({ ok: true, usage: usage(9995000, { paused: true, pausedAt: new Date().toISOString() }) });
    c = await chip();
    if (!/rqb-paused/.test(c.cls) || !/Paused until/.test(c.text) || !/paused/.test(await note() || '')) fail(`paused: chip ${JSON.stringify(c)}, note ${await note()}`);

    // old numbers
    await show({ ok: true, usage: usage(1200000, { at: new Date(Date.now() - 5 * 3600000).toISOString() }) });
    c = await chip();
    if (!/rqb-stale/.test(c.cls) || !/Last checked 5 h ago/.test(c.text)) fail(`numbers from 5 hours ago: chip ${JSON.stringify(c)}`);

    // the server doesn't answer: kept numbers stay; with none, "Couldn't load"; tried again later
    await show({ ok: true, usage: null });
    await page.evaluate(() => { window.__fail = true; });
    let n0 = await calls();
    await page.evaluate(() => RequestBudget.refresh()); await page.waitForTimeout(50);
    c = await chip();
    if (!/rqb-error/.test(c.cls) || !/Couldn't load/.test(c.text)) fail(`the server not answering: chip ${JSON.stringify(c)}`);
    await page.waitForTimeout(900);
    if (await calls() - n0 < 2) fail('after a failed request it doesn\'t try again a little later');
    await page.evaluate(() => { window.__fail = false; });

    // how often: every 1.5 s here (15 minutes for real), none in a background tab, at once when back if due
    await show({ ok: true, usage: usage(1200000) });
    n0 = await calls(); await page.waitForTimeout(3200);
    const visibleCalls = await calls() - n0;
    if (visibleCalls < 1 || visibleCalls > 3) fail(`${visibleCalls} requests in 3.2 s with a 1.5 s refresh (expected about 2)`);
    await page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    n0 = await calls(); await page.waitForTimeout(2500);
    if (await calls() !== n0) fail(`a background tab asked the server ${await calls() - n0} times`);
    await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(150);
    if (await calls() !== n0 + 1) fail(`back in view it didn't ask at once (${await calls() - n0} requests)`);

    // signing out: gone, and no more requests
    await page.evaluate(() => { window.__admin = false; });
    await page.waitForTimeout(300);
    n0 = await calls(); await page.waitForTimeout(2000);
    if (await chip() || await page.$('#rqb-panel') || await note() || await calls() !== n0) fail('after signing out the meter stays or keeps asking');

    // a phone: the chip fits
    await page.setViewportSize({ width: 375, height: 740 });
    await page.evaluate(() => { window.__admin = true; window.__reply = { ok: true, usage: null }; });
    await page.waitForTimeout(400);
    await show({ ok: true, usage: usage(9190000) });
    const box = await page.evaluate(() => { const r = document.getElementById('rqb-chip').getBoundingClientRect(); return { right: r.right, left: r.left }; });
    if (box.left < 0 || box.right > 375) fail(`on a phone the chip runs off the screen: ${JSON.stringify(box)}`);
    await page.click('#rqb-chip');
    const pb = await page.evaluate(() => { const r = document.getElementById('rqb-panel').getBoundingClientRect(); return { right: r.right, left: r.left }; });
    if (pb.left < 0 || pb.right > 375) fail(`on a phone the details run off the screen: ${JSON.stringify(pb)}`);

    await browser.close();
    if (failures.length) { console.log(`\n${failures.length} failure(s):`); failures.forEach((f, i) => console.log(`${i + 1}. ${f}`)); process.exit(1); }
    console.log('Request meter test passed (admins only; OK, getting close, nearly used up, pace, paused, old numbers, not set up, no answer; the note; the details; sparing requests).');
})().catch(e => { console.error(e); process.exit(1); });
