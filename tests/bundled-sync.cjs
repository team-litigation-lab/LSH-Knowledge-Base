// Unit test for src/bundled.js: how a bundled page is brought into the library (planChange) and how a page's links are
// fixed (fixLinks). Pure logic, no server or database needed.
// Run: node tests/bundled-sync.cjs
const { planChange, fixLinks, REF_RE } = require('../src/bundled.js');

const failures = [];
const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) failures.push(m); };

const want = { collection: 'intake', section: '', type: 'Guide', title: 'Common insurance providers', summary: 'The eight carriers', body: 'New text', tags: ['insurance'], credits: [], files: [] };
const imported = { ...want, title: 'COMMON INSURANCE PROVIDERS', body: 'Old text' };

// a page that isn't in the library is added
check(planChange(want, undefined).op === 'add', 'a page not in the library is added');
// archived or waiting for review: left alone
check(planChange(want, { status: 'archived', live: imported, imp: imported }) === null, 'an archived page is not brought back');
check(planChange(want, { status: 'pending', live: imported, imp: imported }) === null, 'a page waiting for review is left alone');
// never edited in the library: updated to the bundle's text
const up = planChange(want, { status: 'published', live: imported, imp: imported });
check(up && up.op === 'update' && up.data.body === 'New text', 'an unedited page gets the bundle’s new text');
check(up && up.data.title === 'Common insurance providers', 'an unedited title follows the bundle');
// a title someone changed in the library (e.g. put in sentence case) keeps their title, the text still updates
const tidied = { ...imported, title: 'Common Insurance Providers' };
const up2 = planChange(want, { status: 'published', live: tidied, imp: imported });
check(up2 && up2.data.body === 'New text' && up2.data.title === 'Common Insurance Providers', 'a renamed page keeps its title and gets the new text');
// text edited in the library: never overwritten
check(planChange(want, { status: 'published', live: { ...imported, body: 'Old text, corrected by a reviewer' }, imp: imported }) === null, 'text edited in the library is never overwritten');
check(planChange(want, { status: 'published', live: imported, imp: null }) === null, 'a page with no import version on record is left alone');
// already up to date: nothing to do
check(planChange(want, { status: 'published', live: want, imp: want }) === null, 'an up-to-date page is left alone');
// a handout imported as a PDF attachment becomes the text page its bundle now holds
const pdf = { ...want, body: 'See the attached handout.', files: [{ id: 'f1', name: 'h.pdf', kind: 'pdf' }] };
const up3 = planChange(want, { status: 'published', live: pdf, imp: pdf });
check(up3 && up3.data.body === 'New text' && up3.data.files.length === 0, 'a PDF-attachment page becomes a text page');
// a course handout the course's own sync updates: not updated from the bundle
check(planChange(want, { status: 'published', live: imported, imp: imported }, { updatable: false }) === null, 'a page kept in step with its course is not updated from the bundle');

// fixLinks
const rules = { moved: { 'https://old.example.com/a': 'https://new.example.com/a' }, dead: ['https://gone.example.com/b'], alive: ['https://fine.example.com/c'] };
const tettra = new Map([['write-a-winning-demand-letter', '848185']]);
const fx = (md) => fixLinks(md, rules, tettra);
check(fx('[Guide](https://old.example.com/a)') === '[Guide](https://new.example.com/a)', 'a moved link gets its new address');
check(fx('[Guide](https://gone.example.com/b)') === 'Guide *(link no longer works)*', 'a dead link keeps its words and loses its link');
check(fx('[Guide](https://gone.example.com/b) *(link no longer works)*') === 'Guide *(link no longer works)*', 'a dead link the converter already marked is marked once');
check(fx('[Guide](https://fine.example.com/c) *(link no longer works)*') === '[Guide](https://fine.example.com/c)', 'a link marked dead that works after all loses the mark');
check(fx('[Letter](https://app.tettra.co/teams/LSH/pages/write-a-winning-demand-letter#header-x)') === '[Letter](/#/go/848185)', 'a Tettra link goes to that page in the library');
check(fx('[Old](https://app.tettra.co/teams/vanlawfirm/pages/some-old-pageEdit)') === 'Old *(an old page that is not in the library)*', 'a Tettra link to a page not in the library says so');
check(fx('Go to https://old.example.com/a.') === 'Go to https://new.example.com/a.', 'a bare moved address gets its new address');
check(fx('Go to https://gone.example.com/b now') === 'Go to gone.example.com/b *(link no longer works)* now', 'a bare dead address is no longer linked');
check(fx('[Keep](https://other.example.com/x) and /#/doc/lesson-x') === '[Keep](https://other.example.com/x) and /#/doc/lesson-x', 'other links are untouched');
check(fixLinks('', rules) === '' && fixLinks('x', null) === 'x', 'empty text or no rules: unchanged');

// the references a link may use
check(['seed:lesson-common-insurance-providers', 'train:L6-T5', 'tettra:829736'].every(r => REF_RE.test(r)), 'docs, training topics and Tettra pages can be linked');
check(!['seed:', 'train:6-5', 'tettra:abc', 'a:1', 'seed:../x'].some(r => REF_RE.test(r)), 'anything else is refused');

console.log(failures.length ? `\n${failures.length} failed` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
