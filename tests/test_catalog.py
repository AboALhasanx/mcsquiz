"""Catalog: subject rail, chapter tiles, quiz rows, subject switching."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('catalog')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True, telegram={'id': 1, 'first_name': 'طالب'})
    try:
        subs = common.subjects(page)
        check('index exposes subjects', len(subs) >= 3, len(subs))

        chips = page.locator('#subject-filter-bar .filter-chip').all_text_contents()
        check('one chip per subject', len(chips) == len(subs), '%d vs %d' % (len(chips), len(subs)))
        check('no "all" chip', not any(c.strip() in ('الكل', 'الجميع') for c in chips))
        check('first subject is active',
              'active' in (page.locator('#subject-filter-bar .filter-chip').first.get_attribute('class') or ''))

        # chapter rail: numbers only, with a sticky label
        tiles = page.locator('#chapter-filter-bar .filter-chip').all_text_contents()
        check('chapter tiles are numbers',
              all(t.strip().isdigit() for t in tiles) and len(tiles) >= 1, tiles)
        check('chapter rail keeps a label',
              'جابتر' in (page.locator('#chapter-filter-bar .filter-bar-label').text_content() or ''))

        rows = page.locator('#catalog-cards-container .sketch-row')
        check('one row per visible chapter', rows.count() >= 1, rows.count())
        check('row links to its quiz',
              '#/quiz/' in (rows.first.locator('a').first.get_attribute('href') or ''))

        # switching subject is local work: no network at all
        before = page.evaluate('() => window.__net || 0')
        calls = []
        page.on('request', lambda r: calls.append(r.url) if 'supabase' in r.url else None)
        if len(subs) > 1:
            page.locator('#subject-filter-bar .filter-chip').nth(1).click()
            page.wait_for_timeout(300)
        check('switching subjects sends no requests', len(calls) == 0, len(calls))
        check('switching subjects changes the active chip',
              len(subs) <= 1 or 'active' in (page.locator('#subject-filter-bar .filter-chip').nth(1).get_attribute('class') or ''))

        # the first row opens the start card
        rows.first.locator('a').first.click()
        page.wait_for_timeout(800)
        check('opening a quiz shows the start card',
              'hidden' not in (page.locator('#quiz-start-view').get_attribute('class') or ''))
        start_card = page.locator('#quiz-start-view').inner_text()
        check('start card counts the questions',
              'عدد الأسئلة' in start_card and '0 أسئلة' not in start_card)
        check('start card estimates the time',
              'الوقت المقدّر' in start_card and 'دقيقة' in start_card)

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
