// Request-storm probe. Opens pages with every /api/** call stubbed as an EMPTY success, sits idle,
// and fails if any one path is requested more than a ceiling inside the window, or if the page is
// still chattering after it should have settled.
//
// Empty is the default on purpose: a storm usually fires only when there is nothing saved yet,
// because an empty answer is treated as a cache miss and re-fetched on every render. A page that
// looks fine with data can still burn the allowance for a trainee with no records.
//
// Usage (from the repository root):
//   node .github/scripts/request-probe.cjs
//   node .github/scripts/request-probe.cjs --page core.html --page simulators/gcal.html
//   node .github/scripts/request-probe.cjs --max-per-path 6 --window 12000 --verbose
//
// Options:
//   --page <path>        a page to probe; repeatable. Default: every .html the repo serves,
//                        excluding stubs/redirect pages.
//   --window <ms>        how long to sit idle on each page (default 12000).
//   --settle <ms>        startup grace before counting (default 3000); load-time bursts are fine.
//   --max-per-path <n>   ceiling per API path inside the window after settling (default 4).
//   --max-total <n>      ceiling across all API paths after settling (default 12).
//   --session <none|trainee|admin>  seed a signed-in session (default admin).
//   --verbose            print every request with its timestamp.
//   --json               machine-readable summary on stdout.
//
// Needs Playwright and Chromium. Both are preinstalled in LSH cloud sessions
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) — never run `playwright install`.
// Exits 0 when clean, 1 on a storm, 2 on a setup problem.

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
    console.error('playwright is not resolvable. In CI, install it as the checks workflow does and set NODE_PATH.');
    process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf('--' + name); return i === -1 ? dflt : Number(args[i + 1]); };
const str = (name, dflt) => { const i = args.indexOf('--' + name); return i === -1 ? dflt : args[i + 1]; };
const WINDOW = flag('window', 12000);
const SETTLE = flag('settle', 3000);
const MAX_PER_PATH = flag('max-per-path', 4);
const MAX_TOTAL = flag('max-total', 12);
const SESSION = str('session', 'admin');
const VERBOSE = args.includes('--verbose');
const AS_JSON = args.includes('--json');

const ROOT = process.cwd();
const pages = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--page') pages.push(args[i + 1]);

// Pages that exist only to redirect or stub, so they never settle into an idle state worth counting.
const SKIP = new Set(['orientation.html', 'simulators/call.html']);

