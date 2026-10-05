#!/usr/bin/env python3
"""Adds (or updates) a written lesson in public/seed/docs.json, which Admin → Import documents publishes as a page.

  python3 scripts/add_lesson.py scripts/lessons/<file>.md --title "Title" --summary "…" --collection insurance --tags "a,b"

The Markdown file is the page's text (headings, lists, tables). Running it again with the same file name updates the page."""
import argparse, datetime, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'public', 'seed', 'docs.json')
ap = argparse.ArgumentParser()
ap.add_argument('file'); ap.add_argument('--title', required=True); ap.add_argument('--summary', default='')
ap.add_argument('--collection', default='general'); ap.add_argument('--section', default=''); ap.add_argument('--type', default='Guide'); ap.add_argument('--tags', default='')
a = ap.parse_args()
name = 'lesson-' + os.path.splitext(os.path.basename(a.file))[0]
docs = json.load(open(MANIFEST))
entry = {'file': name, 'title': a.title, 'summary': a.summary, 'collection': a.collection, 'section': a.section, 'type': a.type,
         'tags': [t.strip() for t in a.tags.split(',') if t.strip()], 'added': datetime.date.today().isoformat(),
         'body': open(a.file).read().strip()}
docs = [d for d in docs if d['file'] != name] + [entry]
json.dump(docs, open(MANIFEST, 'w'), indent=1, ensure_ascii=False)
print(f'{entry["title"]}: {len(entry["body"].split())} words ({len(docs)} documents)')
