#!/usr/bin/env python3
"""Adds (or updates) a Word document as a page in public/seed/docs.json, which Admin → Import documents publishes.

  python3 scripts/add_docx.py file.docx --title "Title" --collection litigation --type SOP --tags "a,b" [--key short-name]

Converts with docx_to_md.py, checks that no words were lost, and writes the summary from the first real paragraph."""
import argparse, collections, datetime, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import docx, docx_to_md
from sentence_case import fix_title, fix_markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'public', 'seed', 'docs.json')
tok = lambda t: collections.Counter(re.findall(r'[a-z0-9]+', t.lower()))


# Fixes applied to every page: typos in the source, and details that should not sit in a shared library.
FIXES = [
    (r'### depInitiation', '### Initiation'),                            # "dep" typed in front of the title
    (r'Saved Credit Cards/MC\**\s*\**4031', "Saved Credit Cards/(the firm's saved card)"),   # a card's last four digits
    # The firm the procedures came from is not named: its name and its e-mail domain are taken out.
    (r'\[([A-Za-z0-9._-]+)@skylawmiami\.com\.?\]\(mailto:[^)]*\)', r'\1@[firm domain]'),
    (r'([A-Za-z0-9._-]+)@skylawmiami\.com', r'\1@[firm domain]'),
    (r'(?i)https?://(www\.)?skylawmiami\.com\S*|skylawmiami\.com', '[firm website]'),
    (r'### Sky Law Firm,? P\.A\.? [–-] ', '### '),
    (r'### Sky Law Firm ', '### '),
    (r'Sky Law Firm, P\.A\.', 'the firm'),
    (r'Sky Law Firm[’\']s', 'the firm’s'),
    (r'(?<=with |from )Sky Law Firm', '[firm name]'),
    (r'Sky Law Firm', 'the firm'),
]


def add(path, title, collection='general', typ='Guide', tags='', key=None):
    d = docx.Document(path)
    md = docx_to_md.convert(path)
    # a numbered or bold first line that Word turned into a list item is the document's title
    md = re.sub(r'^\d+\. \*\*(.+?)\*\*', r'### \1', md, count=1)
    for pat, rep in FIXES:
        md = re.sub(pat, rep, md)
    src = ' '.join(p.text for p in d.paragraphs) + ' ' + ' '.join(c.text for t in d.tables for r in t.rows for c in r.cells)
    miss = sum((tok(src) - tok(re.sub(r'\]\([^)]*\)', ' ', md))).values())
    summary = ''
    for blk in re.split(r'\n\s*\n', md):
        b = blk.strip()
        if b and not b.startswith(('#', '|', '-', ' ')) and len(b) >= 60:
            summary = re.sub(r'[*_]+', '', re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', b)); break
    summary = summary[:217] + '…' if len(summary) > 220 else summary
    name = key or re.sub(r'[^a-z0-9]+', '-', os.path.splitext(os.path.basename(path))[0].lower()).strip('-')[:60]
    docs = json.load(open(MANIFEST))
    docs = [x for x in docs if x['file'] != name] + [{'file': name, 'title': fix_title(title), 'summary': summary, 'collection': collection, 'type': typ,
            'tags': [t.strip() for t in tags.split(',') if t.strip()], 'added': datetime.date.today().isoformat(), 'body': fix_markdown(md)}]
    json.dump(docs, open(MANIFEST, 'w'), indent=1, ensure_ascii=False)
    print(f'{title}: {len(md.split())} words, {miss} words not found in the page, {len(docs)} documents')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('file'); ap.add_argument('--title', required=True); ap.add_argument('--collection', default='general')
    ap.add_argument('--type', default='Guide'); ap.add_argument('--tags', default=''); ap.add_argument('--key')
    a = ap.parse_args()
    add(a.file, a.title, a.collection, a.type, a.tags, a.key)
