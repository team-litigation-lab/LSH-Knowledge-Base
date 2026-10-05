#!/usr/bin/env python3
"""Turns a Tettra JSON export into public/seed/tettra.json for Admin -> Import Tettra pages.

  python3 scripts/tettra_convert.py <tettra-export.json>

Each page's HTML becomes the Knowledge Base's safe Markdown. Images become ![alt](/img/<hash>), where <hash> is the
first 16 hex characters of the SHA-1 of the image's original address; the original addresses are kept in "images" so
the Worker can copy them into R2. Owner e-mail addresses are not carried over. Tettra's own starter templates
(pages with no category) and empty test pages are skipped.
"""
import hashlib, json, os, re, sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = {}


def img_id(url):
    h = hashlib.sha1(url.encode()).hexdigest()[:16]
    IMAGES[h] = url
    return h


class MD(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []          # finished blocks
        self.cur = ''          # inline text of the block being built
        self.lists = []        # stack of ['ul'|'ol', counter]
        self.link = None
        self.pre = False
        self.table = None      # rows being collected
        self.cell = None
        self.skip = 0

    # --- helpers
    def flush(self, prefix=''):
        t = re.sub(r'[ \t]+', ' ', self.cur).strip()
        t = re.sub(r'\s*\n\s*', '\n', t)
        self.cur = ''
        if t:
            self.out.append(prefix + t)

    def add(self, s):
        if self.cell is not None:
            self.cell.append(s)
        else:
            self.cur += s

    def handle_starttag(self, tag, a):
        a = dict(a)
        if tag in ('script', 'style'):
            self.skip += 1
        elif tag in ('h1', 'h2', 'h3', 'h4'):
            self.flush()
            self.hlevel = int(tag[1])
        elif tag == 'p':
            if self.cell is None:
                self.flush()
        elif tag == 'br':
            self.add(' ' if self.cell is not None else '\n')
        elif tag in ('strong', 'b'):
            self.add('**')
        elif tag in ('em', 'i'):
            self.add('*')
        elif tag == 'a':
            href = a.get('href') or ''
            self.link = href if re.match(r'(https?://|mailto:)', href) else None
            self.add('[' if self.link else '')
        elif tag == 'img':
            src = a.get('src') or ''
            if src.startswith('http'):
                alt = re.sub(r'[\[\]\n]', ' ', a.get('alt') or '').strip()
                if re.search(r'\.(png|jpe?g|gif|webp)$', alt, re.I) or alt.lower() in ('image', 'img'):
                    alt = ''
                self.add(f'\n\n![{alt}](/img/{img_id(src)})\n\n' if self.cell is None else f' ![{alt}](/img/{img_id(src)}) ')
        elif tag in ('ul', 'ol'):
            self.flush()
            self.lists.append([tag, 0])
        elif tag == 'li':
            self.flush()
            self.licur = True
        elif tag == 'pre':
            self.flush()
            self.pre = True
        elif tag == 'code' and not self.pre:
            self.add('`')
        elif tag == 'table':
            self.flush()
            self.table = []
        elif tag == 'tr' and self.table is not None:
            self.table.append([])
        elif tag in ('td', 'th') and self.table is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip -= 1
        elif tag in ('h1', 'h2', 'h3', 'h4'):
            self.cur = self.cur.replace('**', '')
            self.flush('#' * self.hlevel + ' ')
        elif tag == 'p':
            if self.cell is None:
                self.flush()
        elif tag in ('strong', 'b'):
            self.add('**')
        elif tag in ('em', 'i'):
            self.add('*')
        elif tag == 'a':
            if self.link:
                self.add(f']({self.link})')
            self.link = None
        elif tag in ('ul', 'ol'):
            self.flush()
            if self.lists:
                self.lists.pop()
            self.out.append('')
        elif tag == 'li':
            if self.lists:
                kind = self.lists[-1]
                kind[1] += 1
                self.flush(('  ' * (len(self.lists) - 1)) + ('- ' if kind[0] == 'ul' else f'{kind[1]}. '))
            else:
                self.flush('- ')
        elif tag == 'pre':
            code = self.cur.strip('\n')
            self.cur = ''
            self.pre = False
            if code.strip():
                self.out.append('```\n' + code + '\n```')
        elif tag == 'code' and not self.pre:
            self.add('`')
        elif tag in ('td', 'th') and self.table is not None and self.cell is not None:
            txt = re.sub(r'\s+', ' ', ''.join(self.cell)).strip().replace('|', '/')
            self.table[-1].append(txt)
            self.cell = None
        elif tag == 'table' and self.table is not None:
            rows = [r for r in self.table if any(c for c in r)]
            self.table = None
            if rows:
                n = max(len(r) for r in rows)
                rows = [r + [''] * (n - len(r)) for r in rows]
                self.out.append('| ' + ' | '.join(rows[0]) + ' |\n|' + '---|' * n + '\n' +
                                '\n'.join('| ' + ' | '.join(r) + ' |' for r in rows[1:]))

    def handle_data(self, data):
        if self.skip:
            return
        if self.pre:
            self.cur += data
        else:
            self.add(re.sub(r'\s+', ' ', data))

    def result(self):
        self.flush()
        # nested lists: keep list items together, everything else separated by blank lines
        md = ''
        prev_li = False
        for b in self.out:
            is_li = re.match(r'\s*(- |\d+\. )', b) is not None and '\n' not in b
            md += ('\n' if (prev_li and is_li) else '\n\n') + b if md else b
            prev_li = is_li
        md = re.sub(r'\*\*\s*\*\*', '', md)                    # empty bold
        md = re.sub(r'\*\*(\s+)', r'\1**', md) if False else md
        md = re.sub(r'\n{3,}', '\n\n', md)
        return md.strip()


def convert(html):
    p = MD()
    p.feed(html)
    p.close()
    return p.result()


def plain(md):
    t = re.sub(r'```.*?```', ' ', md, flags=re.S)
    t = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', t)
    t = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', t)
    t = re.sub(r'[#*`>|\-]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def summary_of(md):
    """The first real paragraph (not a heading, image, list, table or code), else the page's plain text."""
    for blk in re.split(r'\n\s*\n', md):
        b = blk.strip()
        if not b or re.match(r'(#|!\[|\||```|- |\d+\. )', b):
            continue
        t = plain(b)
        if len(t) >= 40:
            return (t[:217] + '…') if len(t) > 220 else t
    t = plain(md)
    return (t[:217] + '…') if len(t) > 220 else t


def main(src):
    data = json.load(open(src))
    pages = []
    for x in data:
        cat = x.get('category_name')
        if x.get('deleted_at') or not cat:
            continue                      # deleted, or one of Tettra's starter templates
        if 'nitro pro' in x['page_title'].lower():
            continue                      # instructions for installing a cracked copy of Nitro Pro; left out on purpose
        if cat == 'Test. Test' and len(x.get('html') or '') < 200:
            continue
        md = convert(x.get('html') or '')
        if len(md) < 20:
            continue
        s = summary_of(md)
        pages.append({'id': x['id'], 'title': x['page_title'].strip(), 'category': cat, 'subcategory': x.get('subcategory_name') or '',
                      'owner': x.get('owner_name') or '', 'created': x['created_at'], 'updated': x['updated_at'],
                      'url': x['url'], 'summary': s, 'body': md})
    used = {h for p in pages for h in re.findall(r'/img/([0-9a-f]{16})', p['body'])}
    out = {'pages': pages, 'images': {h: u for h, u in IMAGES.items() if h in used}}
    dest = os.path.join(ROOT, 'public', 'seed', 'tettra.json')
    json.dump(out, open(dest, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(pages)} pages, {len(out["images"])} images, {os.path.getsize(dest) // 1024} KB -> {dest}')


if __name__ == '__main__':
    main(sys.argv[1])
