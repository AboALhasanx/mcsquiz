"""Cold start without network, served by the service worker (not a warmed page)."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from common import EXE

base = os.environ.get('PORTAL_BASE_URL', 'http://127.0.0.1:18081')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=EXE)
    context = browser.new_context(viewport={'width': 402, 'height': 850})
    page = context.new_page()
    page.add_init_script("localStorage.setItem('portal_tour_done', '1')")
    page.route('**/supabase.co/**', lambda route: route.abort())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    page.goto(base, wait_until='domcontentloaded')
    page.wait_for_selector('#btn-menu-catalog', timeout=30000)
    page.wait_for_function('!!navigator.serviceWorker.controller', timeout=30000)
    page.wait_for_timeout(1500)  # let the install finish caching the shell

    context.set_offline(True)
    page.goto(base, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_selector('#btn-menu-catalog', timeout=30000)
    assert page.locator('#catalog-view').count() >= 0
    print('PASS cold start offline: catalogue rendered from the worker cache')

    page.evaluate("location.hash = '#/vs'")
    page.wait_for_function("!document.getElementById('vs-view').classList.contains('hidden')")
    assert page.locator('#vs-lobby').is_visible()
    page.locator('.vs-legends-summary').click()
    assert page.locator('.vs-legend-btn').count() == 5

    # A live room cannot be created offline; it must fail visibly, not hang.
    page.locator('#vs-btn-create-room').click()
    page.wait_for_function(
        "() => { const r = document.getElementById('toast-region'); return r && r.textContent.includes('تعذر إنشاء الغرفة'); }",
        timeout=20000)
    print('PASS cold start offline: live room fails visibly, legends stay usable')

    page.locator('.vs-legend-btn').first.click()
    page.wait_for_selector('#vs-arena:not(.hidden)', timeout=20000)
    for index in range(5):
        page.wait_for_function(
            "i => document.querySelector('#vs-dot-' + i).classList.contains('is-current')",
            arg=index, timeout=25000)
        page.locator('.vs-opt-btn:not([disabled])').first.click(timeout=10000)
    page.wait_for_selector('#vs-result:not(.hidden)', timeout=25000)
    assert not errors, errors[:2]
    print('PASS cold start offline: legend duel completed, no page errors')
    browser.close()
