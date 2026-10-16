#!/usr/bin/env python3
"""Generate the verified fictitious UX review download; refuses incomplete evidence."""
from pathlib import Path
import json, zipfile, hashlib, csv, io, html, shutil, datetime, sys
repo = Path(__file__).resolve().parents[1]
audit = Path(sys.argv[1] if len(sys.argv) > 1 else repo / 'audit').resolve()
out = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/feng-polish-downloads').resolve()

def read(p):
    return json.loads(p.read_text())
summary = read(audit / 'after/summary.json')
visual = read(audit / 'visual-contact-sheets/review.json')
low = read(audit / 'low-justifications.json')
matrix = read(repo / 'docs/final-polish-verification.json')
ci = read(audit / 'verification/ci.json')
lh = read(audit / 'lighthouse/summary.json')
build = read(audit / 'verification/build.json')
assert summary['gate'] == 'PASS' and summary['complete'] and summary['completeEvidence']
assert summary['screenshots'] == 980 and visual['complete'] and (visual['reviewedStates'] == 980)
assert low['complete'] and (not low['unjustified'])
assert ci['status'] == 'pass'
assert len(lh['scores']) == 6 and all((r['accessibility'] >= 95 and r['bestPractices'] >= 95 and (r['entryScript'] == build['entryScript']) for r in lh['scores']))
assert len(matrix['items']) == 249 and all((r['status'] == 'Fixed' and (not r['verificationPending']) for r in matrix['items']))
out.mkdir(exist_ok=True)
inventory = read(repo / 'scripts/feng-polish-screen-inventory.json')
intro = 'Only fictitious demo and synthetic test data. Unzip the file and open index.html in a browser. Click a screenshot to inspect the original resolution. Measurements include controls and text, in CSS pixels. Physical iPhone, VoiceOver, beta-volunteer and owner sign-off checks remain manual; see FINAL-POLISH-REPORT.md.'

def add(z, path, name):
    z.write(path, name, compress_type=zipfile.ZIP_STORED if path.suffix == '.png' else zipfile.ZIP_DEFLATED)

def page(setup):
    rows = []
    for state in inventory['states']:
        sid = state['id']
        s = read(audit / 'after' / setup / (sid + '.json'))
        els = s['audit']['elements']
        pairs = []
        for phase in ['before', 'after']:
            pairs.append('<div><h3>' + phase.title() + '</h3><a href="' + phase + '/' + setup + '/' + sid + '-full.png">Full page</a> · <a href="' + phase + '/' + setup + '/' + sid + '.json">Raw measurements</a><br><a href="' + phase + '/' + setup + '/' + sid + '.png"><img loading="lazy" src="' + phase + '/' + setup + '/' + sid + '.png" alt="' + html.escape(phase + ' ' + state['title']) + '"></a></div>')
        j = next((r for r in read(repo / 'docs/final-polish-journey.json')['states'] if r['id'] == sid))
        explanation = ''.join(('<p><strong>' + label + ': </strong>' + html.escape(j[key]) + '</p>' for key, label in [('entry', 'Entry'), ('action', 'Interaction'), ('result', 'Result')]))
        rows.append('<article id="' + sid + '"><h2>' + html.escape(state['title']) + '</h2>' + explanation + '<p><code>' + sid + '</code> · ' + str(len(els)) + ' measured elements · ' + str(len(s['audit']['issues'])) + ' recorded layout findings. <a href="measurements/' + sid + '.csv">Element dimensions CSV</a></p><div class="pair">' + ''.join(pairs) + '</div></article>')
    return '<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Feng Finance 2.2.7 · ' + setup + '</title><style>body{font:16px/1.5 system-ui;background:#eef2f8;color:#172034;margin:0 auto;padding:24px;max-width:1500px}h1,h2,h3{line-height:1.3}a{color:#143d8c}article{background:white;border:1px solid #aab5c6;border-radius:12px;padding:20px;margin:24px 0}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}img{max-width:100%;height:auto;display:block;margin-top:16px;border:1px solid #aab5c6}p{max-width:80ch}@media(max-width:700px){.pair{grid-template-columns:1fr}body{padding:16px}}</style><h1>Feng Finance 2.2.7 · ' + setup + '</h1><p>' + intro + '</p><p><a href="FINAL-POLISH-REPORT.md">Complete review and release gates</a> · <a href="final-polish-verification.json">249-item verification matrix</a></p>' + ''.join(rows) + '</html>'
