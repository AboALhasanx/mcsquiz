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
    region.innerHTML = ''; // single-toast policy: replace, never stack
    const t = document.createElement('div');
    t.className = 'portal-toast';
    t.textContent = msg;
    region.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => { if (t.parentNode === region) region.innerHTML = ''; }, 300); }, 2600);
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
    lang: 'ar',         // 'ar' | 'en'
    sound: true,
    session: null,      // {sub, ch, title, chapterLabel, questions, picks, dwells, idx, ..., replay}
    saved: {},          // saveKey -> {origin, snapshot, savedAt}
    savedSubject: null, // saved-view filter
    savedChapter: null, // saved-view filter
  };

  const SAVED_KEY = 'portal_saved_v1';
  const TOUR_KEY = 'portal_tour_done';
  const QUIZ_HINT_KEY = 'portal_quiz_hint';

  function loadSaved() {
    try { S.saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {}; }
    catch (e) { S.saved = {}; }
  }
  try { loadSaved(); } catch (e) {}
  function persistSaved() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(S.saved)); } catch (e) {}
  }
  function saveKeyOf(origin, qid) { return origin.subjectId + '|' + origin.quizId + '|' + qid; }

  const VIEWS = ['deck-catalog', 'quiz-loading', 'quiz-error', 'quiz-start-view', 'quiz-view',
    'results-view', 'saved-view'];
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

  function chLabel(ch) { return 'تشابتر ' + ch.chapter_no; }

  function currentSubject() {
    if (S.index && S.index.subjects.some((s) => s.subject_id === S.subjectFilter)) {
      return S.index.subjects.find((s) => s.subject_id === S.subjectFilter);
    }
    return S.index ? S.index.subjects[0] : null;
  }

  function currentChapter(sub) {
    sub = sub || currentSubject();
    if (sub.chapters.some((c) => c.chapter_no === S.chapterFilter)) {
      return sub.chapters.find((c) => c.chapter_no === S.chapterFilter);
    }
    return sub.chapters[0];
  }

  function renderSubjectChips() {
    const bar = $('subject-filter-bar');
    bar.innerHTML = '';
    if (!S.subjectFilter || !S.index.subjects.some((s) => s.subject_id === S.subjectFilter)) {
      S.subjectFilter = S.index.subjects[0].subject_id;
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
        renderSubjectChips(); renderChapterChips(); renderCatalog();
      });
      return b;
    };
    S.index.subjects.forEach((s) => bar.appendChild(mk(s.subject_id, s.subject_title)));
  }

  function visibleChapters() {
    const sub = currentSubject();
    return sub.chapters
      .filter((c) => c.chapter_no === currentChapter(sub).chapter_no)
      .map((ch) => ({ sub: sub, ch: ch }));
  }

  function renderChapterChips() {
    const bar = $('chapter-filter-bar');
    const sub = currentSubject();
    if (!S.chapterFilter || !sub.chapters.some((c) => c.chapter_no === S.chapterFilter)) {
      S.chapterFilter = sub.chapters[0].chapter_no;
    }
    bar.innerHTML = '';
    if (sub.chapters.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    sub.chapters.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'filter-chip chapter-chip' + (S.chapterFilter === c.chapter_no ? ' active' : '');
      b.textContent = chLabel(c);
      b.setAttribute('aria-pressed', S.chapterFilter === c.chapter_no ? 'true' : 'false');
      b.addEventListener('click', () => { S.chapterFilter = c.chapter_no; renderChapterChips(); renderCatalog(); });
      bar.appendChild(b);
    });
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
      '<li><strong>التشابتر:</strong> ' + escapeHtml(chLabel(ch)) + '</li>' +
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
      idx: 0, retryWrong: !!meta.retryWrong,
      replay: meta.replay || null,
      startEpoch: Date.now(), pauseAccum: 0, pauseStart: null,
      qStart: Date.now(), timerId: null,
    };

    $('quiz-subtitle').textContent = meta.subjectTitle + ' · ' + (meta.chapterLabel || chLabel({ chapter_no: meta.chapterNo }));
    $('quiz-title').textContent = meta.topic;
    $('start-subject-badge').textContent = meta.subjectTitle + ' · ' + (meta.chapterLabel || chLabel({ chapter_no: meta.chapterNo }));
    $('start-quiz-title').textContent = meta.topic;
    $('start-questions-count').textContent = pool.length;
    $('start-estimated-time').textContent = Math.max(1, Math.round(pool.length * 1.5));
    $('question-total-label').textContent = pool.length;
    $('live-feedback-box').classList.add('hidden');
    updateSaveBtn();
    show('quiz-start-view');
    dbg('session start:', meta.quizId, 'n=', pool.length, 'retryWrong=', !!meta.retryWrong);
  }

  function startSession(subjectId, quizId, wrongOnlyFrom) {
    const sub = S.index.subjects.find((s) => s.subject_id === subjectId);
    const ch = sub && sub.chapters.find((c) => c.quiz_id === quizId);
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
    const box = $('saved-groups');
    box.innerHTML = '';
    const groups = savedGroups();
    let total = 0;
    groups.forEach((g) => g.chapters.forEach((c) => { total += c.items.length; }));
    $('saved-total-line').textContent = total === 0 ? '' : total + ' أسئلة محفوظة في ' + groups.length + ' مواد';
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
        b.addEventListener('click', () => { S.savedSubject = g.subjectId; S.savedChapter = null; renderSaved(); });
        subBar.appendChild(b);
      });
    }
    const chNos = sub.chapters.map((c) => c.chapterNo);
    if (!S.savedChapter || !chNos.includes(S.savedChapter)) S.savedChapter = chNos[0];
    if (chBar) {
      chBar.innerHTML = '';
      if (chNos.length <= 1) { chBar.style.display = 'none'; }
      else {
        chBar.style.display = '';
        chNos.forEach((n) => {
          const b = document.createElement('button');
          b.className = 'filter-chip chapter-chip' + (S.savedChapter === n ? ' active' : '');
          b.textContent = 'تشابتر ' + n;
          b.setAttribute('aria-pressed', S.savedChapter === n ? 'true' : 'false');
          b.addEventListener('click', () => { S.savedChapter = n; renderSaved(); });
          chBar.appendChild(b);
        });
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
      '</div><div class="saved-group-sub">' + subAll.length + ' أسئلة محفوظة في ' + sub.chapters.length + ' تشابترات</div>';
    subHead.appendChild(subTitle);
    const genSub = document.createElement('button');
    genSub.type = 'button';
    genSub.className = 'action-btn primary-btn saved-gen-btn';
    genSub.innerHTML = '<i data-lucide="zap"></i><span>توليد اختبار للمادة (' + subAll.length + ')</span>';
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
    head.innerHTML = '<div><div class="saved-group-title">' + escapeHtml('تشابتر ' + c.chapterNo) +
      '</div><div class="saved-group-sub">' + c.items.length + ' أسئلة</div></div>';
    const train = document.createElement('button');
    train.type = 'button';
    train.className = 'action-btn primary-btn saved-train-btn';
    train.innerHTML = '<i data-lucide="target"></i><span>توليد اختبار للتشابتر (' + c.items.length + ')</span>';
    train.setAttribute('aria-label', 'توليد اختبار لتشابتر ' + c.chapterNo);
    train.addEventListener('click', () => startSavedPractice(
      c.items,
      'اختبار محفوظ ' + sub.subjectTitle + ' ' + 'تشابتر ' + c.chapterNo,
      'تشابتر ' + c.chapterNo + ' (' + c.items.length + ' أسئلة)'
    ));
    head.appendChild(train);
    wrap.appendChild(head);
    c.items.forEach((it) => {
      const q = it.snapshot;
      const isAr = S.lang === 'ar';
      const opts = isAr ? (q.options_ar || q.options) : (q.options_en || q.options);
      const card = document.createElement('div');
      card.className = 'review-card correct-border saved-card';
      const stem = document.createElement('p');
      stem.className = 'review-question-text';
      stem.textContent = isAr ? (q.question_ar || q.question) : (q.question_en || q.question);
      card.appendChild(stem);
      const optionsList = document.createElement('div');
      optionsList.className = 'review-options-list';
      opts.forEach((t, oi) => {
        if (oi !== q.correct) return;
        const item = document.createElement('div');
        item.className = 'review-option-item correct-answer';
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

  function nextQuestion() {
    const ses = S.session;
    if (ses.pauseStart) { toast('الكوز متوقف مؤقتاً — اضغط استئناف للمتابعة'); return; }
    if (ses.picks[ses.idx] === null) { toast('أجب على السؤال أولاً'); return; }
    if (ses.idx < ses.questions.length - 1) {
      ses.idx++;
      ses.qStart = Date.now();
      renderQuestion();
      renderMatrix();
    } else {
      const remaining = ses.picks.filter((p) => p === null).length;
      if (remaining > 0) {
        toast('لم تجب على كل الأسئلة — متبقٍ ' + remaining + ' — استخدم جدول الأسئلة');
        renderMatrix();
        openDrawer('matrix-drawer');
        return;
      }
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
      c.addEventListener('click', () => { if (ses.pauseStart) { toast('الكوز متوقف مؤقتاً — اضغط استئناف للمتابعة'); return; } ses.idx = i; ses.qStart = Date.now(); renderQuestion(); renderMatrix(); closeDrawers(); });
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
      escapeHtml(ses.sub.subject_title + ' · ' + (ses.chapterLabel || chLabel(ses.ch))) + '</span>' +
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
    if (h === '#/saved' || h === '#/saved/') {
      S.session = null;
      renderSaved();
      show('saved-view');
      window.scrollTo(0, 0);
      icons();
    } else if (m) {
      startSession(decodeURIComponent(m[1]), decodeURIComponent(m[2]), null);
    } else {
      S.session = null;
      renderCatalog();
      show('deck-catalog');
    }
  }

  // ---------------- guided tour (custom spotlight, short steps, replayable, hands-on) ----------------
  const TOUR_STEPS = [
    { title: 'أهلاً بك في MSCQuiz', body: 'كوزات موادك هنا. جولة تفاعلية قصيرة — ستجرّب بنفسك.', center: true },
    { title: '1 — اختر المادة', body: 'كل مادة بزر مستقل.', target: '#subject-filter-bar' },
    { title: '2 — اختر التشابتر', body: 'التشابترات مرقمة: 1، 2…', target: '#chapter-filter-bar' },
    { title: '3 — ابدأ الكوز', body: 'زر التشغيل يبدأ فوراً. زر (i) يعرض التفاصيل.', target: '#deck-catalog .sketch-row:first-child .sketch-play-cell' },
    { title: '4 — المحفوظ', body: 'أسئلتك المحفوظة هنا، مقسمة حسب المادة والتشابتر.', target: '#btn-open-saved' },
    { title: 'تجربة حقيقية', body: 'سنفتح أول كوز لتجرب بنفسك.', center: true, go: true },
    { title: '5 — ابدأ', body: 'اضغط زر البدء لينطلق المؤقت.', target: '#btn-start-quiz', action: 'start' },
    { title: '6 — أجب', body: 'اضغط أي إجابة — جرّب بنفسك.', target: '#options-container', action: 'answer' },
    { title: '7 — الشرح والحفظ', body: 'يظهر الشرح فوراً. زر الحفظ أعلى البطاقة يحفظ السؤال.', target: '#btn-save-question' },
    { title: '8 — أدوات الامتحان', body: 'الترجمة، الثيم، وإيقاف المؤقت مؤقتاً من الأعلى.', target: '#header-session-view .header-right' },
    { title: '9 — التنقل', body: 'جدول الأسئلة يقفز لأي سؤال. زر التالي ينهي عند آخر سؤال.', target: '#btn-open-matrix' },
    { title: 'انطلق', body: 'أكمل الكوز بنفسك. في النهاية: نتيجتك وتحليلها ومراجعة الأخطاء.', center: true },
  ];
  let tourIdx = -1;

  function tourGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function tourSet(key) { try { localStorage.setItem(key, '1'); } catch (e) {} }

  function tourShow(i) {
    tourIdx = i;
    const ov = $('tour-overlay');
    if (i < 0 || i >= TOUR_STEPS.length) { tourHide(); return; }
    const st = TOUR_STEPS[i];
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
      el = st.target && document.querySelector(st.target);
      if (!el || !el.offsetParent) { tourShow(i + 1); return; } // skip missing target
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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

  // ---------------- wire up ----------------
  function bind() {
    window.addEventListener('hashchange', route);
    window.addEventListener('resize', () => {
      if (tourIdx < 0 || tourIdx >= TOUR_STEPS.length) return;
      if (TOUR_STEPS[tourIdx].go) return;
      tourShow(tourIdx);
    });
    $('btn-retry-load').addEventListener('click', () => location.reload());
    $('btn-back-home').addEventListener('click', () => { location.hash = ''; });
    $('btn-start-quiz').addEventListener('click', beginAnswering);
    $('btn-next').addEventListener('click', nextQuestion);
    $('btn-exit').addEventListener('click', () => { location.hash = ''; });
    const saveBtn = $('btn-save-question');
    if (saveBtn) saveBtn.addEventListener('click', toggleSaveCurrent);
    $('btn-tour-replay').addEventListener('click', () => tourShow(0));
    const replaySession = $('btn-tour-replay-session');
    if (replaySession) replaySession.addEventListener('click', () => tourShow(0));
    $('tour-btn-next').addEventListener('click', () => {
      if (tourIdx >= TOUR_STEPS.length - 1) tourDone();
      else tourShow(tourIdx + 1);
    });
    $('tour-btn-prev').addEventListener('click', () => { if (tourIdx > 0) tourShow(tourIdx - 1); });
    $('tour-btn-skip').addEventListener('click', tourDone);
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
      updateSavedBadge();
      icons();
      if (DEBUG) { window.__portal = { S: S }; $('debug-panel').classList.remove('hidden'); }
      if (S.index && S.index.test_mode === false) {
        const badge = $('test-mode-badge');
        if (badge) badge.style.display = 'none';
      }
      if (!tourGet(TOUR_KEY)) setTimeout(() => { if (tourIdx < 0) tourShow(0); }, 1200);
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
