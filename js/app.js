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

  function dbg(...args) {
    if (!DEBUG) return;
    const el = $('debug-output');
    if (el) el.textContent += args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
    console.log('[portal-debug]', ...args);
  }

  function toast(msg) {
    const region = $('toast-region');
    if (!region) return;
    const t = document.createElement('div');
    t.className = 'portal-toast';
    t.textContent = msg;
    region.appendChild(t);
    setTimeout(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
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
    subjectFilter: 'all',
    chapterFilter: 'all',
    lang: 'ar',         // 'ar' | 'en'
    sound: true,
    session: null,      // {bank, questions, picks, dwells, idx, startEpoch, paused, pauseAccum, pauseStart, timerId, retryWrong}
  };

  const VIEWS = ['deck-catalog', 'quiz-loading', 'quiz-error', 'quiz-start-view', 'quiz-view', 'results-view'];
  function show(viewId) {
    VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== viewId));
    $('quiz-session-topbar').style.display = (viewId === 'quiz-start-view' || viewId === 'quiz-view') ? 'block' : 'none';
    $('header-catalog-view').style.display = (viewId === 'deck-catalog') ? 'flex' : 'none';
    $('header-session-view').style.display = (viewId === 'deck-catalog') ? 'none' : 'flex';
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
  }

  function renderSubjectChips() {
    const bar = $('subject-filter-bar');
    bar.innerHTML = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.className = 'filter-chip' + (S.subjectFilter === id ? ' active' : '');
      b.dataset.subject = id;
      b.textContent = label;
      b.setAttribute('aria-pressed', S.subjectFilter === id ? 'true' : 'false');
      b.addEventListener('click', () => {
        S.subjectFilter = id;
        S.chapterFilter = 'all';
        renderSubjectChips(); renderChapterChips(); renderCatalog();
      });
      return b;
    };
    bar.appendChild(mk('all', 'الكل'));
    S.index.subjects.forEach((s) => bar.appendChild(mk(s.subject_id, s.subject_title)));
  }

  function visibleChapters() {
    const out = [];
    S.index.subjects.forEach((s) => {
      if (S.subjectFilter !== 'all' && s.subject_id !== S.subjectFilter) return;
      s.chapters.forEach((c) => out.push({ sub: s, ch: c }));
    });
    return out;
  }

  function renderChapterChips() {
    const bar = $('chapter-filter-bar');
    bar.innerHTML = '';
    const seen = [];
    visibleChapters().forEach(({ ch }) => { if (!seen.includes(ch.chapter)) seen.push(ch.chapter); });
    if (seen.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.className = 'filter-chip chapter-chip' + (S.chapterFilter === id ? ' active' : '');
      b.textContent = label;
      b.setAttribute('aria-pressed', S.chapterFilter === id ? 'true' : 'false');
      b.addEventListener('click', () => { S.chapterFilter = id; renderChapterChips(); renderCatalog(); });
      return b;
    };
    bar.appendChild(mk('all', 'كل التشابترات'));
    seen.forEach((c) => bar.appendChild(mk(c, c)));
  }

  function renderCatalog() {
    const box = $('catalog-cards-container');
    box.innerHTML = '';
    let count = 0;
    visibleChapters().forEach(({ sub, ch }) => {
      if (S.chapterFilter !== 'all' && ch.chapter !== S.chapterFilter) return;
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
          '<span class="sketch-meta-dot">·</span><span class="sketch-sem-tag">' + escapeHtml(ch.chapter) + '</span>' +
          '<span class="sketch-meta-dot">·</span><span class="sketch-count-tag">' + bank.questions.length + ' أسئلة</span>' +
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
      '<li><strong>التشابتر:</strong> ' + escapeHtml(ch.chapter) + '</li>' +
      '<li><strong>الأسئلة:</strong> ' + bank.questions.length + '</li>' +
      (best_text(ch.quiz_id));
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

  function startSession(subjectId, quizId, wrongOnlyFrom) {
    const sub = S.index.subjects.find((s) => s.subject_id === subjectId);
    const ch = sub && sub.chapters.find((c) => c.quiz_id === quizId);
    const bank = S.banks[quizId];
    if (!sub || !ch || !bank) { showError('لم يتم العثور على الكوز المطلوب.'); return; }

    let pool = bank.questions.map((q) => JSON.parse(JSON.stringify(q)));
    let retryWrong = false;
    if (wrongOnlyFrom) {
      const sub2 = window.PortalAnalytics.buildWrongOnly(wrongOnlyFrom.questions, wrongOnlyFrom.picks);
      if (!sub2) { toast('لا توجد أخطاء لإعادتها — أحسنت!'); return; }
      pool = sub2; retryWrong = true;
    }
    shuffle(pool);
    // Always shuffle options; remap correct (fixes positional bias).
    pool.forEach((q) => {
      const order = shuffle([0, 1, 2, 3]);
      q.options = order.map((i) => q.options[i]);
      q.options_ar = order.map((i) => q.options_ar[i]);
      q.options_en = order.map((i) => q.options_en[i]);
      q.correct = order.indexOf(q.correct);
    });

    S.session = {
      sub: sub, ch: ch, bank: bank,
      questions: pool,
      picks: new Array(pool.length).fill(null),
      dwells: new Array(pool.length).fill(0),
      idx: 0, retryWrong: retryWrong,
      startEpoch: Date.now(), pauseAccum: 0, pauseStart: null,
      qStart: Date.now(), timerId: null,
    };

    $('quiz-subtitle').textContent = sub.subject_title + ' · ' + ch.chapter;
    $('quiz-title').textContent = bank.topic;
    $('start-subject-badge').textContent = sub.subject_title + ' · ' + ch.chapter;
    $('start-quiz-title').textContent = bank.topic;
    $('start-questions-count').textContent = pool.length;
    $('start-estimated-time').textContent = Math.max(1, Math.round(pool.length * 1.5));
    $('question-total-label').textContent = pool.length;
    $('live-feedback-box').classList.add('hidden');
    show('quiz-start-view');
    dbg('session start:', quizId, 'n=', pool.length, 'retryWrong=', retryWrong);
  }

  function beginAnswering() {
    const ses = S.session;
    show('quiz-view');
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

  function qText(q) { return S.lang === 'ar' ? (q.question_ar || q.question) : (q.question_en || q.question); }
  function qOpts(q) { return S.lang === 'ar' ? (q.options_ar || q.options) : (q.options_en || q.options); }

  function renderQuestion() {
    const ses = S.session;
    const q = ses.questions[ses.idx];
    const isAr = S.lang === 'ar';
    const letters = isAr ? ['أ', 'ب', 'ج', 'د'] : ['A', 'B', 'C', 'D'];
    $('question-index-label').textContent = ses.idx + 1;
    $('progress-bar-fill').style.width = (ses.idx / ses.questions.length) * 100 + '%';
    const qEl = $('question-text');
    qEl.textContent = qText(q);
    qEl.style.direction = isAr ? 'rtl' : 'ltr';
    qEl.style.textAlign = isAr ? 'right' : 'left';
    const box = $('options-container');
    box.innerHTML = '';
    const locked = ses.picks[ses.idx] !== null;
    box.classList.toggle('locked', locked);
    const opts = qOpts(q);
    opts.forEach((text, i) => {
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
      btn.style.direction = isAr ? 'rtl' : 'ltr';
      btn.style.textAlign = isAr ? 'right' : 'left';
      const letter = document.createElement('div');
      letter.className = 'option-letter';
      letter.textContent = letters[i];
      const content = document.createElement('div');
      content.className = 'option-content';
      content.textContent = text;
      btn.appendChild(letter);
      btn.appendChild(content);
      if (!locked) btn.addEventListener('click', () => pickOption(i));
      box.appendChild(btn);
    });
    const showExpl = locked && ses.picks[ses.idx] !== q.correct;
    $('live-feedback-box').classList.toggle('hidden', !showExpl);
    if (showExpl) $('live-explanation-text').textContent = q.explanation || '';
    if (ses.idx === ses.questions.length - 1) {
      $('next-btn-text').textContent = 'إنهاء الكوز';
      $('next-btn-icon').setAttribute('data-lucide', 'check-circle');
    } else {
      $('next-btn-text').textContent = 'التالي';
      $('next-btn-icon').setAttribute('data-lucide', 'arrow-left');
    }
    icons();
  }

  function pickOption(i) {
    const ses = S.session;
    if (ses.picks[ses.idx] !== null || ses.pauseStart) return;
    ses.picks[ses.idx] = i;
    ses.dwells[ses.idx] = (Date.now() - ses.qStart) / 1000;
    const q = ses.questions[ses.idx];
    if (i === q.correct) playSound('correct'); else playSound('wrong');
    renderQuestion();
    renderMatrix();
  }

  function nextQuestion() {
    const ses = S.session;
    if (ses.picks[ses.idx] === null) { toast('أجب على السؤال أولاً'); return; }
    if (ses.idx < ses.questions.length - 1) {
      ses.idx++;
      ses.qStart = Date.now();
      renderQuestion();
      renderMatrix();
    } else {
      finishQuiz();
    }
  }

  function renderMatrix() {
    const ses = S.session;
    const grid = $('matrix-grid');
    grid.innerHTML = '';
    ses.questions.forEach((q, i) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'matrix-cell' + (ses.picks[i] !== null ? ' answered' : '') + (i === ses.idx ? ' current' : '');
      c.textContent = i + 1;
      c.setAttribute('aria-label', 'السؤال ' + (i + 1));
      c.addEventListener('click', () => { ses.idx = i; ses.qStart = Date.now(); renderQuestion(); renderMatrix(); closeDrawers(); });
      grid.appendChild(c);
    });
  }

  function finishQuiz() {
    const ses = S.session;
    clearInterval(ses.timerId);
    $('progress-bar-fill').style.width = '100%';
    playSound('completed');
    const res = window.PortalAnalytics.analyze(ses.questions, ses.picks, ses.dwells, elapsedSec());
    setBest(ses.ch.quiz_id, res.pct, res.correct + ' / ' + res.total);
    renderResults(res);
    show('results-view');
    window.scrollTo(0, 0);
    dbg('result:', res);
  }

  // ---------------- results ----------------
  function renderResults(res) {
    $('score-percentage').textContent = res.pct + '%';
    $('score-fraction').textContent = res.correct + ' / ' + res.total;
    $('score-badge-text').textContent = res.band.ar;
    $('stat-correct').textContent = res.correct;
    $('stat-wrong').textContent = res.wrong;
    $('stat-total-time').textContent = res.totalTime;
    $('stat-avg-dwell').textContent = res.avgDwell + ' ث';

    const cb = $('chapter-breakdown');
    const ses = S.session;
    cb.innerHTML = '<div class="chapter-row"><span class="chapter-name">' +
      escapeHtml(ses.sub.subject_title + ' · ' + ses.ch.chapter) + '</span>' +
      '<span class="chapter-pct">' + res.correct + ' / ' + res.total + '</span></div>';

    $('filter-count-all').textContent = res.total;
    $('filter-count-wrong').textContent = res.wrong;
    $('filter-count-correct').textContent = res.correct;

    const list = $('review-cards-list');
    list.innerHTML = '';
    const isAr = S.lang === 'ar';
    const letters = isAr ? ['أ', 'ب', 'ج', 'د'] : ['A', 'B', 'C', 'D'];
    ses.questions.forEach((q, i) => {
      const picked = ses.picks[i];
      const ok = picked === q.correct;
      const opts = isAr ? (q.options_ar || q.options) : (q.options_en || q.options);
      const card = document.createElement('div');
      card.className = 'review-card ' + (ok ? 'correct-border' : 'wrong-border');
      card.dataset.ok = ok ? 'correct' : 'wrong';
      card.setAttribute('data-q-index', i);

      const header = document.createElement('div');
      header.className = 'review-card-header';
      const dwellSec = Math.round(Number(ses.dwells[i]) || 0);
      header.innerHTML =
        '<div class="review-q-meta"><span class="review-q-num">سؤال ' + (i + 1) + '</span>' +
        '<span class="review-status-tag ' + (ok ? 'correct' : 'wrong') + '">' +
        '<i data-lucide="' + (ok ? 'check' : 'x') + '"></i><span>' + (ok ? 'صحيحة' : 'خاطئة') + '</span></span></div>' +
        '<span class="review-dwell-tag"><i data-lucide="clock"></i><span>' + dwellSec + 's</span></span>';
      card.appendChild(header);

      const stem = document.createElement('p');
      stem.className = 'review-question-text';
      stem.textContent = isAr ? (q.question_ar || q.question) : (q.question_en || q.question);
      stem.style.direction = isAr ? 'rtl' : 'ltr';
      stem.style.textAlign = isAr ? 'right' : 'left';
      card.appendChild(stem);

      const optionsList = document.createElement('div');
      optionsList.className = 'review-options-list';
      opts.forEach((t, oi) => {
        if (oi !== picked && oi !== q.correct) return; // show only pick + correct
        let optClass = 'review-option-item';
        if (oi === picked && !ok) optClass += ' user-wrong';
        else if (oi === q.correct) optClass += ' correct-answer';
        const item = document.createElement('div');
        item.className = optClass;
        item.style.direction = isAr ? 'rtl' : 'ltr';
        item.style.textAlign = isAr ? 'right' : 'left';
        item.innerHTML = '<span class="review-option-indicator">' + letters[oi] +
          '</span><span class="review-option-text">' + escapeHtml(t) + '</span>';
        optionsList.appendChild(item);
      });
      card.appendChild(optionsList);

      if (q.explanation) {
        const exp = document.createElement('div');
        exp.className = 'review-explanation-box';
        exp.innerHTML = '<strong>الشرح</strong><span>' + escapeHtml(q.explanation) + '</span>';
        card.appendChild(exp);
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
      c.style.display = (f === 'all' || c.dataset.ok === f) ? '' : 'none';
    });
  }

  // ---------------- routing ----------------
  function route() {
    const h = location.hash;
    const m = h.match(/^#\/quiz\/([^/]+)\/([^/]+)$/);
    if (m) {
      startSession(decodeURIComponent(m[1]), decodeURIComponent(m[2]), null);
    } else {
      S.session = null;
      renderCatalog();
      show('deck-catalog');
    }
  }

  // ---------------- wire up ----------------
  function bind() {
    window.addEventListener('hashchange', route);
    $('btn-retry-load').addEventListener('click', () => location.reload());
    $('btn-back-home').addEventListener('click', () => { location.hash = ''; });
    $('btn-start-quiz').addEventListener('click', beginAnswering);
    $('btn-next').addEventListener('click', nextQuestion);
    $('btn-exit').addEventListener('click', () => { location.hash = ''; });
    $('btn-open-matrix').addEventListener('click', () => { renderMatrix(); openDrawer('matrix-drawer'); });
    $('btn-close-matrix').addEventListener('click', closeDrawers);
    $('btn-close-info').addEventListener('click', closeDrawers);
    $('drawer-overlay').addEventListener('click', closeDrawers);
    document.querySelectorAll('.filter-pill').forEach((p) => p.addEventListener('click', () => filterReview(p.dataset.filter)));

    $('btn-lang-toggle').addEventListener('click', () => {
      S.lang = S.lang === 'ar' ? 'en' : 'ar';
      document.documentElement.setAttribute('lang', S.lang === 'ar' ? 'ar' : 'en');
      if (S.session && !$('quiz-view').classList.contains('hidden')) renderQuestion();
      toast(S.lang === 'ar' ? 'العربية' : 'English');
    });
    $('btn-sound-toggle').addEventListener('click', () => {
      S.sound = !S.sound;
      $('sound-icon').setAttribute('data-lucide', S.sound ? 'volume-2' : 'volume-x');
      icons();
    });

    const toggleTheme = () => {
      const root = document.documentElement;
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('portal_theme', next); } catch (e) {}
    };
    $('btn-theme-toggle').addEventListener('click', toggleTheme);
    $('btn-theme-toggle-session').addEventListener('click', toggleTheme);

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
      startSession(ses.sub.subject_id, ses.ch.quiz_id, null);
      beginAnswering();
    });
    $('btn-retry-wrong').addEventListener('click', () => {
      const ses = S.session;
      const from = { questions: ses.questions, picks: ses.picks };
      const n0 = ses.questions.length;
      startSession(ses.sub.subject_id, ses.ch.quiz_id, from);
      if (S.session && S.session.questions.length < n0) beginAnswering();
    });
    $('btn-back-catalog').addEventListener('click', () => { location.hash = ''; });

    document.addEventListener('keydown', (e) => {
      if ($('quiz-view').classList.contains('hidden') || S.session === null) return;
      if (e.target.matches('input, textarea')) return;
      const k = e.key.toLowerCase();
      const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
      if (k in map) pickOption(map[k]);
      else if (k === 'enter') nextQuestion();
      else if (k === 'arrowleft' || k === 'arrowright') nextQuestion();
    });
  }

  // ---------------- boot ----------------
  async function boot() {
    try {
      const savedTheme = localStorage.getItem('portal_theme');
      if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    } catch (e) {}
    bind();
    show('quiz-loading');
    try {
      await loadData();
      renderSubjectChips();
      renderChapterChips();
      route();
      icons();
      if (DEBUG) { window.__portal = { S: S }; $('debug-panel').classList.remove('hidden'); }
      dbg('boot ok. subjects:', S.index.subjects.length);
    } catch (e) {
      console.error(e);
      showError('فشل تحميل البيانات: ' + e.message);
    }
  }

  function showError(msg) {
    $('error-message').textContent = msg;
    show('quiz-error');
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
