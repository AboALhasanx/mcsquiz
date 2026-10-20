"""Shared fixtures for the MCQ Portal test suite (webapp-testing skill: Playwright).

Every spec file imports `new_page()` and `check()`. The server is started by
`run_all.py` via the skill's `with_server.py` helper; specs only talk to a live
local URL so they can also be pointed at production (`PORTAL_BASE_URL`).
"""
import os
import sys
import json

from playwright.sync_api import sync_playwright

EXE = os.environ.get('PORTAL_CHROMIUM',
                     r'C:\Users\gokoq\AppData\Local\Thorium\Application\thorium.exe')
BASE = os.environ.get('PORTAL_BASE_URL', 'http://127.0.0.1:8081')
# the app exposes its state object only in debug mode; specs drive it there
APP = BASE + ('&' if '?' in BASE else '?') + 'debug=1'
VP = {'width': 390, 'height': 844}

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

RESULTS = []
SUITE = 'portal'


def suite(name):
    global SUITE
    SUITE = name


def check(name, cond, detail=''):
    """TDD assertion: name states the intended behaviour, not the implementation."""
    ok = bool(cond)
    RESULTS.append((SUITE, name, ok, str(detail)))
    line = ('PASS' if ok else 'FAIL') + ' ' + name
    if not ok and detail:
        line += ' :: ' + str(detail)[:160]
    print(line, flush=True)
    return ok


def report():
    failed = [r for r in RESULTS if not r[2]]
    path = os.path.join(os.path.dirname(__file__), 'report.txt')
    with open(path, 'a', encoding='utf-8') as f:
        for s, n, ok, d in RESULTS:
            f.write('%s | %s | %s | %s\n' % ('PASS' if ok else 'FAIL', s, n, d))
    print('%d checks, %d failed' % (len(RESULTS), len(failed)), flush=True)
    return 1 if failed else 0


# --- browser ---------------------------------------------------------------

TG_INIT = """
(localStorage) => {};
"""

def telegram_script(user):
    # NOTE: add_init_script takes no arguments in Python, so the payload is
    # inlined and the snippet runs immediately (no arrow-function wrapper).
    payload = json.dumps(user)
    return ("""
    try {
      window.Telegram = { WebApp: {
        initData: 'x',
        initDataUnsafe: { user: __USER__ },
        colorScheme: 'dark',
        ready() {}, expand() {},
        openTelegramLink(link) { window.__tgLink = link; },
        CloudStorage: { getItem(k, cb) { cb(null, null); }, setItem(k, v, cb) { cb(null, true); }, removeItem(k, cb) { cb(null, true); } },
      } };
      Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    } catch (e) {}
    """.replace('__USER__', payload))


def launch():
    return sync_playwright().start()


def new_page(pw, tour_done=True, telegram=None, add_init=None):
    browser = pw.chromium.launch(headless=True, executable_path=EXE)
    ctx = browser.new_context(viewport=VP, is_mobile=True, has_touch=True,
                              service_workers='block')
    done_line = ("localStorage.setItem('portal_tour_done', '1');"
                 if tour_done else "localStorage.removeItem('portal_tour_done');")
    # NOTE: a plain string is evaluated as-is, so it must run immediately
    # (wrapping it in "() => {...}" would only define a function, never call it).
    ctx.add_init_script(
        "try { " + done_line + " localStorage.setItem('portal_quiz_hint', '1'); } catch (e) {}")
    if telegram is not None:
        ctx.add_init_script(telegram_script(telegram))
    if add_init:
        ctx.add_init_script(add_init)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e).split('\n')[0]))
    page.goto(APP, wait_until='domcontentloaded', timeout=45000)
    page.wait_for_function('() => !!window.PortalLeague', timeout=20000)
    page.wait_for_function(
        '() => window.__portal && window.__portal.S && window.__portal.S.index '
        '&& window.__portal.S.index.subjects && window.__portal.S.banks '
        '&& Object.keys(window.__portal.S.banks).length > 0',
        timeout=25000)
    return browser, page, errors


# --- fakes -----------------------------------------------------------------

