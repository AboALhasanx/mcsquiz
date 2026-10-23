"""Public player card: a league row opens what that classmate is good at (this week)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('player card')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(
        pw, tour_done=True,
        telegram={'id': 7777, 'first_name': 'أنا', 'username': 'me'})
    try:
        rows = common.board(player=6, me_id='tg:7777')
        # a real row carries a handle and a subject breakdown; neither may leak
        rows[0]['username'] = 'secret_handle'
        rows[0]['per_subject'] = {
            '01_Cyber_Security': {'n': 30, 'xp': 30, 'title': 'الأمن السيبراني'},
            '03_Data_Mining': {'n': 12, 'xp': 12, 'title': 'تنقيب البيانات'},
            '06_Artificial_Intelligence': {'n': 4, 'xp': 4, 'title': 'الذكاء الاصطناعي'},
            '05_Soft_Computing': {'n': 1, 'xp': 1, 'title': 'الحوسبة اللينة'},
        }
        common.install_mock(page, rows)
        page.evaluate('() => { location.hash = "#/league"; }')
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          return box && box.childElementCount > 0;
        }""", timeout=15000)
        page.wait_for_timeout(500)

        check('the leader is a podium slot you can open',
              page.locator('.podium-slot.p1.is-clickable').count() == 1)
        check('the table rows are openable too',
              page.locator('.league-row.is-clickable').count() == 3,
              page.locator('.league-row.is-clickable').count())

        # open the first table row (rank 4)
        page.locator('.league-row').first.click()
        page.wait_for_selector('#player-drawer.open', timeout=8000)
        page.wait_for_timeout(300)
        card = page.locator('#player-card').inner_text()
        name = page.locator('.league-row').first.locator('.league-row-name').inner_text().strip()
        check('the card names the player', name in card, card[:80])
        check('the card shows the rank', 'المركز' in card, card[:80])
        check('the card shows answers and accuracy', 'إجابة' in card and 'الدقة' in card, card[:120])
        check('the card never prints the handle', 'secret_handle' not in card and '@' not in card, card)
        check('the card says it is this week only', 'هذا الأسبوع' in card, card[-80:])

        # close it
        page.click('#player-close')
        page.wait_for_timeout(400)
        check('the sheet closes', not page.evaluate(
            "() => document.getElementById('player-drawer').classList.contains('open')"))

        # the podium leader carries the subject breakdown (top three, sorted)
        page.locator('.podium-slot.p1').click()
        page.wait_for_selector('#player-drawer.open', timeout=8000)
        page.wait_for_timeout(300)
        subs = page.locator('.player-subject').count()
        check('the subject breakdown is capped at three', subs <= 3, subs)
        first_sub = page.locator('.player-subject').first.inner_text()
        check('the busiest subject comes first', 'الأمن السيبراني' in first_sub, first_sub)
        page.click('#player-close')
        page.wait_for_timeout(300)

        # keyboard: Enter on a focused row opens the same sheet
        page.locator('.league-row').first.focus()
        page.keyboard.press('Enter')
        page.wait_for_timeout(500)
        check('Enter opens the card from the keyboard',
              page.evaluate("() => document.getElementById('player-drawer').classList.contains('open')"))
    finally:
        browser.close()

    print('errors:', errors[:2], flush=True)
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
