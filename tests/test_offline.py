"""Offline reality check: SW precache -> airplane mode -> full quiz loop."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('offline')


def run():
    pw = common.launch()
    browser = pw.chromium.launch(headless=True,
                                 executable_path=common.EXE)
    ctx = browser.new_context(viewport=common.VP, is_mobile=True,
                              has_touch=True)  # service workers ALLOWED
    ctx.add_init_script(
        "try { localStorage.setItem('portal_tour_done', '1');"
        " localStorage.setItem('portal_quiz_hint', '1'); } catch (e) {}")
    ctx.add_init_script(common.telegram_script({'id': 424242, 'first_name': 'طيار'}))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e).split('\n')[0]))
    try:
        page.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(4000)
        # wait until the service worker controls the page
        try:
            page.wait_for_function(
                '() => !!navigator.serviceWorker.controller', timeout=20000)
            sw = True
        except Exception:
            sw = False
        check('service worker takes control', sw)
        page.wait_for_function(
            '() => window.__portal && window.__portal.S && window.__portal.S.index'
            ' && window.__portal.S.banks && Object.keys(window.__portal.S.banks).length > 0',
            timeout=25000)
        check('banks loaded while online', True)

        # save a question + finish half a quiz while online (seeds local data)
        subs = common.subjects(page)
        sid, qid = subs[0]['id'], subs[0]['chapters'][0]
        page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
        page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
        page.wait_for_timeout(500)
        page.evaluate('() => document.querySelector("#btn-save-question").click()')
        page.wait_for_timeout(300)
        check('a question is saved locally',
              page.evaluate('() => Object.keys(JSON.parse(localStorage.getItem("portal_saved_v1") || "{}")).length') == 1)

        # ---------- airplane mode ----------
        ctx.set_offline(True)
        page.goto(common.APP, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(2500)
        check('catalog renders with no network',
              page.locator('#catalog-cards-container .sketch-row').count() >= 1)
        check('subject chips render offline',
              page.locator('#subject-filter-bar .filter-chip').count() >= 2)

        # full quiz loop offline
        page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
        page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
        page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
        page.wait_for_timeout(500)
        total = int((page.locator('#question-total-label').text_content() or '0').strip())
        for _ in range(total):
            if 'hidden' not in (page.locator('#results-view').get_attribute('class') or ''):
                break
            is_open = page.evaluate("""() => {
              const s = window.__portal.S.session;
              return s.picks[s.idx] === null;
            }""")
            if is_open:
                common.tap(page, page.locator('.option-tile').first)
                page.wait_for_timeout(120)
            page.click('#btn-next')
            page.wait_for_timeout(150)
        check('a quiz starts, runs and finishes offline',
              'hidden' not in (page.locator('#results-view').get_attribute('class') or ''))
        check('history is journalled on the device offline',
              page.evaluate('() => JSON.parse(localStorage.getItem("portal_history_v1") || "[]").length') >= 1)

        # saved view works offline from the device store
        page.evaluate("() => { location.hash = '#/saved'; }")
        page.wait_for_timeout(800)
        check('saved questions open offline',
              'hidden' not in (page.locator('#saved-view').get_attribute('class') or ''))

        # league degrades to an explicit offline note, not a spinner
        page.evaluate("() => { location.hash = '#/league'; }")
        try:
            page.wait_for_function("""() => {
              const e = document.querySelector('#league-empty-state');
              const o = document.querySelector('#league-offline-note');
              return (e && !e.classList.contains('hidden'))
                || (o && !o.classList.contains('hidden'));
            }""", timeout=20000)
        except Exception:
            pass
        page.wait_for_timeout(400)
        league_text = page.locator('#league-view').inner_text() or ''
        check('league explains itself instead of hanging',
              ('إنترنت' in league_text) or ('تعذر' in league_text),
              (league_text[:90] or '').replace('\n', ' | '))

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
