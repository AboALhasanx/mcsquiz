"""Offline legend duel using a throwaway browser profile; no backend writes."""
import os
from playwright.sync_api import sync_playwright
from common import EXE

base = os.environ.get('PORTAL_BASE_URL', 'http://127.0.0.1:18081')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=EXE)
    context = browser.new_context(viewport={'width': 402, 'height': 850}, service_workers='block')
    page = context.new_page()
    page.add_init_script("localStorage.setItem('portal_tour_done', '1')")
    page.route('**/supabase.co/**', lambda route: route.abort())
    page.goto(base, wait_until='domcontentloaded')
    page.wait_for_selector('#btn-menu-catalog', timeout=30000)
    context.set_offline(True)
    page.evaluate("location.hash = '#/vs'")
    page.wait_for_function("!document.getElementById('vs-view').classList.contains('hidden')")
    assert page.locator('#vs-lobby').is_visible()
    assert page.locator('#vs-btn-create-room').is_disabled()
    assert page.locator('#vs-btn-join-room').is_disabled()
    page.locator('.vs-legends-summary').click()
    page.locator('.vs-legend-btn').first.click()
    page.wait_for_selector('#vs-arena:not(.hidden)', timeout=15000)
    for index in range(5):
        page.wait_for_function("i => document.querySelector('#vs-dot-' + i).classList.contains('is-current')", arg=index, timeout=20000)
        page.locator('.vs-opt-btn:not([disabled])').first.click(timeout=10000)
    page.wait_for_selector('#vs-result:not(.hidden)', timeout=20000)
    assert page.locator('#vs-result-title').inner_text()
    print('PASS offline bot duel: 5 rounds completed; live-room controls disabled')
    browser.close()
