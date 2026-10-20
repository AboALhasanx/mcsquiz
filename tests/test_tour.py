"""Guided tour: full walk-through, cross-view navigation, once per device."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('tour')


def run():
    pw = common.launch()
    # a fresh profile: the tour must appear on its own
    browser, page, errors = common.new_page(
        pw, tour_done=False, telegram={'id': 3, 'first_name': 'طالب'})
    try:
        page.wait_for_selector('#tour-overlay:not(.hidden)', timeout=25000)
        check('tour greets a first-time visitor',
              'hidden' not in (page.locator('#tour-overlay').get_attribute('class') or ''))
        check('the tour remembers it started',
              page.evaluate("() => localStorage.getItem('portal_tour_done')") == '1')

        seen, routes, skipped_start = [], set(), False
        for _ in range(30):
            state = page.evaluate("""() => {
              const tip = document.querySelector('#tour-tip');
              const r = tip.getBoundingClientRect();
              if (r.width < 5 || r.height < 5) return null;
              return {
                title: document.querySelector('#tour-tip-title').textContent,
                next: document.querySelector('#tour-btn-next').textContent,
                hash: location.hash,
                quizVisible: !document.querySelector('#quiz-view').classList.contains('hidden'),
              };
            }""")
            if not state:
                break
            seen.append(state['title'])
            routes.add(state['hash'])
            if state['title'].startswith('البداية') and not skipped_start:
                page.click('#tour-btn-next')          # skip the action…
                page.wait_for_timeout(1400)
                still = page.evaluate(
                    "() => !document.querySelector('#quiz-view').classList.contains('hidden')")
                check('skipping the start step still starts the quiz', still)
                skipped_start = True
                continue
            if state['next'] == 'إنهاء':
                page.click('#tour-btn-next')
                page.wait_for_timeout(600)
                break
            page.click('#tour-btn-next')
            page.wait_for_timeout(1100)

        check('the tour has more than ten steps', len(seen) >= 10, len(seen))
        check('the tour visits the quiz, saved, stats and league',
              any('#/saved' in r for r in routes) and any('#/stats' in r for r in routes)
              and any('#/league' in r for r in routes), routes)
        check('the tour ends by closing itself',
              'hidden' in (page.locator('#tour-overlay').get_attribute('class') or ''))

        # replay from the menu, without re-triggering it on a reload
        # (the context fixture wipes the flag on every navigation, so pin it
        # again with a second init script — on a real device nothing wipes it)
        page.context.add_init_script(
            "try { localStorage.setItem('portal_tour_done', '1'); } catch (e) {}")
        page.goto(common.APP, wait_until='domcontentloaded')
        page.wait_for_timeout(1500)
        check('the tour stays dismissed after a reload',
              'hidden' in (page.locator('#tour-overlay').get_attribute('class') or ''))
        page.locator('.btn-menu').first.click()
        page.wait_for_timeout(500)
        page.click('#menu-tour')
        page.wait_for_timeout(700)
        check('the menu replays the tour',
              'hidden' not in (page.locator('#tour-overlay').get_attribute('class') or ''))

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
