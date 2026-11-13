"""League: the virtual legends are labelled, and the ranking is untouched.

Isolated by design: no Supabase request and no real account. The board comes from
`common.install_mock`, the legends from a fixed local stub, so the spec only
proves the disclosure surface (table, podium, player card, share canvas) and the
fact that the marking never filters, re-ranks or re-scores a row.

Deliberately standalone (not in `run_all.py` yet): it prints its own summary and
does not append to `tests/report.txt`, so it cannot disturb evidence being
collected by another spec in parallel.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import common
from common import suite, check

suite('league bot disclosure')

# One legend intentionally omits `isBot` and is recognised by its id prefix,
# which is exactly the case a single-module change must not lose.
BOTS = [
    {'user_id': 'legend:cristiano', 'name': 'كريستيانو', 'title': 'الحاسم تحت الضغط',
     'xp': 250, 'answered': 300, 'updated_at': '2026-11-13T10:00:00.000Z',
     'per_subject': {}},
    {'user_id': 'legend:messi', 'name': 'ميسي', 'title': 'الموهبة الخارقة', 'isBot': True,
     'xp': 200, 'answered': 240, 'updated_at': '2026-11-13T11:00:00.000Z',
     'per_subject': {}},
    {'user_id': 'legend:maldini', 'name': 'مالديني', 'title': 'الجدار المتزن', 'isBot': True,
     'xp': 100, 'answered': 130, 'updated_at': '2026-11-13T12:00:00.000Z',
     'per_subject': {}},
]


def board_state(page):
    """Podium and table as one ranking list: rank, points, virtual flag."""
    return page.evaluate("""() => {
      const num = (el) => {
        const m = ((el && el.textContent) || '').match(/[0-9]+/);
        return m ? Number(m[0]) : NaN;
      };
      const out = [];
      document.querySelectorAll('#league-podium .podium-slot').forEach((s) => {
        out.push({
          rank: num(s.querySelector('.podium-block')),
          xp: num(s.querySelector('.podium-xp')),
          bot: s.classList.contains('is-bot'),
        });
      });
      document.querySelectorAll('#league-board .league-row').forEach((r) => {
        out.push({
          rank: num(r.querySelector('.league-rank')),
          xp: num(r.querySelector('.league-row-xp')),
          bot: r.classList.contains('is-bot'),
        });
      });
      return out.sort((a, b) => a.rank - b.rank);
    }""")


def finish(errors):
    # no common.report(): tests/report.txt belongs to the gate and to parallel work
    failed = [r for r in common.RESULTS if not r[2]]
    print('%d checks, %d failed' % (len(common.RESULTS), len(failed)), flush=True)
    if errors:
        print('runtime errors:', errors[:2], flush=True)
    return 1 if failed else 0


def run():
    pw = common.launch()
    browser, page, errors = common.new_page(
        pw, tour_done=True,
        telegram={'id': 7777, 'first_name': 'ليلى', 'username': 'layla'})
    try:
        humans = common.board(player=6, me_id='tg:7777')
        common.install_mock(page, humans)
        page.evaluate("""(bots) => {
          window.__stubBots = bots;
          const S = window.__portal.S;
          // no background sync: it would re-score my row from empty local history
          S.leagueSyncStamp = Date.now();
          S.leagueRows = null;
          S.leagueStamp = 0;
          // the generated legends join on every render, not only outside tests
          window.PortalLeague.isMock = () => false;
          window.PortalVSBot = window.PortalVSBot || {};
          window.PortalVSBot.getLeagueRows = () => window.__stubBots;
        }""", BOTS)

        page.evaluate('() => { location.hash = "#/league"; }')
        page.wait_for_function("""() => {
          const box = document.querySelector('#league-board');
          return box && box.childElementCount > 0;
        }""", timeout=15000)
        page.wait_for_timeout(400)

        rows = board_state(page)
        ranks = [r['rank'] for r in rows]
        xps = [r['xp'] for r in rows]
        bot_ranks = sorted(r['rank'] for r in rows if r['bot'])

        # ---- the marking adds a label, not a filter and not a re-rank
        check('every contender stays on the board', len(rows) == 9, len(rows))
        check('ranks stay contiguous from one', ranks == sorted(ranks) == list(range(1, 10)), ranks)
        check('points still order the board', all(xps[i] >= xps[i + 1] for i in range(len(xps) - 1)), xps)
        check('virtual opponents keep their exact places', bot_ranks == [1, 4, 9], bot_ranks)

        # ---- table: legends below the podium are labelled
        bot_rows = page.locator('.league-row.is-bot')
        check('the table carries the labelled legends', bot_rows.count() == 2, bot_rows.count())
        check('the table legend shows the Arabic label',
              (page.locator('.league-row.is-bot .league-bot-badge').first.text_content() or '').strip() == 'افتراضي')
        check('the badge explains itself on hover',
              'ليس حساب طالب' in (page.locator('.league-row.is-bot .league-bot-badge').first
                                  .get_attribute('title') or ''))

        # ---- podium: the leader is labelled too, without losing the crown
        check('the podium leader is a legend', page.locator('.podium-slot.p1.is-bot').count() == 1)
        check('the podium legend shows the Arabic label',
              (page.locator('.podium-slot.p1 .league-bot-badge').first.text_content() or '').strip() == 'افتراضي')
        check('the leader still wears the crown',
              page.locator('.podium-slot.p1 .podium-crown').count() == 1)

        # ---- students are never marked by mistake
        check('student rows carry no virtual badge',
              page.locator('.league-row:not(.is-bot) .league-bot-badge').count() == 0)
        check('student podium slots carry no virtual badge',
              page.locator('.podium-slot:not(.is-bot) .league-bot-badge').count() == 0)

        # ---- assistive tech hears the same fact
        label = page.locator('.league-row.is-bot').first.get_attribute('aria-label') or ''
        check('the legend row announces it is virtual', 'منافس افتراضي' in label, label)
        human_label = page.locator('.league-row:not(.is-bot)').first.get_attribute('aria-label') or ''
        check('a student row announces no virtual claim', 'افتراضي' not in human_label, human_label)

        # ---- the recognition does not depend on another module's `isBot` field
        unit = page.evaluate("""() => {
          const ui = window.getLeagueUI();
          return {
            byFlag: ui.isVirtualRow({ isBot: true, user_id: 'x' }),
            byId: ui.isVirtualRow({ user_id: 'legend:maradona' }),
            student: ui.isVirtualRow({ user_id: 'tg:1001' }),
            missing: ui.isVirtualRow(null),
            flagLessStubIntact: window.__stubBots[0].isBot === undefined,
          };
        }""")
        check('an explicit bot flag is recognised', unit['byFlag'] is True, unit)
        check('a legend id is recognised without the flag', unit['byId'] is True, unit)
        check('a student id is not treated as virtual', unit['student'] is False, unit)
        check('a missing row is not treated as virtual', unit['missing'] is False, unit)
        check('the source legend row is not mutated', unit['flagLessStubIntact'] is True, unit)

        # ---- no point was rewritten in the data the UI was given
        untouched = page.evaluate("""() => {
          const bots = window.__stubBots.map((b) => b.xp).sort((a, b) => a - b);
          const humans = (window.__mockRows || []).map((r) => r.xp).sort((a, b) => a - b);
          return { bots, humans };
        }""")
        check('legend points are unchanged', untouched['bots'] == [100, 200, 250], untouched['bots'])
        check('student points are unchanged',
              untouched['humans'] == sorted(r['xp'] for r in humans), untouched['humans'])

        # ---- the player card repeats the disclosure in words, not only a hue
        bot_rows.first.click()
        page.wait_for_selector('#player-drawer.open', timeout=8000)
        page.wait_for_timeout(300)
        card = page.locator('#player-card').inner_text()
        check('the legend card says it is virtual', 'منافس افتراضي' in card, card[:120])
        check('the legend card says it is not an account', 'ليس حساب طالب' in card, card[:160])
        page.click('#player-close')
        page.wait_for_timeout(300)

        # ---- the shared image labels legends too (canvas text is spied, not guessed)
        page.evaluate("""() => {
          window.__drawnTexts = [];
          const proto = CanvasRenderingContext2D.prototype;
          if (!proto.__disclosureSpy) {
            const orig = proto.fillText;
            proto.fillText = function (t) {
              window.__drawnTexts.push(String(t));
              return orig.apply(this, arguments);
            };
            proto.__disclosureSpy = true;
          }
        }""")
        page.click('#btn-league-share')
        page.wait_for_function("""() => {
          const img = document.querySelector('#share-img');
          return img && img.naturalWidth > 0 && (window.__drawnTexts || []).length > 0;
        }""", timeout=15000)
        texts = page.evaluate('() => window.__drawnTexts || []')
        check('the share card draws the legend names', 'كريستيانو' in texts and 'ميسي' in texts,
              [t for t in texts if 'كريستيانو' in t][:2])
        check('the share card tags each legend as virtual',
              texts.count('افتراضي') >= 1, texts.count('افتراضي'))
        check('the share card explains the tag in its footer',
              any('منافس آلي وليس حساب طالب' in t for t in texts),
              [t for t in texts if 'افتراضي' in t][:3])
        page.evaluate("""() => {
          const modal = document.querySelector('#share-modal');
          if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }
        }""")
        page.wait_for_timeout(200)

        # ---- previous-week winner banner: only legends study the closed week here
        page.locator('#league-week-bar button[data-week="prev"]').click()
        page.wait_for_function("""() => {
          const b = document.querySelector('#league-winner-banner');
          return b && !b.classList.contains('hidden');
        }""", timeout=12000)
        banner = page.locator('#league-winner-banner').inner_text()
        check('a virtual weekly winner is labelled in the banner',
              'كريستيانو' in banner and 'افتراضي' in banner, banner)
        page.locator('#league-week-bar button[data-week="current"]').click()
        page.wait_for_timeout(400)

        check('no runtime errors', not errors, errors[:2])
    finally:
        browser.close()

    return finish(errors)


if __name__ == '__main__':
    sys.exit(run())
