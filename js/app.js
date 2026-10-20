/* MCQ Portal — app.js
 * Standalone student quiz app. Static data only (data/index.json + banks).
 * No server calls, no telemetry, no Master-Studio sync. Device-local only.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DEBUG = new URLSearchParams(location.search).has('debug');

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  // Arabic-aware counts. English-style "1 أسئلة" is the fastest way to look machine-made.
  function arCount(n, forms) {
    if (n === 1) return forms.one;
    if (n === 2) return forms.two;
    if (n >= 3 && n <= 10) return n + ' ' + forms.few;
    return n + ' ' + forms.many;
  }
  const qCount = (n) => arCount(n, { one: 'سؤال واحد', two: 'سؤالان', few: 'أسئلة', many: 'سؤالاً' });
  const chCount = (n) => arCount(n, { one: 'جابتر واحد', two: 'جابترين', few: 'جابترات', many: 'جابتراً' });
  const savedCount = (n) => (n === 1 ? 'سؤال واحد محفوظ'
    : n === 2 ? 'سؤالان محفوظان'
      : n >= 3 && n <= 10 ? n + ' أسئلة محفوظة'
        : n + ' سؤالاً محفوظاً');
  // The league talks in correct answers, not an abstract currency.
  const ansCount = (n) => (n === 1 ? 'إجابة واحدة' : n === 2 ? 'إجابتان'
    : n >= 3 && n <= 10 ? n + ' إجابات' : n + ' إجابة');
  const accuracyOf = (r) => (r && r.answered > 0 ? Math.round((r.xp / r.answered) * 100) : null);

  function dbg(...args) {
    if (!DEBUG) return;
    const el = $('debug-output');
    if (el) el.textContent += args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
    console.log('[portal-debug]', ...args);
  }

  function toast(msg, kind) {
    const region = $('toast-region');
    if (!region) return;
    region.innerHTML = ''; // single-toast policy: replace, never stack
    const type = kind === 'error' || kind === 'success' ? kind : 'info';
    const t = document.createElement('div');
    t.className = 'portal-toast toast-' + type;
    const icon = type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle-2' : 'info');
    t.innerHTML = '<i data-lucide="' + icon + '" class="toast-icon" aria-hidden="true"></i><span></span>';
    t.querySelector('span').textContent = msg;
    t.setAttribute('role', type === 'error' ? 'alert' : 'status');
    region.appendChild(t);
    try { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); } catch (e) {}
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => { if (t.parentNode === region) region.innerHTML = ''; }, 260); }, 2800);
    try { if (window.PortalLog) window.PortalLog.info('toast', msg); } catch (e) {}
  }

  function icons() {
    if (window.lucide && window.lucide.createIcons) {
      try { window.lucide.createIcons(); } catch (e) { /* icons optional */ }
    }
  }

  // ---------------- state ----------------
  const S = {
    index: null,
    banks: {},          // quiz_id -> bank json
    subjectFilter: null,   // subject_id — always selected, no "all"
    chapterFilter: null,   // chapter_no — always selected, no "all"
    lang: 'ar',         // 'ar' | 'en' | 'both'
    sound: true,
    session: null,      // {sub, ch, title, chapterLabel, questions, picks, dwells, idx, hash, finished, ..., replay}
    saved: {},          // saveKey -> {origin, snapshot, savedAt}
    history: [],        // [{t, subjectId, subjectTitle, chapterNo, chapterLabel, quizId, topic, correct, total, pct, secs, kind}]
    savedChapterOpen: null, // open chapter in saved view
    savedSubject: null, // saved-view filter
    savedChapter: null, // saved-view filter
    savedExpanded: null, // saved-view accordion
    leagueSubject: null, // league filter: null = overall
    cloudName: null, // linked Telegram account display name
  };

  const SAVED_KEY = 'portal_saved_v1';
  const HISTORY_KEY = 'portal_history_v1';
  const UI_KEY = 'portal_ui_v1';
  const TOUR_KEY = 'portal_tour_done';
  const QUIZ_HINT_KEY = 'portal_quiz_hint';

  function saveUI() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        subject: S.subjectFilter, chapter: S.chapterFilter,
        savedSubject: S.savedSubject, savedChapter: S.savedChapter, savedChapterOpen: null, savedExpanded: S.savedExpanded,
        lang: S.lang,
      }));
    } catch (e) {}
  }
  function loadUI() {
    try {
      const u = JSON.parse(localStorage.getItem(UI_KEY) || 'null');
      if (!u) return;
      if (u.subject) S.subjectFilter = u.subject;
      if (u.chapter) S.chapterFilter = u.chapter;
      if (u.savedSubject) S.savedSubject = u.savedSubject;
    if (u.savedExpanded) S.savedExpanded = u.savedExpanded;
      if (u.savedChapter) S.savedChapter = u.savedChapter;
      if (u.lang === 'ar' || u.lang === 'en' || u.lang === 'both') S.lang = u.lang;
    } catch (e) {}
  }

  function loadSaved() {
    try { S.saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}; }
    catch (e) { S.saved = {}; }
    try { S.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') || []; }
    catch (e) { S.history = []; }
    if (!Array.isArray(S.history)) S.history = [];
  }
  try { loadSaved(); } catch (e) {}
  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(S.saved)); } catch (e) {}
    cloudPush();
  }
  function saveKeyOf(origin, qid) { return origin.subjectId + '|' + origin.quizId + '|' + qid; }

  const VIEWS = ['deck-catalog', 'quiz-loading', 'quiz-error', 'quiz-start-view', 'quiz-view',
    'results-view', 'saved-view', 'stats-view', 'league-view'];
  function show(viewId) {
    VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== viewId));
    const inQuiz = viewId === 'quiz-start-view' || viewId === 'quiz-view';
    $('quiz-session-topbar').style.display = (inQuiz || viewId === 'results-view') ? 'block' : 'none';
    const catalogViews = ['deck-catalog', 'saved-view', 'stats-view', 'league-view'];
    $('header-catalog-view').style.display = catalogViews.includes(viewId) ? 'flex' : 'none';
    $('header-session-view').style.display = catalogViews.includes(viewId) ? 'none' : 'flex';
    document.body.dataset.quizlive = (inQuiz && S.session && !S.session.finished) ? 'yes' : 'no';
    closeDrawers();
    icons();
  }

  // ---------------- audio ----------------
  const sounds = {};
  function playSound(name) {
    if (!S.sound) return;
    try {
      if (!sounds[name]) sounds[name] = new Audio('sounds/' + name + '.mp3');
      sounds[name].currentTime = 0;
      sounds[name].play().catch(() => {});
    } catch (e) { /* audio optional */ }
  }

  // ---------------- data ----------------
  async function loadData() {
    const t0 = performance.now();
    const idx = await (await fetch('data/index.json', { cache: 'no-store' })).json();
    S.index = idx;
    const jobs = [];
    idx.subjects.forEach((sub) => sub.chapters.forEach((ch) => {
      jobs.push(fetch('data/' + ch.bank, { cache: 'no-store' }).then((r) => r.json()).then((bank) => {
        const errs = validateBank(bank);
        if (errs.length) throw new Error(ch.bank + ': ' + errs.join('; '));
        S.banks[ch.quiz_id] = bank;
      }));
    }));
    await Promise.all(jobs);
    dbg('data loaded in ms:', Math.round(performance.now() - t0), 'banks:', Object.keys(S.banks));
    if (DEBUG) $('debug-panel').classList.remove('hidden');
  }

  function validateBank(b) {
    const errs = [];
    if (!Array.isArray(b.questions) || b.questions.length === 0) errs.push('no questions');
    (b.questions || []).forEach((q) => {
      if (!(q.options && q.options_ar && q.options_en) || q.options.length !== 4 || q.options_ar.length !== 4 || q.options_en.length !== 4) errs.push(q.id + ':optlen');
      if ('ABCD'[q.correct] !== q.answer) errs.push(q.id + ':keysync');
      if (!q.explanation) errs.push(q.id + ':noexpl');
    });
    return errs;
  }

  // ---------------- catalog ----------------
  function bestKey(quizId) { return 'portal_best_' + quizId; }
  function getBest(quizId) {
    try { return JSON.parse(localStorage.getItem(bestKey(quizId)) || 'null'); } catch (e) { return null; }
  }
  function setBest(quizId, pct, frac) {
    try {
      const prev = getBest(quizId);
      if (!prev || pct > prev.pct) localStorage.setItem(bestKey(quizId), JSON.stringify({ pct: pct, frac: frac }));
    } catch (e) { /* storage optional */ }
    cloudPush();
  }
  function cloudPush() {
    try {
      if (window.PortalCloud && window.PortalCloud.configured() && window.PortalCloud.linked()) {
        window.PortalCloud.pushSoon();
      }
      updateAccountRow();
    } catch (e) {}
  }

  function chLabel(ch) { return 'جابتر ' + ch.chapter_no; }

  function currentSubject() {
    if (S.index && Array.isArray(S.index.subjects) && S.index.subjects.some((s) => s.subject_id === S.subjectFilter)) {
      return S.index.subjects.find((s) => s.subject_id === S.subjectFilter);
    }
    return (S.index && Array.isArray(S.index.subjects) && S.index.subjects.length) ? S.index.subjects[0] : null;
  }

  function currentChapter(sub) {
    sub = sub || currentSubject();
    if (!sub || !Array.isArray(sub.chapters) || !sub.chapters.length) return null;
    if (sub.chapters.some((c) => c.chapter_no === S.chapterFilter)) {
      return sub.chapters.find((c) => c.chapter_no === S.chapterFilter);
    }
    return sub.chapters[0];
  }

  function renderSubjectChips() {
    const bar = $('subject-filter-bar');
    bar.innerHTML = '';
    const subjects = (S.index && Array.isArray(S.index.subjects)) ? S.index.subjects : [];
    if (!subjects.length) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    if (!S.subjectFilter || !subjects.some((s) => s.subject_id === S.subjectFilter)) {
      S.subjectFilter = subjects[0].subject_id;
      S.chapterFilter = null;
    }
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.className = 'filter-chip' + (S.subjectFilter === id ? ' active' : '');
      b.dataset.subject = id;
      b.textContent = label;
      b.setAttribute('aria-pressed', S.subjectFilter === id ? 'true' : 'false');
      b.addEventListener('click', () => {
        S.subjectFilter = id;
        S.chapterFilter = null;
        saveUI();
        renderSubjectChips(); renderChapterChips(); renderCatalog();
      });
      return b;
    };
    subjects.forEach((s) => bar.appendChild(mk(s.subject_id, s.subject_title)));
  }
  function visibleChapters() {
    const sub = currentSubject();
    const ch = currentChapter(sub);
    if (!sub || !ch) return [];
    return sub.chapters
      .filter((c) => c.chapter_no === ch.chapter_no)
      .map((c2) => ({ sub: sub, ch: c2 }));
  }

  function filterBarLabel(text) {
    const lab = document.createElement('span');
    lab.className = 'filter-bar-label';
    lab.textContent = text;
    return lab;
  }

  function renderChapterChips() {
    const bar = $('chapter-filter-bar');
    const sub = currentSubject();
    if (!sub || !Array.isArray(sub.chapters) || !sub.chapters.length) {
      if (bar) { bar.innerHTML = ''; bar.style.display = 'none'; }
      return;
    }
    if (!S.chapterFilter || !sub.chapters.some((c) => c.chapter_no === S.chapterFilter)) {
      S.chapterFilter = sub.chapters[0].chapter_no;
    }
    bar.innerHTML = '';
    if (sub.chapters.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.appendChild(filterBarLabel('جابتر'));
    sub.chapters.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'filter-chip chapter-chip' + (S.chapterFilter === c.chapter_no ? ' active' : '');
      b.textContent = c.chapter_no;
      b.setAttribute('aria-label', chLabel(c));
      b.title = chLabel(c);
      b.setAttribute('aria-pressed', S.chapterFilter === c.chapter_no ? 'true' : 'false');
      b.addEventListener('click', () => { S.chapterFilter = c.chapter_no; saveUI(); renderChapterChips(); renderCatalog(); });
      bar.appendChild(b);
    });
    const active = bar.querySelector('.filter-chip.active');
    if (active) { try { active.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {} }
  }

  function renderCatalog() {
    const box = $('catalog-cards-container');
    box.innerHTML = '';
    let count = 0;
    visibleChapters().forEach(({ sub, ch }) => {
      const bank = S.banks[ch.quiz_id];
      if (!bank) return;
      count++;
      const best = getBest(ch.quiz_id);
      const row = document.createElement('div');
      row.className = 'sketch-row';
      row.innerHTML =
        '<button type="button" class="sketch-cell sketch-info-cell row-info-cell" aria-label="تفاصيل الكويز">' +
          '<i data-lucide="info"></i></button>' +
        '<a href="#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id) + '" class="sketch-cell sketch-content-cell">' +
          '<div class="sketch-title-ltr">' + escapeHtml(bank.topic) + '</div>' +
          '<div class="sketch-meta-line"><span class="sketch-subject-tag">' + escapeHtml(sub.subject_title) + '</span>' +
          '<span class="sketch-meta-dot">·</span><span class="sketch-sem-tag">' + escapeHtml(chLabel(ch)) + '</span>' +
          '<span class="sketch-meta-dot">·</span><span class="sketch-count-tag">' + qCount(bank.questions.length) + '</span>' +
          (best ? '<span class="sketch-meta-dot">·</span><span class="sketch-score-label">' + Math.round(best.pct) + '%</span>' : '') +
          '</div></a>' +
        '<a href="#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id) + '" class="sketch-cell sketch-play-cell" aria-label="بدء الكويز مباشرة"><i data-lucide="play"></i></a>';
      row.querySelector('.row-info-cell').addEventListener('click', () => openInfo(sub, ch, bank));
      box.appendChild(row);
    });
    $('catalog-empty-state').classList.toggle('hidden', count !== 0);
    icons();
  }

  // ---------------- drawers ----------------
  function openDrawer(id) { $(id).classList.add('open'); $(id).setAttribute('aria-hidden', 'false'); $('drawer-overlay').classList.add('active'); $('drawer-overlay').setAttribute('aria-hidden', 'false'); }
  function closeDrawers() {
    document.querySelectorAll('.drawer.open').forEach((d) => { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); });
    $('drawer-overlay').classList.remove('active'); $('drawer-overlay').setAttribute('aria-hidden', 'true');
  }

  function openInfo(sub, ch, bank) {
    $('info-sheet-topic').textContent = bank.topic;
    $('info-sheet-list').innerHTML =
      '<li><strong>المادة:</strong> ' + escapeHtml(sub.subject_title) + '</li>' +
      '<li><strong>الجابتر:</strong> ' + escapeHtml(chLabel(ch)) + '</li>' +
      '<li><strong>الأسئلة:</strong> ' + bank.questions.length + '</li>' +
      (best_text(ch.quiz_id));
    const startBtn = $('info-sheet-start');
    if (startBtn) startBtn.setAttribute('href', '#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id));
    openDrawer('quiz-info-drawer');
    icons();
  }
  function best_text(quizId) {
    const b = getBest(quizId);
    return b ? '<li><strong>أفضل نتيجة:</strong> ' + Math.round(b.pct) + '% (' + escapeHtml(b.frac) + ')</li>' : '';
  }

  // ---------------- quiz session ----------------
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function originOf(sub, ch, bank) {
    return {
      subjectId: sub.subject_id, subjectTitle: sub.subject_title,
      chapterNo: ch.chapter_no, quizId: ch.quiz_id, topic: bank ? bank.topic : '',
    };
  }

  function preparePool(pool) {
    shuffle(pool);
    // Always shuffle options; remap correct (fixes positional bias).
    pool.forEach((q) => {
      const order = shuffle([0, 1, 2, 3]);
      q.options = order.map((i) => q.options[i]);
      q.options_ar = order.map((i) => q.options_ar[i]);
      q.options_en = order.map((i) => q.options_en[i]);
      q.correct = order.indexOf(q.correct);
    });
    return pool;
  }

  function launchSession(pool, meta) {
    // meta: {subjectId, subjectTitle, chapterNo, chapterLabel?, topic, quizId|null, retryWrong, replay}
    preparePool(pool);
    S.session = {
      sub: { subject_id: meta.subjectId, subject_title: meta.subjectTitle },
      ch: { chapter_no: meta.chapterNo, quiz_id: meta.quizId },
      title: meta.topic,
      chapterLabel: meta.chapterLabel || chLabel({ chapter_no: meta.chapterNo }),
      questions: pool,
      picks: new Array(pool.length).fill(null),
      dwells: new Array(pool.length).fill(0),
      idx: 0, maxIdx: 0, retryWrong: !!meta.retryWrong,
      replay: meta.replay || null,
      hash: location.hash, finished: false, started: false,
      startEpoch: Date.now(), pauseAccum: 0, pauseStart: null,
      qStart: Date.now(), timerId: null,
    };

    $('quiz-subtitle').textContent = meta.subjectTitle + ' · ' + (meta.chapterLabel || chLabel({ chapter_no: meta.chapterNo }));
    $('quiz-title').textContent = meta.topic;
    $('start-subject-badge').textContent = meta.subjectTitle + ' · ' + (meta.chapterLabel || chLabel({ chapter_no: meta.chapterNo }));
    $('start-quiz-title').textContent = meta.topic;
    $('start-questions-count').textContent = qCount(pool.length);
    $('start-estimated-time').textContent = Math.max(1, Math.round(pool.length * 1.5)) + ' دقيقة';
    $('question-total-label').textContent = pool.length;
    $('live-feedback-box').classList.add('hidden');
    updateSaveBtn();
    show('quiz-start-view');
    dbg('session start:', meta.quizId, 'n=', pool.length, 'retryWrong=', !!meta.retryWrong);
  }

  function startSession(subjectId, quizId, wrongOnlyFrom) {
    const sub = (S.index.subjects || []).find((s) => s.subject_id === subjectId);
    const ch = sub && (sub.chapters || []).find((c) => c.quiz_id === quizId);
    const bank = S.banks[quizId];
    if (!sub || !ch || !bank) { showError('لم يتم العثور على الكوز المطلوب.'); return; }

    let pool = bank.questions.map((q) => {
      const c = JSON.parse(JSON.stringify(q));
      c.origin = originOf(sub, ch, bank);
      return c;
    });
    let retryWrong = false;
    if (wrongOnlyFrom) {
      const sub2 = window.PortalAnalytics.buildWrongOnly(wrongOnlyFrom.questions, wrongOnlyFrom.picks);
      if (!sub2) { toast('لا توجد أخطاء لإعادتها — أحسنت!'); return; }
      pool = sub2; retryWrong = true;
    }
    const origin = originOf(sub, ch, bank);
    launchSession(pool, {
      subjectId: sub.subject_id, subjectTitle: sub.subject_title,
      chapterNo: ch.chapter_no, topic: bank.topic, quizId: ch.quiz_id,
      retryWrong: retryWrong, replay: { type: 'bank', subjectId: sub.subject_id, quizId: ch.quiz_id },
    });
  }

  // Practice session built from saved-question snapshots (device-local).
  function startSavedPractice(items, title, chapterLabel) {
    if (!items.length) return;
    const pool = items.map((it) => JSON.parse(JSON.stringify(it.snapshot)));
    const first = items[0].origin;
    launchSession(pool, {
      subjectId: first.subjectId, subjectTitle: first.subjectTitle,
      chapterNo: first.chapterNo, chapterLabel: chapterLabel,
      topic: title,
      quizId: null, retryWrong: false,
      replay: { type: 'saved', keys: items.map((it) => it.key) },
    });
    S.session.hash = '#/practice';
    if (location.hash !== '#/practice') location.hash = '#/practice';
  }

  // ---------------- saved questions (device-local) ----------------
  function currentSaveKey() {
    const ses = S.session;
    if (!ses || !ses.questions[ses.idx] || !ses.questions[ses.idx].origin) return null;
    const q = ses.questions[ses.idx];
    return saveKeyOf(q.origin, q.id);
  }

  function updateSaveBtn() {
    const btn = $('btn-save-question');
    if (!btn) return;
    const key = currentSaveKey();
    btn.classList.toggle('is-saved', !!key && !!S.saved[key]);
    btn.setAttribute('aria-pressed', !!key && !!S.saved[key] ? 'true' : 'false');
  }

  function toggleSaveCurrent() {
    const ses = S.session;
    if (!ses) return;
    const q = ses.questions[ses.idx];
    if (!q || !q.origin) return;
    const key = saveKeyOf(q.origin, q.id);
    if (S.saved[key]) {
      delete S.saved[key];
      toast('أُزيل من المحفوظ');
    } else {
      S.saved[key] = { origin: q.origin, snapshot: JSON.parse(JSON.stringify(q)), savedAt: Date.now() };
      toast('حُفظ السؤال');
    }
    persistSaved();
    updateSaveBtn();
    updateSavedBadge();
  }

  function updateSavedBadge() {
    const b = $('saved-count-badge');
    if (!b) return;
    const n = Object.keys(S.saved).length;
    b.textContent = n;
    b.classList.toggle('hidden', n === 0);
    updateMenuCounts();
  }

  function savedGroups() {
    // [{subjectId, subjectTitle, chapters: [{chapterNo, topic, items: [{key, origin, snapshot}]}]}]
    const bySub = {};
    Object.keys(S.saved).forEach((key) => {
      const it = S.saved[key];
      const o = it.origin;
      bySub[o.subjectId] = bySub[o.subjectId] || { subjectId: o.subjectId, subjectTitle: o.subjectTitle, chapters: {} };
      const ch = bySub[o.subjectId].chapters[o.chapterNo] = bySub[o.subjectId].chapters[o.chapterNo] || { chapterNo: o.chapterNo, topic: o.topic, items: [] };
      ch.items.push({ key: key, origin: o, snapshot: it.snapshot });
    });
    return Object.keys(bySub).map((sid) => ({
      subjectId: sid, subjectTitle: bySub[sid].subjectTitle,
      chapters: Object.keys(bySub[sid].chapters).map(Number).sort((a, b) => a - b).map((n) => bySub[sid].chapters[n]),
    }));
  }

  function renderSaved() {
    try {
      const sv = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
      if (sv && typeof sv === 'object') S.saved = sv;
    } catch (e) {}
    const box = $('saved-groups');
    box.innerHTML = '';
    const groups = savedGroups();
    let total = 0;
    groups.forEach((g) => g.chapters.forEach((c) => { total += c.items.length; }));
    $('saved-total-line').textContent = total === 0 ? '' :
      savedCount(total) + ' في ' + arCount(groups.length, { one: 'مادة واحدة', two: 'مادتين', few: 'مواد', many: 'مادة' });
    $('saved-empty-state').classList.toggle('hidden', total !== 0);

    // Filter bars (same pattern as catalog): subject chips, then chapter chips. No "all".
    const subBar = $('saved-subject-bar');
    const chBar = $('saved-chapter-bar');
    if (total === 0) {
      if (subBar) { subBar.innerHTML = ''; subBar.style.display = 'none'; }
      if (chBar) { chBar.innerHTML = ''; chBar.style.display = 'none'; }
      icons();
      return;
    }
    if (subBar) subBar.style.display = '';
    if (!S.savedSubject || !groups.some((g) => g.subjectId === S.savedSubject)) {
      S.savedSubject = groups[0].subjectId;
      S.savedChapter = null;
    }
    const sub = groups.find((g) => g.subjectId === S.savedSubject) || groups[0];
    if (subBar) {
      subBar.innerHTML = '';
      groups.forEach((g) => {
        const n = g.chapters.reduce((a, c) => a + c.items.length, 0);
        const b = document.createElement('button');
        b.className = 'filter-chip' + (S.savedSubject === g.subjectId ? ' active' : '');
        b.textContent = g.subjectTitle + ' (' + n + ')';
        b.setAttribute('aria-pressed', S.savedSubject === g.subjectId ? 'true' : 'false');
        b.addEventListener('click', () => { S.savedSubject = g.subjectId; S.savedChapter = null; saveUI(); renderSaved(); });
        subBar.appendChild(b);
      });
    }
    const chNos = sub.chapters.map((c) => c.chapterNo);
    if (!S.savedChapter || !chNos.includes(S.savedChapter)) S.savedChapter = chNos[0];
    const expanded = true; // subject block always open; chapters collapse individually
    if (chBar) {
      chBar.innerHTML = '';
      if (!expanded || chNos.length <= 1) { chBar.style.display = 'none'; }
      else {
        chBar.style.display = '';
        chBar.appendChild(filterBarLabel('جابتر'));
        chNos.forEach((n) => {
          const b = document.createElement('button');
          b.className = 'filter-chip chapter-chip' + (S.savedChapter === n ? ' active' : '');
          b.textContent = n;
          b.setAttribute('aria-label', 'جابتر ' + n);
          b.title = 'جابتر ' + n;
          b.setAttribute('aria-pressed', S.savedChapter === n ? 'true' : 'false');
          b.addEventListener('click', () => { S.savedChapter = n; S.savedChapterOpen = null; saveUI(); renderSaved(); });
          chBar.appendChild(b);
        });
        const act = chBar.querySelector('.filter-chip.active');
        if (act) { try { act.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {} }
      }
    }

    const letters = S.lang === 'ar' ? ['أ', 'ب', 'ج', 'د'] : ['A', 'B', 'C', 'D'];
    // Subject-level block: title + whole-subject test generation
    const subAll = [];
    sub.chapters.forEach((c) => c.items.forEach((it) => subAll.push(it)));
    const subWrap = document.createElement('div');
    subWrap.className = 'saved-group saved-subject-block';
    const subHead = document.createElement('div');
    subHead.className = 'saved-group-head';
    const subTitle = document.createElement('div');
    subTitle.innerHTML = '<div class="saved-group-title">' + escapeHtml(sub.subjectTitle) +
      '</div><div class="saved-group-sub">' + savedCount(subAll.length) + '</div>';
    subHead.appendChild(subTitle);
    const genSub = document.createElement('button');
    genSub.type = 'button';
    genSub.className = 'action-btn secondary-btn saved-gen-btn';
    genSub.innerHTML = '<i data-lucide="layers"></i><span>اختبار المادة</span>';
    genSub.setAttribute('aria-label', 'توليد اختبار من كل محفوظ ' + sub.subjectTitle);
    genSub.addEventListener('click', () => startSavedPractice(
      subAll,
      'اختبار محفوظ ' + sub.subjectTitle,
      'اختبار شامل (' + subAll.length + ' أسئلة)'
    ));
    subHead.appendChild(genSub);
    subWrap.appendChild(subHead);
    box.appendChild(subWrap);


    // Selected chapter block: items + chapter-only test generation
    const c = sub.chapters.find((x) => x.chapterNo === S.savedChapter) || sub.chapters[0];
    const wrap = document.createElement('div');
    wrap.className = 'saved-group';
    const head = document.createElement('div');
    head.className = 'saved-group-head';
    head.innerHTML = '<div><div class="saved-group-title">' + escapeHtml('جابتر ' + c.chapterNo) +
      '</div><div class="saved-group-sub">' + qCount(c.items.length) + '</div></div>';
    const train = document.createElement('button');
    train.type = 'button';
    train.className = 'action-btn secondary-btn saved-train-btn';
    train.innerHTML = '<i data-lucide="play"></i><span>اختبار</span>';
    train.setAttribute('aria-label', 'توليد اختبار لجابتر ' + c.chapterNo);
    train.addEventListener('click', () => startSavedPractice(
      c.items,
      'اختبار محفوظ ' + sub.subjectTitle + ' ' + 'جابتر ' + c.chapterNo,
      'جابتر ' + c.chapterNo + ' (' + c.items.length + ' أسئلة)'
    ));
    head.appendChild(train);
    const chExp = document.createElement('button');
    chExp.type = 'button';
    chExp.className = 'icon-btn saved-expand-btn' + (S.savedChapterOpen === c.chapterNo ? ' open' : '');
    chExp.setAttribute('aria-label', 'فتح أو طي أسئلة الجابتر');
    chExp.setAttribute('aria-expanded', S.savedChapterOpen === c.chapterNo ? 'true' : 'false');
    chExp.innerHTML = '<i data-lucide="chevron-down"></i>';
    chExp.addEventListener('click', () => {
      S.savedChapterOpen = S.savedChapterOpen === c.chapterNo ? null : c.chapterNo;
      saveUI();
      renderSaved();
    });
    head.appendChild(chExp);
    wrap.appendChild(head);
    if (S.savedChapterOpen !== c.chapterNo) { box.appendChild(wrap); icons(); return; }
    c.items.forEach((it) => {
      const q = it.snapshot;
      const card = document.createElement('div');
      card.className = 'review-card correct-border saved-card';
      stemPair(q).forEach((sp, si) => {
        const stem = document.createElement('p');
        stem.className = 'review-question-text' + (si > 0 ? ' review-question-text-sub' : '');
        stem.textContent = sp.t;
        stem.setAttribute('dir', 'auto');
        card.appendChild(stem);
      });
      const optionsList = document.createElement('div');
      optionsList.className = 'review-options-list';
      for (let oi = 0; oi < 4; oi++) {
        if (oi !== q.correct) continue;
        const pair = optsPair(q, oi);
        const item = document.createElement('div');
        item.className = 'review-option-item correct-answer';
        item.setAttribute('dir', 'auto');
        const li = lettersFor(pair[0].lang);
        item.innerHTML = '<span class="review-option-indicator">' + li[oi] +
          '</span><span class="review-option-text">' + pair.map((p) => '<span class="opt-line opt-' + p.lang + '">' + escapeHtml(p.t) + '</span>').join('') + '</span>';
        optionsList.appendChild(item);
      }
      card.appendChild(optionsList);
      const expl = explText(q);
      if (expl) {
        const exp = document.createElement('div');
        exp.className = 'review-explanation-box';
        exp.setAttribute('dir', 'auto');
        exp.innerHTML = '<strong>الشرح</strong><span>' + escapeHtml(expl) + '</span>';
        card.appendChild(exp);
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'action-btn secondary-btn saved-remove-btn';
      rm.innerHTML = '<i data-lucide="trash-2"></i><span>إزالة</span>';
      rm.setAttribute('aria-label', 'إزالة السؤال من المحفوظ');
      rm.addEventListener('click', () => {
        delete S.saved[it.key];
        if (Object.keys(S.saved).length === 0) { S.savedSubject = null; S.savedChapter = null; }
        persistSaved(); updateSavedBadge(); renderSaved(); icons();
        toast('أُزيل من المحفوظ');
      });
      card.appendChild(rm);
      wrap.appendChild(card);
    });
    box.appendChild(wrap);
    icons();
  }

  function beginAnswering() {
    const ses = S.session;
    ses.started = true;
    show('quiz-view');
    updateSaveBtn();
    maybeQuizHint();
    tourNotify('start');
    ses.startEpoch = Date.now(); ses.pauseAccum = 0; ses.pauseStart = null;
    ses.qStart = Date.now();
    clearInterval(ses.timerId);
    ses.timerId = setInterval(tickTimer, 500);
    renderQuestion();
    renderMatrix();
    icons();
  }

  function elapsedSec() {
    const ses = S.session;
    let extra = ses.pauseAccum;
    if (ses.pauseStart) extra += Date.now() - ses.pauseStart;
    return Math.max(0, (Date.now() - ses.startEpoch - extra) / 1000);
  }

  function tickTimer() {
    const ses = S.session;
    if (!ses || ses.pauseStart) return;
    const s = Math.floor(elapsedSec());
    $('session-timer').textContent = window.PortalAnalytics.fmtClock(s);
  }

  function qText(q) { return S.lang === 'en' ? (q.question_en || q.question) : (q.question_ar || q.question); }
  function qOpts(q) { return S.lang === 'en' ? (q.options_en || q.options) : (q.options_ar || q.options); }
  function qLetters() { return S.lang === 'en' ? ['A', 'B', 'C', 'D'] : ['أ', 'ب', 'ج', 'د']; }

  // Bilingual pairs for 'both' mode: [{t, lang}] — primary first.
  function stemPair(q) {
    const ar = q.question_ar || q.question;
    const en = q.question_en || q.question;
    if (S.lang === 'en') return [{ t: en, lang: 'en' }];
    if (S.lang === 'both' && en !== ar) return [{ t: ar, lang: 'ar' }, { t: en, lang: 'en' }];
    return [{ t: ar, lang: 'ar' }];
  }
  function optsPair(q, i) {
    const ar = (q.options_ar || q.options)[i];
    const en = (q.options_en || q.options)[i];
    if (S.lang === 'en') return [{ t: en, lang: 'en' }];
    if (S.lang === 'both' && en !== ar) return [{ t: ar, lang: 'ar' }, { t: en, lang: 'en' }];
    return [{ t: ar, lang: 'ar' }];
  }
  function explText(q) { return q.explanation_ar || q.explanation || q.explanation_en || ''; }
  function lettersFor(lang) { return lang === 'en' ? ['A', 'B', 'C', 'D'] : ['أ', 'ب', 'ج', 'د']; }

  function renderQuestion() {
    const ses = S.session;
    const q = ses.questions[ses.idx];
    const letters = qLetters();
    $('question-index-label').textContent = ses.idx + 1;
    $('progress-bar-fill').style.width = (ses.idx / ses.questions.length) * 100 + '%';
    const stems = stemPair(q);
    const qEl = $('question-text');
    qEl.textContent = stems[0].t;
    qEl.setAttribute('dir', 'auto');
    const qEl2 = $('question-text-2');
    if (stems[1]) {
      qEl2.textContent = stems[1].t;
      qEl2.setAttribute('dir', 'auto');
      qEl2.classList.remove('hidden');
    } else {
      qEl2.classList.add('hidden');
    }
    const box = $('options-container');
    box.innerHTML = '';
    const locked = ses.picks[ses.idx] !== null;
    box.classList.toggle('locked', locked);
    for (let i = 0; i < 4; i++) {
      const pair = optsPair(q, i);
      const isSelected = ses.picks[ses.idx] === i;
      const isCorrectOpt = q.correct === i;
      let tileClass = 'option-tile';
      if (locked) {
        if (isSelected) tileClass += (i === q.correct) ? ' correct-answer' : ' user-wrong';
        else if (isCorrectOpt) tileClass += ' correct-answer';
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = tileClass;
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      btn.setAttribute('data-option-index', i);
      btn.setAttribute('dir', 'auto');
      const letter = document.createElement('div');
      letter.className = 'option-letter';
      letter.textContent = letters[i];
      const content = document.createElement('div');
      content.className = 'option-content';
      content.setAttribute('dir', 'auto');
      content.innerHTML = pair.map((p) => '<span class="opt-line opt-' + p.lang + '">' + escapeHtml(p.t) + '</span>').join('');
      btn.appendChild(letter);
      btn.appendChild(content);
      if (!locked) btn.addEventListener('click', () => pickOption(i));
      box.appendChild(btn);
    }
    const showExpl = locked && ses.picks[ses.idx] !== q.correct;
    $('live-feedback-box').classList.toggle('hidden', !showExpl);
    if (showExpl) {
      $('live-explanation-text').textContent = explText(q);
      $('live-explanation-text').setAttribute('dir', 'auto');
    }
    if (ses.idx === ses.questions.length - 1) {
      $('next-btn-text').textContent = 'إنهاء الكوز';
      $('next-btn-icon').setAttribute('data-lucide', 'check-circle');
    } else {
      $('next-btn-text').textContent = 'التالي';
      $('next-btn-icon').setAttribute('data-lucide', 'arrow-left');
    }
    updateSaveBtn();
    icons();
  }

  function pickOption(i) {
    const ses = S.session;
    if (ses.picks[ses.idx] !== null || ses.pauseStart) return;
    ses.picks[ses.idx] = i;
    ses.dwells[ses.idx] = (Date.now() - ses.qStart) / 1000;
    tourNotify('answer');
    const q = ses.questions[ses.idx];
    if (i === q.correct) playSound('correct'); else playSound('wrong');
    renderQuestion();
    renderMatrix();
  }

  function advanceTo(i) {
    const ses = S.session;
    ses.idx = i;
    ses.maxIdx = Math.max(ses.maxIdx, i);
    ses.qStart = Date.now();
    renderQuestion();
    renderMatrix();
  }

  function nextQuestion() {
    const ses = S.session;
    if (ses.pauseStart) { toast('الكوز متوقف مؤقتاً — اضغط استئناف للمتابعة'); return; }
    if (ses.picks[ses.idx] === null) { toast('اختر إجابة أولاً', 'error'); return; }
    if (ses.idx < ses.questions.length - 1) {
      advanceTo(ses.idx + 1);
    } else {
      finishQuiz();
    }
  }

  function renderMatrix() {
    const ses = S.session;
    if (!ses || ses.finished) return;
    const grid = $('matrix-grid');
    grid.innerHTML = '';
    ses.questions.forEach((q, i) => {
      const c = document.createElement('button');
      c.type = 'button';
      let cls = 'matrix-cell';
      const picked = ses.picks[i];
      if (picked !== null && picked !== undefined) {
        cls += (picked === q.correct) ? ' answered-correct' : ' answered-wrong';
      } else if (i < ses.maxIdx) {
        cls += ' seen-skipped';
      }
      if (i === ses.idx) cls += ' current';
      c.className = cls;
      c.textContent = i + 1;
      c.setAttribute('aria-label', 'السؤال ' + (i + 1));
      c.addEventListener('click', () => {
        if (ses.pauseStart) { toast('الكوز متوقف مؤقتاً — اضغط استئناف للمتابعة'); return; }
        if (i > ses.maxIdx) { toast('أجب بالترتيب — لا يمكن القفز للأمام'); return; }
        ses.idx = i; ses.qStart = Date.now(); renderQuestion(); renderMatrix(); closeDrawers();
      });
      grid.appendChild(c);
    });
  }

  function finishQuiz() {
    const ses = S.session;
    clearInterval(ses.timerId);
    $('progress-bar-fill').style.width = '100%';
    const res = window.PortalAnalytics.analyze(ses.questions, ses.picks, ses.dwells, elapsedSec());
    playSound(res.pct >= 60 ? 'completed' : 'fail');
    if (ses.ch.quiz_id) setBest(ses.ch.quiz_id, res.pct, res.correct + ' / ' + res.total);
    ses.finished = true;
    recordHistory(ses, res);
    renderResults(res);
    show('results-view');
    window.scrollTo(0, 0);
    dbg('result:', res);
  }

  function recordHistory(ses, res) {
    try {
      S.history.push({
        t: Date.now(),
        subjectId: ses.sub.subject_id, subjectTitle: ses.sub.subject_title,
        chapterNo: ses.ch.chapter_no, chapterLabel: ses.chapterLabel || '',
        quizId: ses.ch.quiz_id, topic: ses.title,
        correct: res.correct, total: res.total, pct: res.pct,
        secs: res.totalTimeSec,
        kind: ses.ch.quizId ? 'bank' : (ses.replay && ses.replay.type === 'saved' ? 'saved' : 'bank'),
      });
      while (S.history.length > 200) S.history.shift();
      localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history));
    } catch (e) {}
    cloudPush();
    try {
      if (window.PortalLeague && window.PortalLeague.linked && window.PortalLeague.linked()) {
        window.PortalLeague.syncWeek().catch(function () {});
      }
    } catch (e) {}
  }

  function clearHistory() {
    S.history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
  }

  function pctClass(p) { return p >= 75 ? 'good' : (p >= 60 ? 'mid' : 'bad'); }
  function fmtDate(t) {
    try { return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(t)); }
    catch (e) { return ''; }
  }
  function fmtDur(s) {
    s = Math.round(Number(s) || 0);
    const m = Math.floor(s / 60);
    return m > 0 ? m + ' د ' + (s % 60) + ' ث' : s + ' ث';
  }
  function collectBests() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('portal_best_') === 0) out[k] = JSON.parse(localStorage.getItem(k));
      }
    } catch (e) {}
    return out;
  }

  function renderStats() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (Array.isArray(h)) S.history = h;
    } catch (e) {}
    const H = S.history;
    const n = H.length;
    const totQ = H.reduce((a, h) => a + (h.correct || 0), 0);
    const totTried = H.reduce((a, h) => a + (h.total || 0), 0);
    const totSecs = H.reduce((a, h) => a + (h.secs || 0), 0);
    const avg = n ? H.reduce((a, h) => a + (h.pct || 0), 0) / n : 0;
    const best = n ? Math.max.apply(null, H.map((h) => h.pct || 0)) : 0;
    // The figures below carry the same facts; no duplicate one-line summary.
    $('stats-total-line').textContent = '';
    const attempts = (k) => (k === 0 ? 'لا محاولات' : k === 1 ? 'محاولة واحدة' : k === 2 ? 'محاولتان' : k + ' محاولات');
    const box = $('stats-overall');
    box.innerHTML = '';
    const cards = [
      ['history', String(n), 'محاولات'],
      ['target', n ? (Math.round(avg * 10) / 10) + '%' : '—', 'متوسط النتائج'],
      ['award', n ? best + '%' : '—', 'أفضل نتيجة'],
      ['check', totQ + ' / ' + totTried, 'إجابات صحيحة'],
      ['clock', fmtDur(totSecs), 'زمن المذاكرة'],
    ];
    cards.forEach(([icon, val, label]) => {
      const d = document.createElement('div');
      d.className = 'stat-card stat-card-wide';
      d.innerHTML = '<div class="stat-icon-wrapper time-accent"><i data-lucide="' + icon + '"></i></div>' +
        '<div class="stat-info"><span class="stat-value">' + (typeof val === 'string' && val.indexOf('/') !== -1 ? '<span dir="ltr">' + escapeHtml(val) + '</span>' : escapeHtml(val)) + '</span>' +
        '<span class="stat-label">' + escapeHtml(label) + '</span></div>';
      box.appendChild(d);
    });

    const subs = $('stats-subjects');
    subs.innerHTML = '';
    const bySub = {};
    H.forEach((h) => {
      (bySub[h.subjectId] = bySub[h.subjectId] || { title: h.subjectTitle, rows: [] }).rows.push(h);
    });
    Object.keys(bySub).forEach((sid) => {
      const g = bySub[sid];
      const rows = g.rows;
      const a2 = rows.reduce((x, h) => x + (h.pct || 0), 0) / rows.length;
      const b2 = Math.max.apply(null, rows.map((h) => h.pct || 0));
      const last = rows[rows.length - 1];
      const wrap = document.createElement('div');
      wrap.className = 'saved-group';
      const head = document.createElement('div');
      head.className = 'saved-group-head';
      head.innerHTML = '<div><div class="saved-group-title">' + escapeHtml(g.title) +
        '</div><div class="saved-group-sub">' + attempts(rows.length) + '</div></div>' +
        '<div class="stat-value" dir="ltr">' + last.pct + '%</div>';
      wrap.appendChild(head);
      const track = document.createElement('div');
      track.className = 'stat-bar-track';
      track.innerHTML = '<div class="stat-bar-fill" style="width:' + Math.max(0, Math.min(100, a2)) + '%"></div>';
      wrap.appendChild(track);
      const meta = document.createElement('div');
      meta.className = 'saved-group-sub';
      meta.textContent = rows.length > 1
        ? 'المتوسط ' + (Math.round(a2 * 10) / 10) + '% · الأفضل ' + b2 + '%'
        : 'النتيجة ' + b2 + '%';
      wrap.appendChild(meta);
      subs.appendChild(wrap);
    });

    const list = $('history-list');
    list.innerHTML = '';
    $('history-empty-state').classList.toggle('hidden', n !== 0);
    H.slice(-20).reverse().forEach((h) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = '<span class="history-pct ' + pctClass(h.pct) + '" dir="ltr">' + h.pct + '%</span>' +
        '<div class="history-meta"><div class="history-topic">' + escapeHtml(h.topic || '') + '</div>' +
        '<div class="history-sub">' + escapeHtml(h.subjectTitle + (h.chapterLabel ? ' · ' + h.chapterLabel : '')) +
        ' · ' + fmtDate(h.t) + ' · ' + h.correct + '/' + h.total + '</div></div>';
      list.appendChild(row);
    });
    icons();
  }

  function exportData() {
    try {
      const data = {
        app: 'mcq-portal', version: 1, exportedAt: new Date().toISOString(),
        saved: S.saved, history: S.history, bests: collectBests(),
      };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mcq-portal-backup.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      toast('تم تنزيل النسخة الاحتياطية');
    } catch (e) { toast('تعذر إنشاء النسخة'); }
  }

  function importData(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (d.saved && typeof d.saved === 'object') {
          S.saved = d.saved;
          persistSaved(); updateSavedBadge(); updateMenuCounts();
        }
        if (Array.isArray(d.history)) {
          S.history = d.history.slice(-200);
          try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history)); } catch (e) {}
        }
        if (d.bests && typeof d.bests === 'object') {
          Object.keys(d.bests).forEach((k) => {
            if (k.indexOf('portal_best_') === 0) {
              try { localStorage.setItem(k, JSON.stringify(d.bests[k])); } catch (e) {}
            }
          });
        }
        if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
        toast('تمت الاستعادة بنجاح');
      } catch (e) { toast('ملف غير صالح'); }
    };
    rd.readAsText(file);
  }

  // ---------------- results ----------------
  function startTourDemoResults() {
    const sub = currentSubject();
    const ch = sub && sub.chapters && sub.chapters[0];
    const bank = ch && S.banks ? S.banks[ch.quiz_id] : null;
    if (!sub || !ch || !bank || !bank.questions || !bank.questions.length) return false;
    const origin = { subjectId: sub.subject_id, subjectTitle: sub.subject_title, chapterNo: ch.chapter_no, topic: bank.topic, quizId: ch.quiz_id };
    const qs = bank.questions.slice(0, 3).map((q) => Object.assign({}, q, { origin: origin }));
    const picks = [qs[0].correct, (qs[0].correct + 1) % 4, (qs[0].correct + 2) % 4];
    const dwells = [14, 9, 0];
    S.session = {
      sub: { subject_id: sub.subject_id, subject_title: sub.subject_title },
      ch: ch, chapterLabel: chLabel(ch), questions: qs, picks: picks, dwells: dwells,
      started: true, finished: true, demo: true, idx: 0, maxIdx: 0,
      quizId: ch.quiz_id, hash: location.hash,
    };
    const res = window.PortalAnalytics.analyze(qs, picks, dwells, 23);
    show('results-view');
    renderResults(res);
    return true;
  }

  function renderResults(res) {
    S.lastResults = res;
    const resultsCard = document.querySelector('.results-card');
    if (resultsCard) {
      const old = resultsCard.querySelector('.demo-banner');
      if (old) old.remove();
      if (S.session && S.session.demo) {
        const b = document.createElement('div');
        b.className = 'demo-banner';
        b.textContent = 'عرض تجريبي من الجولة — ليست نتيجتك';
        resultsCard.prepend(b);
      }
    }
    $('score-percentage').textContent = res.pct + '%';
    $('score-fraction').textContent = res.correct + ' / ' + res.total;
    $('score-badge-text').textContent = res.band.ar;
    const badgeIcon = $('score-badge-icon');
    if (badgeIcon) {
      const fresh = document.createElement('i');
      fresh.id = 'score-badge-icon';
      fresh.setAttribute('data-lucide', res.band.icon);
      badgeIcon.replaceWith(fresh);
    }
    const unanswered = (S.session.picks || []).filter((p) => p === null || p === undefined).length;
    $('stat-correct').textContent = res.correct;
    $('stat-wrong').textContent = Math.max(0, res.total - res.correct - unanswered);
    const accEl = $('stat-accuracy');
    if (accEl) accEl.textContent = res.pct + '%';
    $('stat-total-time').textContent = res.totalTime;

    const cb = $('chapter-breakdown');
    const ses = S.session;
    cb.innerHTML = '<div class="chapter-row"><span class="chapter-name">' +
      escapeHtml(ses.sub.subject_title + ' · ' + (ses.chapterLabel || chLabel(ses.ch))) + '</span></div>';

    $('filter-count-all').textContent = res.total;
    const actualWrong = ses.picks.filter((p, i) => p !== null && p !== undefined && p !== ses.questions[i].correct).length;
    $('filter-count-wrong').textContent = actualWrong;
    $('filter-count-correct').textContent = res.correct;

    const list = $('review-cards-list');
    list.innerHTML = '';
    const letters = qLetters();
    ses.questions.forEach((q, i) => {
      const picked = ses.picks[i];
      const skipped = picked === null || picked === undefined;
      const ok = !skipped && picked === q.correct;
      const verdict = ok ? 'correct' : (skipped ? 'skipped' : 'wrong');
      const card = document.createElement('div');
      card.className = 'review-card ' + (ok ? 'correct-border' : (skipped ? 'skipped-border' : 'wrong-border'));
      card.dataset.ok = verdict;
      card.setAttribute('data-q-index', i);

      const header = document.createElement('div');
      header.className = 'review-card-header';
      const dwellSec = Math.round(Number(ses.dwells[i]) || 0);
      const statusIcon = ok ? 'check' : (skipped ? 'minus' : 'x');
      const statusWord = ok ? 'صحيحة' : (skipped ? 'لم تُجب' : 'خاطئة');
      header.innerHTML =
        '<div class="review-q-meta"><span class="review-q-num">سؤال ' + (i + 1) + '</span>' +
        '<span class="review-status-tag ' + verdict + '">' +
        '<i data-lucide="' + statusIcon + '"></i><span>' + statusWord + '</span></span></div>' +
        '<span class="review-dwell-tag" dir="ltr"><i data-lucide="clock"></i><span>' + dwellSec + 's</span></span>';
      card.appendChild(header);

      stemPair(q).forEach((sp, si) => {
        const stem = document.createElement('p');
        stem.className = 'review-question-text' + (si > 0 ? ' review-question-text-sub' : '');
        stem.textContent = sp.t;
        stem.setAttribute('dir', 'auto');
        card.appendChild(stem);
      });

      const optionsList = document.createElement('div');
      optionsList.className = 'review-options-list';
      for (let oi = 0; oi < 4; oi++) {
        if (oi !== picked && oi !== q.correct) continue; // show only pick + correct
        const pair = optsPair(q, oi);
        let optClass = 'review-option-item';
        if (oi === picked && !ok && !skipped) optClass += ' user-wrong';
        else if (oi === q.correct) optClass += ' correct-answer';
        const item = document.createElement('div');
        item.className = optClass;
        item.setAttribute('dir', 'auto');
        const li = lettersFor(pair[0].lang);
        item.innerHTML = '<span class="review-option-indicator">' + li[oi] +
          '</span><span class="review-option-text">' + pair.map((p) => '<span class="opt-line opt-' + p.lang + '">' + escapeHtml(p.t) + '</span>').join('') + '</span>';
        optionsList.appendChild(item);
      }
      card.appendChild(optionsList);

      const expl = explText(q);
      if (expl) {
        const exp = document.createElement('div');
        exp.className = 'review-explanation-box collapsed';
        exp.innerHTML =
          '<button type="button" class="expl-toggle" aria-expanded="false">' +
          '<i data-lucide="lightbulb" class="expl-icon"></i>' +
          '<span>الشرح</span>' +
          '<i data-lucide="chevron-down" class="expl-chevron"></i>' +
          '</button>' +
          '<div class="expl-body" dir="auto" hidden>' + escapeHtml(expl) + '</div>';
        const tg = exp.querySelector('.expl-toggle');
        const body = exp.querySelector('.expl-body');
        tg.addEventListener('click', () => {
          const open = exp.classList.toggle('collapsed') === false;
          tg.setAttribute('aria-expanded', open ? 'true' : 'false');
          body.hidden = !open;
        });
        card.appendChild(exp);
      }

      // save / unsave straight from the review list
      if (q.origin) {
        const key = saveKeyOf(q.origin, q.id);
        const saveBtn = document.createElement('button');
        const setState = () => {
          const on = !!S.saved[key];
          saveBtn.className = 'review-save-btn' + (on ? ' is-saved' : '');
          saveBtn.innerHTML = '<i data-lucide="bookmark"></i><span>' + (on ? 'محفوظ' : 'حفظ') + '</span>';
          saveBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
          try { if (window.lucide) window.lucide.createIcons(); } catch (e) {}
        };
        saveBtn.type = 'button';
        setState();
        saveBtn.addEventListener('click', () => {
          if (S.saved[key]) delete S.saved[key];
          else S.saved[key] = { origin: q.origin, snapshot: JSON.parse(JSON.stringify(q)), savedAt: Date.now() };
          persistSaved();
          updateSavedBadge();
          setState();
          toast(S.saved[key] ? 'تم حفظ السؤال' : 'أُزيل من المحفوظة', S.saved[key] ? 'success' : 'info');
        });
        card.appendChild(saveBtn);
      }
      list.appendChild(card);
    });
    filterReview('all');
    icons();
  }

  function filterReview(f) {
    document.querySelectorAll('.filter-pill').forEach((p) => {
      const on = p.dataset.filter === f;
      p.classList.toggle('active', on);
      p.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.review-card').forEach((c) => {
      const k = c.dataset.ok;
      c.style.display = (f === 'all' || k === f || (f === 'wrong' && k === 'skipped')) ? '' : 'none';
    });
  }

  // ---------------- routing ----------------
  function route() {
    const h = location.hash;
    const m = h.match(/^#\/quiz\/([^/]+)\/([^/]+)$/);
    if (h === '#/saved' || h === '#/saved/') {
      S.session = null;
      renderSaved();
      show('saved-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/stats' || h === '#/stats/') {
      S.session = null;
      renderStats();
      show('stats-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/league' || h === '#/league/') {
      S.session = null;
      renderLeague();
      show('league-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/practice' || h === '#/practice/') {
      if (S.session && !S.session.finished && !S.session.ch.quiz_id) {
        show(S.session.started ? 'quiz-view' : 'quiz-start-view');
        window.scrollTo(0, 0);
      } else {
        location.hash = '';
      }
    } else if (m) {
      const qz = decodeURIComponent(m[2]);
      if (S.session && !S.session.finished && S.session.ch.quiz_id &&
          S.session.ch.quiz_id === qz && h === S.session.hash) {
        show(S.session.started ? 'quiz-view' : 'quiz-start-view');
        window.scrollTo(0, 0);
      } else {
        startSession(decodeURIComponent(m[1]), qz, null);
      }
    } else {
      S.session = null;
      renderCatalog();
      show('deck-catalog');
    }
  }

  // ---------------- guided tour (custom spotlight, short steps, replayable, hands-on) ----------------
  const TOUR_STEPS = [
    { title: 'MSCQuiz — جولة كاملة', body: 'كل شي بالبوابة: المواد والكوزات والنتيجة والمحفوظ والإحصائيات والدوري. جولة قصيرة، تقدر تطلع منها بأي وقت.', center: true },

    { title: 'أزرار الهيدر', body: 'المحفوظات، تبديل المظهر (فاتح/داكن)، والقائمة الجانبية — والشعار يرجّعك للرئيسية.', target: '.header-catalog-actions' },

    { title: 'القائمة الجانبية', body: 'تثبيت التطبيق، المحفوظ، الإحصائيات، الدوري، إعادة الجولة، الصوت، المظهر، وسجل التشخيص.', open: 'menu', target: '#menu-drawer .menu-list' },

    { title: 'اختر المادة', body: 'شريط أفقي — اسحب واختر مادتك.', target: '#subject-filter-bar' },

    { title: 'اختر الجابتر', body: 'أرقام الجابترات. الرقم الفاتح هو المختار حالياً.', target: '#chapter-filter-bar' },

    { title: 'صف الكوز', body: 'زر التشغيل يبدأ الكوز فوراً، وأيقونة (i) تعرض عدد الأسئلة وأفضل نتيجة.', target: '#deck-catalog .sketch-row:first-child' },

    { title: 'نجرّب كوز', body: 'سنفتح أول كوز حتى تشوف كل شي عملي.', center: true, go: true },

    { title: 'البداية', body: 'هنا عدد الأسئلة والوقت المتوقع. المؤقت يبدأ عند الضغط.', target: '#btn-start-quiz', action: 'start' },

    { title: 'الحفظ والترجمة', body: 'زر الحفظ أعلى البطاقة، وأيقونة اللغة تبدّل السؤال بين عربي / English / الاثنين معاً.', target: '#btn-save-question' },

    { title: 'أجب', body: 'اختر إجابة — ما فيه زر تخطي. لازم تجاوب حتى تنتقل.', target: '#options-container', action: 'answer' },

    { title: 'الشرح فوراً', body: 'بعد الإجابة يظهر الشرح بالعربي تحت الخيارات.', target: '#live-feedback-box' },

    { title: 'التالي', body: 'ينتقل بعد الإجابة فقط، وبآخر سؤال ينهي الكوز ويحسب النتيجة.', target: '#btn-next' },

    { title: 'جدول الأسئلة', body: 'هذا الزر يفتح خريطة الأسئلة.', target: '#btn-open-matrix' },

    { title: 'خريطة الأسئلة', body: 'الصحيح والخطأ، وتقفز للأسئلة السابقة فقط. الكوز ينهي نفسه تلقائياً بعد آخر سؤال.', open: 'matrix', target: '#matrix-drawer .matrix-grid' },

    { title: 'شاشة النتيجة', body: 'عرض حقيقي للنتيجة: النسبة، الصحيحة/الخاطئة/لم تُجب، الزمن، ثم مراجعة كل سؤال. السهم يفتح الشرح، وتقدر تحفظ أي سؤال من هنا، والترجمة من الشريط العلوي.', demo: 'results', target: '.results-card' },

    { title: 'المحفوظات', body: 'كل سؤال حفظته، مقسم مادة ثم جابتر. كل جابتر عنده زر اختبار، وفيه اختبار لكل المادة.', center: true, route: '#/saved' },

    { title: 'الإحصائيات', body: 'أرقامك العامة، متوسط كل مادة، سجل المحاولات، ونسخة احتياطية/استعادة/مسح.', center: true, route: '#/stats' },

    { title: 'الدوري الأسبوعي', body: 'ترتيب أسبوعي بالإجابات الصحيحة مع نسبة الدقة. زر «ظاهر» يخفي اسمك أو يرجعه.', target: '#league-view .league-head', route: '#/league' },

    { title: 'شارك ترتيبك', body: 'بطاقة صورة جاهزة: ترتيبك، أعلى ثلاثة، والدقة — تنزلها أو تشاركها بضغطة.', target: '#btn-league-share' },

    { title: 'خلصت الجولة', body: 'تعيدها من القائمة الجانبية ← إعادة الجولة التعليمية. والتطبيق يشتغل بدون إنترنت بعد أول زيارة.', center: true },
  ];

  let tourIdx = -1;
  let tourRoutedFor = -1;
  const tourRetried = new Map();

  function tourGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function tourSet(key) { try { localStorage.setItem(key, '1'); } catch (e) {} }

  function tourShow(i) {
    tourIdx = i;
    const ov = $('tour-overlay');
    if (i < 0 || i >= TOUR_STEPS.length) { tourHide(); return; }
    const st = TOUR_STEPS[i];
    if (st.demo === 'results' && $('results-view').classList.contains('hidden')) {
      startTourDemoResults();
    }
    // cross-view steps: navigate first, then place the tip on the new screen
    if (st.route && location.hash !== st.route) {
      if (tourRoutedFor !== i) {
        tourRoutedFor = i;
        try { S.session = null; } catch (e) {}     // the tour is an explicit leave
        try { hideLeaveModal(); } catch (e) {}
        $('tour-tip').style.visibility = 'hidden';
        const nb = $('tour-btn-next');
        if (nb) nb.disabled = true;
        navBypass = true;
        location.hash = st.route;
        setTimeout(() => {
          $('tour-tip').style.visibility = '';
          if (nb) nb.disabled = false;
          if (tourIdx === i) tourShow(i);
        }, 800);
        return;
      }
      // navigation did not take: keep the step centred instead of looping
    }
    $('tour-tip').style.visibility = '';
    const nextBtn = $('tour-btn-next');
    if (nextBtn) nextBtn.disabled = false;
    try { hideLeaveModal(); } catch (e) {}
    if (st.open === 'menu') openDrawer('menu-drawer');
    else if (st.open === 'matrix') openDrawer('matrix-drawer');
    else closeDrawers();
    if (st.go) {
      const sub = currentSubject();
      const ch = sub && sub.chapters[0];
      if (sub && ch) location.hash = '#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id);
      setTimeout(() => tourShow(i + 1), 900);
      return;
    }
    let el = null;
    let rect = null;
    if (!st.center) {
      const cands = st.target ? Array.from(document.querySelectorAll(st.target)) : [];
      el = cands.find((x) => x && x.offsetParent) || null;
      if (!el) {
        // the view may still be rendering (e.g. the explanation after an answer)
        const tries = tourRetried.get(i) || 0;
        if (tries < 3) {
          tourRetried.set(i, tries + 1);
          setTimeout(() => { if (tourIdx === i) tourShow(i); }, 600);
          return;
        }
        tourShow(i + 1); return; // skip a target that never appears
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      rect = el.getBoundingClientRect();
    }
    ov.classList.remove('hidden');
    ov.setAttribute('aria-hidden', 'false');
    ov.classList.toggle('tour-dim-light', !!st.center);
    const icon = $('tour-tip-icon');
    if (icon) icon.style.display = st.center ? 'block' : 'none';
    // Action steps need the spotlight hole clickable: shades stop intercepting.
    ['tour-shade-top', 'tour-shade-bottom', 'tour-shade-left', 'tour-shade-right'].forEach((id) => {
      document.getElementById(id).style.pointerEvents = st.action ? 'none' : 'auto';
    });
    $('tour-tip-title').textContent = st.title;
    $('tour-tip-body').textContent = st.body;
    $('tour-tip-progress').textContent = (i + 1) + ' / ' + TOUR_STEPS.length;
    const bar = $('tour-tip-bar-fill');
    if (bar) bar.style.width = ((i + 1) / TOUR_STEPS.length * 100) + '%';
    const isAction = !!st.action;
    $('tour-tip').classList.toggle('tour-waiting', isAction);
    $('tour-btn-next').textContent = i === TOUR_STEPS.length - 1 ? 'إنهاء' : (isAction ? 'تخطي الخطوة' : 'التالي');
    $('tour-btn-prev').style.visibility = i === 0 ? 'hidden' : 'visible';
    $('tour-tip').classList.toggle('is-last', i === TOUR_STEPS.length - 1);
    requestAnimationFrame(() => tourPlace(rect, !!st.center));
    // Re-place after smooth scroll settles (fixed overlay doesn't track scrolling).
    if (el) setTimeout(() => {
      if (tourIdx !== i) return;
      tourPlace(el.getBoundingClientRect(), false);
    }, 550);
    icons();
  }

  function tourPlace(rect, centered) {
    const tip = $('tour-tip');
    tip.classList.toggle('tour-centered', centered);
    if (centered) { centerTip(); paintShades(null); return; }
    const pad = 8;
    paintShades(rect);
    const vw = window.innerWidth, vh = window.innerHeight;
    const wide = vw >= 768;
    tip.style.visibility = 'hidden';
    tip.style.transform = '';
    tip.style.maxWidth = '';
    tip.style.marginLeft = '';
    tip.style.marginRight = '';
    if (wide) {
      tip.style.width = '360px';
      tip.style.left = ''; tip.style.right = '';
      // RTL: align tip's right edge with the target's right edge
      tip.style.left = Math.max(8, Math.min(rect.right - 360, vw - 376)) + 'px';
    } else {
      tip.style.width = '';
      tip.style.left = '12px'; tip.style.right = '12px';
    }
    tip.style.top = '0px';
    const th = tip.offsetHeight;
    const gap = 10;
    const y = rect.top + rect.height + pad;
    let ty = y + gap;
    if (ty + th > vh - 8) ty = Math.max(8, rect.top - pad - gap - th);
    tip.style.top = ty + 'px';
    tip.style.visibility = 'visible';
    tip.style.right = wide ? '' : '12px';
  }

  function paintShades(rect) {
    const pad = 8;
    const t = $('tour-shade-top'), b = $('tour-shade-bottom'),
      l = $('tour-shade-left'), r = $('tour-shade-right'),
      f = $('tour-frame');
    const vw = window.innerWidth, vh = window.innerHeight;
    const show = (el, x, y, w, h) => {
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.style.width = Math.max(0, w) + 'px'; el.style.height = Math.max(0, h) + 'px';
    };
    if (!rect) {
      show(t, 0, 0, vw, vh); show(b, 0, 0, 0, 0); show(l, 0, 0, 0, 0); show(r, 0, 0, 0, 0);
      if (f) f.classList.add('hidden');
      return;
    }
    const x = Math.max(0, rect.left - pad), y = Math.max(0, rect.top - pad),
      w = rect.width + pad * 2, h = rect.height + pad * 2;
    show(t, 0, 0, vw, y);
    show(b, 0, y + h, vw, vh - (y + h));
    show(l, 0, y, x, h);
    show(r, x + w, y, vw - (x + w), h);
    if (f) {
      f.classList.remove('hidden');
      f.style.left = x + 'px'; f.style.top = y + 'px';
      f.style.width = w + 'px'; f.style.height = h + 'px';
    }
  }

  function centerTip() {
    const tip = $('tour-tip');
    tip.style.width = 'min(440px, calc(100vw - 24px))';
    tip.style.left = '0';
    tip.style.right = '0';
    tip.style.marginLeft = 'auto';
    tip.style.marginRight = 'auto';
    tip.style.transform = '';
    tip.style.top = Math.max(12, (window.innerHeight - tip.offsetHeight) / 2 - 30) + 'px';
    tip.style.visibility = 'visible';
  }

  function tourHide() {
    tourIdx = -1;
    $('tour-overlay').classList.add('hidden');
    $('tour-overlay').setAttribute('aria-hidden', 'true');
    const f = $('tour-frame');
    if (f) f.classList.add('hidden');
    try { closeDrawers(); } catch (e) {}
  }

  function tourDone() { tourSet(TOUR_KEY); tourHide(); toast('انتهت الجولة — بالتوفيق!'); }

  function tourNotify(eventName) {
    if (tourIdx < 0 || tourIdx >= TOUR_STEPS.length) return;
    const st = TOUR_STEPS[tourIdx];
    if (st.action === eventName) tourShow(tourIdx + 1);
  }

  function maybeQuizHint() {
    if (tourGet(QUIZ_HINT_KEY)) return;
    tourSet(QUIZ_HINT_KEY);
    setTimeout(() => toast('اختر إجابة ثم التالي — وزر الحفظ يحفظ السؤال'), 600);
  }

  // ---------------- leave-exam guard ----------------
  let navBypass = false;
  let navPending = null;
  let leaveIntent = 'exit';

  function dirtySession() {
    const s = S.session;
    return !!(s && !s.finished && s.picks.some((p) => p !== null));
  }

  function goHash(h) {
    if (dirtySession() && h !== S.session.hash) {
      navPending = h;
      showLeaveModal();
      return;
    }
    if (location.hash === h) route();
    else location.hash = h;
  }

  function showLeaveModal(intent) {
    leaveIntent = intent === 'finish' ? 'finish' : 'exit';
    const t = $('leave-title'), b = $('leave-body'), go = $('leave-go');
    if (t && b && go) {
      if (leaveIntent === 'finish') {
        t.textContent = 'إنهاء الاختبار؟';
        b.textContent = 'الأسئلة التي لم تُجب عنها ستُحسب غير صحيحة.';
        go.textContent = 'إنهاء';
      } else {
        t.textContent = 'الخروج من الاختبار؟';
        b.textContent = 'لن تُحسب نتيجتك إذا خرجت الآن. هل تريد الخروج؟';
        go.textContent = 'خروج';
      }
    }
    $('leave-modal').classList.remove('hidden');
    $('leave-modal').setAttribute('aria-hidden', 'false');
    icons();
  }
  function hideLeaveModal() {
    $('leave-modal').classList.add('hidden');
    $('leave-modal').setAttribute('aria-hidden', 'true');
    navPending = null;
  }

  function onHashChange() {
    if (navBypass) { navBypass = false; route(); return; }
    if (dirtySession()) {
      const h = location.hash;
      if (h !== S.session.hash) {
        navPending = h;
        navBypass = true;
        location.hash = S.session.hash;
        showLeaveModal();
        return;
      }
    }
    route();
  }

  // ---------------- side menu ----------------
  function openMenu() {
    syncMenuToggles();
    updateMenuCounts();
    refreshOfflineRow();
    openDrawer('menu-drawer');
  }

  // Honest offline readiness: says whether this window can even run a service
  // worker (Telegram's WebView may not), and whether the shell is cached.
  async function refreshOfflineRow() {
    const label = $('menu-offline-label');
    const badge = $('menu-offline-state');
    if (!label || !badge) return;
    let supported = false;
    try { supported = ('serviceWorker' in navigator); } catch (e) {}
    if (!supported) {
      label.textContent = 'بدون إنترنت: غير مدعوم في هذه النافذة';
      badge.textContent = '!';
      badge.classList.remove('hidden');
      return;
    }
    let entries = 0;
    try {
      const st = await offlineState();
      entries = Object.keys(st.caches).reduce((n, k) => n + (st.caches[k] || 0), 0);
      const ctrl = !!navigator.serviceWorker.controller;
      if (entries > 5 && ctrl) {
        label.textContent = 'النسخة بدون إنترنت';
        badge.textContent = 'جاهزة';
        badge.classList.remove('hidden');
        return;
      }
    } catch (e) {}
    label.textContent = 'جهّز النسخة بدون إنترنت';
    badge.textContent = '—';
    badge.classList.remove('hidden');
  }

  async function prepareOffline() {
    let supported = false;
    try { supported = ('serviceWorker' in navigator); } catch (e) {}
    if (!supported) {
      toast('هذه النافذة ما تدعم التخزين — افتح الرابط في Chrome وثبّته', 'error');
      return;
    }
    toast('نجهّز النسخة بدون إنترنت…', 'info');
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      if (reg && reg.update) await reg.update().catch(() => {});
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ]).catch(() => {});
      const st = await offlineState();
      const entries = Object.keys(st.caches).reduce((n, k) => n + (st.caches[k] || 0), 0);
      if (entries > 5) toast('النسخة بدون إنترنت جاهزة ✓', 'success');
      else toast('التجهيز ما كمل — خلي الصفحة مفتوحة شوي وأعد المحاولة', 'error');
      refreshOfflineRow();
    } catch (e) {
      toast('تعذر تجهيز النسخة بدون إنترنت', 'error');
    }
  }
  function setSound(on) {
    S.sound = !!on;
    const si = $('sound-icon');
    if (si) si.setAttribute('data-lucide', S.sound ? 'volume-2' : 'volume-x');
    syncMenuToggles();
    icons();
  }
  function syncMenuToggles() {
    const ms = $('menu-sound-icon');
    if (ms) ms.setAttribute('data-lucide', S.sound ? 'volume-2' : 'volume-x');
    const ml = $('menu-sound-label');
    if (ml) ml.textContent = 'الصوت: ' + (S.sound ? 'يعمل' : 'صامت');
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const mt = $('menu-theme-icon');
    if (mt) mt.setAttribute('data-lucide', dark ? 'moon' : 'sun');
    const mtl = $('menu-theme-label');
    if (mtl) mtl.textContent = 'المظهر: ' + (dark ? 'داكن' : 'فاتح');
    const th = $('theme-header-icon');
    if (th) th.setAttribute('data-lucide', dark ? 'sun' : 'moon');
    icons();
  }
  function updateMenuCounts() {
    const b = $('menu-saved-count');
    if (!b) return;
    const n = Object.keys(S.saved).length;
    b.textContent = n;
    b.classList.toggle('hidden', n === 0);
  }
  async function installApp() {
    const inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    if (window.PortalPWA && await window.PortalPWA.install()) {
      closeDrawers();
      toast('تم إرسال طلب التثبيت');
    } else if (inTelegram) {
      // measured on a real tablet: Telegram's WebView does not keep the offline
      // cache, so the installed browser app is the offline path
      toast('للتشغيل بدون إنترنت: افتح الرابط في Chrome ثم ⋮ ← تثبيت التطبيق', 'info');
    } else {
      toast('من قائمة المتصفح ⋮ اختر "تثبيت التطبيق"');
    }
  }

  // ---------------- cloud account (Telegram, optional) ----------------
  function cloud() { return window.PortalCloud || null; }
  function fmtSyncTime() {
    try {
      const t = window.PortalCloud ? window.PortalCloud.lastSync() : 0;
      if (!t) return '';
      return new Intl.DateTimeFormat('ar', { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
    } catch (e) { return ''; }
  }
  function updateAccountRow() {
    const name = $('menu-account-name');
    const sub = $('menu-account-sub');
    const av = $('menu-avatar');
    if (!name || !sub) return;
    const C = cloud();
    const setAvatar = (url, fallbackText) => {
      if (!av) return;
      if (url) {
        av.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
      } else {
        av.style.backgroundImage = '';
        av.textContent = fallbackText;
      }
    };
    if (!C || !C.configured()) {
      name.textContent = 'زائر — بدون حساب';
      sub.textContent = 'افتح البوابة من بوت تليجرام للمزامنة';
      setAvatar('', 'ز');
      return;
    }
    if (!C.linked()) {
      name.textContent = 'زائر — بدون حساب';
      sub.textContent = 'افتح البوابة من داخل تليجرام للدخول';
      setAvatar('', 'ز');
      return;
    }
    const who = S.cloudName || 'حسابي';
    name.textContent = who;
    let photo = '';
    try { photo = (C.avatarUrl && C.avatarUrl()) || ''; } catch (e) {}
    setAvatar(photo, (who.trim()[0] || 'ح').toUpperCase());
    if (!navigator.onLine) sub.textContent = 'أوفلاين — سيُزامَن عند الاتصال';
    else {
      const t = fmtSyncTime();
      sub.textContent = t ? 'مزامن ✓ ' + t : 'مزامن ✓';
    }
    icons();
  }
  window.PortalCloudUI = function () { try { updateAccountRow(); } catch (e) {} };

  async function handleAccountTap() {
    const C = cloud();
        if (!C || !C.configured()) {
      try {
        const inTg = C && C.inTelegram && C.inTelegram();
        const hasBot = C && C.bot && C.bot();
        if (!inTg && !hasBot) { toast('حساب تليجرام قيد الإعداد — قريباً'); }
        else { toast('افتح البوابة من داخل تليجرام'); }
      } catch (e) { toast('افتح البوابة من داخل تليجرام'); }
      return;
    }
    if (!C.linked()) {
      const link = C.botLink ? C.botLink() : '';
      if (link) {
        try { window.open(link, '_blank', 'noopener'); } catch (e) {}
        toast('افتح الرابط في تليجرام للدخول بحسابك');
      } else {
        toast('افتح هذه الصفحة من داخل تطبيق تليجرام');
      }
      return;
    }
    let me = null;
    try { me = await C.accountInfo(); } catch (e) {}
    toast(me && me.name ? ('مسجل عبر تليجرام: ' + me.name) : 'مسجل عبر تليجرام ✓');
  }

  async function initTelegram() {
    const C = cloud();
    const L = window.PortalLog;
    try { if (L) L.info('tg', 'init src=' + (C && C.identitySource ? C.identitySource() : 'none') + ' store=' + (C && C.storeName ? C.storeName() : '?')); } catch (e) {}
    if (!C) { try { if (L) L.warn('tg', 'no PortalCloud'); } catch (e) {} return; }
    try {
      if (typeof C.integrate === 'function') C.integrate();
    } catch (e) { try { if (L) L.warn('tg', 'integrate failed: ' + e.message); } catch (e2) {} }
    if (!C.linked()) {
      try { if (L) L.info('tg', 'not linked (guest)'); } catch (e) {}
      updateAccountRow();
      return;
    }
    try {
      const me = await C.accountInfo();
      S.cloudName = (me && (me.name || me.username)) || S.cloudName || null;
      try { if (L) L.info('tg', 'linked ' + (me && (me.username || me.id)) + ' store=' + C.storeName()); } catch (e) {}
    } catch (e) { try { if (L) L.warn('tg', 'accountInfo failed: ' + e.message); } catch (e2) {} }
    updateAccountRow();
    try {
      const r = await C.pullOrPush();
      try { if (L) L.info('tg', 'sync=' + (r && r.action)); } catch (e) {}
      renderCatalog();
      if (location.hash === '#/saved' || location.hash === '#/saved/') renderSaved();
      if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
      updateSavedBadge(); updateMenuCounts(); updateAccountRow();
      icons();
      if (r && r.action === 'downloaded') toast('تمت المزامنة من حساب تليجرام ✓');
    } catch (e) {
      try { if (L) L.warn('tg', 'sync failed: ' + ((e && e.message) || e)); } catch (e2) {}
      toast('تعذرت المزامنة الأولى — سيُحاوَل تلقائياً');
    }
  }
  // Re-rank a board inside one subject (the cached board is always the full one,
  // so switching subjects is a local re-sort instead of another request).
  function scopeRows(rows, subjectId) {
    if (!subjectId) return rows;
    const out = (rows || []).map((r) => Object.assign({}, r, {
      xp: (r.per_subject && r.per_subject[subjectId] && Number(r.per_subject[subjectId].xp)) || 0,
    }));
    out.sort((a, b) => b.xp - a.xp);
    out.forEach((r, i) => { r.rank = i + 1; });
    return out;
  }

  // ---------------- weekly league (shared board) ----------------
  function leagueScopeLabel() {
    if (!S.leagueSubject) return 'الترتيب العام';
    const subs = (S.index && S.index.subjects) || [];
    const s = subs.find((x) => x.subject_id === S.leagueSubject);
    return s ? s.subject_title : 'الترتيب العام';
  }

  function renderLeagueChips() {
    const bar = $('league-subject-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.className = 'filter-chip' + (S.leagueSubject === id ? ' active' : '');
      b.textContent = label;
      b.setAttribute('aria-pressed', S.leagueSubject === id ? 'true' : 'false');
      b.addEventListener('click', () => { S.leagueSubject = id; renderLeague(); });
      bar.appendChild(b);
    };
    mk(null, 'العام');
    ((S.index && S.index.subjects) || []).forEach((s) => mk(s.subject_id, s.subject_title));
  }

  function avatarHtml(photo, name, cls) {
    if (photo) {
      return '<span class="' + cls + '" style="background-image:url(&quot;' + String(photo).replace(/"/g, '%22') +
        '&quot;);background-size:cover;background-position:center"></span>';
    }
    // default avatar (no photo): neutral silhouette instead of a letter on a tinted disc
    return '<span class="' + cls + ' avatar-default" aria-hidden="true"></span>';
  }

  async function renderLeague() {
    const box = $('league-board');
    const emptyEl = $('league-empty-state');
    const offEl = $('league-offline-note');
    if (box) box.innerHTML = '';
    const L = window.PortalLeague;
    const wk = L && L.weekStart ? L.weekStart(Date.now()) : '';
    const wl = $('league-week-line');
    if (wl) {
      if (wk) {
        const start = new Date(wk + 'T00:00:00');
        const end = new Date(start.getTime() + 6 * 86400000);
        const dayFmt = new Intl.DateTimeFormat('ar', { day: 'numeric' });
        const monFmt = new Intl.DateTimeFormat('ar', { month: 'long' });
        wl.textContent = start.getMonth() === end.getMonth()
          ? dayFmt.format(start) + ' – ' + dayFmt.format(end) + ' ' + monFmt.format(start)
          : dayFmt.format(start) + ' ' + monFmt.format(start) + ' – ' + dayFmt.format(end) + ' ' + monFmt.format(end);
      } else {
        wl.textContent = '';
      }
    }
    renderLeagueChips();

    if (!L || !L.configured()) {
      if (emptyEl) emptyEl.classList.add('hidden');
      if (offEl) offEl.classList.add('hidden');
      const chips = $('league-subject-bar');
      if (chips) chips.style.display = 'none';
      updateLeagueMe(null, []);
      icons();
      return;
    }
    const chips = $('league-subject-bar');
    if (chips) chips.style.display = '';
    if (offEl) offEl.classList.toggle('hidden', navigator.onLine !== false);
    if (emptyEl) emptyEl.classList.add('hidden');

    let rows = [];
    let me = null;
    try {
      const fresh = Array.isArray(S.leagueRows) && Date.now() - (S.leagueStamp || 0) < 45000;
      if (fresh) {
        rows = S.leagueRows;
        me = S.leagueMe || null;
      } else {
        rows = await L.board();
        me = (L.linked && L.linked()) ? await L.myRow() : null;
        S.leagueRows = rows;
        S.leagueMe = me;
        S.leagueStamp = Date.now();
        // refresh my row in the background — never on the render path
        if (L.linked && L.linked() && navigator.onLine !== false && Date.now() - (S.leagueSyncStamp || 0) > 600000) {
          S.leagueSyncStamp = Date.now();
          L.syncWeek().then(() => L.board()).then((r2) => {
            S.leagueRows = r2;
            S.leagueStamp = Date.now();
            if (location.hash.indexOf('#/league') === 0) renderLeague();
          }).catch(() => {});
        }
      }
    } catch (e) {
      const offline = navigator.onLine === false;
      if (offline) {
        if (offEl) offEl.classList.remove('hidden');
        if (emptyEl) emptyEl.classList.add('hidden');
      } else if (emptyEl) {
        emptyEl.querySelector('p').textContent = 'تعذر تحميل اللوحة';
        emptyEl.classList.remove('hidden');
      }
      updateLeagueMe(null, []);
      icons();
      return;
    }
    rows = scopeRows(rows, S.leagueSubject);
    if (!rows.length && emptyEl) {
      emptyEl.querySelector('p').textContent = 'لا أحد في الترتيب بعد هذا الأسبوع';
      emptyEl.classList.remove('hidden');
    }

    const myId = me && me.user_id;
    const myPhoto = (me && me.avatar) || (function () { try { return L.avatarUrl ? L.avatarUrl() : ''; } catch (e) { return ''; } })();
    const avatarFor = (r) => avatarHtml(r.user_id === myId && !r.avatar ? myPhoto : r.avatar, r.name, 'menu-avatar');
    const usePodium = rows.length >= 3;
    const top = usePodium ? rows.slice(0, 3) : [];
    const rest = usePodium ? rows.slice(3) : rows;
    renderPodium(top, myId, myPhoto);
    const restLabel = $('league-rest-label');
    if (restLabel) restLabel.classList.toggle('hidden', !usePodium || rest.length === 0);
    rest.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'league-row' + (myId && r.user_id === myId ? ' is-me' : '');
      row.setAttribute('role', 'listitem');
      row.innerHTML =
        '<span class="league-rank" dir="ltr">' + r.rank + '</span>' +
        avatarFor(r) +
        '<span class="league-row-name" dir="auto">' + escapeHtml(r.name || 'لاعب') + '</span>' +
        '<span class="league-row-xp">' + r.xp + '<small>إجابة</small></span>' +
        (accuracyOf(r) !== null && !S.leagueSubject ? '<span class="league-row-acc">' + accuracyOf(r) + '%</span>' : '');
      box.appendChild(row);
    });
    updateLeagueMe(me, rows);
    icons();
  }

  function renderPodium(top, myId, myPhoto) {
    const el = $('league-podium');
    if (!el) return;
    el.innerHTML = '';
    if (!top.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    // visual order in RTL: 2nd · 1st · 3rd  (grid fills right-to-left)
    const order = [top[1], top[0], top[2]].filter(Boolean);
    order.forEach((r) => {
      const slot = document.createElement('div');
      const first = r.rank === 1;
      const photo = (myId && r.user_id === myId && !r.avatar) ? (myPhoto || '') : r.avatar;
      slot.className = 'podium-slot p' + r.rank + (myId && r.user_id === myId ? ' is-me' : '');
      slot.innerHTML =
        '<span class="podium-av-wrap">' +
        (first ? '<span class="podium-crown" aria-hidden="true"><i data-lucide="crown"></i></span>' : '') +
        avatarHtml(photo, r.name, 'podium-av') +
        '</span>' +
        '<span class="podium-name" dir="auto">' + escapeHtml(r.name || 'لاعب') + '</span>' +
        '<span class="podium-xp">' + r.xp + ' <small>إجابة</small></span>' +
        '<span class="podium-block">' + r.rank + '</span>';
      el.appendChild(slot);
    });
  }

  function updateLeagueMe(me, rows) {
    const box = $('league-me');
    if (!box) return;
    const L = window.PortalLeague;
    const linked = !!(L && L.linked && L.linked());
    box.hidden = false;

    if (!L || !L.configured()) {
      box.innerHTML = '<div class="league-me-main"><div class="league-me-name">الدوري غير متاح حالياً</div>' +
        '<div class="league-me-sub">سيتوفر بعد إعداد الخادم الخاص بالبوابة</div></div>';
      icons();
      return;
    }

    if (!linked) {
      box.innerHTML = '<div class="league-me-main"><div class="league-me-name">لست في الدوري</div>' +
        '<div class="league-me-sub">افتح البوابة من بوت تليجرام لتظهر في الترتيب</div></div>';
      icons();
      return;
    }

    const hidden = !!(me && me.hidden);
    const myId = me && me.user_id;
    const mine = (rows || []).filter((r) => r.user_id === myId)[0];
    const name = (me && me.name) || S.cloudName || 'أنت';
    const photo = (me && me.avatar) || (function () { try { return L.avatarUrl ? L.avatarUrl() : ''; } catch (e) { return ''; } })();
    const facts = [];
    if (mine) facts.push('المركز ' + mine.rank);
    facts.push(ansCount(mine ? mine.xp : (Number(me && me.xp) || 0)));
    const acc = accuracyOf(mine);
    if (acc !== null && !S.leagueSubject) facts.push('دقة ' + acc + '%');
    if (hidden) facts.push('مخفي');
    let gapLine = '';
    if (!hidden && mine && mine.rank > 1) {
      const above = (rows || [])[mine.rank - 2];
      if (above) {
        const gap = Math.max(0, above.xp - mine.xp);
        gapLine = gap === 0 ? 'متعادل مع المركز ' + above.rank : 'باقي ' + gap + ' للمركز ' + above.rank;
      }
    }

    box.innerHTML =
      avatarHtml(photo, name, 'menu-avatar') +
      '<div class="league-me-main">' +
      '<div class="league-me-name" dir="auto">' + escapeHtml(name) + '</div>' +
      '<div class="league-me-sub">' + escapeHtml(facts.join(' · ')) + '</div>' +
      (gapLine ? '<div class="league-me-gap">' + escapeHtml(gapLine) + '</div>' : '') +
      '</div>' +
      '<label class="league-vis">' +
      '<input type="checkbox" id="league-vis-toggle"' + (hidden ? '' : ' checked') + '>' +
      '<span>ظاهر</span>' +
      '</label>';

    const toggle = $('league-vis-toggle');
    if (toggle) toggle.addEventListener('change', async () => {
      const next = !toggle.checked;   // checked = visible, so hiding = !checked
      toggle.disabled = true;
      try {
        await L.setHidden(next);
        toast(next ? 'أُخفيت من الترتيب' : 'ظهرت في الترتيب', 'success');
      } catch (e) {
        toast('تعذر تحديث الحالة', 'error');
      }
      // the visibility flip is already on the server: drop the cached board
      // so the re-render below shows the new state instead of the old one
      S.leagueRows = null;
      S.leagueMe = null;
      S.leagueStamp = 0;
      renderLeague();
    });
    icons();
  }

  // ---- shareable league card (drawn on canvas, no external template) ----
  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawAvatar(ctx, cx, cy, r, name, ring, img, fallback) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.width) {
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
    } else if (fallback && fallback.width) {
      ctx.fillStyle = 'rgba(139, 151, 168, 0.14)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.drawImage(fallback, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#14161c';
      ctx.font = '700 ' + Math.round(r * 0.9) + 'px "MSCQuiz Arabic", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((name || '؟').trim().charAt(0) || '؟', cx, cy + 2);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ring || 'rgba(255,255,255,0.14)';
    ctx.stroke();
  }

  function loadCardImage(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      // Telegram avatars are unreadable from the browser (CSP sandbox), so route
      // them through our own /api/avatar proxy → same-origin → canvas-safe.
      const isTme = /^https:\/\/t\.me\/i\/userpic\//.test(url);
      const localDev = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
      const src = isTme
        ? ((localDev ? 'https://mcq-portal-jade.vercel.app' : '') + '/api/avatar?u=' + encodeURIComponent(url))
        : url;
      const img = new Image();
      if (!/^\/api\//.test(src)) img.crossOrigin = 'anonymous';
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      img.src = src;
      setTimeout(() => finish(null), 3500);
    });
  }

  async function buildLeagueCard(data) {
    const W = 1080;
    const INK = '#f3f4f6', MUTED = '#8b97a8', FAINT = '#6b7280';
    const ACCENT = '#c9a227', GOLD = '#d9a521';
    const L = 84, R = W - 84;

    // never trust incoming order: rank the rows here so a bigger number can never
    // sit under a smaller rank on the card
    const ranked = data.rows.slice().sort((a, b) => b.xp - a.xp)
      .map((r, i) => Object.assign({}, r, { rank: i + 1 }));
    const mineId = data.mine && data.mine.user_id;
    const mine = ranked.filter((r) => r.user_id === mineId)[0] || null;
    const shown = ranked.slice(0, 5);
    const mineOutside = !!(mine && mine.rank > 5);

    const rowH = 148;
    const header = 330, footerH = 40, mineH = mineOutside ? 148 : 0;
    const H = Math.max(860, Math.min(1350, header + shown.length * rowH + mineH + footerH));

    // avatars are remote (Telegram) — preload with CORS, fall back to the silhouette
    const imgs = {};
    const fallbackAvatar = await loadCardImage('/assets/avatar-default.svg');
    const toLoad = shown.slice();
    if (mineOutside && mine) toLoad.push(mine);
    await Promise.all(toLoad.map(async (r) => {
      const url = (mineId && r.user_id === mineId && !r.avatar) ? (data.myPhoto || '') : r.avatar;
      imgs[r.user_id] = await loadCardImage(url);
    }));

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.direction = 'rtl';
    ctx.textBaseline = 'alphabetic';

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b0e14');
    bg.addColorStop(1, '#0e131c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, 190, 40, W / 2, 190, 580);
    glow.addColorStop(0, 'rgba(201,162,39,0.10)');
    glow.addColorStop(1, 'rgba(77,163,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 660);

    // brand row
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = '700 34px "MSCQuiz Arabic", sans-serif';
    ctx.fillText('MSCQuiz', R, 96);
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = '500 26px "MSCQuiz Arabic", sans-serif';
    ctx.fillText(data.week, L, 96);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(L, 132, W - L * 2, 2);

    // title
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = '700 58px "MSCQuiz Arabic", sans-serif';
    ctx.fillText('ترتيب هذا الأسبوع', R, 226);
    ctx.fillStyle = MUTED;
    ctx.font = '500 28px "MSCQuiz Arabic", sans-serif';
    ctx.fillText(data.scope, R, 268);

    // column labels — makes it a table, not a list of guesses
    ctx.font = '500 21px "MSCQuiz Arabic", sans-serif';
    ctx.fillStyle = FAINT;
    ctx.textAlign = 'right';
    ctx.fillText('اللاعب', R - 162, 306);
    ctx.textAlign = 'left';
    ctx.fillText('إجابات صحيحة', L, 306);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(L, 318, W - L * 2, 1.5);

    const medals = ['#d9a521', '#c3ccda', '#c08a5c'];

    const drawRow = (r, y, opts) => {
      const h = opts.h;
      const isMe = !!mine && r.user_id === mine.user_id;
      const first = r.rank === 1;
      const avR = opts.av;
      const cy = y + h / 2;

      if (isMe) {
        ctx.fillStyle = 'rgba(201,162,39,0.10)';
        drawRoundRect(ctx, L - 14, y + 8, W - (L - 14) * 2, h - 16, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(201,162,39,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // rank at the right edge
      ctx.textAlign = 'right';
      ctx.fillStyle = medals[r.rank - 1] || MUTED;
      ctx.font = '700 40px "MSCQuiz Arabic", sans-serif';
      ctx.fillText(String(r.rank), R - 4, cy + 13);

      // avatar
      drawAvatar(ctx, R - 92, cy, avR, r.name, first ? GOLD : 'rgba(255,255,255,0.10)', imgs[r.user_id], fallbackAvatar);
      if (first) {
        const cx = R - 92, cyy = cy - avR - 12;
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(cx - 22, cyy + 10);
        ctx.lineTo(cx - 15, cyy - 8);
        ctx.lineTo(cx - 7, cyy + 2);
        ctx.lineTo(cx, cyy - 10);
        ctx.lineTo(cx + 7, cyy + 2);
        ctx.lineTo(cx + 15, cyy - 8);
        ctx.lineTo(cx + 22, cyy + 10);
        ctx.closePath();
        ctx.fill();
      }

      // name
      ctx.textAlign = 'right';
      ctx.fillStyle = INK;
      ctx.font = '600 32px "MSCQuiz Arabic", sans-serif';
      const nameX = R - 92 - avR - 26;
      ctx.fillText(r.name || 'لاعب', nameX, cy + 10);

      // the number on the left, where a table puts its values
      ctx.textAlign = 'left';
      ctx.fillStyle = first ? GOLD : INK;
      ctx.font = '700 38px "MSCQuiz Arabic", sans-serif';
      ctx.fillText(String(r.xp), L, cy + 16);
      const nw = ctx.measureText(String(r.xp)).width;
      ctx.fillStyle = MUTED;
      ctx.font = '500 22px "MSCQuiz Arabic", sans-serif';
      ctx.fillText('إجابة', L + nw + 8, cy + 14);

      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(L, y + h - 6, W - L * 2, 1.5);
    };

    let y = header;
    shown.forEach((r) => { drawRow(r, y, { h: rowH, av: 44 }); y += rowH; });

    if (mineOutside) {
      drawRow(mine, y + 12, { h: 124, av: 40 });
    }

    return c;
  }

  function appShareLink() {
    const appUrl = (window.PORTAL_APP_URL || 'https://mcq-portal-jade.vercel.app/') + '#/league';
    return 'https://t.me/share/url?url=' + encodeURIComponent(appUrl) +
      '&text=' + encodeURIComponent('دوري MSCQuiz — ترتيبي هذا الأسبوع');
  }

  function showSharePreview(url) {
    const modal = $('share-modal');
    const img = $('share-img');
    if (!modal || !img) return;
    img.src = url;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    const dl = $('share-download');
    if (dl) dl.onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mscquiz-league.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    const tg = $('share-telegram');
    if (tg) {
      tg.classList.remove('hidden');
      tg.onclick = () => {
        const link = appShareLink();
        try {
          if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(link);
          } else {
            window.open(link, '_blank');
          }
        } catch (e) { window.open(link, '_blank'); }
      };
    }
    const cp = $('share-copy');
    if (cp) cp.classList.toggle('hidden', true);
  }

  async function shareMyRank() {
    const btn = $('btn-league-share');
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    toast('نجهّز بطاقتك…', 'info');
    try {
      const L = window.PortalLeague;
      if (!L || !L.configured()) { toast('الدوري غير مفعّل بعد', 'error'); return; }
      // reuse what the board already fetched — the tap should feel instant
      let rows = null;
      let me = null;
      if (Array.isArray(S.leagueRows) && Date.now() - (S.leagueStamp || 0) < 60000) {
        rows = S.leagueRows;
        me = S.leagueMe || null;
      } else {
        rows = await L.board();
        try { me = await L.myRow(); } catch (e) {}
      }
      rows = scopeRows(rows, S.leagueSubject);
      const myId = me && me.user_id;
      const mine = rows.filter((r) => r.user_id === myId)[0] || null;
      let weekLabel = '';
      const wk = L.weekStart(Date.now());
      if (wk) {
        const start = new Date(wk + 'T00:00:00');
        const end = new Date(start.getTime() + 6 * 86400000);
        const df = new Intl.DateTimeFormat('ar', { day: 'numeric' });
        const mf = new Intl.DateTimeFormat('ar', { month: 'long' });
        weekLabel = df.format(start) + ' – ' + df.format(end) + ' ' + mf.format(start);
      }
      const myPhoto = (me && me.avatar) || (function () { try { return L.avatarUrl ? L.avatarUrl() : ''; } catch (e) { return ''; } })();
      const canvas = await buildLeagueCard({ rows, mine, myPhoto, scope: leagueScopeLabel(), week: weekLabel });
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) { toast('تعذر إنشاء الصورة', 'error'); return; }
      const file = new File([blob], 'mscquiz-league.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'دوري MSCQuiz' });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      // no file share on this device: offer the card + open the Telegram share sheet
      showSharePreview(URL.createObjectURL(blob));
    } catch (e) { toast('تعذر إنشاء المشاركة', 'error'); }
    finally {
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    }
  }

  // ---------------- wire up ----------------
  function bind() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (!$('leave-modal').classList.contains('hidden')) { hideLeaveModal(); return; }
        if (!$('tour-overlay').classList.contains('hidden')) return; // tour has its own skip
        closeDrawers();
        return;
      }
    });
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('beforeunload', (e) => {
      if (dirtySession()) { e.preventDefault(); e.returnValue = ''; }
    });
    // In-app navigation goes through the leave guard.
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#/"]') : null;
      if (!a) return;
      e.preventDefault();
      closeDrawers();
      goHash(a.getAttribute('href'));
    });
    $('leave-stay').addEventListener('click', hideLeaveModal);
    const shareClose = $('share-close');
    if (shareClose) shareClose.addEventListener('click', () => {
      $('share-modal').classList.add('hidden');
      $('share-modal').setAttribute('aria-hidden', 'true');
    });
    $('leave-go').addEventListener('click', () => {
      if (leaveIntent === 'finish') {
        hideLeaveModal();
        closeDrawers();
        finishQuiz();
        return;
      }
      const target = navPending || '';
      S.session = null;
      hideLeaveModal();
      if (location.hash === target) route();
      else location.hash = target;
    });
    window.addEventListener('resize', () => {
      if (tourIdx < 0 || tourIdx >= TOUR_STEPS.length) return;
      if (TOUR_STEPS[tourIdx].go) return;
      tourShow(tourIdx);
    });
    $('btn-retry-load').addEventListener('click', () => location.reload());
    $('btn-back-home').addEventListener('click', () => goHash(''));
    $('btn-start-quiz').addEventListener('click', beginAnswering);
    $('btn-next').addEventListener('click', nextQuestion);
    $('btn-exit').addEventListener('click', () => goHash(''));
    document.querySelectorAll('.btn-menu').forEach((b) => b.addEventListener('click', openMenu));
    $('btn-close-menu').addEventListener('click', closeDrawers);
    const saveBtn = $('btn-save-question');
    if (saveBtn) saveBtn.addEventListener('click', toggleSaveCurrent);
    $('menu-tour').addEventListener('click', () => { closeDrawers(); tourShow(0); });
    const dbgBtn = $('menu-debug');
    if (dbgBtn) dbgBtn.addEventListener('click', () => {
      closeDrawers();
      try { if (window.PortalLog) window.PortalLog.restore(); } catch (e) {}
      const m = $('debug-modal');
      const log = $('debug-modal-log');
      if (log && window.PortalLog) log.textContent = window.PortalLog.snapshot();
      if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
      icons();
    });
    $('debug-close').addEventListener('click', () => {
      const m = $('debug-modal');
      if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
    });
    $('debug-clear').addEventListener('click', () => {
      try { if (window.PortalLog) window.PortalLog.clear(); } catch (e) {}
      const log = $('debug-modal-log');
      if (log) log.textContent = '(فُرغ السجل)';
    });
    $('debug-copy').addEventListener('click', async () => {
      try {
        const txt = window.PortalLog ? window.PortalLog.snapshot() : '';
        if (navigator.clipboard) { await navigator.clipboard.writeText(txt); toast('نُسخ السجل'); }
        else { const log = $('debug-modal-log'); if (log) { log.textContent = txt; toast('انسخ يدوياً من النص'); } }
      } catch (e) { toast('تعذر النسخ'); }
    });
    $('menu-install').addEventListener('click', installApp);
    const offlineBtn = $('menu-offline');
    if (offlineBtn) offlineBtn.addEventListener('click', prepareOffline);
    const menuAccount = $('menu-account');
    if (menuAccount) menuAccount.addEventListener('click', () => { handleAccountTap(); });
    window.addEventListener('online', () => { updateAccountRow(); try { window.PortalCloud && window.PortalCloud.pushSoon(); } catch (e) {} });
    window.addEventListener('offline', updateAccountRow);
    $('menu-sound').addEventListener('click', () => { setSound(!S.sound); });
    $('menu-theme').addEventListener('click', () => toggleTheme());
    const expBtn = $('btn-export-data');
    if (expBtn) expBtn.addEventListener('click', exportData);
    const hideBtn = $('btn-league-hide');
    if (hideBtn) hideBtn.addEventListener('click', async () => {
      try {
        const L = window.PortalLeague;
        if (!L || !L.configured() || !L.linked || !L.linked()) { toast('سجّل الدخول عبر تليجرام أولاً'); return; }
        const m = await L.myRow();
        await L.setHidden(!(m && m.hidden));
        renderLeague();
      } catch (e) { toast('تعذر تحديث الحالة', 'error'); }
    });
    const shareBtn = $('btn-league-share');
    if (shareBtn) shareBtn.addEventListener('click', shareMyRank);
    // league: sync my row when opening the board so the rank is always fresh
    const leagueLink = $('menu-league');
    if (leagueLink) leagueLink.addEventListener('click', () => {
      try {
        const L = window.PortalLeague;
        if (L && L.linked && L.linked() && L.syncWeek) L.syncWeek().catch(() => {});
      } catch (e) {}
    });
    const impInput = $('import-data-input');
    if (impInput) impInput.addEventListener('change', () => {
      if (impInput.files && impInput.files[0]) importData(impInput.files[0]);
      impInput.value = '';
    });
    const clearBtn = $('btn-clear-history');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (S.history.length === 0) { toast('السجل فارغ أصلاً'); return; }
      if (window.confirm('مسح كل سجل المحاولات؟ لا يمكن التراجع.')) {
        clearHistory();
        renderStats();
        toast('تم مسح السجل');
      }
    });
    $('tour-btn-next').addEventListener('click', () => {
      const st = TOUR_STEPS[tourIdx];
      // skipping an action step still performs it, so the tour's screen matches the app
      if (st && st.action === 'start' && S.session && !S.session.started) {
        try { beginAnswering(); } catch (e) {}
      }
      if (tourIdx >= TOUR_STEPS.length - 1) tourDone();
      else tourShow(tourIdx + 1);
    });
    $('tour-btn-prev').addEventListener('click', () => { if (tourIdx > 0) tourShow(tourIdx - 1); });
    $('tour-btn-skip').addEventListener('click', tourDone);
    const openMatrix = $('btn-open-matrix');
    if (openMatrix) openMatrix.addEventListener('click', () => {
      if (!S.session || S.session.finished) { toast('لا يوجد كوز نشط'); return; }
      renderMatrix(); openDrawer('matrix-drawer');
    });
    $('btn-close-matrix').addEventListener('click', closeDrawers);
    $('btn-close-info').addEventListener('click', closeDrawers);
    $('drawer-overlay').addEventListener('click', closeDrawers);
    document.querySelectorAll('.filter-pill').forEach((p) => p.addEventListener('click', () => filterReview(p.dataset.filter)));

    $('btn-lang-toggle').addEventListener('click', () => {
      S.lang = S.lang === 'ar' ? 'en' : (S.lang === 'en' ? 'both' : 'ar');
      document.documentElement.setAttribute('lang', S.lang === 'en' ? 'en' : 'ar');
      saveUI();
      if (S.session && !$('quiz-view').classList.contains('hidden')) renderQuestion();
      else if (S.session && S.lastResults && !$('results-view').classList.contains('hidden')) renderResults(S.lastResults);
      toast(S.lang === 'ar' ? 'العربية فقط' : (S.lang === 'en' ? 'English only' : 'عربي + English معاً'));
    });
    $('btn-sound-toggle').addEventListener('click', () => { setSound(!S.sound); });

    const toggleTheme = () => {
      const root = document.documentElement;
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('portal_theme', next); } catch (e) {}
      syncMenuToggles();
    };
    const themeHeaderBtn = $('btn-theme-header');
    if (themeHeaderBtn) themeHeaderBtn.addEventListener('click', toggleTheme);

    $('btn-timer-pause').addEventListener('click', () => {
      const ses = S.session;
      if (!ses || $('quiz-view').classList.contains('hidden')) return;
      if (!ses.pauseStart) {
        ses.pauseStart = Date.now();
        $('pause-overlay').classList.remove('hidden');
        $('timer-icon').setAttribute('data-lucide', 'play');
      } else {
        ses.pauseAccum += Date.now() - ses.pauseStart;
        ses.pauseStart = null;
        ses.qStart = Date.now();
        $('pause-overlay').classList.add('hidden');
        $('timer-icon').setAttribute('data-lucide', 'pause');
      }
      icons();
    });
    $('btn-resume-quiz').addEventListener('click', () => $('btn-timer-pause').click());

    $('btn-retry-quiz').addEventListener('click', () => {
      const ses = S.session;
      if (ses && ses.replay && ses.replay.type === 'saved') {
        const items = ses.replay.keys.map((k) => ({ key: k, origin: S.saved[k].origin, snapshot: S.saved[k].snapshot })).filter((it) => it.origin);
        if (items.length) { startSavedPractice(items); return; }
      }
      startSession(ses.sub.subject_id, ses.ch.quiz_id, null);
      beginAnswering();
    });
    $('btn-retry-wrong').addEventListener('click', () => {
      const ses = S.session;
      const from = { questions: ses.questions, picks: ses.picks };
      const n0 = ses.questions.length;
      if (ses.replay && ses.replay.type === 'saved') {
        const subset = window.PortalAnalytics.buildWrongOnly(from.questions, from.picks);
        if (!subset) { toast('لا توجد أخطاء لإعادتها — أحسنت!'); return; }
        const meta = { subjectId: ses.sub.subject_id, subjectTitle: ses.sub.subject_title, chapterNo: ses.ch.chapter_no, chapterLabel: ses.chapterLabel, topic: ses.title, quizId: null, retryWrong: true, replay: ses.replay };
        launchSession(subset, meta);
        beginAnswering();
        return;
      }
      startSession(ses.sub.subject_id, ses.ch.quiz_id, from);
      if (S.session && S.session.questions.length < n0) beginAnswering();
    });
    $('btn-back-catalog').addEventListener('click', () => goHash(''));

    document.addEventListener('keydown', (e) => {
      if ($('quiz-view').classList.contains('hidden') || S.session === null) return;
      if (e.target.matches('input, textarea')) return;
      const k = e.key.toLowerCase();
      const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
      if (k in map) pickOption(map[k]);
      else if (k === 'enter') nextQuestion();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') nextQuestion();
    });
  }

  // ---------------- boot ----------------
  // ---------------- version guard: never run a stale shell ----------------
  const SHELL_VERSION = 'v37';
  async function guardShell() {
    try {
      const marker = localStorage.getItem('portal_shell_version');
      if (marker && marker !== SHELL_VERSION) {
        // A newer shell is deployed: drop cached state that may conflict and reload once.
        localStorage.removeItem('portal_shell_version');
      }
      localStorage.setItem('portal_shell_version', SHELL_VERSION);
    } catch (e) {}
  }
  // ---------------- offline / service-worker diagnostics ----------------
  async function offlineState() {
    const out = { supported: ('serviceWorker' in navigator), controller: false, reg: 'none', caches: {} };
    const race = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('t')), ms || 2000))]);
    try { out.controller = !!navigator.serviceWorker.controller; } catch (e) {}
    try {
      if (out.supported) {
        const reg = await race(navigator.serviceWorker.getRegistration());
        out.reg = reg ? (reg.active ? 'active' : (reg.installing ? 'installing' : (reg.waiting ? 'waiting' : 'registered'))) : 'none';
      }
    } catch (e) { out.reg = 'timeout'; }
    try {
      const names = await race(caches.keys());
      for (let i = 0; i < names.length; i++) {
        const c = await caches.open(names[i]);
        const keys = await race(c.keys());
        out.caches[names[i]] = keys.length;
      }
    } catch (e) {}
    return out;
  }

  function logOfflineState() {
    // log the synchronous facts first: inside Telegram's WebView the async
    // service-worker APIs can hang, and then we would learn nothing at all
    let quick = 'sw=NO controller=no';
    try {
      quick = 'sw=' + (('serviceWorker' in navigator) ? 'yes' : 'NO') +
        ' controller=' + ((navigator.serviceWorker && navigator.serviceWorker.controller) ? 'yes' : 'no');
    } catch (e) {}
    try { if (window.PortalLog) window.PortalLog.info('offline', quick); } catch (e) {}
    const log = (st) => {
      try {
        if (window.PortalLog) {
          window.PortalLog.info('offline', 'reg=' + st.reg + ' caches=' + JSON.stringify(st.caches));
        }
      } catch (e) {}
    };
    offlineState().then(log).catch(() => {});
    setTimeout(() => { offlineState().then(log).catch(() => {}); }, 6000);
  }

  async function boot() {
    await guardShell();
    try { if (window.PortalLog) { window.PortalLog.restore(); window.PortalLog.info('boot', 'start href=' + location.href.slice(0, 80)); } } catch (e) {}
    try {
      const savedTheme = localStorage.getItem('portal_theme');
      if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    } catch (e) {}
    loadUI();
    if (S.lang === 'en') document.documentElement.setAttribute('lang', 'en');
    bind();
    initTelegram();
    show('quiz-loading');
    try {
      await loadData();
      renderSubjectChips();
      renderChapterChips();
      route();
      updateSavedBadge(); updateMenuCounts();
      syncMenuToggles();
      updateAccountRow();
      icons();
      if (DEBUG) { window.__portal = { S: S }; $('debug-panel').classList.remove('hidden'); }
      {
        const badge = $('test-mode-badge');
        if (badge) {
          if (S.index && S.index.test_mode === true) badge.classList.remove('hidden');
          else badge.classList.add('hidden');
        }
      }
      if (window.PortalLog) window.PortalLog.info('boot', 'ok subjects=' + (S.index ? S.index.subjects.length : 0) + ' test_mode=' + (S.index ? S.index.test_mode : '?'));
      logOfflineState();
      // Show the tour exactly once per device: mark it seen the moment it opens,
      // so a reload mid-tour never brings it back (it is replayable from the menu).
      if (!tourGet(TOUR_KEY)) setTimeout(() => { if (tourIdx < 0) { tourSet(TOUR_KEY); tourShow(0); } }, 1200);
      dbg('boot ok. subjects:', S.index.subjects.length);
    } catch (e) {
      try { if (window.PortalLog) window.PortalLog.error('boot', String((e && e.message) || e)); } catch (e2) {}
      console.error(e);
      showError('فشل تحميل البيانات: ' + e.message);
    }
  }

  function showError(msg) {
    $('error-message').textContent = msg;
    show('quiz-error');
  }

  // SW tells open tabs that a new shell is live -> refresh once so the new
  // assets (and the new Telegram identity path) are actually in use.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
      if (ev && ev.data && ev.data.type === 'sw-activated') {
        try {
          if (sessionStorage.getItem('portal_sw_reloaded') !== ev.data.cache) {
            sessionStorage.setItem('portal_sw_reloaded', ev.data.cache);
            location.reload();
          }
        } catch (e) {}
      }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
