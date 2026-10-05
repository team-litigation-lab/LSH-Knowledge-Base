#!/usr/bin/env python3
"""Turns a Word (.docx) file into the Knowledge Base's Markdown: headings, bold and italic, links, bullet and numbered lists
(nested), and tables.     python3 scripts/docx_to_md.py file.docx > file.md        Needs: pip install python-docx"""
import re, sys
import docx
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


def list_formats(d):
    """(numId, level) -> 'bullet' or 'decimal' (or other number formats), from the document's numbering part."""
    try:
        root = d.part.numbering_part.element
    except Exception:
        return {}
    abstract = {}
    for a in root.findall(qn('w:abstractNum')):
        aid = a.get(qn('w:abstractNumId'))
        for lvl in a.findall(qn('w:lvl')):
            f = lvl.find(qn('w:numFmt'))
            abstract[(aid, int(lvl.get(qn('w:ilvl'))))] = f.get(qn('w:val')) if f is not None else 'bullet'
    out = {}
    for n in root.findall(qn('w:num')):
        aid = n.find(qn('w:abstractNumId')).get(qn('w:val'))
        for (a, lv), fmt in abstract.items():
            if a == aid:
                out[(n.get(qn('w:numId')), lv)] = fmt
    return out


def runs_md(p):
    out = []
    for item in p.iter_inner_content():
        if hasattr(item, 'url'):                    # a hyperlink
            text = ''.join(r.text for r in item.runs) or item.text
            out.append(f'[{text.strip()}]({item.url})' if item.url and text.strip() else text)
            continue
        t = item.text
        if not t:
            continue
        b, i = bool(item.bold), bool(item.italic)
        lead, core, trail = re.match(r'(\s*)(.*?)(\s*)$', t, re.S).groups()
        core = re.sub(r'^\*+|\*+$', '', core)       # asterisks typed into the text itself (they would clash with the bold marks)
        if core:
            core = f'***{core}***' if b and i else f'**{core}**' if b else f'*{core}*' if i else core
        out.append(lead + core + trail)
    s = ''.join(out)
    s = re.sub(r'\*\*(\s*)\*\*', r'\1', s)            # empty bold between runs
    s = re.sub(r'(?<=\*\*)\*\*(?=\S)', '', s) if False else s
    s = re.sub(r'\*\*\s*\*\*', ' ', s)
    s = s.replace('****', '')
    return re.sub(r'[ \t]+', ' ', s).strip()


def convert(path):
    d = docx.Document(path)
    fmts = list_formats(d)
    blocks, counters = [], {}
    prev_list = False
    for el in d.element.body.iterchildren():
        if el.tag == qn('w:tbl'):
            t = Table(el, d)
            rows = []
            for r in t.rows:
                cells, seen = [], set()
                for c in r.cells:
                    if id(c._tc) in seen:
                        continue
                    seen.add(id(c._tc))
                    cells.append(re.sub(r'\s+', ' ', ' '.join(runs_md(p) for p in c.paragraphs)).strip().replace('|', '/'))
                rows.append(cells)
            rows = [r for r in rows if any(r)]
            if rows:
                n = max(len(r) for r in rows)
                rows = [r + [''] * (n - len(r)) for r in rows]
                blocks.append('| ' + ' | '.join(rows[0]) + ' |\n|' + '---|' * n + '\n' + '\n'.join('| ' + ' | '.join(r) + ' |' for r in rows[1:]))
            prev_list = False
            continue
        if el.tag != qn('w:p'):
            continue
        p = Paragraph(el, d)
        text = runs_md(p)
        plain = p.text.strip()
        if not plain:
            prev_list = False
            continue
        style = (p.style.name or '').lower()
        pPr = p._p.pPr
        num = pPr.numPr if pPr is not None and pPr.numPr is not None and pPr.numPr.numId is not None else None
        m = re.match(r'heading (\d)', style)
        if m or style == 'title':
            lvl = 1 if style == 'title' else int(m.group(1))
            blocks.append('#' * min(lvl, 3) + ' ' + re.sub(r'\*', '', text))
            prev_list = False
            continue
        if num is not None and 'heading' not in style:
            nid, lv = str(num.numId.val), int(num.ilvl.val) if num.ilvl is not None else 0
            fmt = fmts.get((nid, lv), 'bullet')
            if fmt in ('bullet', 'none'):
                marker = '-'
            else:
                counters[(nid, lv)] = counters.get((nid, lv), 0) + 1
                for k in [k for k in counters if k[0] == nid and k[1] > lv]:
                    del counters[k]
                marker = f'{counters[(nid, lv)]}.'
            item = '  ' * lv + marker + ' ' + text
            if prev_list:
                blocks[-1] += '\n' + item
            else:
                blocks.append(item)
            prev_list = True
            continue
        prev_list = False
        counters.clear() if False else None
        runs = [r for r in p.runs if r.text.strip()]
        if runs and all(r.bold for r in runs) and len(plain) < 90 and not plain.endswith('.'):
            blocks.append('### ' + re.sub(r'\*', '', text))     # a short all-bold line is a heading
        else:
            blocks.append(text)
    md = '\n\n'.join(blocks)
    return re.sub(r'\n{3,}', '\n\n', md).strip()


if __name__ == '__main__':
    print(convert(sys.argv[1]))