MOCK_CLIENT = """
(rows) => {
  const wk = window.PortalLeague.weekStart(Date.now());
  rows.forEach((r) => { r.week_id = wk; });
  const chain = (table, filters) => {
    const resolve = () => {
      if (table !== 'league_xp') return [];
      let r = rows.slice();
      filters.forEach(([k, v]) => { r = r.filter((x) => String(x[k]) === String(v)); });
      return r.sort((a, b) => b.xp - a.xp);
    };
    const s = {
      select() { return s; }, eq(k, v) { filters.push([k, v]); return s; },
      neq() { return s; }, order() { return s; }, limit() { return s; },
      maybeSingle() { return Promise.resolve({ data: resolve()[0] || null, error: null }); },
      then(res, rej) { return Promise.resolve({ data: resolve(), error: null }).then(res, rej); },
      upsert(row) {
        const i = rows.findIndex((x) => x.user_id === row.user_id);
        const rec = Object.assign({ week_id: window.PortalLeague.weekStart(Date.now()), per_subject: {} }, row);
        if (i >= 0) rows[i] = Object.assign({}, rows[i], rec); else rows.push(rec);
        return Promise.resolve({ error: null });
      },
    };
    return s;
  };
  window.PortalLeague._setClient({ from: (t) => chain(t, []) });
  window.__mockRows = rows;
}
"""


def board(player=11, xp=220, answered=300, me_id=None, avatars=None):
    """A deterministic weekly board: `player` people, first one has `xp` answers."""
    avatars = avatars or {}
    rows = []
    for i in range(player):
        uid = me_id if (me_id and i == 3) else 'tg:%d' % (1000 + i)
        rows.append({
            'week_id': '',
            'user_id': uid,
            'name': 'لاعب %d' % i,
            'username': '',
            'avatar': avatars.get(uid, ''),
            'hidden': False,
            'xp': xp - i * 11,
            'answered': answered - i * 15,
            'per_subject': {},
        })
    return rows


def tap(page, locator, timeout=10000):
    """Tap an in-content control.

    Centres it first (Playwright's own scroll would tuck tiles under the
    sticky header), asserts the tile itself is the hit target, then clicks.
    The hit-target assertion keeps this honest: a genuinely covered control
    fails here instead of silently tapping through it.
    """
    locator.scroll_into_view_if_needed(timeout=timeout)
    handle = locator.element_handle(timeout=timeout)
    page.evaluate('(el) => el.scrollIntoView({ block: "center" })', handle)
    page.wait_for_timeout(150)
    top = page.evaluate("""(el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit === el || el.contains(hit);
    }""", handle)
    assert top, 'tap target is covered by another element'
    page.evaluate('(el) => el.click()', handle)


def install_mock(page, rows):
    """Install the fake Supabase client before any navigation, so no real
    request can win a race against it later."""
    page.evaluate(MOCK_CLIENT, rows)
    page.evaluate("""() => {
      if (window.__portal) {
        window.__portal.S.leagueRows = null;
        window.__portal.S.leagueStamp = 0;
      }
    }""")


def mock_board(page, rows):
    """Install the fake Supabase client, drop the cached board and re-render."""
    page.evaluate(MOCK_CLIENT, rows)
    # force a real re-route: setting an identical hash would not trigger it
    page.evaluate("""() => {
      if (window.__portal) {
        window.__portal.S.leagueRows = null;
        window.__portal.S.leagueStamp = 0;
      }
      location.hash = '#/';
    }""")
    page.wait_for_timeout(400)
    page.evaluate("() => { location.hash = '#/league'; }")
    # wait for the board to actually render (also settles hash navigation)
    try:
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          const empty = document.querySelector('#league-empty-state');
          return (box && box.childElementCount > 0)
            || (empty && !empty.classList.contains('hidden'));
        }""", timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(400)


def text_of(page, selector):
    """Text of the first match, or '' when the element does not exist."""
    loc = page.locator(selector)
    try:
        if loc.count() == 0:
            return ''
        return loc.first.text_content(timeout=3000) or ''
    except Exception:
        return ''


def bank_ids(page):
    return page.evaluate('() => Object.keys(window.__portal ? window.__portal.S.banks : {})')


def subjects(page):
    page.wait_for_function(
        '() => window.__portal && window.__portal.S && window.__portal.S.index && window.__portal.S.index.subjects',
        timeout=20000)
    return page.evaluate("""
    () => (window.__portal ? (window.__portal.S.index.subjects || []) : [])
      .map((s) => ({ id: s.subject_id, title: s.subject_title, chapters: (s.chapters || []).map((c) => c.quiz_id) }))
    """)
