#!/usr/bin/env python3
"""Turns a PDF handout into the Knowledge Base's Markdown (headings, bold, lists, tables), so it reads as a page
of the platform instead of opening in a PDF viewer.   python3 scripts/pdf_to_md.py file.pdf > file.md
Needs: pip install pymupdf"""
import collections, re, sys
import pymupdf

BUL = re.compile(r'^\s*([●•○▪■◦·\-–*]|\d{1,2}[.)])\s*(?=\S)')


def clean(t):
    t = t.replace('​', '').replace(' ', ' ').replace('', '•')
    return re.sub(r'[ \t]+', ' ', t).strip()


def convert(path):
    doc = pymupdf.open(path)
    sizes = collections.Counter()
    page_lines = []
    for pg in doc:
        items = []
        tabs = pg.find_tables().tables
        tb = [pymupdf.Rect(t.bbox) for t in tabs]
        for b in pg.get_text('dict')['blocks']:
            if b['type'] != 0:
                continue
            r = pymupdf.Rect(b['bbox'])
            if any((r & t).get_area() > 0.5 * r.get_area() for t in tb):
                continue
            lines = []
            for l in b['lines']:
                spans = [s for s in l['spans'] if s['text'].strip()]
                if not spans:
                    continue
                for s in spans:
                    sizes[round(s['size'])] += len(s['text'])
                lines.append(spans)
            if lines:
                items.append((b['bbox'][1], 'text', lines))
        for t, r in zip(tabs, tb):
            rows = [[clean((c or '').replace('\n', ' ')).replace('|', '/') for c in row] for row in t.extract()]
            rows = [r_ for r_ in rows if any(r_)]
            if rows:
                items.append((r.y0, 'table', rows))
        items.sort(key=lambda x: x[0])
        page_lines.append(items)
    body = sizes.most_common(1)[0][0]
    # lines that repeat on several pages are page furniture (logo text, footers)
    seen = collections.Counter()
    for items in page_lines:
        for _, k, c in items:
            if k == 'text':
                for l in c:
                    seen[clean(''.join(s['text'] for s in l))] += 1
    furniture = {t for t, n in seen.items() if n >= 3 and len(t) < 60}

    out = []

    def span_md(s):
        t = s['text']
        if not t.strip():
            return t
        bold = bool(s['flags'] & 16) or 'bold' in s['font'].lower()
        ital = bool(s['flags'] & 2) or 'italic' in s['font'].lower()
        lead, core, trail = re.match(r'(\s*)(.*?)(\s*)$', t, re.S).groups()
        if bold and ital:
            core = f'***{core}***'
        elif bold:
            core = f'**{core}**'
        elif ital:
            core = f'*{core}*'
        return lead + core + trail

    def is_bold(s):
        return bool(s['flags'] & 16) or 'bold' in s['font'].lower()

    for items in page_lines:
        for _, kind, content in items:
            if kind == 'table':
                n = max(len(r) for r in content)
                rows = [r + [''] * (n - len(r)) for r in content]
                out.append('| ' + ' | '.join(rows[0]) + ' |\n|' + '---|' * n + '\n' + '\n'.join('| ' + ' | '.join(r) + ' |' for r in rows[1:]))
                continue
            para, lst, head = [], [], None   # one PDF block: a paragraph, or list items, or a heading
            blocks = []

            def close():
                nonlocal para, lst, head
                if head:
                    blocks.append(head)
                if para:
                    blocks.append(' '.join(para))
                if lst:
                    blocks.append('\n'.join(lst))
                para, lst, head = [], [], None

            for spans in content:
                plain = clean(''.join(s['text'] for s in spans))
                if not plain or plain in furniture or re.fullmatch(r'(page )?\d{1,3}( of \d+)?', plain, re.I):
                    continue
                size = max(round(s['size']) for s in spans)
                nb = sum(len(s['text'].strip()) for s in spans if is_bold(s))
                frac = nb / max(1, sum(len(s['text'].strip()) for s in spans))
                m = BUL.match(plain)
                bullet = bool(m) and not re.match(r'\d', m.group(1))
                if frac >= 0.9 and len(plain) <= 120 and (size > body or not bullet):
                    t = re.sub(r'\*+', '', plain)
                    t = re.sub(r'^\d{1,2}[.)]\s*(?=\d{1,2}[.)]\s)', '', t)      # "1. 1. Title" -> "1. Title"
                    t = re.sub(r'^[^\w(]{1,3}\s+', '', t)
                    lvl = 2 if size >= body + 5 else 3 if size >= body + 2 else 4
                    if head and head.startswith('#' * lvl + ' '):
                        head += ' ' + t
                    else:
                        if para or lst or head:
                            close()
                        head = '#' * lvl + ' ' + t
                    continue
                text = clean(''.join(span_md(s) for s in spans))
                if m:
                    if head or para:
                        close()
                    marker = '- ' if bullet else m.group(1) + ' '
                    lst.append(marker + BUL.sub('', text))
                elif lst and (text[:1].islower() or lst[-1].endswith((',', ';', ':'))):
                    lst[-1] += ' ' + text
                elif lst:
                    lst[-1] += ' ' + text
                else:
                    if head:
                        close()
                    para.append(text)
            close()
            out.extend(blocks)
    merged = []
    for b in out:   # a title that wrapped onto a second line came out as two headings of the same level
        if merged and re.match(r'#{2,4} ', b) and merged[-1].startswith(b.split(' ')[0] + ' ') and re.search(r'\b(for|and|of|to|the|in|&|a|on|with)$', merged[-1], re.I):
            merged[-1] += ' ' + b.split(' ', 1)[1]
        else:
            merged.append(b)
    out = merged
    md = '\n\n'.join(b for b in out if b.strip())
    md = re.sub(r'\*\*(\s*)\*\*', r'\1', md)
    md = re.sub(r'(\*\*[^*\n]+?)\*\*\s*\*\*', r'\1 ', md)
    return re.sub(r'\n{3,}', '\n\n', md).strip()


if __name__ == '__main__':
    print(convert(sys.argv[1]))
