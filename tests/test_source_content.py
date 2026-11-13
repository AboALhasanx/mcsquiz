"""Local integration check of actual vault source banks, without publishing.

Usage: python tests/test_source_content.py --vault C:\\Users\\gokoq\\Master-Studio
Intercepts the manifest/bank reads only in the test browser. data/ stays untouched.
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import common
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import portal_schema as schema


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
        source[bank['quiz_id']]=bank
    ids=[q['source']['id'] for b in source.values() for q in b['questions']]
    common.check('every reviewed source question occurs exactly once', len(ids)==len(set(ids)) and set(ids)==set(snapshot['items']), len(ids))
    root=Path(__file__).resolve().parents[1]
    previous=json.loads((root/'data/index.json').read_text(encoding='utf-8'))
    subject=next(s for s in previous['subjects'] if s['subject_id']==sid)
    manifest={'version':previous['version'], 'subjects':[subject]}
    subject['chapters']=list(subject['chapters'])
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
        common.check('actual source payloads load alongside existing practice',page.locator('[data-bank-kind="source"]').count()==1)
        for qid,bank in source.items():
            page.evaluate("""(id) => {
              const b=window.__portal.S.banks[id];
              if (window.__portal.S.session) clearInterval(window.__portal.S.session.timerId);
              window.__portal.startReviewPractice(b.questions, 'تدقيق المصدر', 'custom');
            }""",qid)
            actual=page.evaluate("""() => window.__portal.S.session.questions.map(q=>({
              id:q.source.id, en:q.stem.en, options:q.options.map(o=>o.en), answer:q.answer
            }))""")
            expected=[{'id':q['source']['id'],'en':q['stem']['en'],'options':[o['en'] for o in q['options']],'answer':q['answer']} for q in bank['questions']]
            common.check(f'{qid}: all original questions/options/keys survive launch',actual==expected)
            page.locator('#btn-start-quiz').click()
            common.check(f'{qid}: original English appears on screen',page.locator('#question-text').inner_text()==bank['questions'][0]['stem']['en'])
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
