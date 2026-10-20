"""League: board, podium, visibility switch, per-subject scope, defaults."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('league')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(
        pw, tour_done=True,
        telegram={'id': 7777, 'first_name': 'ليلى', 'username': 'layla'})
    try:
        # the fake client goes in before the first navigation: a slow real
        # request must never win a race against it
        common.install_mock(page, common.board(player=6, me_id='tg:7777'))
        page.evaluate('() => { location.hash = "#/league"; }')
        page.wait_for_timeout(1500)

        # ---- a full board: podium for the top three, table for the rest
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          const empty = document.querySelector('#league-empty-state');
          return (box && box.childElementCount > 0)
            || (empty && !empty.classList.contains('hidden'));
        }""", timeout=15000)
        page.wait_for_timeout(400)
        check('podium shows three slots', page.locator('.podium-slot').count() == 3,
              page.locator('.podium-slot').count())
        check('the leader wears the crown', page.locator('.podium-slot.p1 .podium-crown').count() == 1)
        check('ranks four and below are a table', page.locator('.league-row').count() == 3,
              page.locator('.league-row').count())
        check('the table starts at rank 4',
              (page.locator('.league-row').first.locator('.league-rank').text_content() or '').strip() == '4')
        check('accuracy is shown for the general board',
              page.locator('.league-row-acc').count() > 0)

        # ---- my card: rank, answers, accuracy, gap to the rank above
        mine = common.text_of(page, '.league-me-sub')
        check('my card shows my rank', 'المركز' in mine, mine)
        check('my card shows the gap to the next rank',
              'باقي' in common.text_of(page, '.league-me-gap'))

        # ---- visibility: one switch hides me from the board
        page.locator('#league-vis-toggle').uncheck()
        page.wait_for_timeout(900)
        check('hiding removes me from the board', page.locator('.podium-slot.is-me').count() == 0)
        check('my card confirms I am hidden', 'مخفي' in common.text_of(page, '.league-me-sub'))
        # re-show via a true pointer click (check()/uncheck() hang on Playwright's
        # same-document navigation tracking after hash routing; the handler is identical)
        toggle_box = page.locator('#league-vis-toggle').bounding_box()
        check('the visibility switch is on screen', toggle_box is not None)
        if toggle_box:
            page.mouse.click(toggle_box['x'] + toggle_box['width'] / 2,
                             toggle_box['y'] + toggle_box['height'] / 2)
        page.wait_for_timeout(900)
        back = page.locator('.podium-slot.is-me').count() + page.locator('.league-row.is-me').count()
        check('showing again restores me', back == 1, back)

        # ---- per-subject scope re-ranks locally, without a single request
        subs = common.subjects(page)
        rows = common.board(player=6, me_id='tg:7777')
        for r in rows:
            r['per_subject'] = {subs[0]['id']: {'xp': max(0, 90 - rows.index(r) * 20), 'n': 2, 'title': 't'}}
        common.mock_board(page, rows)
        page.wait_for_timeout(1000)
        calls = []
        page.on('request', lambda r: calls.append(r.url) if 'supabase' in r.url else None)
        chips = page.locator('#league-subject-bar .filter-chip')
        if chips.count() > 1:
            chips.nth(1).click()
            page.wait_for_timeout(200)
            chips.nth(0).click()
            page.wait_for_timeout(200)
        check('scope switching sends no requests', len(calls) == 0, len(calls))

        # ---- small boards do not pretend to be a podium
        common.mock_board(page, common.board(player=2))
        page.wait_for_timeout(1000)
        check('no podium below three players', page.locator('.podium-slot').count() == 0)
        check('the board stays a table', page.locator('.league-row').count() == 2)

        # ---- avatars: photo when there is one, silhouette otherwise
        check('default avatar silhouette is used',
              page.locator('.menu-avatar.avatar-default').count() > 0)

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
