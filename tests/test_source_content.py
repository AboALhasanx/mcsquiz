"""Local integration check of actual vault source banks, without publishing.

Usage: python tests/test_source_content.py --vault C:\\Users\\gokoq\\Master-Studio
Intercepts the manifest/bank reads only in the test browser. data/ stays untouched.
"""
import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import common
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import portal_schema as schema

PROVENANCE_RE = re.compile(
    r'(?i)(publisher|textbook|official (?:key|answer|textbook)|answer key|'
    r'keyed answer|printed key|printed book|companion slides?|slide deck|'
    r'the deck|\bslides?\b|\bpages?\s*\d+|\bp\.\s*\d+|\bT1\b|'
    r'Aggarwal\s*[§&]|Bieman\s*&\s*Kang|IEEE standard terminology|'
    r'الناشر|الكتاب|مفتاح الناشر|مفتاح الكتاب|المفتاح الرسمي|'
    r'السلايدات?|الشريحة|الشرائح|مذكرة|مذكرات|ص\.?\s*\d+)'
)


def run(vault):
    common.suite('source_content')
    sid='04_Advanced_Software_Eng'
    quiz_dir=vault/'01_Semester_1'/sid/'07_Quizzes_&_Anki'
    snapshot=json.loads((quiz_dir/'source_manifests/ASE_Source_MCQs.json').read_text(encoding='utf-8'))
    source={}
    for path in sorted(quiz_dir.glob('Quiz_Ch*_S*_Source_MCQs.json')):
        raw=json.loads(path.read_text(encoding='utf-8'))
        bank=schema.to_v3(raw)
        errs=schema.validate_v3(bank)
        common.check(f'{path.name} validates as v3', not errs, errs[:2])
        if errs:
            continue
        for question in bank['questions']:
            explanation = question.get('explanation')
            texts = list(explanation.values()) if isinstance(explanation, dict) else [explanation]
            common.check(
                f"{path.name}:{question['id']} explanation has no provenance",
                all(isinstance(text, str) and not PROVENANCE_RE.search(text) for text in texts),
                [text for text in texts if not isinstance(text, str) or PROVENANCE_RE.search(text)],
            )
        source[bank['quiz_id']]=bank
    ids=[q['source']['id'] for b in source.values() for q in b['questions']]
    common.check('every reviewed source question occurs exactly once', len(ids)==len(set(ids)) and set(ids)==set(snapshot['items']), len(ids))
    root=Path(__file__).resolve().parents[1]
    previous=json.loads((root/'data/index.json').read_text(encoding='utf-8'))
    subject=next(s for s in previous['subjects'] if s['subject_id']==sid)
    manifest={'version':previous['version'], 'subjects':[subject]}
    subject['chapters']=[c for c in subject['chapters'] if c.get('quiz_id') not in source]
    for qid,bank in source.items():
        subject['chapters'].append({'chapter_no':int(qid.split('_')[1][2:]),'quiz_id':qid,
            'bank':f'banks/{qid}.json','count':len(bank['questions']),'version':1})
    expected_banks=len(subject['chapters'])
    pw=common.launch()
    browser=pw.chromium.launch(**({'executable_path':common.EXE} if os.path.exists(common.EXE) else {}))
    errors=[]
    try:
        ctx=browser.new_context(viewport={'width':402,'height':874},service_workers='block')
        ctx.add_init_script("localStorage.setItem('portal_tour_done','1');localStorage.setItem('portal_quiz_hint','1');")
        ctx.route('**/rest/v1/rpc/**',lambda r:r.abort())
        ctx.route('**/data/index.json*',lambda r:r.fulfill(json=manifest))
        def source_route(payload):
            def handle(route):
                route.fulfill(json=payload)
            return handle
        for qid,bank in source.items():
            ctx.route(f'**/data/banks/{qid}.json*',source_route(bank))
        page=ctx.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(common.APP,wait_until='domcontentloaded')
        page.wait_for_function('(n) => window.__portal && Object.keys(window.__portal.S.banks).length===n',arg=expected_banks,timeout=45000)
        page.locator('#subject-filter-bar [data-subject="04_Advanced_Software_Eng"]').click()
        first_chapter = min(int(qid.split('_')[1][2:]) for qid in source)
        page.get_by_role('button', name=f'جابتر {first_chapter}', exact=True).click()
        visible_ids = page.locator('#catalog-cards-container .sketch-content-cell').evaluate_all(
            "(els) => els.map(a => decodeURIComponent(a.getAttribute('href').split('/').pop()))")
        expected_visible = [ch['quiz_id'] for ch in subject['chapters'] if ch['chapter_no'] == first_chapter]
        common.check('source banks appear in the normal chapter list beside other banks',
                     set(visible_ids) == set(expected_visible) and
                     any(qid in visible_ids for qid in source if int(qid.split('_')[1][2:]) == first_chapter))
        common.check('catalog has no source/practice filter',
                     page.locator('#bank-kind-filter-bar, [data-bank-kind]').count() == 0)
        for qid,bank in source.items():
            page.evaluate("""(id) => {
              const b=window.__portal.S.banks[id];
              if (window.__portal.S.session) clearInterval(window.__portal.S.session.timerId);
              window.__portal.startReviewPractice(b.questions, 'فحص البنك', 'custom');
            }""",qid)
            actual=page.evaluate("""() => window.__portal.S.session.questions.map(q=>({
              id:q.source.id, en:q.stem.en, options:q.options.map(o=>o.en), answer:q.answer
            }))""")
            expected=[{'id':q['source']['id'],'en':q['stem']['en'],'options':[o['en'] for o in q['options']],'answer':q['answer']} for q in bank['questions']]
            common.check(f'{qid}: all original questions/options/keys survive launch',actual==expected)
            common.check(f'{qid}: question uses the selected Arabic language',
                         page.evaluate('window.__portal.S.lang') == 'ar')
            page.locator('#btn-start-quiz').click()
            common.check(f'{qid}: question appears in Arabic without provenance',
                         page.locator('#question-text').inner_text()==bank['questions'][0]['stem']['ar'] and
                         page.locator('#question-source').count()==0 and
                         bank['questions'][0]['source']['reference'] not in page.locator('#question-card').inner_text())
            common.check(f'{qid}: source note is not inserted into the question card',
                         not any(note in page.locator('#question-card').inner_text()
                                 for note in bank['questions'][0]['source'].get('note', {}).values()))
        longest=max((q for b in source.values() for q in b['questions']),key=lambda q:len(q['stem']['en'])+sum(len(o['en']) for o in q['options']))
        page.evaluate("""(q) => window.__portal.startReviewPractice([q], 'تدقيق العرض', 'custom')""",longest)
        page.locator('#btn-start-quiz').click()
        artifacts=Path(tempfile.gettempdir())/'opencode'
        artifacts.mkdir(exist_ok=True)
        for width,theme in [(402,'dark'),(533,'light')]:
            page.set_viewport_size({'width':width,'height':874})
            page.evaluate('(t)=>document.documentElement.setAttribute("data-theme",t)',theme)
            page.evaluate('document.fonts.ready')
            page.screenshot(path=str(artifacts/f'ase-source-real-{theme}{width}.png'),full_page=True)
            common.check(f'long original fits horizontally at {width} {theme}',page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        common.check('no actual-content runtime errors',not errors,errors[:2])
    finally:
        browser.close()
        pw.stop()
    return common.report()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vault',type=Path,required=True)
    sys.exit(run(parser.parse_args().vault))
