// Runtime audit on the tablet: timers that survive their screen (zombies),
// listeners, unhandled rejections, orphan storage keys.
//
//   adb forward tcp:9222 localabstract:chrome_devtools_remote
//   node tools/audit_runtime.js
//
// It instruments setInterval/setTimeout before the app boots, drives every
// screen, then reports what is still alive.
const { chromium } = require('playwright-core');
const BASE = 'https://mcq-portal-jade.vercel.app';

const INSTRUMENT = `
(() => {
  if (window.__audit) return;
  const live = { intervals: {}, timeouts: {}, created: 0, cleared: 0 };
  window.__audit = live;
  const oi = window.setInterval, ci = window.clearInterval, ot = window.setTimeout, ct = window.clearTimeout;
  const origin = () => { try { const f = (new Error()).stack.split('\\n'); return (f[3] || f[2] || '?').trim().replace(/https?:\\/\\/[^/]+\\//, ''); } catch (e) { return '?'; } };
  window.setInterval = function (fn, ms) {
    const id = oi(fn, ms);
    live.intervals[id] = { ms: ms, at: Date.now(), where: origin() };
    live.created++;
    return id;
  };
  window.clearInterval = function (id) { if (live.intervals[id]) { delete live.intervals[id]; live.cleared++; } return ci(id); };
  window.setTimeout = function (fn, ms) {
    let id;
    const wrapped = function () { delete live.timeouts[id]; try { return fn.apply(this, arguments); } catch (e) { throw e; } };
    id = ot(wrapped, ms);
    live.timeouts[id] = { ms: ms, at: Date.now(), where: origin() };
    live.created++;
    return id;
  };
  window.clearTimeout = function (id) { if (live.timeouts[id]) { delete live.timeouts[id]; live.cleared++; } return ct(id); };
  window.__auditErrors = [];
  window.addEventListener('unhandledrejection', (e) => { window.__auditErrors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)); });
  window.addEventListener('error', (e) => { window.__auditErrors.push('error: ' + (e.message || '')); });
})();
`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = b.contexts()[0];
  let p = ctx.pages().find((x) => 'url' in x && x.url().indexOf('mcq-portal') >= 0) || (await ctx.newPage());
  await p.bringToFront();

  // instrument now, before the flows that create timers (the quiz timer is
  // created on start, so this catches every interval that should die with it)
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await p.waitForFunction(() => window.PortalApp && window.PortalApp.bankCount() > 0, null, { timeout: 60000 });
  await wait(2500);
  await p.evaluate(INSTRUMENT);
  const keysBefore = await p.evaluate(() => Object.keys(localStorage).sort());

  const step = async (name, fn) => {
    try { await fn(); console.log('  ok  ' + name); }
    catch (e) { console.log('  ??  ' + name + ' :: ' + e.message.split('\n')[0]); }
  };
  const home = async () => {
    await p.evaluate(() => { location.hash = '#/'; });
    await wait(900);
    if (await p.locator('#leave-modal').isVisible().catch(() => false)) { await p.click('#leave-go'); await wait(800); }
  };

  console.log('driving the screens…');
  await step('home filters', async () => {
    const n = await p.locator('#subject-filter-bar .filter-chip').count();
    for (let i = 0; i < n; i++) { await p.locator('#subject-filter-bar .filter-chip').nth(i).click(); await wait(350); }
  });
  await step('drawer', async () => {
    await home();
    await p.click('#btn-menu-catalog'); await wait(700);
    await p.click('#btn-close-menu'); await wait(500);
  });
  await step('quiz: start, answer, explain, matrix, pause/resume, leave', async () => {
    await home();
    await p.locator('#subject-filter-bar .filter-chip').nth(5).click(); await wait(500);
    await p.locator('#catalog-cards-container .sketch-play-cell').first().click(); await wait(900);
    await p.click('#btn-start-quiz');
    await p.waitForSelector('#options-container .option-tile', { timeout: 20000 });
    await p.locator('#options-container .option-tile').nth(0).click(); await wait(500);
    await p.click('#live-expl-toggle').catch(() => {});
    await p.click('#btn-open-matrix').catch(() => {}); await wait(600);
    await p.click('#btn-close-matrix').catch(() => {}); await wait(400);
    await p.click('#btn-timer-pause').catch(() => {}); await wait(700);
    await p.click('#btn-resume-quiz').catch(() => {}); await wait(500);
    await p.click('#btn-exit'); await wait(600);
    if (await p.locator('#leave-modal').isVisible().catch(() => false)) { await p.click('#leave-go'); await wait(900); }
  });
  await step('quiz: finish one', async () => {
    await home();
    await p.locator('#subject-filter-bar .filter-chip').nth(5).click(); await wait(500);
    await p.locator('#catalog-cards-container .sketch-play-cell').first().click(); await wait(900);
    await p.click('#btn-start-quiz');
    await p.waitForSelector('#options-container .option-tile', { timeout: 20000 });
    for (let i = 0; i < 8; i++) {
      await p.locator('#options-container .option-tile').nth(0).click(); await wait(350);
      if (!(await p.locator('#btn-next').isVisible().catch(() => false))) break;
      await p.click('#btn-next'); await wait(450);
      if (!(await p.locator('#options-container .option-tile').first().isVisible().catch(() => false))) break;
    }
    await wait(1200);
  });
  await step('results → home', async () => {
    await home();
  });
  await step('saved, stats, league, account', async () => {
    for (const h of ['#/saved', '#/stats', '#/league', '#/account']) {
      await p.evaluate((x) => { location.hash = x; }, h);
      await wait(1400);
    }
    await home();
  });

  await wait(4000); // give debounced timers a chance to expire

  const report = await p.evaluate(() => {
    const A = window.__audit || { intervals: {}, timeouts: {}, created: 0, cleared: 0 };
    const sess = window.__portal && window.__portal.S ? window.__portal.S.session : 'n/a';
    return {
      intervals: Object.keys(A.intervals).map((k) => A.intervals[k]),
      timeouts: Object.keys(A.timeouts).map((k) => A.timeouts[k]),
      created: A.created,
      cleared: A.cleared,
      errors: window.__auditErrors || [],
      session: sess ? { started: sess.started, finished: sess.finished, timerId: !!sess.timerId } : sess,
      keys: Object.keys(localStorage).sort(),
      hash: location.hash,
    };
  });

  console.log('\n=== runtime audit ===');
  console.log('timers created:', report.created, '| cleared:', report.cleared);
  console.log('live intervals:', report.intervals.length);
  report.intervals.forEach((i) => console.log('  interval', i.ms + 'ms', 'from', i.where));
  console.log('live timeouts:', report.timeouts.length);
  report.timeouts.slice(0, 10).forEach((t) => console.log('  timeout', t.ms + 'ms', 'from', t.where));
  console.log('unhandled errors:', report.errors.length);
  report.errors.slice(0, 5).forEach((e) => console.log('  ', e));
  console.log('session after leaving:', JSON.stringify(report.session));
  const added = report.keys.filter((k) => keysBefore.indexOf(k) < 0);
  const gone = keysBefore.filter((k) => report.keys.indexOf(k) < 0);
  console.log('storage keys added:', added.length ? added.join(', ') : '(none)');
  console.log('storage keys removed during the run:', gone.length ? gone.join(', ') : '(none)');
  console.log('hash at the end:', report.hash);

  await b.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
