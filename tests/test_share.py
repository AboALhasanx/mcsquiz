"""Share card: direct share, app link, layout that fits any rank."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('share')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(
        pw, tour_done=True,
        telegram={'id': 7777, 'first_name': 'ليلى', 'username': 'layla'})
    try:
        common.install_mock(page, common.board(player=8, me_id='tg:7777'))
        page.evaluate('() => { location.hash = "#/league"; }')
        page.wait_for_timeout(1500)
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          return box && box.childElementCount > 0;
        }""", timeout=15000)
        page.wait_for_timeout(400)

        page.click('#btn-league-share')
        page.wait_for_timeout(6000)

        check('share opens the preview', 'hidden' not in (page.locator('#share-modal').get_attribute('class') or ''))
        check('the card image rendered',
              page.evaluate('() => (document.querySelector("#share-img").naturalWidth || 0) > 0'))
        check('share action is offered', 'hidden' not in (page.locator('#share-telegram').get_attribute('class') or ''))
        check('download is offered', page.locator('#share-download').is_visible())

        page.locator('#share-telegram').click()
        page.wait_for_timeout(400)
        link = page.evaluate('() => window.__tgLink || ""')
        check('sharing sends the app link, not a storage URL',
              't.me/share/url' in link and 'supabase.co' not in link, link[:120])

        # the card follows the viewer: top five, then the viewer's row when lower
        page.locator('#share-close').click()
        page.wait_for_timeout(300)
        wide = common.board(player=12, me_id='tg:7777')
        common.install_mock(page, wide)
        page.evaluate('() => { location.hash = "#/"; }')
        page.wait_for_timeout(400)
        page.evaluate('() => { location.hash = "#/league"; }')
        page.wait_for_timeout(1500)
        page.click('#btn-league-share')
        page.wait_for_timeout(6000)
        size = page.evaluate("""() => {
          const i = document.querySelector('#share-img');
          return { w: i.naturalWidth, h: i.naturalHeight };
        }""")
        check('card keeps a portrait share format', size['w'] == 1080, size)
        check('card grows when the viewer is outside the top five', size['h'] > 1100, size)

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
