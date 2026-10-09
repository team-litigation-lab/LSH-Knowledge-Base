// Unit test for src/util.js's autoformatBody: the Admin → Library maintenance action that autoformats
// an existing entry's body the same way a rich paste is now autoformatted. Pure logic, no server needed.
// Run: node tests/autoformat-body.cjs
const { autoformatBody } = require('../src/util.js');

const failures = [];
const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) failures.push(m); };

// A plain-text table lined up with two or more spaces becomes a real pipe table.
const spaced = 'Item        Amount\nBill        $12,000\nTotal       $12,000';
const spacedMd = autoformatBody(spaced);
check(spacedMd.split('\n').length === 4, 'a space-aligned table gets a header, a separator and both body rows');
check(spacedMd.split('\n')[0] === '| Item | Amount |', 'the header row becomes a pipe row');
check(/^\|\s*---\s*\|\s*---\s*\|$/.test(spacedMd.split('\n')[1]), 'a separator row is inserted');
check(spacedMd.split('\n')[2] === '| Bill | $12,000 |', 'the first body row keeps its cells');

// A table typed with a bare "|" (no leading/trailing pipe, no separator row) becomes a real table too.
const bare = 'Item | Amount\nBill | $12,000';
const bareMd = autoformatBody(bare);
check(bareMd === '| Item | Amount |\n| --- | --- |\n| Bill | $12,000 |', 'a bare-pipe table gets wrapped and a separator row');

// A single "Label:" at the start of a line is bolded; a label already bolded is left alone (idempotent).
check(autoformatBody('Operational Note: This document contains standard protocols.') === '**Operational Note:** This document contains standard protocols.',
    'a leading label gets bolded');
check(autoformatBody('**Operational Note:** This document contains standard protocols.') === '**Operational Note:** This document contains standard protocols.',
    'a label already bolded is left alone');

// Running it twice changes nothing the second time (the admin action relies on this to know an entry is done).
for (const md of [spaced, bare, 'Operational Note: This document contains standard protocols.',
    '## Heading\n\n1. **Isolate the Defect:** do the thing\n2. Another step\n\n| Item | Amount |\n|---|---|\n| Bill | $12,000 |']) {
    const once = autoformatBody(md), twice = autoformatBody(once);
    check(once === twice, `running autoformatBody twice on ${JSON.stringify(md.slice(0, 30))}… gives the same result both times`);
}

// Headings, lists, quotes and an existing valid table are left exactly as they are.
const untouched = '## Heading\n\nA normal paragraph.\n\n- First item\n- Second item\n\n> A quote\n\n| Item | Amount |\n|---|---|\n| Bill | $12,000 |';
check(autoformatBody(untouched) === untouched, 'headings, lists, quotes and an already-valid table are untouched');

// A short run (a single line, or two lines with a different number of columns) is never turned into a table.
check(autoformatBody('Item        Amount') === 'Item        Amount', 'a single line is never turned into a table');
check(autoformatBody('A    B    C\nD    E') === 'A    B    C\nD    E', 'rows with a different column count are left alone');

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
