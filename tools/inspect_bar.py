import sys
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp('http://127.0.0.1:9333')
    page = browser.contexts[0].pages[0]

    res = page.evaluate('''() => {
        const bar = document.getElementById('chapter-filter-bar');
        bar.scrollTo({ left: 0 });
        const s1 = bar.scrollLeft;
        bar.scrollLeft = 100;
        const s2 = bar.scrollLeft;
        bar.scrollLeft = -100;
        const s3 = bar.scrollLeft;
        return { s1, s2, s3, dir: getComputedStyle(bar).direction };
    }''')
    print('Scroll test:', res)
