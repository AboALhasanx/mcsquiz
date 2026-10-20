import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common

pw = common.launch()
browser, page, errors = common.new_page(pw, tour_done=True, telegram={'id': 8, 'first_name': 'طالب'})
try:
    subs = common.subjects(page)
    sid, qid = subs[0]['id'], subs[0]['chapters'][0]
    page.evaluate('(h) => { location.hash = h; }', '#/quiz/%s/%s' % (sid, qid))
    page.wait_for_selector('#btn-start-quiz:visible', timeout=15000)
    page.evaluate('() => document.querySelector("#btn-start-quiz").click()')
    page.wait_for_timeout(500)
    common.tap(page, page.locator('.option-tile').first)
    page.wait_for_timeout(300)
    page.evaluate('() => { location.hash = "#/"; }')   # leave attempt
    page.wait_for_timeout(600)
    shown = page.evaluate("() => !document.querySelector('#leave-modal').classList.contains('hidden')")
    print('modal shown:', shown)
    print('title:', page.locator('#leave-title').text_content())
    print('body:', page.locator('#leave-body').text_content())
    print('remaining:', page.locator('#leave-remaining').text_content())
    print('go:', page.locator('#leave-go').text_content())
    page.screenshot(path='C:/Windows/Temp/opencode/leave-dark.png')
    page.evaluate('() => document.documentElement.setAttribute("data-theme", "light")')
    page.wait_for_timeout(300)
    page.screenshot(path='C:/Windows/Temp/opencode/leave-light.png')
    print('errors:', errors[:2])
finally:
    browser.close()
