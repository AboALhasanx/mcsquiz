"""Accessibility: skip link, focus visibility, labels, announcements, direction."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('a11y')


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(pw, tour_done=True, telegram={'id': 4, 'first_name': 'طالب'})
    try:
        check('document is RTL Arabic',
              page.evaluate("() => document.documentElement.getAttribute('dir')") == 'rtl'
              and page.evaluate("() => document.documentElement.getAttribute('lang')") == 'ar')

        # skip link: first tab stop, visible when focused
        page.keyboard.press('Tab')
        page.wait_for_timeout(200)
        first = page.evaluate("""() => {
          const el = document.activeElement;
          return { cls: el.className || '', top: Math.round(el.getBoundingClientRect().top) };
        }""")
        check('the first tab stop is the skip link', 'skip-link' in first['cls'], first)
        check('the skip link becomes visible on focus', first['top'] >= 0, first)
        page.keyboard.press('Enter')
        page.wait_for_timeout(300)

        # every icon-only control carries a label
        # (textContent, not innerText: drawer items are named by their content
        # even while the drawer is closed, exactly as assistive tech reads them)
        unlabelled = page.evaluate("""() => {
          const out = [];
          document.querySelectorAll('button, a').forEach((el) => {
            const text = (el.textContent || '').trim();
            if (text) return;
            if (el.getAttribute('aria-label') || el.getAttribute('title')) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            out.push(el.id || el.className);
          });
          return out;
        }""")
        check('every visible icon-only control has a label', len(unlabelled) == 0, unlabelled)

        # keyboard focus is visible on a control
        page.evaluate("() => document.querySelector('#btn-menu-catalog').focus()")
        page.wait_for_timeout(200)
        outline = page.evaluate("""() => {
          const cs = getComputedStyle(document.querySelector('#btn-menu-catalog'));
          return cs.outlineWidth + ' ' + cs.outlineStyle;
        }""")
        check('focused controls draw a focus ring',
              outline.startswith('2px') and 'none' not in outline, outline)

        # toasts are announced
        page.evaluate('() => { location.hash = "#/quiz/01_Cyber_Security/Quiz_Ch01_T01_Cybersecurity_Definition_and_Evolution"; }')
        page.wait_for_timeout(1200)
        page.click('#btn-start-quiz')
        page.wait_for_timeout(500)
        page.click('#btn-next')          # unanswered -> a message
        page.wait_for_timeout(400)
        check('a message appears for a blocked action',
              page.locator('.portal-toast').count() >= 1)
        check('the message is announced politely or as an alert',
              page.evaluate("""() => {
                const t = document.querySelector('#toast-region');
                return (t.getAttribute('aria-live') === 'polite')
                  || !!document.querySelector('.portal-toast[role="status"], .portal-toast[role="alert"]');
              }"""))

        # images and canvases carry a name
        check('the share preview image has alt text',
              page.evaluate("""() => {
                const i = document.querySelector('#share-img');
                return !!i && (i.getAttribute('alt') || '').length > 3;
              }"""))

        # theme toggle updates the accent and persists
        page.evaluate('() => { location.hash = "#/"; }')
        page.wait_for_timeout(700)
        # a live quiz always warns before leaving (the student asked for this):
        # confirm the exit, otherwise the guard keeps the quiz view open
        if page.locator('#leave-modal:not(.hidden)').count():
            page.click('#leave-go')
            page.wait_for_timeout(700)
        dark = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        page.click('#btn-theme-header')
        page.wait_for_timeout(400)
        light = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        check('theme toggle changes the palette', dark != light, '%s / %s' % (dark, light))
        check('theme choice is remembered',
              page.evaluate("() => localStorage.getItem('portal_theme')") is not None)

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()
    return common.report()


if __name__ == '__main__':
    sys.exit(run())
