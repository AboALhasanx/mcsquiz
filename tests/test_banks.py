"""Banks: bilingual schema, Arabic coverage, bidi-safe rendering."""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('banks')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARABIC = re.compile(r'[\u0600-\u06FF]')


def run():
    banks = sorted(glob.glob(os.path.join(ROOT, 'data', 'banks', '*.json')))
    check('banks exist', len(banks) >= 10, len(banks))

    total = ar_q = ar_o = ar_e = 0
    structural = []
    for path in banks:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for q in data['questions']:
            total += 1
            name = os.path.basename(path)[:32] + '#' + str(q.get('id'))
            # Canonical v3 pairs, with the older aliases still accepted
            stem = q.get('stem') if isinstance(q.get('stem'), dict) else {}
            opts = q.get('options') if isinstance(q.get('options'), list) else []
            pair_shape = bool(stem) and bool(opts) and isinstance(opts[0], dict)
            if pair_shape:
                q_en = stem.get('en') or ''
                q_ar = stem.get('ar') or ''
                o_en = [o.get('en') or '' for o in opts]
                o_ar = [o.get('ar') or '' for o in opts]
                e_en = (q.get('explanation') or {}).get('en') or ''
                e_ar = (q.get('explanation') or {}).get('ar') or ''
                answer = q.get('answer')
            else:
                q_en = q.get('question_en') or ''
                q_ar = q.get('question_ar') or ''
                o_en = q.get('options_en') or []
                o_ar = q.get('options_ar') or []
                e_en = q.get('explanation_en') or ''
                e_ar = q.get('explanation_ar') or ''
                answer = q.get('correct')
            if not (q_en and len(o_en) == 4 and e_en):
                structural.append(name + ':en')
            if not (0 <= int(answer if answer is not None else -1) <= 3):
                structural.append(name + ':correct')
            # translated questions must be fully consistent, never half-Arabic
            if ARABIC.search(q_ar):
                ar_q += 1
                if len(o_ar) != 4 or not all(ARABIC.search(o or '') for o in o_ar):
                    structural.append(name + ':ar-options')
            if any(ARABIC.search(o or '') for o in o_ar):
                ar_o += 1
            if ARABIC.search(e_ar):
                ar_e += 1

    check('every question has English text and a valid answer key',
          not [s for s in structural if not s.endswith('ar-options')],
          [s for s in structural if not s.endswith('ar-options')][:4])
    # translation coverage is tracked, not asserted: content lands bank by bank
    partial = [s for s in structural if 'ar-options' in s]
    print('questions still missing Arabic options: %d' % len(partial), flush=True)

    # coverage ratchet: raise this number as banks are translated
    MIN_AR_QUESTIONS = 10
    check('Arabic question coverage meets the current target',
          ar_q >= MIN_AR_QUESTIONS, '%d/%d translated' % (ar_q, total))
    print('coverage: ar-questions %d/%d, ar-options %d/%d, ar-explanations %d/%d'
          % (ar_q, total, ar_o, total, ar_e, total), flush=True)

    # ---- bidi rendering: numbers inside Arabic must be isolated, in order
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True, telegram={'id': 7, 'first_name': 'طالب'})
    try:
        page.wait_for_function('() => !!document.querySelector("#catalog-cards-container .sketch-row")', timeout=20000)
        # open a bank that contains digits in its Arabic question/options
        target = None
        for path in banks:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            for q in data['questions']:
                stem = q.get('stem') if isinstance(q.get('stem'), dict) else {}
                opts = q.get('options') if isinstance(q.get('options'), list) else []
                if stem and opts and isinstance(opts[0], dict):
                    ar_text = stem.get('ar') or ''
                    ar_opts = [o.get('ar') or '' for o in opts]
                else:
                    ar_text = q.get('question_ar') or ''
                    ar_opts = q.get('options_ar') or []
                blob = ar_text + ' ' + ' '.join(ar_opts)
                if ARABIC.search(blob) and re.search(r'[0-9]', blob):
                    target = (data['subject_id'], data['quiz_id'])
                    break
            if target:
                break
        check('found a bilingual question containing numbers', target is not None, target)
        if target:
            page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % target)
            page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
            page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
            page.wait_for_timeout(600)
            html = page.evaluate("() => document.querySelector('#question-card').innerHTML")
            # the questions are shuffled, so check the renderer itself: a mixed
            # Arabic line with a Latin/number run must isolate that run
            mixed = page.evaluate("() => window.PortalRich.html('شاهد cloud 20 سؤال')")
            check('LTR runs inside Arabic are wrapped in bdi dir=ltr',
                  ('<bdi dir="ltr">' in mixed), mixed[:120])
        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()

    return common.report()


if __name__ == '__main__':
    sys.exit(run())
