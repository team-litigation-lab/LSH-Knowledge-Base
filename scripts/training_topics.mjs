#!/usr/bin/env node
// Turns the Foundational Training lessons into Knowledge Base pages, one page per topic, as public/seed/training.json.
//   node scripts/training_topics.mjs <path to the Foundational-Training repo>
// A lesson's topics are the ones its slide list is divided into (FT_TOPICS in js/ft-updates.js). Each topic's page is the text
// of its slides (their spoken script, one line per item), under the slides' own headings. Trainer-only material (the Training
// Guide, facilitator's notes, answer sheets) is not used.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const FT = path.resolve(process.argv[2] || '../Foundational-Training');
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'seed', 'training.json');

const topicsSrc = fs.readFileSync(path.join(FT, 'js', 'ft-updates.js'), 'utf8');
const start = topicsSrc.indexOf('const FT_TOPICS = {');
const end = topicsSrc.indexOf('\n};', start);
const FT_TOPICS = vm.runInNewContext('(' + topicsSrc.slice(start + 'const FT_TOPICS = '.length, end + 2) + ')');

const decode = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const say = (html) => { const m = html.match(/data-say="([^"]*)"/); return m ? decode(m[1]) : ''; };
const slug = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const pages = [];
for (const f of fs.readdirSync(path.join(FT, 'build', 'lessons')).filter(f => /^lesson0[1-8]\.js$/.test(f)).sort()) {
  const src = fs.readFileSync(path.join(FT, 'build', 'lessons', f), 'utf8');
  const name = src.match(/const (DAY\d+) = /)[1];
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src + ';this.D=' + name + ';', ctx);
  const D = ctx.D, topics = FT_TOPICS[D.id];
  if (!topics) continue;
  const ids = D.sections.map(s => s.id);
  const starts = topics.map(([id, h]) => ({ h, at: ids.indexOf(id) })).filter(t => t.at >= 0).sort((a, b) => a.at - b.at);
  starts.forEach((t, i) => {
    const slides = D.sections.slice(t.at, i + 1 < starts.length ? starts[i + 1].at : D.sections.length);
    const body = [];
    for (const sl of slides) {
      const lines = say(sl.html).split('\n').map(x => x.trim()).filter(Boolean);
      if (!lines.length) continue;
      const [head, ...rest] = lines;
      if (!rest.length && slides.length > 1 && head === sl.h && head === t.h) continue;
      if (slugEq(head, t.h) && body.length === 0) { /* the topic's own title slide: no repeated heading */ } else body.push('### ' + head);
      for (const l of rest) body.push(l);
    }
    const text = body.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < 60) return;
    const first = body.find(l => !l.startsWith('### ')) || '';
    pages.push({
      id: `L${D.id}-T${i + 1}`, lesson: D.id, lessonTitle: D.title, topic: t.h, order: i + 1, slides: slides.length,
      title: `${D.title}: ${t.h}`,
      summary: first.length > 220 ? first.slice(0, 217) + '…' : first,
      body: `*From the training module **${D.title}** (Lesson ${D.id}), topic ${i + 1} of ${starts.length}.*\n\n` + text
    });
  });
}
function slugEq(a, b) { return slug(a) === slug(b); }
fs.writeFileSync(OUT, JSON.stringify({ pages }, null, 1));
console.log(pages.length + ' topic pages -> ' + OUT);
const by = {}; pages.forEach(p => by[p.lesson] = (by[p.lesson] || 0) + 1); console.log(by);
