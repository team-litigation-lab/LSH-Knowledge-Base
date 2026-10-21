// Unit test for public/js/ai-editor.js: splitting an entry into cards, and applying one card's
// suggestion back into the markdown. Pure string work, no browser needed.
// Run: node tests/ai-editor.cjs
const fs = require('fs');
const path = require('path');
global.window = {};
new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'ai-editor.js'), 'utf8'))(global.window);
const A = global.window.KBAiEditor;

const failures = [];
const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) failures.push(m); };

// One card per heading; the text before the first heading is its own card.
const doc = 'A one-line opening.\n\n## Before you call\n- Pull the file\n\n## On the call\n1. Confirm the claim number\n';
const cards = A.splitCards(doc);
check(cards.length === 3, 'an entry with two headings splits into three cards');
check(cards.map(c => c.heading).join('|') === '|Before you call|On the call', 'each card carries its heading (the opening has none)');
check(cards[1].level === 2, 'the heading level comes along');
check(cards[1].text.startsWith('## Before you call'), 'a card holds its own heading line');

// Nothing is lost: the cards put back together are the entry, character for character.
check(A.joinCards(A.splitCards(doc)) === doc, 'splitting and rejoining gives back the same markdown');
const messy = '# Title\n\n\ntext\n\n#### Deep\n\nmore\n';
check(A.joinCards(A.splitCards(messy)) === messy, 'blank lines and an H4 survive the round trip');

// A heading inside a code fence is text, not a new card.
const fenced = 'Intro\n\n```\n# not a heading\n```\n\n## Real heading\nbody\n';
check(A.splitCards(fenced).length === 2, 'a # line inside a ``` fence does not start a card');

// Applying a card changes that card only, and keeps the blank line before the next heading.
const applied = A.applyCard(doc, 1, '## Before you call\n- Pull the file first');
check(applied === 'A one-line opening.\n\n## Before you call\n- Pull the file first\n\n## On the call\n1. Confirm the claim number\n',
    'applying a card replaces just that card and keeps the gap before the next heading');
check(A.applyCard(doc, 0, 'A one-line opening, corrected.').startsWith('A one-line opening, corrected.\n\n## Before you call'),
    'the opening card can be applied too');
check(A.applyCard(doc, 9, 'nope') === doc, 'a card that is not there leaves the markdown alone');

// An entry with no headings at all is one card.
check(A.splitCards('Just a paragraph.').length === 1, 'an entry with no headings is a single card');
check(A.splitCards('').length === 1, 'an empty entry is one (empty) card, so the panel has something to show');

console.log(failures.length ? `\n${failures.length} failed` : '\nAll passed');
process.exit(failures.length ? 1 : 0);
