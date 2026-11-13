"""The adaptive controller is called by a real legend duel and feeds the next match."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
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

    # Spy on the shipped controller and on the bot's accuracy input.
    page.evaluate("""() => {
      window.__calls = [];
      const real = window.PortalVSAdaptive;
      window.PortalVSAdaptive = {
        createProfile: () => real.createProfile(),
        difficulty: () => ({ offset: 0.05 }),
        recordAggregate: (profile, aggregate) => {
          window.__calls.push(aggregate);
          return real.recordAggregate(profile, aggregate);
        }
      };
      const decide = window.PortalVSBot.decide;
      window.PortalVSBot.decide = function (legend) {
        window.__legendUsed = legend.baseAccuracy;
        return decide.apply(this, arguments);
      };
    }""")

    page.evaluate("location.hash = '#/vs'")
    page.wait_for_function("!document.getElementById('vs-view').classList.contains('hidden')")
    page.locator('.vs-legends-summary').click()
    page.locator('.vs-legend-btn').first.click()
    page.wait_for_selector('#vs-arena:not(.hidden)', timeout=15000)

    used = page.evaluate("window.__legendUsed")
    base_acc = page.evaluate("window.PortalVSBot.getLegend(window.vsState.botLegend.id).baseAccuracy")
    assert used is not None and abs(used - (base_acc + 0.05)) < 1e-9, (used, base_acc)

    for index in range(5):
        page.wait_for_function(
            "i => document.querySelector('#vs-dot-' + i).classList.contains('is-current')",
            arg=index, timeout=20000)
        page.locator('.vs-opt-btn:not([disabled])').first.click(timeout=10000)
    page.wait_for_selector('#vs-result:not(.hidden)', timeout=20000)

    calls = page.evaluate("window.__calls")
    assert len(calls) == 1, calls
    assert sum(calls[0].values()) == 1, calls
    print('PASS adaptive offset reached the opponent and one outcome was recorded')
    browser.close()
