#!/usr/bin/env python3
"""Turns a Tettra JSON export into public/seed/tettra.json for Admin -> Import Tettra pages.

  python3 scripts/tettra_convert.py <tettra-export.json>

Each page's HTML becomes the Knowledge Base's safe Markdown. Images become ![alt](/img/<hash>), where <hash> is the
first 16 hex characters of the SHA-1 of the image's original address; the original addresses are kept in "images" so
the Worker can copy them into R2. Owner e-mail addresses are not carried over. Pages deleted in Tettra, pages with no\ncontent (the empty "asd" test page) and the cracked-Nitro-Pro install page are skipped; everything else is kept, including\nTettra's starter templates (pages with no category, shelved under "Tettra starter templates").
"""
import hashlib, json, os, re, sys, urllib.parse
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Company-related policy and management sections of the old Tettra (company information, client management, VA management).
# They are not part of the Knowledge Base; an import also archives any of these pages imported earlier.
EXCLUDE_CATEGORIES = {'I. Company Information', 'II. Client Management', 'II. VA Management',
                      'III. Tools & Applications', 'III. Service: Document Generation', 'III. Service: Automation',
                      'III. Service: Marketing', 'III Service: Accounting/Bookkeeping'}
# Pages that become the Glossary (a dictionary of terms) instead of library entries.
# Company-internal pages that are not knowledge: the company's own product list, the VA task assessment manual, and
# Tettra's ten starter templates (About the company, Social media policy, Quarterly OKRs ...). Archived if imported earlier.
EXCLUDE_TITLES = {'LSH Marketing Products', 'LSH Task Assessment Manual (TAM)'}
# The Knowledge Base is limited to the law practice itself (intake, claims and case work, demands, medical summaries and liens,
# litigation, practice areas). Software tutorials, automation, accounting, marketing tools and general VA-skills pages are left out.
EXCLUDE_TITLES |= {'Upskill on your FREE TIME', 'Email Management', 'Ways to Manage Your Email Inbox'}
EXCLUDE_UNCATEGORIZED = True
GLOSSARY_PAGES = {'LSH Legal Jargon', 'Medical Terminologies and Abbreviations'}
DEAD = set(json.load(open(os.path.join(ROOT, 'scripts', 'dead_links.json')))['dead'])
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
        md = re.sub(r'\*\*[ \t]*\*\*', '', md)                # empty bold (within a line only, so neighbouring bold paragraphs stay apart)
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
    heads = [re.sub(r'[*`\[\]]|\([^)]*\)', '', h).strip() for h in re.findall(r'^#{1,2} (.+)$', md, flags=re.M)]
    heads = [h for h in heads if h]
    if heads:
        t = 'Covers ' + ', '.join(heads[:6]) + ('…' if len(heads) > 6 else '.')
        return (t[:217] + '…') if len(t) > 220 else t
    t = plain(md)
    return (t[:217] + '…') if len(t) > 220 else t


def tidy(md, by_slug):
    """Brings a page up to date after the move from Tettra: links to other Tettra pages point at their Knowledge Base
    pages, "Tettra article" becomes "Knowledge Base article", attachments get their file name as link text, and the
    Tettra login that was written into the Task Assessment Manual is removed."""
    md = re.sub(r'[\ue000-\uf8ff]', '', md)
    # the Tettra login written into the Task Assessment Manual (an account that is no longer used)
    md = re.sub(r'### Learn more: Introduction to LSH Tettra\n\n.*?(?=\n\n)',
                "### Learn more: The LSH Knowledge Base\n\nThe LSH Knowledge Base is the team's internal library of SOPs, guides and training videos. "
                "Open it from the LSH Training Portal.", md, flags=re.S)
    md = re.sub(r'Username:\s*\[?[^\s\]]+\]?(\([^)]*\))?\s*Password:\s*\S+', '', md)

    def target(url):
        m = re.match(r'https?://app\.tettra\.co/teams/([^/]+)/pages/([A-Za-z0-9_-]+)', url)
        if not m:
            return None
        pid = by_slug.get(m.group(2)) if m.group(1).lower() == 'lsh' else None
        return pid if pid else False

    def link(m):
        text, url = m.group(1), m.group(2)
        t = target(url)
        if t is None:
            return m.group(0)
        return f'[{text}](/#/go/{t})' if t else text
    md = re.sub(r'(?<!!)\[([^\]\n]*)\]\((https?://app\.tettra\.co/[^)\s]*)\)', link, md)

    def bare(m):
        t = target(m.group(0))
        return f'[this page](/#/go/{t})' if t else '(an old Tettra page that is not in the library)'
    md = re.sub(r'https?://app\.tettra\.co/teams/[^\s)\]]+', bare, md)

    def attach(m):
        name = urllib.parse.unquote(m.group(1).split('?')[0].rsplit('/', 1)[-1]) or 'attachment'
        return f'[{name}]({m.group(1)})'
    md = re.sub(r'(?<!!)\[\s*\]\((https?://[^)\s]+)\)', attach, md)
    md = re.sub(r'\bTettra [Aa]rticles\b', 'Knowledge Base articles', md)
    md = re.sub(r'\bTettra [Aa]rticle\b', 'Knowledge Base article', md)
    return md


