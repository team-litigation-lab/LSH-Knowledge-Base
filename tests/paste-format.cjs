// Unit test for public/js/paste-format.js: pure regex-based markdown conversion, no browser needed.
// Run: node tests/paste-format.cjs
const fs = require('fs');
const path = require('path');
global.window = {};
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'paste-format.js'), 'utf8'))(global.window);
const F = global.window.KBPasteFormat;

const failures = [];
const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) failures.push(m); };

// Bold and italic from <strong>/<em>, as a browser's clipboard HTML for a Word or Google Docs paste gives it.
check(F.hasRichFormatting('<p>Call the <strong>client</strong> within <em>24 hours</em>.</p>'), 'strong/em is detected as rich formatting');
check(F.htmlToMarkdown('<p>Call the <strong>client</strong> within <em>24 hours</em>.</p>') === 'Call the **client** within *24 hours*.',
    'strong/em becomes **bold**/*italic*');

// Google Docs represents bold as a styled span (font-weight), not a <strong> tag.
check(F.hasRichFormatting('<span style="font-weight:700">Important</span>'), 'a font-weight:700 span is detected as rich formatting');
check(F.htmlToMarkdown('<span style="font-weight:700">Important</span> — read first.') === '**Important** — read first.',
    'a bold styled span becomes **bold**');
check(F.htmlToMarkdown('<span style="font-style:italic">note</span>') === '*note*', 'an italic styled span becomes *italic*');
check(F.htmlToMarkdown('<u>Underlined</u>') === '++Underlined++', '<u> becomes ++underline++');
check(F.htmlToMarkdown('<span style="font-weight:bold"><em>both</em></span>') === '***both***',
    'bold styling around an <em> keeps both: **wraps the already-*italic* text**');

// A pasted HTML table becomes a pipe table that js/md.js can render.
const tableHtml = '<table><tr><th>Item</th><th>Amount</th></tr><tr><td>Bill</td><td>$12,000</td></tr><tr><td><b>Total</b></td><td>$12,000</td></tr></table>';
check(F.hasRichFormatting(tableHtml), 'a <table> is detected as rich formatting');
const tableMd = F.htmlToMarkdown(tableHtml);
check(tableMd.split('\n').length === 4, 'the table has a header row, a separator row and two body rows');
check(/^\| Item \| Amount \|$/.test(tableMd.split('\n')[0]), 'the header row is a pipe row');
check(/^\|\s*---\s*\|\s*---\s*\|$/.test(tableMd.split('\n')[1]), 'the second row is the table separator');
check(tableMd.split('\n')[3] === '| **Total** | $12,000 |', 'bold inside a table cell is kept');

// Plain paragraph text with no formatting is left for the browser to paste as usual.
check(F.hasRichFormatting('<p>Just a plain sentence.</p>') === false, 'plain HTML with no bold/italic/underline/table is not rich formatting');

// A link survives, with its href, as a markdown link.
check(F.htmlToMarkdown('<p>See <a href="https://example.com/sop">the SOP</a>.</p>') === 'See [the SOP](https://example.com/sop).',
    'a link becomes [text](url)');

// A list becomes markdown bullets.
check(F.htmlToMarkdown('<ul><li>First</li><li>Second</li></ul>').replace(/\n+/g, '\n').trim() === '- First\n- Second',
    'a <ul> becomes a markdown bullet list');

// Tab-separated plain text (no HTML), the shape a spreadsheet's plain clipboard takes, becomes a table too.
check(F.looksLikeTabTable('Item\tAmount\nBill\t$12,000') === true, 'two equal-width tab-separated rows look like a table');
check(F.looksLikeTabTable('just one line') === false, 'a single line is never treated as a table');
check(F.looksLikeTabTable('no tabs here\nor here') === false, 'text with no tabs is never treated as a table');
const tabMd = F.tabTextToMarkdown('Item\tAmount\nBill\t$12,000');
check(tabMd === '| Item | Amount |\n| --- | --- |\n| Bill | $12,000 |', 'tab-separated text becomes the same kind of pipe table');

// HTML entities in pasted text come back as literal characters, not the escaped source.
check(F.htmlToMarkdown('<p>Smith &amp; Jones &mdash; 10&nbsp;days</p>') === 'Smith & Jones — 10 days', 'entities decode to literal characters');

console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
