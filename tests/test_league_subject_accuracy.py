"""A subject view must not print a ratio built from subject points and total answers."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('league subject accuracy')

ROWS = [
    {'hidden': False, 'user_id': 'u:a', 'name': 'طالب أ', 'xp': 360, 'answered': 900,
     'updated_at': '2026-11-13T10:00:00.000Z',
     'per_subject': {'01_Cyber_Security': {'title': 'الأمن السيبراني', 'xp': 360, 'n': 4}}},
    {'hidden': False, 'user_id': 'u:b', 'name': 'طالب ب', 'xp': 100, 'answered': 200,
     'updated_at': '2026-11-13T11:00:00.000Z',
     'per_subject': {'01_Cyber_Security': {'title': 'الأمن السيبراني', 'xp': 40, 'n': 1}}},
]


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True)
    try:
        common.install_mock(page, ROWS)
        page.evaluate("() => { location.hash = '#/league'; }")
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          return box && box.childElementCount > 0;
        }""", timeout=15000)
        page.wait_for_timeout(300)

        # The subject chip only re-scopes client-side; no request is made.
        page.evaluate("""() => {
          window.__portal.S.leagueSubject = '01_Cyber_Security';
        }""")
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(200)
        page.evaluate("() => { location.hash = '#/league'; }")
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          return box && box.childElementCount > 0;
        }""", timeout=15000)
        page.wait_for_timeout(500)

        row = page.locator('#league-board .league-row').first
        row.click()
        page.wait_for_function("!document.getElementById('player-drawer').classList.contains('hidden')",
                               timeout=10000)
        card = page.locator('#player-card').inner_text()
        check('subject view does not print a misleading accuracy', '%' not in card, card[:200])
        check('subject view still shows the points', '360' in card, card[:120])
        check('subject view keeps the rank', 'المركز' in card, card[:120])
        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    failed = [r for r in common.RESULTS if not r[2]]
    print('%d checks, %d failed' % (len(common.RESULTS), len(failed)), flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(run())