def mark_dead(md):
    """Adds "(link no longer works)" after every link that is known to be dead (scripts/dead_links.json)."""
    def sub(m):
        return m.group(0) if m.group(0).endswith('(link no longer works)') else m.group(0) + ' *(link no longer works)*'
    for u in sorted(DEAD, key=len, reverse=True):
        esc = re.escape(u)
        md = re.sub(r'(?<!\()\[[^\]\n]*\]\(' + esc + r'\)(?! \*\(link no longer works)', sub, md)
        md = re.sub(r'(?<![(\[/\w])' + esc + r'(?![\w/)\]-])(?! \*\(link no longer works)', sub, md)
    return md


def years(md):
    return sorted(set(re.findall(r'\b(20[12]\d)\b', md)))


def glossary(title, pid, md):
    """Terms and definitions from the two Tettra pages that are really dictionaries."""
    terms = []

    def add(term, definition, example=''):
        term = re.sub(r'\s+', ' ', term).strip(' *:-')
        definition = re.sub(r'\s+', ' ', definition).strip(' -–:*')
        definition = re.sub(r'^(is|are|refers to)\s+', '', definition)
        if term and definition:
            terms.append({'term': term, 'definition': definition[0].upper() + definition[1:], 'example': example,
                          'category': 'Legal' if title == 'LSH Legal Jargon' else 'Medical', 'ref': f'tettra:{pid}:{len(terms) + 1}',
                          'source': 'Tettra: ' + title})
    if title == 'LSH Legal Jargon':
        heading = ''
        for blk in [b.strip() for b in re.split(r'\n\s*\n', md) if b.strip()]:
            if blk.startswith('#'):
                heading = blk.lstrip('# ').strip()
                continue
            if blk.startswith('*') and not blk.startswith('**') and terms:
                terms[-1]['example'] = re.sub(r'^\*|\*$', '', blk).strip()
                continue
            m = re.match(r'\*\*([^*]+?)\s*\*\*\s*(.*)', blk, re.S)
            if m:
                rest = m.group(2)
                two = re.split(r'\s*While \*\*([^*]+?)\*\*\s*', rest)
                add(m.group(1), two[0])
                if len(two) == 3:
                    add(two[1], two[2])
            elif heading and not heading.isupper() and not heading.startswith('Case Details'):
                add(heading, blk)
    else:
        for line in md.split('\n'):
            m = re.match(r'\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*$', line)
            if m:
                add(m.group(1), m.group(2))
    return terms


def main(src):
    data = json.load(open(src))
    by_slug = {x['url'].rsplit('/', 1)[-1]: x['id'] for x in data if x.get('url')}
    pages, terms = [], []
    for x in data:
        cat = x.get('category_name') or 'Tettra starter templates'
        if x.get('deleted_at'):
            continue                      # deleted in Tettra
        if 'crack version' in (x.get('html') or '').lower():
            continue                      # instructions for installing a cracked copy of Nitro Pro; left out on purpose
        if x['page_title'].strip() in GLOSSARY_PAGES:
            terms += glossary(x['page_title'].strip(), x['id'], mark_dead(tidy(convert(x.get('html') or ''), by_slug)))
            continue                      # it is the Glossary now, not a library entry
        if x['page_title'].strip() in EXCLUDE_TITLES or (EXCLUDE_UNCATEGORIZED and not x.get('category_name')):
            continue                      # company-internal, not knowledge
        if cat in EXCLUDE_CATEGORIES:
            continue                      # company-related policies and management: not part of the Knowledge Base
        md = mark_dead(tidy(convert(x.get('html') or ''), by_slug))
        if len(md) < 20:
            continue
        s = summary_of(md)
        yrs = years(md)
        tags = []
        if yrs and yrs[-1] <= '2023':      # only cites dates up to 2023: a reviewer should confirm it is still current
            tags = ['needs-review']
            md = f'> **Needs review:** this page was last updated in {x["updated_at"][:4]} and its dates stop at {yrs[-1]}. A reviewer should confirm it is still current.\n\n' + md
        pages.append({'id': x['id'], 'tags': tags, 'title': x['page_title'].strip(), 'category': cat, 'subcategory': x.get('subcategory_name') or '',
                      'owner': x.get('owner_name') or '', 'created': x['created_at'], 'updated': x['updated_at'],
                      'url': x['url'], 'summary': s, 'body': md})
    used = {h for p in pages for h in re.findall(r'/img/([0-9a-f]{16})', p['body'])}
    out = {'pages': pages, 'images': {h: u for h, u in IMAGES.items() if h in used}}
    json.dump({'terms': sorted(terms, key=lambda t: t['term'].lower())}, open(os.path.join(ROOT, 'public', 'seed', 'glossary.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'{len(terms)} glossary terms')
    dest = os.path.join(ROOT, 'public', 'seed', 'tettra.json')
    json.dump(out, open(dest, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(pages)} pages, {len(out["images"])} images, {os.path.getsize(dest) // 1024} KB -> {dest}')


if __name__ == '__main__':
    main(sys.argv[1])
