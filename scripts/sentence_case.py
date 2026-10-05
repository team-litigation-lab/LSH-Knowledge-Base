#!/usr/bin/env python3
"""Sentence case for ALL-CAPS titles and headings: "WRITE A WINNING DEMAND LETTER" becomes "Write a winning demand letter".

  python3 scripts/sentence_case.py            # fixes public/seed/*.json in place (safe to run again)

Only text that is entirely capitals is touched; a title or heading already in mixed case is left as it is. Acronyms and a few
proper nouns keep their capitals (the lists below). The Worker has the same rules in src/util.js (sentenceCase): keep the lists in step."""
import json, os, re, sys

ACRONYMS = set('''SOP SOPS SOL PI VA VAS LSH TAM HIPAA ERISA MRI CT DUI ADR CME PIP UM UIM BI PD EOB HCFA CMS FAQ USA EMG NCV ER ID IME DV HR IP MVA
RFP PDF CPT ICD HMO PPO SSI SSDI CPA IRS DOB SSN PHI POA ASAP ETA OCR EHR EMR ICU DME PT OT PCP OB GYN ENT NP PA MD DC RN LPN EA AI
FL CA TX NY NJ GA'''.split())
PROPER = {'medicare': 'Medicare', 'medicaid': 'Medicaid', 'tricare': 'Tricare', 'florida': 'Florida', 'california': 'California', 'texas': 'Texas',
          'chartswap': 'Chartswap', 'compex': 'Compex', 'filevine': 'Filevine', 'clio': 'Clio', 'american': 'American', 'americans': 'Americans'}
PHRASES = [('united states', 'United States'), ('social security', 'Social Security')]
ROMAN = re.compile(r'^(?:I{1,3}|IV|V|VI{0,3}|IX|X{1,3})[.):]*$')
MARKER = re.compile(r'^(?:\d{1,3}|[A-Z])[.)]$')


def letters(t):
    return [c for c in t if c.isalpha()]


def is_caps(t, min_letters=4):
    """True when the text is entirely (or all but a stray letter or two) capitals."""
    L = letters(re.sub(r'\b[A-Z]{1,3}\b(?=\s*[.)])', '', t))
    return len(L) >= min_letters and sum(c.isupper() for c in L) / len(L) > 0.8


def sentence_case(t):
    t = re.sub(r'\b(I{1,3}|IV|VI{0,3}|IX|X{1,3})\.(?=[A-Za-z])', r'\1. ', t)   # "II.VISITATION" -> "II. VISITATION"
    words = t.split(' ')
    out, first, after_stop = [], True, False
    for w in words:
        if not w:
            out.append(w); continue
        core = re.sub(r'^[^A-Za-z0-9]+|[^A-Za-z0-9]+$', '', w)
        if not core:
            out.append(w); continue
        if not letters(core):          # a number such as 1500 or 2024
            out.append(w); after_stop = False; continue
        if first and (MARKER.match(w) or ROMAN.match(core + (w[-1] if w[-1] in '.):' else '')) and w.endswith(('.', ')'))):
            out.append(w); continue    # numbering at the start: "1." "A." "IV."
        up = core.upper()
        if up in ACRONYMS and len(core) > 1:
            new = up
        elif core.lower() in PROPER:
            new = PROPER[core.lower()]
        elif ROMAN.match(core) and len(core) > 1 and not first:
            new = up
        else:
            new = core.lower()
            if first:
                new = new[0].upper() + new[1:]
        out.append(w.replace(core, new, 1))
        first = False
    s = ' '.join(out)
    for low, proper in PHRASES:
        s = re.sub(r'\b' + low + r'\b', proper, s, flags=re.I)
    return s


def fix_title(t):
    t = t.strip()
    one = t.upper().strip('.:')
    if is_caps(t) and not (len(t.split()) == 1 and one in ACRONYMS):
        return sentence_case(t)
    return t


HEAD = re.compile(r'^(#{1,6})(\s+)(.*?)(\s*)$')
BOLD = re.compile(r'^\*\*\s*([^*]+?)\s*\*\*(:?)\s*$')


def fix_markdown(md):
    """ALL-CAPS headings (and short bold lines used as headings) in a page's Markdown. Long bold sentences in capitals are kept:
    they are emphasis, such as a warning in a contract."""
    out = []
    for ln in md.split('\n'):
        m = HEAD.match(ln)
        if m:
            text = m.group(3)
            if is_caps(re.sub(r'[*_`]', '', text)):
                ln = m.group(1) + m.group(2) + sentence_case(text) + m.group(4)
        else:
            b = BOLD.match(ln.strip())
            if b and len(b.group(1).split()) <= 12 and len(b.group(1)) <= 90 and not b.group(1).lstrip().startswith(('“', '"')) and not b.group(1).rstrip().endswith('.') and is_caps(b.group(1)):
                one = b.group(1).strip().upper().strip('.:')
                if one not in ACRONYMS:
                    ln = '**' + sentence_case(b.group(1).strip()) + '**' + b.group(2)
        out.append(ln)
    return '\n'.join(out)


def main():
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'seed')
    changed = 0
    for name, key in (('docs.json', None), ('tettra.json', 'pages'), ('training.json', 'pages')):
        path = os.path.join(root, name)
        raw = open(path).read()
        data = json.loads(raw)
        compact = raw.count('\n') < 5   # keep each file's own layout, so a re-run only shows the real changes
        arr = data if key is None else data[key]
        for p in arr:
            t, b = fix_title(p['title']), fix_markdown(p['body'])
            if t != p['title'] or b != p['body']:
                changed += 1
            p['title'], p['body'] = t, b
        json.dump(data, open(path, 'w'), ensure_ascii=False, **({'separators': (',', ':')} if compact else {'indent': 1}))
    print(f'{changed} pages changed')


if __name__ == '__main__':
    main()