for setup in [s['id'] for s in inventory['setups']]:
    path = out / ('Feng-Finance-2.2.7-' + setup + '.zip')
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr('index.html', page(setup))
        z.writestr('README.txt', intro + '\n')
        add(z, repo / 'FINAL-POLISH-REPORT.md', 'FINAL-POLISH-REPORT.md')
        add(z, repo / 'docs/final-polish-verification.json', 'final-polish-verification.json')
        add(z, audit / 'verification/build.json', 'verification/build.json')
        add(z, audit / 'verification/ci.json', 'verification/ci.json')
        for phase in ['before', 'after']:
            for f in sorted((audit / phase / setup).iterdir()):
                assert f.suffix in {'.png', '.json'}, f
                add(z, f, phase + '/' + setup + '/' + f.name)
        for state in inventory['states']:
            d = read(audit / 'after' / setup / (state['id'] + '.json'))
            fields = list(dict.fromkeys((k for e in d['audit']['elements'] for k in e)))
            b = io.StringIO()
            w = csv.DictWriter(b, fieldnames=fields)
            w.writeheader()
            w.writerows(d['audit']['elements'])
            z.writestr('measurements/' + state['id'] + '.csv', b.getvalue())
    print(json.dumps({'file': path.name, 'bytes': path.stat().st_size}), flush=True)
full = out / 'Feng-Finance-2.2.7-Complete-UX-Audit.zip'
with zipfile.ZipFile(full, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    z.writestr('README.txt', intro + '\nOpen audit/report.html for the complete seven-setup comparison. The visual-discovery folder contains earlier inspected contact sheets used only when final image pairs have identical hashes. Use audit/after for the final candidate.\n')
    for folder in ['before', 'after', 'lighthouse', 'verification', 'visual-contact-sheets', 'visual-changed-sheets', 'visual-discovery']:
        for f in sorted((audit / folder).rglob('*')):
            if f.is_file():
                add(z, f, 'audit/' + str(f.relative_to(audit)))
    for name in ['report.html', 'low-justifications.json']:
        add(z, audit / name, 'audit/' + name)
    add(z, repo / 'FINAL-POLISH-REPORT.md', 'FINAL-POLISH-REPORT.md')
    for name in ['final-polish-verification.json', 'final-polish-audit-method.md', 'iphone-checklist.md', 'final-polish-journey.json', 'beta-test-plan.md']:
        p = repo / 'docs' / name
        if p.exists():
            add(z, p, 'docs/' + name)
    for p in sorted((repo / 'scripts').glob('feng-*')):
        if p.is_file():
            add(z, p, 'scripts/' + p.name)
    add(z, repo / 'scripts/verify-polish-visual.py', 'scripts/verify-polish-visual.py')
    add(z, repo / 'README.md', 'README.md')
    add(z, repo / 'package.json', 'package.json')
    add(z, repo / 'package-lock.json', 'package-lock.json')
print(json.dumps({'file': full.name, 'bytes': full.stat().st_size}), flush=True)
files = []
for p in sorted((p for p in out.iterdir() if p.suffix in {'.zip', '.html'})):
    assert p.stat().st_size < 2000000000
    if p.suffix == '.zip':
        with zipfile.ZipFile(p) as z:
            assert z.testzip() is None
    files.append({'name': p.name, 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
(out / 'download-manifest.json').write_text(json.dumps({'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'fictitiousOnly': True, 'build': build, 'files': files}, indent=2) + '\n')
print('Verified ' + str(len(files)) + ' archives.')