function discover(dir, out = [], base = '') {
    for (const name of fs.readdirSync(dir)) {
        if (name.startsWith('.') || name === 'node_modules' || name === 'reports') continue;
        const full = path.join(dir, name);
        const rel = base ? base + '/' + name : name;
        const st = fs.statSync(full);
        if (st.isDirectory()) { if (name !== 'functions') discover(full, out, rel); }
        else if (name.endsWith('.html') && !SKIP.has(rel)) out.push(rel);
    }
    return out;
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.cjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// Empty-but-successful shapes. A page that cannot parse the answer may bail out early and look
// quiet for the wrong reason, so the common envelopes are all present.
function emptyBody(pathname) {
    return JSON.stringify({
        success: true, ok: true, locked: false, paused: false, active: false,
        rows: [], items: [], list: [], results: [], pings: [], data: null, value: null,
        settings: {}, firms: [], profiles: [], user: null, me: null,
        siteState: { success: true, locked: false, paused: false },
        alert: { active: false }, _stub: pathname
    });
}

const SESSIONS = {
    admin: { username: 'trainer-probe', fullName: 'Probe Trainer', batchId: 'B1', userType: 'Admin' },
    trainee: { username: 'trainee-probe', fullName: 'Probe Trainee', batchId: 'B1', userType: 'Trainee' }
};

(async () => {
    const list = pages.length ? pages : discover(ROOT);
    if (!list.length) { console.error('no pages found to probe'); process.exit(2); }

    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        let f = path.join(ROOT, decodeURIComponent(u.pathname));
        if (f.endsWith('/')) f += 'index.html';
        if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
        res.end(fs.readFileSync(f));
    });
    await new Promise(r => server.listen(0, r));
    const base = `http://localhost:${server.address().port}`;

    const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH }
        : (process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') } : {});
    let browser;
    try { browser = await chromium.launch(launch); }
    catch (e) { try { browser = await chromium.launch(); } catch (e2) { console.error('could not launch Chromium: ' + e2.message); process.exit(2); } }

    const report = [];
    let storms = 0;

    for (const rel of list) {
        const log = [];
        const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(e.message));
        page.on('dialog', d => d.dismiss().catch(() => {}));
        await page.route('**/api/**', route => {
            const u = new URL(route.request().url());
            log.push({ at: Date.now(), path: u.pathname });
            route.fulfill({ status: 200, contentType: 'application/json', body: emptyBody(u.pathname) }).catch(() => {});
        });
        // Keep third-party CDNs out of the measurement; they do not touch the allowance.
        await page.route(/cdn\.tailwindcss\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/,
            r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }).catch(() => {}));
        if (SESSION !== 'none') {
            const who = SESSIONS[SESSION] || SESSIONS.admin;
            await page.addInitScript(s => {
                try { sessionStorage.setItem('LSH_SESSION_V1', s); } catch (e) {}
                try { localStorage.setItem('LSH_SESSION_V1', s); } catch (e) {}
            }, JSON.stringify(who));
        }

        let navError = null;
        try { await page.goto(base + '/' + rel, { waitUntil: 'load', timeout: 30000 }); }
        catch (e) { navError = e.message; }

        if (navError) {
            report.push({ page: rel, skipped: 'did not load: ' + navError });
            await page.close();
            continue;
        }

        await page.waitForTimeout(SETTLE);
        const t0 = Date.now();
        await page.waitForTimeout(WINDOW);

        const after = log.filter(x => x.at >= t0);
        const byPath = {};
        for (const r of after) byPath[r.path] = (byPath[r.path] || 0) + 1;
        const worst = Object.entries(byPath).sort((a, b) => b[1] - a[1]);
        const total = after.length;
        const perMinute = Math.round(total * 60000 / WINDOW);

        const problems = [];
        for (const [p, n] of worst) if (n > MAX_PER_PATH) problems.push(`${p} asked ${n}x in ${WINDOW / 1000}s (ceiling ${MAX_PER_PATH})`);
        if (total > MAX_TOTAL) problems.push(`${total} API requests in ${WINDOW / 1000}s idle (ceiling ${MAX_TOTAL}) — about ${perMinute}/min per tab`);

        report.push({ page: rel, total, perMinute, byPath, problems, pageErrors: pageErrors.slice(0, 3) });
        if (problems.length) storms++;

        if (VERBOSE) {
            console.log(`\n--- ${rel}: every API request after settling`);
            for (const r of after) console.log(`    +${String(r.at - t0).padStart(6)}ms  ${r.path}`);
        }
        await page.close();
    }

    await browser.close();
    server.close();

    if (AS_JSON) { console.log(JSON.stringify({ window: WINDOW, maxPerPath: MAX_PER_PATH, maxTotal: MAX_TOTAL, storms, report }, null, 2)); }
    else {
        console.log(`\nRequest-storm probe — idle ${WINDOW / 1000}s per page, empty API responses, session: ${SESSION}`);
        console.log(`Ceilings: ${MAX_PER_PATH} per path, ${MAX_TOTAL} total.\n`);
        for (const r of report) {
            if (r.skipped) { console.log(`  SKIP  ${r.page} — ${r.skipped}`); continue; }
            const worst = Object.entries(r.byPath).sort((a, b) => b[1] - a[1]).slice(0, 4)
                .map(([p, n]) => `${p}×${n}`).join('  ') || 'none';
            console.log(`  ${r.problems.length ? 'STORM' : ' ok  '} ${r.page.padEnd(40)} ${String(r.total).padStart(4)} reqs (~${r.perMinute}/min)   ${worst}`);
            for (const p of r.problems) console.log(`        → ${p}`);
            for (const e of r.pageErrors) console.log(`        page error: ${e}`);
        }
        console.log(storms ? `\n${storms} page(s) over the ceiling.` : '\nNo page exceeded the ceiling.');
    }
    process.exit(storms ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
