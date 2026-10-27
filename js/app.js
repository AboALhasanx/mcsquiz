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
        statsRange: S.statsRange,
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
      if (u.statsRange !== undefined && u.statsRange !== null) S.statsRange = Number(u.statsRange);
      if (u.lang === 'en' || u.lang === 'ar') S.lang = u.lang;
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
    touchData();
    cloudPush();
  }

  // the moment the personal data really changed — the sync compares this with
  // the server's write time, so a stale device can never clobber a newer one
  function touchData() {
    try { localStorage.setItem('portal_data_touched_v1', String(Date.now())); } catch (e) {}
  }

  // a removal is a fact too: it travels as a timestamp so the other device
  // cannot bring the bookmark back on the next merge
  function savedRemovedMap() {
    try { return JSON.parse(localStorage.getItem('portal_saved_removed_v1') || '{}') || {}; } catch (e) { return {}; }
  }
  function writeSavedRemoved(m) {
    try { localStorage.setItem('portal_saved_removed_v1', JSON.stringify(m)); } catch (e) {}
  }
  function markSavedRemoved(key) { const m = savedRemovedMap(); m[key] = Date.now(); writeSavedRemoved(m); }
  function clearSavedRemoved(key) { const m = savedRemovedMap(); if (m[key]) { delete m[key]; writeSavedRemoved(m); } }
  function saveKeyOf(origin, qid) { return origin.subjectId + '|' + origin.quizId + '|' + qid; }

  const VIEWS = ['deck-catalog', 'quiz-loading', 'quiz-error', 'quiz-start-view', 'quiz-view',
    'results-view', 'saved-view', 'stats-view', 'league-view', 'account-view'];
  function show(viewId) {
    VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== viewId));
    const inQuiz = viewId === 'quiz-start-view' || viewId === 'quiz-view';
    $('quiz-session-topbar').style.display = inQuiz ? 'block' : 'none';
    // the question grid is meaningless before the quiz starts
    const matrixBtn = $('btn-open-matrix');
    if (matrixBtn) matrixBtn.style.display = (viewId === 'quiz-view') ? '' : 'none';
    // the saved shortcut is part of the top bar: always reachable, one tap
    // (the sound toggle is not — it lives in the burger menu only)
    // the language toggle lives in every app bar and is always visible
    const catalogViews = ['deck-catalog', 'saved-view', 'stats-view', 'league-view', 'account-view'];
    $('header-catalog-view').style.display = catalogViews.includes(viewId) ? 'flex' : 'none';
    $('header-session-view').style.display = catalogViews.includes(viewId) ? 'none' : 'flex';
    document.body.dataset.quizlive = (inQuiz && S.session && !S.session.finished) ? 'yes' : 'no';
    // the pause overlay belongs to a running question: never let it survive a
    // view change (a paused quiz that is left behind used to block the next one)
    const pauseOv = $('pause-overlay');
    if (pauseOv && viewId !== 'quiz-view') pauseOv.classList.add('hidden');
    // and a session clock never outlives the quiz view (defensive: every exit
    // path — the guard, the browser back button, a route change — lands here)
    if (viewId !== 'quiz-view' && S.session && S.session.timerId) {
      try { clearInterval(S.session.timerId); } catch (e) {}
      S.session.timerId = null;
    }
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
  // The content is versioned: data/index.json carries a version, every chapter
  // carries its own. The app keeps the banks it already has (localStorage), and
  // only downloads the ones that actually changed — that is what makes
  // "new questions published" appear without a redeploy of the whole app.
  const BANKS_KEY = 'portal_banks_v1';
  const SEEN_KEY = 'portal_seen_v1';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function loadBankStore() {
    try {
      const s = JSON.parse(lsGet(BANKS_KEY) || '{}');
      return (s && typeof s === 'object') ? s : {};
    } catch (e) { return {}; }
  }

  function saveBankStore(store) {
    try { lsSet(BANKS_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function loadSeen() {
    try {
      const s = JSON.parse(lsGet(SEEN_KEY) || '{}');
      return (s && typeof s === 'object') ? s : {};
    } catch (e) { return {}; }
  }

  function saveSeen(seen) {
    try { lsSet(SEEN_KEY, JSON.stringify(seen)); } catch (e) {}
  }

  // v3 is the canonical shape; older banks are read through the same normaliser
  // the publish tool uses (the pairs may be plain strings in a hand-edited file)
  function normalizeBank(raw, fallbackTitle) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const pair = (v, arFallback, enFallback) => {
      if (v && typeof v === 'object') return { ar: v.ar || '', en: v.en || '' };
      return { ar: arFallback || '', en: enFallback || (typeof v === 'string' ? v : '') };
    };
    const out = {
      schema_version: 3,
      quiz_id: b.quiz_id || '',
      subject_id: b.subject_id || b.subject || '',
      subject_title: b.subject_title || '',
      topic: pair(b.topic, b.topic_ar, b.topic),
      instructor: pair(b.instructor, b.instructor_ar, b.instructor),
      updated_at: b.updated_at || '',
      has_math: !!b.has_math,
      questions: [],
    };
    (b.questions || []).forEach((q) => {
      const opts = (q.options || []).map((o) => {
        if (o && typeof o === 'object') return { ar: o.ar || '', en: o.en || '' };
        return { ar: '', en: o || '' };
      });
      const optAr = (q.options_ar && q.options_ar.length ? q.options_ar : null);
      const optEn = (q.options_en && q.options_en.length ? q.options_en : null);
      if (optAr || optEn) {
        const ar = optAr || [];
        const en = optEn || [];
        for (let i = 0; i < 4; i++) {
          opts[i] = { ar: (ar[i] || ''), en: (en[i] || '') };
        }
      }
      let answer = q.answer;
      if (typeof answer === 'string' && 'ABCD'.indexOf(answer.toUpperCase()) >= 0) {
        answer = 'ABCD'.indexOf(answer.toUpperCase());
      }
      if (typeof answer !== 'number' && typeof q.correct === 'number') answer = q.correct;
      const answerIdx = typeof answer === 'number' ? answer : -1;
      out.questions.push({
        id: q.id || '',
        concept_id: q.concept_id || '',
        bloom: q.bloom || q.bloom_level || '',
        stem: pair(q.stem, q.question_ar, q.question_en || q.question),
        options: opts,
        answer: answerIdx,
        correct: answerIdx,
        explanation: pair(q.explanation, q.explanation_ar, q.explanation_en),
      });
    });
    if (!out.topic.ar && !out.topic.en) out.topic = { ar: fallbackTitle || '', en: '' };
    return out;
  }

  async function loadData() {
    const t0 = performance.now();
    const store = loadBankStore();
    const seen = loadSeen();
    let idx = null;
    let source = 'static';
    // 1) the content portal (Supabase): tiny manifest, then only what changed
    try {
      if (window.PortalContent && window.PortalContent.configured()) {
        const m = await window.PortalContent.manifest();
        if (m && Array.isArray(m.subjects)) {
          idx = m; source = 'portal';
          try { lsSet('portal_manifest_v1', JSON.stringify(m)); } catch (e) {}
        }
      }
    } catch (e) { dbg('content portal unreachable'); }
    // 2) offline: the manifest this device saw last time
    if (!idx) {
      try {
        const m = JSON.parse(lsGet('portal_manifest_v1') || 'null');
        if (m && Array.isArray(m.subjects)) { idx = m; source = 'cache'; }
      } catch (e) {}
    }
    // 3) the bundled copy that ships with the shell (first visit, no network)
    if (!idx) {
      try {
        const r = await fetch('data/index.json?v=' + Date.now(), { cache: 'no-store' });
        if (r.ok) idx = await r.json();
      } catch (e) { /* offline */ }
      if (!idx) {
        try { idx = await (await fetch('data/index.json', { cache: 'no-store' })).json(); }
        catch (e) { throw new Error('no content'); }
      }
    }
    S.index = idx;
    // chapters stay plain numbers (1, 2, 3 …). Inside a chapter every bank
    // gets its own topic number: chapter.topic (1.1, 1.2 …), shown inside the
    // card next to the topic title
    try {
      idx.subjects.forEach((sub) => {
        const groups = {};
        (sub.chapters || []).forEach((ch) => {
          const k = String(ch.chapter_no);
          (groups[k] = groups[k] || []).push(ch);
        });
        Object.keys(groups).forEach((k) => {
          groups[k].sort((a, b) => String(a.quiz_id).localeCompare(String(b.quiz_id)));
          groups[k].forEach((ch, i) => {
            ch.label = String(ch.chapter_no);
            ch.topicNum = String(i + 1);
            ch.topicLabel = 'موضوع: ' + (i + 1);
          });
        });
      });
    } catch (e) {}
    // a chapter can hold two papers (النموذج أ / النموذج ب): keep a stable
    // order so "أ" is always listed before "ب"
    try {
      idx.subjects.sort((a, b) => String(a.subject_id).localeCompare(String(b.subject_id)));
      idx.subjects.forEach((sub) => {
        (sub.chapters || []).sort((a, b) =>
          ((Number(a.chapter_no) || 0) - (Number(b.chapter_no) || 0)) ||
          String(a.quiz_id).localeCompare(String(b.quiz_id)));
      });
    } catch (e) {}
    S.contentVersion = Number(idx.version || 0);
    S.contentSource = source;

    const jobs = [];
    idx.subjects.forEach((sub) => sub.chapters.forEach((ch) => {
      const want = Number(ch.version || 1);
      const cached = store[ch.quiz_id];
      if (cached && Number(cached.v) === want) {
        S.banks[ch.quiz_id] = cached.b;
        return;
      }
      const load = source === 'portal'
        ? window.PortalContent.bank(ch.quiz_id)
        : fetch('data/' + ch.bank + '?v=' + want, { cache: 'no-store' })
          .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
      jobs.push(Promise.resolve(load).then((raw) => {
        if (!raw) throw new Error('empty bank ' + ch.quiz_id);
        const bank = normalizeBank(raw, (ch.topic && ch.topic.ar) || '');
        const errs = validateBank(bank);
        if (errs.length) throw new Error(ch.quiz_id + ': ' + errs.join('; '));
        S.banks[ch.quiz_id] = bank;
        store[ch.quiz_id] = { v: want, b: bank };
      }).catch((e) => {
        // a missing bank from the portal must not kill the whole boot: keep the
        // cached copy if there is one
        if (cached && cached.b) { S.banks[ch.quiz_id] = cached.b; return; }
        dbg('bank load failed (isolated):', ch.quiz_id, (e && e.message) || e);
      }));
    }));
    if (jobs.length) {
      await Promise.all(jobs);
      saveBankStore(store);
    }

    // the first run sets the baseline: what is there now is not "new"
    const seenExisted = !!lsGet(SEEN_KEY);
    if (!seenExisted) {
      idx.subjects.forEach((sub) => sub.chapters.forEach((ch) => {
        seen[ch.quiz_id] = Number(ch.version || 1);
      }));
      saveSeen(seen);
    }

    // which chapters carry questions the student has not seen yet
    const freshChapters = [];
    idx.subjects.forEach((sub) => sub.chapters.forEach((ch) => {
      const want = Number(ch.version || 1);
      if (Number(seen[ch.quiz_id] || 0) < want) {
        freshChapters.push({
          read: false,
          quiz_id: ch.quiz_id,
          subject_id: sub.subject_id,
          subject: sub.subject_title,
          chapterLabel: ch.topicLabel || ch.label || String(ch.chapter_no || ''),
          chapter: ch.chapter_no,
          topic: (ch.topic && (ch.topic.ar || ch.topic.en)) || (typeof ch.topic === 'string' ? ch.topic : ''),
          count: ch.count || 0,
          updated_at: ch.updated_at || '',
        });
      }
    }));
    S.freshChapters = freshChapters;
    setTimeout(notifyNewContent, 1200);
    dbg('data loaded in ms:', Math.round(performance.now() - t0), 'banks:', Object.keys(S.banks), 'fresh:', freshChapters.length);
  }

  function validateBank(b) {
    const errs = [];
    if (!Array.isArray(b.questions) || b.questions.length === 0) errs.push('no questions');
    (b.questions || []).forEach((q) => {
      const opts = q.options || [];
      if (opts.length !== 4) errs.push(q.id + ':optlen');
      opts.forEach((o, i) => {
        const v = (o && typeof o === 'object') ? (o.ar || o.en) : o;
        if (!v) errs.push(q.id + ':opt' + i + 'empty');
      });
      if (!(q.answer >= 0 && q.answer <= 3)) errs.push(q.id + ':keysync');
      const ex = (q.explanation && typeof q.explanation === 'object') ? (q.explanation.ar || q.explanation.en) : q.explanation;
      if (!ex) errs.push(q.id + ':noexpl');
      const stem = (q.stem && typeof q.stem === 'object') ? (q.stem.ar || q.stem.en) : '';
      if (!stem) errs.push(q.id + ':nostem');
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
    touchData();
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

  // ---- hierarchy: subject -> chapter -> topic (the finest unit) ----
  const DIFF_LABELS = { 1: 'سهل', 2: 'سهل-متوسط', 3: 'متوسط', 4: 'فوق المتوسط', 5: 'صعب' };
  const DIFF_COLORS = { 1: '#34d399', 2: '#a3e635', 3: '#fbbf24', 4: '#f97316', 5: '#ef4444' };

  function isRtlText(t) { return /[\u0600-\u06FF]/.test(String(t || '')); }

  function cleanTopic(t) {
    let s = String(t || '').trim();
    s = s.replace(/^(chapter|week|unit|lecture|lesson|module)\s*\.?\s*\d+\s*[:.\-\u2013\u2014]\s*/i, '');
    s = s.replace(/[,،]\s*\d+\s*MCQ bank requested by the instructor\s*$/i, '');
    return s.trim();
  }

  function topicTitle(bank) {
    if (!bank) return '';
    const t = bank.topic;
    // v3 keeps the topic as an {ar, en} pair; follow the language switch and
    // keep the English side clean (the raw label carries a chapter prefix and
    // an instructor note)
    if (t && typeof t === 'object') {
      const ar = String(t.ar || '').trim();
      const en = cleanTopic(t.en || '');
      if (S.lang === 'en') return en || ar;
      return ar || en;
    }
    if (S.lang === 'en') return cleanTopic(t) || String(bank.topic_ar || '').trim();
    if (bank.topic_ar) return String(bank.topic_ar).trim();
    return cleanTopic(t);
  }

  function crumbHtml(sub, ch) {
    return '<span class="crumb-subject">' + escapeHtml(sub.subject_title) + '</span>' +
      '<span class="crumb-sep" aria-hidden="true">\u2039</span>' +
      '<span class="crumb-chapter">' + escapeHtml(chLabel(ch)) + '</span>';
  }

  function detailGridHtml(rows) {
    return (rows || []).filter(Boolean).map((r) => {
      const label = r[0] ? '<span class="detail-label">' + escapeHtml(r[0]) + '</span>' : '';
      return '<div class="detail-item' + (r[2] === 'span2' ? ' span-2' : '') + (r[0] ? '' : ' no-label') + '">' +
        label + '<span class="detail-value ' + (r[3] || '') + '">' + r[1] + '</span></div>';
    }).join('');
  }

  function attemptsFor(quizId) {
    let count = 0; let last = null;
    try {
      (S.history || []).forEach((h) => {
        if (h && h.quizId === quizId) { count++; if (!last || (h.t || 0) > (last.t || 0)) last = h; }
      });
    } catch (e) {}
    return { count: count, last: last };
  }

  function savedCountFor(quizId) {
    let n = 0;
    try {
      Object.keys(S.saved || {}).forEach((k) => {
        const parts = String(k).split('|');
        if (parts[1] === quizId) n++;
      });
    } catch (e) {}
    return n;
  }

  function bankDetailRows(sub, ch, bank) {
    if (!bank) return [];
    const n = bank.questions.length;
    const best = getBest(ch.quiz_id);
    const att = attemptsFor(ch.quiz_id);
    const rows = [];
    rows.push(['عدد الأسئلة', escapeHtml(qCount(n))]);
    rows.push(['الوقت المقدّر', escapeHtml(Math.max(1, Math.round(n * 1.5)) + ' دقيقة')]);
    if (best) rows.push(['أفضل نتيجة', '<span class="is-good">' + Math.round(best.pct) + '%</span> <span class="muted">(' + escapeHtml(best.frac) + ')</span>']);
    else rows.push(['أفضل نتيجة', '<span class="muted">لم تبدأ بعد</span>']);
    rows.push(['عدد المحاولات', att.count ? escapeHtml(att.count + ' ' + (att.count === 1 ? 'محاولة' : 'محاولات')) : '<span class="muted">لا محاولات سابقة</span>']);
    if (bank.instructor_ar) rows.push(['دكتور المادة', escapeHtml(bank.instructor_ar), 'span2']);
    const material = bank.material_url || '';
    if (material) {
      rows.push([null, '<a class="material-link" href="' + escapeHtml(material) +
        '" target="_blank" rel="noopener">اضغط هنا للانتقال للجابتر</a>', 'span2']);
    }
    return rows;
  }

  function chLabel(ch) { return (ch && ch.label) ? ch.label : String((ch && ch.chapter_no) || ''); }
  function chLabelLong(ch) { return 'جابتر ' + chLabel(ch); }

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
    // several banks can share one chapter (النموذج أ / النموذج ب) — the bar
    // lists every chapter number once, and keeps the first bank as its label
    const chapters = [];
    const seenChapters = new Set();
    sub.chapters.forEach((c) => {
      if (seenChapters.has(c.chapter_no)) return;
      seenChapters.add(c.chapter_no);
      chapters.push(c);
    });
    if (!S.chapterFilter || !chapters.some((c) => c.chapter_no === S.chapterFilter)) {
      S.chapterFilter = chapters[0].chapter_no;
    }
    bar.innerHTML = '';
    if (chapters.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    bar.appendChild(filterBarLabel('جابتر'));
    chapters.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'filter-chip chapter-chip' + (S.chapterFilter === c.chapter_no ? ' active' : '');
      b.textContent = chLabel(c);
      b.setAttribute('aria-label', chLabelLong(c));
      b.title = chLabelLong(c);
      b.setAttribute('aria-pressed', S.chapterFilter === c.chapter_no ? 'true' : 'false');
      b.addEventListener('click', () => { S.chapterFilter = c.chapter_no; saveUI(); renderChapterChips(); renderCatalog(); });
      bar.appendChild(b);
    });
    const active = bar.querySelector('.filter-chip.active');
    if (active) { try { active.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {} }
  }

  // the bell carries the "new questions" state; the list lives in a sheet.
  // Every item has a read flag: tapping one marks it read, "قراءة الكل" clears
  // the lot, and the badge counts only what is still unread.
  function unreadCount() {
    return (S.freshChapters || []).filter((f) => !f.read).length;
  }

  function renderBell() {
    const fresh = S.freshChapters || [];
    const n = unreadCount();
    ['bell-dot', 'bell-dot-session'].forEach((id) => {
      const dot = $(id);
      if (!dot) return;
      dot.classList.toggle('hidden', n === 0);
      dot.textContent = n > 9 ? '9+' : String(n);
    });
    ['btn-bell', 'btn-bell-session'].forEach((id) => {
      const b = $(id);
      if (!b) return;
      b.classList.toggle('has-new', n > 0);
      b.setAttribute('aria-label', n ? ('التنبيهات — ' + n + ' جديد') : 'التنبيهات');
    });
    renderNotifList();
  }

  function renderNotifList() {
    const list = $('notif-list');
    const empty = $('notif-empty');
    if (!list) return;
    // a notification that has been opened (or cleared) leaves the sheet at once
    const fresh = (S.freshChapters || []).filter((f) => !f.read);
    const readAllBtn = $('notif-read-all');
    if (readAllBtn) readAllBtn.classList.toggle('hidden', fresh.length === 0);
    if (!fresh.length) {
      list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    list.innerHTML = fresh.map((f) =>
      '<a class="notif-row" href="#/quiz/' + encodeURIComponent(f.subject_id || '') + '/' + encodeURIComponent(f.quiz_id) + '"' +
      ' data-quiz="' + escapeHtml(f.quiz_id) + '">' +
      '<span class="notif-icon"><i data-lucide="sparkles"></i></span>' +
      '<span class="notif-text"><span class="notif-title">تمت إضافة أسئلة لـ' + escapeHtml(f.chapterLabel || '') + '</span>' +
      '<span class="notif-sub">في ' + escapeHtml(chLabelLong({ chapter_no: f.chapter })) + ' لمادة ' + escapeHtml(f.subject) + ' · ' + (f.count || 0) + ' سؤال</span></span>' +
      '<i data-lucide="chevron-left" class="notif-chev"></i></a>').join('');
    icons();
  }

  // tapping a notification marks it read; the bell count follows
  function markNotifRead(quizId) {
    const item = (S.freshChapters || []).find((f) => f.quiz_id === quizId);
    if (!item || item.read) return;
    item.read = true;
    markChapterSeen(quizId);
    renderBell();
    renderNotifList();
  }

  function markAllNotifsRead() {
    (S.freshChapters || []).forEach((f) => {
      if (!f.read) { f.read = true; markChapterSeen(f.quiz_id); }
    });
    renderBell();
    renderNotifList();
    toast('تم تحديد الكل كمقروء', 'success');
  }

  // other callers still say "the content banner": keep the name working
  function renderContentBanner() { renderBell(); }

  // one toast when new content actually lands on this device
  function notifyNewContent() {
    const fresh = (S.freshChapters || []).filter((f) => !f.read);
    if (!fresh.length) return;
    if (lsGet('portal_notified_v' + (S.contentVersion || 0))) return;
    lsSet('portal_notified_v' + (S.contentVersion || 0), '1');
    if (fresh.length === 1) {
      const f = fresh[0];
      toast('تمت إضافة أسئلة ل' + (f.chapterLabel || '') + ' في ' + chLabelLong({ chapter_no: f.chapter }) +
        ' لمادة ' + (f.subject || '') + ' (' + (f.count || 0) + ' سؤال) — افتح الجرس', 'info');
    } else {
      const total = fresh.reduce((n, f) => n + (f.count || 0), 0);
      toast('تمت إضافة أسئلة لـ' + fresh.length + ' مواضيع جديدة (' + total + ' سؤال) — افتح الجرس', 'info');
    }
  }

  function findChapter(quizId) {
    const idx = S.index || {};
    let found = null;
    (idx.subjects || []).forEach((sub) => (sub.chapters || []).forEach((ch) => {
      if (ch.quiz_id === quizId) found = ch;
    }));
    return found;
  }

  // a chapter counts as seen once the student opens it
  function markChapterSeen(quizId) {
    const seen = loadSeen();
    const ch = findChapter(quizId);
    if (!ch) return;
    if (Number(seen[quizId] || 0) >= Number(ch.version || 1)) return;
    seen[quizId] = Number(ch.version || 1);
    saveSeen(seen);
    // the item stays in the sheet, flagged read (the badge follows the unread
    // count); it disappears on the next load
    const item = (S.freshChapters || []).find((f) => f.quiz_id === quizId);
    if (item) item.read = true;
    renderContentBanner();
    renderCatalog();
  }

  function renderCatalog() {
    renderBell();
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
      const title = topicTitle(bank);
      const isFresh = !!(S.freshChapters || []).some((f) => f.quiz_id === ch.quiz_id && !f.read);
      row.innerHTML =
        '<button type="button" class="sketch-cell sketch-info-cell row-info-cell" aria-label="تفاصيل الكوز">' +
          '<i data-lucide="info"></i></button>' +
        '<a href="#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id) + '" class="sketch-cell sketch-content-cell">' +
          '<div class="sketch-eyebrow">' +
            '<span class="sketch-subject-tag">' + escapeHtml(sub.subject_title) + '</span>' +
            '<span class="sketch-chip">' + escapeHtml(chLabelLong(ch)) + '</span>' +
            '<span class="sketch-topic-num" dir="auto">' + escapeHtml(ch.topicLabel || 'موضوع: 1') + '</span>' +
            (isFresh ? '<span class="sketch-chip sketch-chip-new">جديد</span>' : '') +
          '</div>' +
          '<div class="sketch-title" dir="' + (isRtlText(title) ? 'rtl' : 'ltr') + '">' + escapeHtml(title) + '</div>' +
          '<div class="sketch-meta-line">' +
            '<span class="sketch-count-tag">' + qCount(bank.questions.length) + '</span>' +
            (best ? '<span class="sketch-meta-dot">·</span><span class="sketch-score-label ' + pctClass(best.pct) + '">' + Math.round(best.pct) + '%</span>' : '') +
          '</div></a>' +
        '<a href="#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id) + '" class="sketch-cell sketch-play-cell" aria-label="بدء الكوز مباشرة"><i data-lucide="play"></i></a>';
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
    const title = topicTitle(bank);
    const crumb = $('info-sheet-crumb');
    if (crumb) crumb.innerHTML = crumbHtml(sub, ch);
    const topicEl = $('info-sheet-topic');
    const tNum = ch.topicLabel || 'موضوع: 1';
    topicEl.innerHTML = '<span class="sketch-topic-num">' + escapeHtml(tNum) + '</span> ' + escapeHtml(title);
    topicEl.setAttribute('dir', isRtlText(title) ? 'rtl' : 'ltr');
    $('info-sheet-list').innerHTML = detailGridHtml(bankDetailRows(sub, ch, bank));
    const startBtn = $('info-sheet-start');
    if (startBtn) startBtn.setAttribute('href', '#/quiz/' + encodeURIComponent(sub.subject_id) + '/' + encodeURIComponent(ch.quiz_id));
    openDrawer('quiz-info-drawer');
    icons();
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
      if (Array.isArray(q.options) && q.options.length && q.options[0] && typeof q.options[0] === 'object') {
        // v3: the options are {ar, en} pairs, shuffled together
        q.options = order.map((i) => q.options[i]);
      } else {
        q.options = order.map((i) => q.options[i]);
        if (Array.isArray(q.options_ar)) q.options_ar = order.map((i) => q.options_ar[i]);
        if (Array.isArray(q.options_en)) q.options_en = order.map((i) => q.options_en[i]);
      }
      // v3 calls it "answer", the session has always used "correct"
      const key = (typeof q.correct === 'number' && q.correct >= 0) ? q.correct
        : (typeof q.answer === 'number' ? q.answer : -1);
      q.correct = order.indexOf(key);
      q.answer = q.correct;
    });
    return pool;
  }

  const SNAP_KEY = 'portal_session_v1';
  function clearSessionSnapshot() {
    try { sessionStorage.removeItem(SNAP_KEY); } catch (e) {}
  }

  // a refresh (or a swipe down on the page) must not throw a half-finished quiz
  // away: every answer/navigation writes a snapshot, and boot can rebuild it
  function saveSessionSnapshot() {
    const ses = S.session;
    if (!ses || !ses.started || ses.finished) { clearSessionSnapshot(); return; }
    try {
      const elapsed = Math.max(0, Date.now() - ses.startEpoch - ses.pauseAccum -
        (ses.pauseStart ? Date.now() - ses.pauseStart : 0));
      sessionStorage.setItem(SNAP_KEY, JSON.stringify({
        at: Date.now(), hash: ses.hash, sub: ses.sub, ch: ses.ch, title: ses.title,
        chapterLabel: ses.chapterLabel, questions: ses.questions, picks: ses.picks,
        dwells: ses.dwells, idx: ses.idx, maxIdx: ses.maxIdx,
        retryWrong: !!ses.retryWrong, replay: ses.replay || null, elapsed,
      }));
    } catch (e) { /* audit-ignore: a full sessionStorage only costs the resume */ }
  }

  function restoreSessionSnapshot(hash, quizId) {
    let snap = null;
    try { snap = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null'); } catch (e) {}
    if (!snap || !Array.isArray(snap.questions) || !snap.questions.length) return false;
    if (String(hash || '').replace(/\/$/, '') !== String(snap.hash || '').replace(/\/$/, '')) return false;
    if (quizId && snap.ch && snap.ch.quiz_id !== quizId) return false;
    if (Date.now() - Number(snap.at || 0) > 6 * 60 * 60 * 1000) { clearSessionSnapshot(); return false; }
    S.session = {
      sub: snap.sub, ch: snap.ch, title: snap.title, chapterLabel: snap.chapterLabel,
      questions: snap.questions, picks: snap.picks, dwells: snap.dwells,
      idx: Math.min(Number(snap.idx) || 0, snap.questions.length - 1),
      maxIdx: Number(snap.maxIdx) || 0,
      retryWrong: !!snap.retryWrong, replay: snap.replay || null,
      hash: snap.hash, finished: false, started: true,
      startEpoch: Date.now() - Number(snap.elapsed || 0), pauseAccum: 0, pauseStart: null,
      qStart: Date.now(), timerId: null,
    };
    $('question-total-label').textContent = snap.questions.length;
    show('quiz-view');
    clearInterval(S.session.timerId);
    S.session.timerId = setInterval(tickTimer, 500);
    renderQuestion();
    renderMatrix();
    icons();
    tickTimer();
    toast('رجعت للكوز من حيث وقفت', 'success');
    dbg('session restored at', S.session.idx + 1, 'of', snap.questions.length);
    return true;
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

    const chapterLabel = meta.chapterLabel || chLabel({ chapter_no: meta.chapterNo });
    const chapterNum = 'جابتر ' + meta.chapterNo;
    $('quiz-subtitle').textContent = meta.subjectTitle + ' · ' + chapterNum + ' · ' + chapterLabel;
    $('quiz-title').textContent = meta.topic;
    $('start-subject-badge').textContent = meta.subjectTitle;
    $('start-chapter-badge').textContent = chapterNum + ' · ' + chapterLabel;
    const startTitle = $('start-quiz-title');
    startTitle.textContent = meta.topic;
    startTitle.setAttribute('dir', isRtlText(meta.topic) ? 'rtl' : 'ltr');
    const startCount = $('start-questions-count');
    if (startCount) startCount.textContent = qCount(pool.length);
    const startTime = $('start-estimated-time');
    if (startTime) startTime.textContent = Math.max(1, Math.round(pool.length * 1.5)) + ' دقيقة';
    // the pre-exam card carries every detail a student needs before committing
    const bank = meta.bank || null;
    const details = $('start-details');
    if (details) {
      details.innerHTML = bank
        ? detailGridHtml(bankDetailRows({ subject_title: meta.subjectTitle }, { chapter_no: meta.chapterNo, quiz_id: meta.quizId }, bank))
        : '';
    }
    const note = $('start-note');
    if (note) {
      const att = attemptsFor(meta.quizId);
      const saved = savedCountFor(meta.quizId);
      if (att.count) {
        note.textContent = 'لديك ' + att.count + ' محاولة سابقة على هذا الكوز — آخر نتيجة ' +
          Math.round((att.last && att.last.pct) || 0) + '%. البدء من جديد يعيد ضبط المحاولة.';
      } else if (saved) {
        note.textContent = 'لديك ' + saved + ' سؤال محفوظ من هذا الكوز في «الأسئلة المحفوظة».';
      } else {
        note.textContent = '';
      }
    }
    $('question-total-label').textContent = pool.length;
    $('live-feedback-box').classList.add('hidden');
    updateSaveBtn();
    show('quiz-start-view');
    dbg('session start:', meta.quizId, 'n=', pool.length, 'retryWrong=', !!meta.retryWrong);
  }

  function startSession(subjectId, quizId, wrongOnlyFrom) {
    const sub = (S.index && S.index.subjects || []).find((s) => s.subject_id === subjectId);
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
    markChapterSeen(ch.quiz_id);
    launchSession(pool, {
      subjectId: sub.subject_id, subjectTitle: sub.subject_title,
      chapterNo: ch.chapter_no, chapterLabel: ch.topicLabel || ch.label || chLabel(ch), topic: topicTitle(bank), quizId: ch.quiz_id, bank: bank,
      retryWrong: retryWrong, replay: { type: 'bank', subjectId: sub.subject_id, quizId: ch.quiz_id },
    });
  }

  // Practice session built from saved-question snapshots (device-local).
  function startSavedPractice(items, title, chapterLabel) {
    if (!items.length) return;
    const pool = items.map((it) => JSON.parse(JSON.stringify(it.snapshot || it)));
    const first = (items[0] && items[0].origin) || {};
    launchSession(pool, {
      subjectId: first.subjectId || 'saved', subjectTitle: first.subjectTitle || 'الأسئلة المحفوظة',
      chapterNo: first.chapterNo !== undefined ? first.chapterNo : 1, chapterLabel: chapterLabel,
      topic: title,
      quizId: null, retryWrong: false,
      replay: { type: 'saved', keys: items.map((it) => it.key) },
    });
    S.session.hash = '#/practice';
    if (location.hash !== '#/practice') location.hash = '#/practice';
    saveSessionSnapshot();
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
      markSavedRemoved(key);
      toast('أُزيل من المحفوظ');
    } else {
      S.saved[key] = { origin: q.origin, snapshot: JSON.parse(JSON.stringify(q)), savedAt: Date.now() };
      clearSavedRemoved(key);
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
    b.textContent = n > 99 ? '99+' : n;
    b.classList.toggle('hidden', n === 0);
    updateMenuCounts();
  }

  function savedGroups() {
    // [{subjectId, subjectTitle, chapters: [{chapterNo, topic, items: [{key, origin, snapshot}]}]}]
    const bySub = {};
    Object.keys(S.saved).forEach((key) => {
      const it = S.saved[key];
      if (!it) return;
      const o = it.origin || {};
      const sid = o.subjectId || it.sub || it.subjectId || 'other';
      const stitle = o.subjectTitle || it.subjectTitle || (S.index && S.index.subjects && S.index.subjects.find((s) => s.subject_id === sid) ? S.index.subjects.find((s) => s.subject_id === sid).subject_title : 'أسئلة عامة');
      const cno = o.chapterNo !== undefined ? o.chapterNo : (it.chapterNo !== undefined ? it.chapterNo : 1);
      const topic = o.topic || it.topic || '';
      bySub[sid] = bySub[sid] || { subjectId: sid, subjectTitle: stitle, chapters: {} };
      const ch = bySub[sid].chapters[cno] = bySub[sid].chapters[cno] || { chapterNo: cno, topic: topic, items: [] };
      ch.items.push({ key: key, origin: o, snapshot: it.snapshot || it });
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
    const groupActions = document.createElement('div');
    groupActions.className = 'saved-group-actions';
    groupActions.appendChild(train);
    groupActions.appendChild(chExp);
    head.appendChild(groupActions);
    wrap.appendChild(head);
    if (S.savedChapterOpen !== c.chapterNo) { box.appendChild(wrap); icons(); return; }
    c.items.forEach((it) => {
      const q = it.snapshot;
      const card = document.createElement('div');
      card.className = 'review-card correct-border saved-card';
      stemPair(q).forEach((sp, si) => {
        const stem = document.createElement('p');
        stem.className = 'review-question-text' + (si > 0 ? ' review-question-text-sub' : '');
        stem.innerHTML = richHtml(sp.t);
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
          '</span><span class="review-option-text">' + pair.map((p) => '<span class="opt-line opt-' + p.lang + '">' + richHtml(p.t) + '</span>').join('') + '</span>';
        optionsList.appendChild(item);
      }
      card.appendChild(optionsList);
      const expl = explText(q);
      if (expl) {
        const exp = document.createElement('div');
        exp.className = 'review-explanation-box';
        exp.setAttribute('dir', 'auto');
        exp.innerHTML = '<strong>الشرح</strong><span>' + richHtml(expl) + '</span>';
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
    if (!ses) return;
    ses.started = true;
    show('quiz-view');
    updateSaveBtn();
    maybeQuizHint();
    tourNotify('start');
    ses.startEpoch = Date.now(); ses.pauseAccum = 0; ses.pauseStart = null;
    // a pause from an earlier attempt must never cover the new question
    try { $('pause-overlay').classList.add('hidden'); } catch (e) {}
    ses.qStart = Date.now();
    clearInterval(ses.timerId);
    ses.timerId = setInterval(tickTimer, 500);
    renderQuestion();
    renderMatrix();
    icons();
    saveSessionSnapshot();
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

  function qLetters() { return S.lang === 'en' ? ['A', 'B', 'C', 'D'] : ['أ', 'ب', 'ج', 'د']; }

  // Bilingual pairs for 'both' mode: [{t, lang}] — primary first.
  // Bidi-safe text: inside Arabic text, Latin/numeric runs (numbers, formulas,
  // English terms) are isolated so they never reverse or tear the sentence.
  const AR_RE = /[\u0600-\u06FF]/;
  function setExplOpen(box, toggle, body, open) {
    if (!box) return;
    box.classList.toggle('collapsed', !open);
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (body) body.hidden = !open;
  }

  function bidiHtml(text) {
    const s = String(text == null ? '' : text);
    if (!AR_RE.test(s)) return escapeHtml(s);
    return s.split(/([\x20-\x7E]+)/g).map(function (part) {
      // isolate a Latin/number run, but never a lone space (it would break
      // the Arabic line flow)
      if (/^[\x20-\x7E]+$/.test(part) && /[A-Za-z0-9]/.test(part)) {
        return '<bdi dir="ltr">' + escapeHtml(part) + '</bdi>';
      }
      return escapeHtml(part);
    }).join('');
  }

  // ---------------- math + mixed text ----------------
  // A question may mix Arabic prose, English technical terms and LaTeX:
  //   $x^2 + 1$        inline math
  //   $$\sum_{i=1}^n$$  display math
  // The math is pulled out first (so the bidi pass never touches it), then
  // rendered with KaTeX and wrapped in <bdi dir="ltr"> so it keeps its own
  // direction inside the Arabic line.
  const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

  function hasMath(text) {
    MATH_RE.lastIndex = 0;
    return MATH_RE.test(String(text == null ? '' : text));
  }

  function katexReady() {
    return !!(window.katex && typeof window.katex.renderToString === 'function');
  }

  function renderMath(src, display) {
    if (!katexReady()) {
      // no math engine (or it failed): show the source, still readable
      return '<bdi dir="ltr">' + escapeHtml(src) + '</bdi>';
    }
    try {
      const html = window.katex.renderToString(src, {
        displayMode: !!display,
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html'
      });
      return '<bdi dir="ltr" class="math-inline">' + html + '</bdi>';
    } catch (e) {
      return '<bdi dir="ltr">' + escapeHtml(src) + '</bdi>';
    }
  }

  // a small read-only status for the console, the tests and the diagnostics
  window.PortalApp = {
    contentSource: function () { return S.contentSource || 'unknown'; },
    contentVersion: function () { return S.contentVersion || 0; },
    bankCount: function () { return Object.keys(S.banks || {}).length; },
    freshCount: function () { return (S.freshChapters || []).length; },
  };

  // exposed so the math renderer can be checked from the console and by tests
  window.PortalRich = {
    html: function (t) { return richHtml(t); },
    hasMath: function (t) { return hasMath(t); },
  };

  // the renderer every question, option and explanation goes through
  function richHtml(text) {
    const raw = String(text == null ? '' : text);
    if (raw.indexOf('$') < 0) return bidiHtml(raw);
    MATH_RE.lastIndex = 0;
    let out = '';
    let last = 0;
    let m;
    while ((m = MATH_RE.exec(raw)) !== null) {
      out += bidiHtml(raw.slice(last, m.index));
      if (m[1] !== undefined) out += renderMath(m[1], true);
      else out += renderMath(m[2], false);
      last = m.index + m[0].length;
    }
    out += bidiHtml(raw.slice(last));
    return out;
  }

  // pick the candidate that really is in the wanted language (the banks carry
  // both a canonical pair and app-facing aliases, and some are untranslated)
  function pickAr() {
    for (let i = 0; i < arguments.length; i++) {
      const c = arguments[i];
      if (typeof c === 'string' && c.trim() && AR_RE.test(c)) return c;
    }
    return '';
  }
  function pickEn() {
    for (let i = 0; i < arguments.length; i++) {
      const c = arguments[i];
      if (typeof c === 'string' && c.trim() && !AR_RE.test(c)) return c;
    }
    return '';
  }
  // v3 shape: stem/options/explanation are {ar, en} pairs. The fallbacks keep
  // the older files readable while they are being republished.
  function stemAr(q) {
    const s = q.stem;
    if (s && typeof s === 'object') return pickAr(s.ar, s.en);
    return pickAr(q.question_ar, q.text) || q.question_en || q.question || '';
  }
  function stemEn(q) {
    const s = q.stem;
    if (s && typeof s === 'object') return pickEn(s.en, s.ar);
    return pickEn(q.question_en, q.text_en) || q.question_ar || q.question || '';
  }
  function optsAr(q) {
    const o = q.options;
    if (Array.isArray(o) && o.length && o[0] && typeof o[0] === 'object') {
      return o.map((x) => (x && (x.ar || x.en)) || '');
    }
    const a = q.options_ar; const b = o;
    if (Array.isArray(a) && a.length && AR_RE.test(String(a[0]))) return a;
    if (Array.isArray(b) && b.length && AR_RE.test(String(b[0]))) return b;
    return (Array.isArray(a) && a.length) ? a : (Array.isArray(b) ? b : []);
  }
  function optsEn(q) {
    const o = q.options;
    if (Array.isArray(o) && o.length && o[0] && typeof o[0] === 'object') {
      return o.map((x) => (x && (x.en || x.ar)) || '');
    }
    const a = q.options_en; const b = o;
    if (Array.isArray(a) && a.length && !AR_RE.test(String(a[0]))) return a;
    if (Array.isArray(b) && b.length && !AR_RE.test(String(b[0]))) return b;
    return (Array.isArray(a) && a.length) ? a : (Array.isArray(b) ? b : []);
  }
  function explAr(q) {
    const e = q.explanation;
    if (e && typeof e === 'object') return pickAr(e.ar, e.en);
    return pickAr(q.explanation_ar, q.explanation, q.explanation_en);
  }
  function explEn(q) {
    const e = q.explanation;
    if (e && typeof e === 'object') return pickEn(e.en, e.ar);
    return pickEn(q.explanation_en, q.explanation, q.explanation_ar);
  }

  // one translation icon in the bar: yellow while the questions are Arabic,
  // plain like the other icons while English. Tapping it toggles the language.
  function syncLangButtons() {
    const ar = S.lang !== 'en';
    document.querySelectorAll('.lang-toggle').forEach((b) => {
      b.classList.toggle('lang-active', ar);
      b.setAttribute('aria-pressed', ar ? 'true' : 'false');
      const label = ar ? 'لغة الأسئلة: عربي' : 'لغة الأسئلة: English';
      b.setAttribute('aria-label', label);
      b.setAttribute('title', 'لغة الأسئلة');
    });
    try { document.documentElement.setAttribute('data-qlang', ar ? 'ar' : 'en'); } catch (e) {}
    document.querySelectorAll('.lang-opt').forEach((b) => {
      const on = b.dataset.lang === S.lang;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    });
  }

  function toggleLang() { setLang(S.lang === 'en' ? 'ar' : 'en'); }

  // The switch: Arabic <-> English for the question, the options and the
  // explanation — in the quiz, in the saved questions and in the review.
  function setLang(lang) {
    S.lang = (lang === 'en') ? 'en' : 'ar';
    try { document.documentElement.setAttribute('lang', S.lang); } catch (e) {}
    saveUI();
    syncLangButtons();
    try {
      if (S.session && !$('quiz-view').classList.contains('hidden')) renderQuestion();
      else if (S.session && S.lastResults && !$('results-view').classList.contains('hidden')) renderResults(S.lastResults);
      else if (!$('saved-view').classList.contains('hidden')) renderSaved();
      else if (!$('deck-catalog').classList.contains('hidden')) renderCatalog();
    } catch (e) {}
  }

  function stemPair(q) {
    if (S.lang === 'en') return [{ t: stemEn(q), lang: 'en' }];
    return [{ t: stemAr(q), lang: 'ar' }];
  }
  function optsPair(q, i) {
    const ar = optsAr(q)[i] || '';
    const en = optsEn(q)[i] || '';
    if (S.lang === 'en') return [{ t: en || ar, lang: 'en' }];
    return [{ t: ar || en, lang: 'ar' }];
  }
  function explText(q) {
    return S.lang === 'en' ? (explEn(q) || explAr(q)) : (explAr(q) || explEn(q));
  }
  function lettersFor(lang) { return lang === 'en' ? ['A', 'B', 'C', 'D'] : ['أ', 'ب', 'ج', 'د']; }

  function renderQuestion() {
    const ses = S.session;
    const q = ses.questions[ses.idx];
    const letters = qLetters();
    $('question-index-label').textContent = ses.idx + 1;
    $('progress-bar-fill').style.width = (ses.idx / ses.questions.length) * 100 + '%';
    const stems = stemPair(q);
    const qEl = $('question-text');
    qEl.innerHTML = richHtml(stems[0].t);
    qEl.setAttribute('dir', 'auto');
    const qEl2 = $('question-text-2');
    if (stems[1]) {
      qEl2.innerHTML = richHtml(stems[1].t);
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
      content.innerHTML = pair.map((p) => '<span class="opt-line opt-' + p.lang + '">' + richHtml(p.t) + '</span>').join('');
      btn.appendChild(letter);
      btn.appendChild(content);
      if (!locked) btn.addEventListener('click', () => pickOption(i));
      box.appendChild(btn);
    }
    // The explanation is always available after answering: auto-opened when the
    // answer was wrong (the moment it matters), collapsed when it was right.
    const answered = locked;
    const wasWrong = answered && ses.picks[ses.idx] !== q.correct;
    const expl = explText(q);
    const boxEl = $('live-feedback-box');
    const explBody = $('live-explanation-text');
    const explToggle = $('live-expl-toggle');
    const showBox = answered && !!expl;
    boxEl.classList.toggle('hidden', !showBox);
    if (showBox) {
      explBody.innerHTML = richHtml(expl);
      explBody.setAttribute('dir', 'auto');
      setExplOpen(boxEl, explToggle, explBody, wasWrong);
      if (wasWrong) {
        requestAnimationFrame(() => {
          const bnav = document.querySelector('.bottom-nav');
          const navH = bnav ? bnav.offsetHeight : 0;
          const rect = boxEl.getBoundingClientRect();
          if (rect.bottom > window.innerHeight - navH - 10) {
            window.scrollBy({ top: rect.bottom - (window.innerHeight - navH - 10), behavior: 'smooth' });
          }
        });
      }
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
    saveSessionSnapshot();
  }

  function advanceTo(i) {
    const ses = S.session;
    ses.idx = i;
    ses.maxIdx = Math.max(ses.maxIdx, i);
    ses.qStart = Date.now();
    renderQuestion();
    renderMatrix();
    saveSessionSnapshot();
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
        saveSessionSnapshot();
      });
      grid.appendChild(c);
    });
  }

  function finishQuiz() {
    const ses = S.session;
    clearInterval(ses.timerId);
    clearSessionSnapshot();
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
    if (S.pendingReload) {
      toast('تحديث جديد متوفر — جارٍ التحديث…', 'info');
      setTimeout(() => location.reload(), 1800);
    }
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
      touchData();
    } catch (e) {}
    cloudPush();
    try {
      if (window.PortalLeague && window.PortalLeague.linked && window.PortalLeague.linked()) {
        window.PortalLeague.syncWeek().catch(function (e) { dbg('league sync failed:', (e && e.message) || e); });
      }
    } catch (e) {}
  }

  function clearHistory() {
    S.history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
    try { localStorage.setItem('portal_history_cleared_v1', String(Date.now())); } catch (e) {}
    touchData();
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
    for (let i = 0; i < localStorage.length; i++) {
      try {
        const k = localStorage.key(i);
        if (k && k.indexOf('portal_best_') === 0) {
          const bv = JSON.parse(localStorage.getItem(k));
          if (bv && typeof bv === 'object') out[k] = bv;
        }
      } catch (e) {}
    }
    return out;
  }

  // ---------------- statistics & history ----------------
  // The screen follows the pattern the good study apps use: one headline
  // number, the trend behind it, a breakdown by subject, then the raw log.
  const STATS_RANGES = [7, 30, 0];
  const PASS_MARK = 60;   // the pass mark used everywhere in this app

  function statsRange() {
    const r = Number(S.statsRange);
    return STATS_RANGES.indexOf(r) >= 0 ? r : 30;
  }

  function statsBand(pct) {
    if (pct >= 85) return 'good';
    if (pct >= PASS_MARK) return 'ok';
    return 'low';
  }

  function dayKey(t) {
    const d = new Date(t || 0);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function shortDay(t) {
    try {
      return new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short' }).format(new Date(t || 0));
    } catch (e) { return ''; }
  }

  function dayLabel(t) {
    const d = new Date(t || 0);
    const today = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
    if (diff === 0) return 'اليوم';
    if (diff === 1) return 'أمس';
    if (diff === 2) return 'أمس قبل أمس';
    const df = new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'long' });
    return df.format(d);
  }

  function streakDays(items) {
    if (!items.length) return 0;
    const days = {};
    items.forEach((h) => { days[dayKey(h.t)] = true; });
    let streak = 0;
    const cur = new Date();
    // a streak survives if the last attempt was today or yesterday
    if (!days[dayKey(cur.getTime())]) cur.setDate(cur.getDate() - 1);
    while (days[dayKey(cur.getTime())]) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
    return streak;
  }

  function renderStats() {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (Array.isArray(h)) S.history = h;
    } catch (e) {}
    const ALL = S.history.slice().sort((a, b) => (a.t || 0) - (b.t || 0));
    const days = statsRange();
    const H = days ? ALL.filter((h) => (Date.now() - (h.t || 0)) <= days * 86400000) : ALL;
    const prev = days
      ? ALL.filter((h) => {
        const age = Date.now() - (h.t || 0);
        return age > days * 86400000 && age <= days * 2 * 86400000;
      })
      : [];

    document.querySelectorAll('.range-opt').forEach((b) => {
      const on = Number(b.dataset.range) === days;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    const n = H.length;
    const totQ = H.reduce((a, h) => a + (h.correct || 0), 0);
    const totTried = H.reduce((a, h) => a + (h.total || 0), 0);
    const totSecs = H.reduce((a, h) => a + (h.secs || 0), 0);
    const avg = n ? H.reduce((a, h) => a + (h.pct || 0), 0) / n : 0;
    const best = n ? Math.max.apply(null, H.map((h) => h.pct || 0)) : 0;
    const prevAvg = prev.length ? prev.reduce((a, h) => a + (h.pct || 0), 0) / prev.length : null;
    const rangeName = days === 7 ? 'آخر أسبوع' : (days === 30 ? 'آخر شهر' : 'الكل');

    $('stats-total-line').textContent = n
      ? (arCount(n, { one: 'محاولة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' }) + ' · ' + rangeName)
      : '';

    // ---- with no attempts at all, the screen shows one honest empty state ----
    const empty = $('stats-empty');
    const hasAny = ALL.length > 0;
    if (empty) empty.classList.toggle('hidden', hasAny);
    ['stats-hero', 'stats-overall', 'stats-trend', 'stats-insight', 'stats-subjects'].forEach((id) => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', !hasAny);
    });
    const trendBlock = document.querySelector('#stats-trend') ? document.querySelector('#stats-trend').closest('.stats-block') : null;
    if (trendBlock) trendBlock.classList.toggle('hidden', !hasAny);
    const subsBlock = document.querySelector('#stats-subjects') ? document.querySelector('#stats-subjects').closest('.stats-block') : null;
    if (subsBlock) subsBlock.classList.toggle('hidden', !hasAny);

    // ---- hero: the one number that matters, with the movement behind it ----
    const hero = $('stats-hero');
    hero.innerHTML = '';
    const delta = prevAvg === null ? null : avg - prevAvg;
    const heroMain = document.createElement('div');
    heroMain.className = 'stats-hero-main';
    heroMain.innerHTML =
      '<span class="stats-hero-label">متوسط نتائجك</span>' +
      '<span class="stats-hero-value" dir="ltr">' + (n ? (Math.round(avg * 10) / 10) + '%' : '—') + '</span>' +
      (delta === null ? '' :
        '<span class="stats-hero-trend ' + (delta >= 0 ? 'up' : 'down') + '">' +
        (delta >= 0 ? '▲' : '▼') + ' ' + Math.abs(Math.round(delta * 10) / 10) + ' نقطة عن الفترة السابقة</span>');
    hero.appendChild(heroMain);
    const heroSide = document.createElement('div');
    heroSide.className = 'stats-hero-side';
    heroSide.innerHTML =
      '<div><span class="stats-hero-side-value" dir="ltr">' + n + '</span><span class="stats-hero-side-label">محاولة</span></div>' +
      '<div><span class="stats-hero-side-value" dir="ltr">' + (n ? best + '%' : '—') + '</span><span class="stats-hero-side-label">أفضل نتيجة</span></div>';
    hero.appendChild(heroSide);

    // ---- four small facts ----
    const box = $('stats-overall');
    box.innerHTML = '';
    const cards = [
      ['check', totQ + ' / ' + totTried, 'إجابات صحيحة'],
      ['target', totTried ? Math.round((totQ / totTried) * 100) + '%' : '—', 'دقة الإجابات'],
      ['award', H.filter((h) => (h.pct || 0) >= 60).length + ' من ' + n, 'اختبارات ناجحة'],
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

    // ---- the trend: one bar per attempt, with the pass mark ----
    const trend = $('stats-trend');
    trend.innerHTML = '';
    const last = H.slice(-12);
    if (!last.length) {
      trend.innerHTML = '<div class="trend-empty">لا توجد محاولات في هذه الفترة</div>';
    } else {
      const bars = last.map((h) => {
        const pct = Math.max(0, Math.min(100, h.pct || 0));
        return '<div class="trend-col" title="' + escapeHtml((h.topic || '') + ' · ' + h.pct + '%') + '">' +
          '<span class="trend-val" dir="ltr">' + Math.round(h.pct) + '%</span>' +
          '<div class="trend-bar ' + statsBand(h.pct) + '" style="height:' + Math.max(6, pct) + '%"></div>' +
          '<span class="trend-day">' + escapeHtml(shortDay(h.t)) + '</span>' +
          '</div>';
      }).join('');
      trend.innerHTML = '<div class="trend-chart"><div class="trend-bars">' + bars +
        '<span class="trend-pass" style="bottom:' + PASS_MARK + '%"><i></i><b>' + PASS_MARK + '%</b></span>' +
        '</div></div>';
    }

    // ---- one honest sentence about the movement ----
    const insight = $('stats-insight');
    const streak = streakDays(ALL);
    let txt = '';
    if (n) {
      if (delta !== null && Math.abs(delta) >= 0.5) {
        txt = delta > 0
          ? 'تحسّن متوسطك ' + Math.round(delta) + ' نقطة عن الفترة السابقة.'
          : 'انخفض متوسطك ' + Math.abs(Math.round(delta)) + ' نقاط عن الفترة السابقة.';
      } else if (prev.length) {
        txt = 'نتائجك على نفس المستوى عن الفترة السابقة.';
      } else {
        txt = 'لا توجد محاولة سابقة في الفترة نفسها — محاولة إضافية تكفي للمقارنة.';
      }
      if (streak >= 2) txt += ' وعندك سلسلة ' + streak + ' أيام متتالية.';
    }
    insight.textContent = txt;

    // ---- per subject ----
    const subs = $('stats-subjects');
    subs.innerHTML = '';
    const bySub = {};
    H.forEach((h) => {
      const sid = h.subjectId || h.sub || 'other';
      const stitle = h.subjectTitle || h.title || 'مادة عامة';
      (bySub[sid] = bySub[sid] || { title: stitle, rows: [] }).rows.push(h);
    });
    Object.keys(bySub).sort((a, b) => {
      const av = (g) => g.rows.reduce((x, h) => x + (h.pct || 0), 0) / g.rows.length;
      return av(bySub[b]) - av(bySub[a]);
    }).forEach((sid) => {
      const g = bySub[sid];
      const rows = g.rows;
      const a2 = rows.reduce((x, h) => x + (h.pct || 0), 0) / rows.length;
      const b2 = Math.max.apply(null, rows.map((h) => h.pct || 0));
      const lastRow = rows[rows.length - 1];
      const wrap = document.createElement('div');
      wrap.className = 'saved-group';
      const head = document.createElement('div');
      head.className = 'saved-group-head';
      head.innerHTML = '<div><div class="saved-group-title">' + escapeHtml(g.title) + '</div>' +
        '<div class="saved-group-sub">' + (rows.length > 1 ? 'المتوسط ' + (Math.round(a2 * 10) / 10) + '% · الأفضل ' + b2 + '%' : 'محاولة واحدة · ' + (lastRow ? lastRow.pct : 0) + '%') + '</div></div>' +
        '<div class="stat-value" dir="ltr">' + Math.round(a2) + '%</div>';
      wrap.appendChild(head);
      const track = document.createElement('div');
      track.className = 'stat-bar-track';
      track.innerHTML = '<div class="stat-bar-fill" style="width:' + Math.max(0, Math.min(100, a2)) + '%"></div>';
      wrap.appendChild(track);
      subs.appendChild(wrap);
    });

    // ---- the log, grouped by day ----
    const list = $('history-list');
    list.innerHTML = '';
    const rangeBar = document.querySelector('.stats-range');
    if (rangeBar) rangeBar.classList.toggle('hidden', !hasAny);
    const recent = ALL.slice(-30).reverse();
    let currentKey = '';
    recent.forEach((h) => {
      const key = dayKey(h.t);
      if (key !== currentKey) {
        currentKey = key;
        const dayBox = document.createElement('div');
        dayBox.className = 'history-day';
        const count = ALL.filter((x) => dayKey(x.t) === key).length;
        dayBox.innerHTML = '<div class="history-day-head"><span class="history-day-name">' +
          escapeHtml(dayLabel(h.t)) + '</span><span class="history-day-count">' +
          arCount(count, { one: 'محاولة', two: 'محاولتان', few: 'محاولات', many: 'محاولة' }) + '</span></div>';
        list.appendChild(dayBox);
      }
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
          writeSavedRemoved({});
          persistSaved(); updateSavedBadge(); updateMenuCounts();
        }
        if (Array.isArray(d.history)) {
          S.history = d.history.slice(-200);
          try { localStorage.setItem(HISTORY_KEY, JSON.stringify(S.history)); } catch (e) {}
          touchData();
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
      ch: ch, chapterLabel: ch.topicLabel || chLabel(ch), questions: qs, picks: picks, dwells: dwells,
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
    const btnWrong = $('btn-retry-wrong');
    if (btnWrong) btnWrong.style.display = actualWrong > 0 ? '' : 'none';

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
        '<div class="review-header-actions">' +
        '<span class="review-dwell-tag" dir="ltr"><i data-lucide="clock"></i><span>' + dwellSec + 's</span></span>' +
        '</div>';

      stemPair(q).forEach((sp, si) => {
        const stem = document.createElement('p');
        stem.className = 'review-question-text' + (si > 0 ? ' review-question-text-sub' : '');
        stem.innerHTML = richHtml(sp.t);
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
          '</span><span class="review-option-text">' + pair.map((p) => '<span class="opt-line opt-' + p.lang + '">' + richHtml(p.t) + '</span>').join('') + '</span>';
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
          '<div class="expl-body" dir="auto" hidden>' + richHtml(expl) + '</div>';
        const tg = exp.querySelector('.expl-toggle');
        const body = exp.querySelector('.expl-body');
        tg.addEventListener('click', () => {
          const open = exp.classList.toggle('collapsed') === false;
          tg.setAttribute('aria-expanded', open ? 'true' : 'false');
          body.hidden = !open;
        });
        card.appendChild(exp);
      }

      // save / unsave straight from the review header
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
        const ha = header.querySelector('.review-header-actions');
        if (ha) ha.appendChild(saveBtn);
      }
      card.appendChild(header);
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

  function closeOpenModals() {
    let closed = false;
    document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((m) => {
      if (m.id === 'leave-modal') return;
      m.classList.add('hidden');
      m.setAttribute('aria-hidden', 'true');
      closed = true;
    });
    return closed;
  }

  // ---------------- routing ----------------
  function route() {
    closeOpenModals();
    closeDrawers();
    if (!S.index) return;
    const h = location.hash;
    const m = h.match(/^#\/quiz\/([^/]+)\/([^/]+)$/);
    if (h === '#/saved' || h === '#/saved/') {
      S.session = null;
      clearSessionSnapshot();
      renderSaved();
      show('saved-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/stats' || h === '#/stats/') {
      S.session = null;
      clearSessionSnapshot();
      renderStats();
      show('stats-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/account' || h === '#/account/') {
      S.session = null;
      clearSessionSnapshot();
      renderAccount();
      show('account-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/league' || h === '#/league/') {
      S.session = null;
      clearSessionSnapshot();
      renderLeague();
      show('league-view');
      window.scrollTo(0, 0);
      icons();
    } else if (h === '#/practice' || h === '#/practice/') {
      if (S.session && !S.session.finished && !S.session.ch.quiz_id) {
        show(S.session.started ? 'quiz-view' : 'quiz-start-view');
        window.scrollTo(0, 0);
      } else if (!restoreSessionSnapshot(h, null)) {
        location.hash = '#/saved';
      }
    } else if (m) {
      const qz = decodeURIComponent(m[2]);
      if (S.session && !S.session.finished && S.session.ch.quiz_id &&
          S.session.ch.quiz_id === qz && h === S.session.hash) {
        show(S.session.started ? 'quiz-view' : 'quiz-start-view');
        window.scrollTo(0, 0);
      } else if (!restoreSessionSnapshot(h, qz)) {
        startSession(decodeURIComponent(m[1]), qz, null);
      }
    } else {
      S.session = null;
      clearSessionSnapshot();
      renderCatalog();
      show('deck-catalog');
    }
  }

  // ---------------- guided tour (custom spotlight, short steps, replayable, hands-on) ----------------
  const TOUR_STEPS = [
    { title: 'MCSQuiz — جولة تعريفية', body: 'دليل شامل للبوابة: المواد، الاختبارات، النتيجة، المحفوظات، الإحصائيات، والدوري. يمكنك إنهاء الجولة في أي وقت.', center: true },

    { title: 'أزرار الشريط العلوي', body: 'الجرس للتنبيهات (يظهر إشعار عند نزول أسئلة جديدة)، ثم المحفوظات وتبديل المظهر والقائمة — والشعار يعيدك للرئيسية.', target: '.header-catalog-actions' },

    { title: 'القائمة الجانبية', body: 'المحفوظ والإحصائيات والدوري، وتثبيت التطبيق والنسخة بدون إنترنت، والصوت والمظهر.', open: 'menu', target: '#menu-drawer .menu-list' },

    { title: 'الجرس والتنبيهات', body: 'أي أسئلة تنزل جديدة توصلك هنا: المادة والجابتر وعدد الأسئلة. تفتحها أو تحدد الكل كمقروء.', target: '#btn-bell' },

    { title: 'اختر المادة', body: 'شريط أفقي — اسحب واختر مادتك.', target: '#subject-filter-bar' },

    { title: 'اختر الجابتر', body: 'أرقام الجابترات. الرقم الفاتح هو المختار حالياً.', target: '#chapter-filter-bar' },

    { title: 'صف الكوز', body: 'زر التشغيل يبدأ الكوز فوراً، وأيقونة (i) تعرض عدد الأسئلة وأفضل نتيجة.', target: '#deck-catalog .sketch-row:first-child' },

    { title: 'تجربة اختبار', body: 'سنفتح الاختبار الأول لمعاينة تجربة الحل عملياً.', center: true, go: true },

    { title: 'البداية', body: 'هنا عدد الأسئلة والوقت المتوقع. المؤقت يبدأ عند الضغط.', target: '#btn-start-quiz', action: 'start' },

    { title: 'الحفظ', body: 'زر الحفظ أعلى البطاقة — يضيف السؤال إلى المحفوظات.', target: '#btn-save-question' },

    { title: 'زر الترجمة', body: 'أيقونة الترجمة ثابتة في الشريط العلوي: باللون الذهبي للعربية، والقياسي للإنجليزية. تبدّل لغة السؤال والخيارات والشرح.', target: '#lang-toggle-session' },

    { title: 'أجب', body: 'اختر إجابة — لا يوجد زر تخطٍ؛ يلزم تحديد خيار للانتقال.', target: '#options-container', action: 'answer' },

    { title: 'الشرح فوراً', body: 'بعد الإجابة يظهر الشرح بالعربي تحت الخيارات.', target: '#live-feedback-box' },

    { title: 'التالي', body: 'ينتقل بعد الإجابة فقط، ومع السؤال الأخير يُنهي الاختبار ويحسب النتيجة.', target: '#btn-next' },

    { title: 'جدول الأسئلة', body: 'هذا الزر يفتح خريطة الأسئلة.', target: '#btn-open-matrix' },

    { title: 'خريطة الأسئلة', body: 'توضح الإجابات الصحيحة والخاطئة مع إمكانية مراجعة الأسئلة السابقة. يُنهى الاختبار تلقائياً بعد آخر سؤال.', open: 'matrix', target: '#matrix-drawer .matrix-grid' },

    { title: 'شاشة النتيجة', body: 'عرض تفصيلي للنتيجة: النسبة، الإجابات، الزمن، ومراجعة لكل سؤال مع الشرح وإمكانية حفظ أي سؤال، والترجمة من الشريط العلوي.', demo: 'results', target: '.results-card' },

    { title: 'المحفوظات', body: 'الأسئلة المحفوظة مقسمة حسب المادة والفصل، مع خيار بدء اختبار للفصل أو المادة كاملة.', center: true, route: '#/saved' },

    { title: 'الإحصائيات', body: 'أرقامك العامة، متوسط كل مادة، سجل المحاولات، ونسخة احتياطية/استعادة/مسح.', center: true, route: '#/stats' },

    { title: 'الدوري الأسبوعي', body: 'ترتيب أسبوعي بالإجابات الصحيحة مع نسبة الدقة. زر «ظاهر» يخفي اسمك أو يرجعه.', target: '#league-view .league-head', route: '#/league' },

    { title: 'شارك ترتيبك', body: 'بطاقة مشاركة مصممة تتضمن ترتيبك وأفضل النتائج والدقة لتنزيلها أو مشاركتها.', target: '#btn-league-share' },

    { title: 'انتهت الجولة', body: 'يمكنك إعادتها من القائمة الجانبية ← «إعادة الجولة التعليمية». يعمل التطبيق بدون إنترنت بعد الزيارة الأولى.', center: true },
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
        // the target is not on the screen yet (the explanation only appears
        // after an answer): keep the text of the step visible in the middle
        // and try again, instead of leaving a blank overlay behind
        const tries = tourRetried.get(i) || 0;
        if (tries < 3) tourRetried.set(i, tries + 1);
        ov.classList.remove('hidden');
        ov.setAttribute('aria-hidden', 'false');
        ov.classList.add('tour-dim-light');
        const tipIcon = $('tour-tip-icon');
        if (tipIcon) tipIcon.style.display = 'block';
        $('tour-tip-title').textContent = st.title;
        $('tour-tip-body').textContent = st.body;
        $('tour-tip-progress').textContent = (i + 1) + ' / ' + TOUR_STEPS.length;
        const tipBar = $('tour-tip-bar-fill');
        if (tipBar) tipBar.style.width = ((i + 1) / TOUR_STEPS.length * 100) + '%';
        $('tour-btn-next').textContent = i === TOUR_STEPS.length - 1 ? 'إنهاء' : (st.action ? 'تخطي الخطوة' : 'التالي');
        $('tour-btn-prev').style.visibility = i === 0 ? 'hidden' : 'visible';
        $('tour-tip').classList.remove('tour-waiting');
        centerTip();
        paintShades(null);
        icons();
        if (tries < 3) setTimeout(() => { if (tourIdx === i) tourShow(i); }, 600);
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      rect = el.getBoundingClientRect();
    }
    ov.classList.remove('hidden');
    ov.setAttribute('aria-hidden', 'false');
    ov.removeAttribute('inert');
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
    $('tour-overlay').setAttribute('inert', '');
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
    // warn only once the quiz has really started: sitting on the start card is
    // not an attempt yet, but a running quiz must always warn before leaving
    const s = S.session;
    return !!(s && !s.finished && s.started);
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
    const stay = $('leave-stay'), hint = $('leave-hint'), rem = $('leave-remaining');
    if (t && b && go) {
      if (leaveIntent === 'finish') {
        t.textContent = 'إنهاء الاختبار؟';
        b.textContent = 'الأسئلة التي لم تُجب عنها ستُحسب خاطئة.';
        go.textContent = 'إنهاء الآن';
        if (stay) stay.textContent = 'متابعة الاختبار';
        if (hint) hint.style.display = 'none';
      } else {
        t.textContent = 'الخروج من الاختبار؟';
        b.textContent = 'لن تُحسب نتيجتك إذا خرجت الآن.';
        go.textContent = 'خروج بدون احتساب';
        if (stay) stay.textContent = 'متابعة الاختبار';
        if (hint) {
          const ses = S.session;
          const left = ses ? ses.questions.filter((q, i) => ses.picks[i] === null || ses.picks[i] === undefined).length : 0;
          hint.textContent = left > 0 ? ('بقي ' + qCount(left) + ' على إنهاء الاختبار.') : '';
          hint.style.display = left > 0 ? '' : 'none';
        }
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
    closeOpenModals();
    closeDrawers();
    if (!S.index) return;
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
  // ---------- side menu ----------------
  function openMenu() {
    syncMenuToggles();
    updateMenuCounts();
    refreshOfflineRow();
    refreshInstallRow();
    openDrawer('menu-drawer');
  }

  // Honest offline readiness: says whether this window can even run a service
  // worker (Telegram's WebView may not), and whether the shell is cached.
  async function refreshOfflineRow() {
    const label = $('menu-offline-label');
    const badge = $('menu-offline-state');
    const sub = $('menu-offline-sub');
    if (!label || !badge) return;
    let supported = false;
    try { supported = ('serviceWorker' in navigator); } catch (e) {}
    if (!supported) {
      label.textContent = 'النسخة بدون إنترنت';
      if (sub) sub.textContent = 'هذه النافذة ما تدعم التخزين — افتح الرابط في Chrome';
      badge.textContent = '!';
      badge.classList.remove('hidden', 'ok', 'warn');
      return;
    }
    let entries = 0;
    try {
      const st = await offlineState();
      entries = Object.keys(st.caches).reduce((n, k) => n + (st.caches[k] || 0), 0);
      const ctrl = !!navigator.serviceWorker.controller;
      if (entries > 5 && ctrl) {
        label.textContent = 'النسخة بدون إنترنت';
        if (sub) sub.textContent = 'الكوزات محفوظة على جهازك — تفتح بلا نت';
        badge.textContent = 'جاهزة';
        badge.classList.remove('hidden', 'warn');
        badge.classList.add('ok');
        return;
      }
    } catch (e) { /* audit-ignore: probe only */ }
    label.textContent = 'النسخة بدون إنترنت';
    if (sub) sub.textContent = 'اضطر لتحضير الكوزات على جهازك';
    badge.textContent = 'جهّز';
    badge.classList.remove('hidden', 'ok');
    badge.classList.add('warn');
  }

  // the install row: "installed" is what matters, and an installed app opened in
  // a normal tab reports neither standalone mode nor an install prompt — so it is
  // detected three ways (mode, the appinstalled flag, the browser's own list)
  async function isAppInstalled() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (e) {}
    try { if (lsGet('portal_installed_v1') === '1') return true; } catch (e) {}
    try {
      if (navigator.getInstalledRelatedApps) {
        const apps = await navigator.getInstalledRelatedApps();
        if (Array.isArray(apps) && apps.length) {
          lsSet('portal_installed_v1', '1');
          return true;
        }
      }
    } catch (e) { /* audit-ignore: probe only */ }
    return false;
  }

  async function refreshInstallRow() {
    const sub = $('menu-install-sub');
    const badge = $('menu-install-state');
    if (!sub && !badge) return;
    const installed = await isAppInstalled();
    const canInstall = !!(window.PortalPWA && window.PortalPWA.canInstall && window.PortalPWA.canInstall());
    if (installed) {
      if (sub) sub.textContent = 'التطبيق مثبّت على جهازك — افتحه من شاشته';
      if (badge) { badge.textContent = 'مثبّت'; badge.classList.remove('hidden', 'warn'); badge.classList.add('ok'); }
    } else if (canInstall) {
      if (sub) sub.textContent = 'افتح البوابة كتطبيق وتفتح بلا نت';
      if (badge) { badge.textContent = 'متاح'; badge.classList.remove('hidden', 'warn'); badge.classList.add('ok'); }
    } else {
      if (sub) sub.textContent = 'ثبّته من قائمة المتصفح جم → تثبيت التطبيق';
      if (badge) { badge.textContent = 'غير متاح'; badge.classList.remove('hidden', 'ok'); badge.classList.add('warn'); }
    }
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
      if (entries > 5) {
        const inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
        toast(inTelegram
          ? 'النسخة محفوظة ✓ — داخل تليجرام لازم تفتحها وأنت متصل؛ للفتح بلا نت استعمل التطبيق المثبّت'
          : 'النسخة بدون إنترنت جاهزة ✓', 'success');
      }
      else toast('التجهيز ما كمل — خلي الصفحة مفتوحة شوي وأعد المحاولة', 'error');
      refreshOfflineRow();
    } catch (e) {
      toast('تعذر تجهيز النسخة بدون إنترنت', 'error');
    }
  }
  function setSound(on) {
    S.sound = !!on;
    try { localStorage.setItem('portal_sound', S.sound ? '1' : '0'); } catch (e) {}
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
    const ths = $('theme-header-icon-session');
    if (ths) ths.setAttribute('data-lucide', dark ? 'sun' : 'moon');
    icons();
  }
  function updateMenuCounts() {
    const b = $('menu-saved-count');
    if (!b) return;
    const n = Object.keys(S.saved).length;
    b.textContent = n > 999 ? '999+' : n;
    b.classList.toggle('hidden', n === 0);
  }
  async function installApp() {
    const inTelegram = !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData);
    if (await isAppInstalled()) {
      closeDrawers();
      toast('التطبيق مثبّت أصلاً — افتحه من شاشته', 'info');
      return;
    }
    if (window.PortalPWA && await window.PortalPWA.install()) {
      closeDrawers();
      toast('تم إرسال طلب التثبيت');
    } else if (inTelegram) {
      // measured on a real tablet: Telegram's WebView does not keep the offline
      // cache, so the installed browser app is the offline path
      toast('للتشغيل بدون إنترنت: افتح الرابط في Chrome ثم ⋮ ← تثبيت التطبيق', 'info');
    } else {
      toast('ثبّت التطبيق من قائمة المتصفح: جم → تثبيت التطبيق', 'info');
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
    const acc = (C && C.account) ? C.account() : null;
    const setAvatar = (url, fallbackText) => {
      if (!av) return;
      if (url) {
        av.classList.add('avatar-default');
        av.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '"),url("assets/avatar-default.svg")';
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';
      } else {
        av.classList.remove('avatar-default');
        av.style.backgroundImage = '';
        av.textContent = fallbackText;
      }
    };
    if (acc) {
      name.textContent = acc.name || acc.handle;
      // the picture the account holder picked, not just the first letter
      setAvatar(acc.avatar || '', (String(acc.name || acc.handle).trim()[0] || '؟'));
      if (!navigator.onLine) sub.textContent = 'أوفلاين — تُزامن عند الاتصال';
      else {
        const t = fmtSyncTime();
        sub.textContent = '@' + acc.handle + (t ? ' · مزامن ' + t : '');
      }
      icons();
      return;
    }
    if (!C || !C.linked()) {
      name.textContent = 'زائر — بدون حساب';
      sub.textContent = 'ادخل باسمك لتُحفظ بياناتك وتظهر في الدوري';
      setAvatar('', 'ز');
      icons();
      return;
    }
    const who = (C.displayName && C.displayName()) || S.cloudName || 'لاعب';
    name.textContent = who;
    let photo = '';
    try { photo = (C.avatarUrl && C.avatarUrl()) || ''; } catch (e) {}
    setAvatar(photo, (String(who).trim()[0] || '؟'));
    if (!navigator.onLine) sub.textContent = 'أوفلاين — تُزامن عند الاتصال';
    else {
      const t = fmtSyncTime();
      sub.textContent = t ? 'مزامن ✓ ' + t : 'مزامن ✓';
    }
    icons();
  }
  window.PortalCloudUI = function (res) {
    try {
      loadSaved();
      updateSavedBadge();
      updateMenuCounts();
      updateAccountRow();
      if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
      if (location.hash === '#/saved' || location.hash === '#/saved/') renderSaved();
      if (res && (res.action === 'uploaded-new' || res.action === 'merged-uploaded')) {
        toast('تمت مزامنة النتائج تلقائياً ✓', 'success');
      }
    } catch (e) {}
  };

  async function handleAccountTap() {
    // picking a drawer item must dismiss the drawer itself, otherwise its overlay
    // keeps intercepting taps behind the sheet that opens next
    closeDrawers();
    const C = cloud();
    const acc = (C && C.account) ? C.account() : null;
    if (!acc) { openLoginModal(); return; }
    // signed in: the account opens as its own page
    S.accountReturn = (location.hash && location.hash !== '#/account') ? location.hash : '#/';
    goHash('#/account');
  }

  // the account page
  function renderAccount() {
    const C = cloud();
    const acc = (C && C.account) ? C.account() : null;
    if (!acc) { openLoginModal(); return; }
    $('account-body').textContent = '@' + acc.handle + (navigator.onLine ? '' : ' · غير متصل');
    renderProfileEditor(acc);
    $('account-link').classList.remove('hidden');
    $('account-logout').classList.remove('hidden');
    $('account-delete').classList.remove('hidden');
    // a device that only linked (no PIN here) cannot read or write the
    // encrypted personal data yet
    const hasPin = !!(C && C.pinOnDevice && C.pinOnDevice());
    $('account-unlock').classList.toggle('hidden', hasPin);
    $('account-open-bot').classList.add('hidden');
    $('account-sync-now').classList.remove('hidden');
    icons();
  }

  const AVATARS = [
    'person-01', 'person-02', 'person-03', 'person-04', 'person-05',
    'person-06', 'person-07', 'person-08', 'person-09', 'person-10',
    'person-11', 'person-12', 'person-13', 'person-14', 'person-15',
    'person-16', 'person-17', 'person-18', 'person-19', 'person-20',
    'person-21', 'person-22', 'person-23', 'person-24', 'person-25',
  ];

  function renderProfileEditor(acc) {
    const box = $('account-profile');
    if (!box) return;
    box.classList.remove('hidden');
    $('profile-name').value = acc.name || '';
    $('profile-handle').textContent = '@' + acc.handle;
    try { $('profile-pin').value = localStorage.getItem('portal_pin_v1') || ''; } catch (e) {}
    // the new-PIN fields are always empty when the page opens
    if ($('pin-new')) $('pin-new').value = '';
    if ($('pin-new2')) $('pin-new2').value = '';
    const grid = $('avatar-grid');
    grid.innerHTML = '';
    // one row at a time: the picker opens compact and «إظهار المزيد» expands it
    grid.classList.add('collapsed');
    const moreBtn = $('avatar-more');
    if (moreBtn) {
      moreBtn.setAttribute('aria-expanded', 'false');
      if ($('avatar-more-label')) $('avatar-more-label').textContent = 'إظهار المزيد';
      const mi = $('avatar-more-icon');
      if (mi) mi.setAttribute('data-lucide', 'chevron-down');
    }
    const current = acc.avatar || '';

    // «بدون صورة» is a tile of its own, not a chip on the edge
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.id = 'avatar-none';
    noneBtn.className = 'avatar-choice avatar-none-choice' + (current ? '' : ' selected');
    noneBtn.setAttribute('aria-label', 'بدون صورة');
    noneBtn.setAttribute('aria-pressed', current ? 'false' : 'true');
    noneBtn.innerHTML = '<i data-lucide="user-x"></i><span class="avatar-check" aria-hidden="true">' +
      '<i data-lucide="check"></i></span>';
    grid.appendChild(noneBtn);

    AVATARS.forEach((name) => {
      const src = 'assets/avatars/' + name + '.png';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'avatar-choice' + (current === src ? ' selected' : '');
      b.setAttribute('aria-label', 'صورة ' + name);
      b.setAttribute('aria-pressed', current === src ? 'true' : 'false');
      b.innerHTML = '<img src="' + src + '" alt=""><span class="avatar-check" aria-hidden="true">' +
        '<i data-lucide="check"></i></span>';
      b.addEventListener('click', () => {
        grid.querySelectorAll('.avatar-choice').forEach((x) => {
          x.classList.remove('selected');
          x.setAttribute('aria-pressed', 'false');
        });
        b.classList.add('selected');
        b.setAttribute('aria-pressed', 'true');
        noneBtn.classList.remove('selected');
        noneBtn.setAttribute('aria-pressed', 'false');
        box.dataset.avatar = src;
        paintAvatarPreview(src);
      });
      grid.appendChild(b);
    });
    noneBtn.onclick = () => {
      grid.querySelectorAll('.avatar-choice').forEach((x) => {
        x.classList.remove('selected');
        x.setAttribute('aria-pressed', 'false');
      });
      noneBtn.classList.add('selected');
      noneBtn.setAttribute('aria-pressed', 'true');
      box.dataset.avatar = '';
      paintAvatarPreview('');
    };
    box.dataset.avatar = current;
    paintAvatarPreview(current);
    icons();
  }

  // the account sheet header shows the picture that is currently picked
  function paintAvatarPreview(src) {
    const box = $('account-avatar-preview');
    if (!box) return;
    if (src) {
      box.classList.add('has-avatar');
      const img = document.createElement('img');
      img.src = escapeHtml(src);
      img.alt = '';
      img.onerror = () => { box.classList.remove('has-avatar'); box.innerHTML = '<i data-lucide="user-round"></i>'; icons(); };
      box.innerHTML = '';
      box.appendChild(img);
    } else {
      box.classList.remove('has-avatar');
      box.innerHTML = '<i data-lucide="user-round"></i>';
    }
    icons();
  }

  async function saveProfile() {
    const C = cloud();
    const box = $('account-profile');
    if (!C || !C.updateProfile) return;
    const name = ($('profile-name').value || '').trim();
    if (!name) { toast('اكتب اسمك', 'error'); return; }
    const avatar = box.dataset.avatar || '';
    const pin = ($('profile-pin').value || '').replace(/\D/g, '');
    if (pin.length !== 4) { toast('أدخل رمزك (4 أرقام) لتأكيد التعديل', 'error'); return; }
    try {
      await C.updateProfile(name, avatar, pin);
      updateAccountRow();
      S.leagueRows = null; S.leagueStamp = 0;
      try { await window.PortalLeague.syncWeek(); } catch (e) { dbg('league sync failed:', (e && e.message) || e); }
      renderLeague();
      toast('تم حفظ الملف', 'success');
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (msg.indexOf('too_many_attempts') >= 0) toast('محاولات كثيرة — حاول بعد قليل', 'error');
      else if (msg.indexOf('bad_pin') >= 0) toast('الرمز غير صحيح', 'error');
      else if (msg.indexOf('pin') >= 0) toast('أعد تسجيل الدخول لتعديل الملف', 'error');
      else toast('تعذر الحفظ', 'error');
    }
  }

  async function changePin() {
    const C = cloud();
    if (!C || !C.changePin) return;
    const cur = ($('profile-pin').value || '').replace(/\D/g, '');
    const next = ($('pin-new').value || '').replace(/\D/g, '');
    const again = ($('pin-new2').value || '').replace(/\D/g, '');
    if (cur.length !== 4) { toast('اكتب رمزك الحالي (4 أرقام)', 'error'); return; }
    if (next.length !== 4) { toast('الرمز الجديد 4 أرقام', 'error'); return; }
    if (next !== again) { toast('تأكيد الرمز ما مطابق', 'error'); return; }
    if (next === cur) { toast('الرمز الجديد نفس القديم', 'error'); return; }
    const btn = $('pin-change');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جارٍ التغيير…';
    try {
      await C.changePin(cur, next);
      $('pin-new').value = '';
      $('pin-new2').value = '';
      $('profile-pin').value = next;
      toast('تم تغيير الرمز — استعمله من هسه', 'success');
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (msg.indexOf('too_many_attempts') >= 0) toast('محاولات كثيرة — حاول بعد قليل', 'error');
      else if (msg.indexOf('bad_pin') >= 0) toast('الرمز الحالي غير صحيح', 'error');
      else if (msg.indexOf('same_pin') >= 0) toast('الرمز الجديد نفس القديم', 'error');
      else toast('تعذر تغيير الرمز', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  // ---------------- handle accounts (no email / password) ----------------
  function loginError(msg) {
    const el = $('login-error');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function openLoginModal() {
    loginError('');
    setLoginMode('create');
    $('login-modal').classList.remove('hidden');
    $('login-modal').setAttribute('aria-hidden', 'false');
    setTimeout(() => { try { $('login-name').focus(); } catch (e) {} }, 120);
    icons();
  }

  // two shapes: a new account (name + handle + PIN) and a saved one (handle + PIN)
  let loginMode = 'create';
  function setLoginMode(mode) {
    loginMode = mode === 'login' ? 'login' : 'create';
    const creating = loginMode === 'create';
    $('login-title').textContent = creating ? 'ادخل باسمك' : 'ادخل بحسابك';
    const sub = document.querySelector('#login-modal .auth-sub');
    if (sub) {
      sub.textContent = creating
        ? 'معرّفك هو حسابك — بدون إيميل ولا كلمة مرور. نفس المعرّف على أي جهاز يفتح نفس بياناتك.'
        : 'اكتب اسم المستخدم والرمز فقط — بدون اسم جديد.';
    }
    $('login-name-group').classList.toggle('hidden', !creating);
    $('login-submit').textContent = creating ? 'دخول أو إنشاء' : 'دخول';
    $('login-mode').textContent = creating
      ? 'عندي حساب محفوظ — دخول بالمعرّف والرمز'
      : 'حساب جديد؟ أنشئ واحد';
    loginError('');
    icons();
  }

  function closeLoginModal() {
    $('login-modal').classList.add('hidden');
    $('login-modal').setAttribute('aria-hidden', 'true');
  }

  async function submitLogin() {
    const C = cloud();
    const creating = loginMode === 'create';
    const name = ($('login-name').value || '').trim();
    const handle = C && C.normalizeHandle ? C.normalizeHandle($('login-handle').value) : ($('login-handle').value || '').trim();
    const pin = ($('login-pin').value || '').replace(/\D/g, '');
    if (creating && !name) { loginError('اكتب اسمك أولاً'); return; }
    if (handle.length < 3) { loginError('اسم المستخدم 3 أحرف على الأقل (a-z 0-9 _)'); return; }
    if (pin.length !== 4) { loginError('رمز الدخول 4 أرقام'); return; }
    const btn = $('login-submit');
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول…';
    try {
      const who = await C.login(handle, pin, name);
      closeLoginModal();
      toast('أهلاً ' + ((who && who.name) || name || handle), 'success');
      // an account switch clears the previous account's data: re-read it, then
      // let the pull bring this account's own copy
      try { loadSaved(); } catch (e) {}
      updateAccountRow();
      // a fresh identity must not read the previous board cache
      S.leagueRows = null; S.leagueMe = null; S.leagueStamp = 0;
      try { await C.pullOrPush(); } catch (e) { dbg('sync failed:', (e && e.message) || e); }
      try { if (window.PortalLeague) await window.PortalLeague.syncWeek(); } catch (e) { dbg('league sync failed:', (e && e.message) || e); }
      renderLeague();
      try { loadSaved(); } catch (e) {}
      renderCatalog();
      if (location.hash === '#/saved' || location.hash === '#/saved/') renderSaved();
      if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
      updateSavedBadge(); updateMenuCounts();
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (msg.indexOf('bad_pin') >= 0) loginError('الرمز غير صحيح لهذا المستخدم');
      else if (msg.indexOf('too_many_attempts') >= 0) {
        const mins = Number(String(msg).split(':')[1] || 5);
        loginError('محاولات كثيرة — الحساب مقفل مؤقتاً. حاول بعد ' + mins + ' دقيقة');
      }
      else if (msg.indexOf('handle-short') >= 0) loginError('اسم المستخدم قصير');
      else if (msg.indexOf('pin-format') >= 0) loginError('رمز الدخول 4 أرقام');
      else loginError('تعذر الدخول — تحقق من الاتصال');
    } finally {
      btn.disabled = false;
      btn.textContent = 'دخول';
    }
  }

  // ---------------- link another device (code + number matching) ----------------
  let linkPoll = null;
  let linkMode = 'generate';

  function stopLinkPoll() {
    if (linkPoll) { clearInterval(linkPoll); linkPoll = null; }
  }

  async function generateLinkCode() {
    const C = cloud();
    if (!C || !C.login) return;
    // asking for a link is an explicit sign-in: the "I signed out" guard that
    // stops background polls from resurrecting a session must not block it
    try { localStorage.removeItem('portal_signed_out_v1'); } catch (e) {}
    const startedAt = Date.now();
    const code = String(Math.floor(100000 + Math.random() * 900000));   // six digits
    $('link-title').textContent = 'ربط هذا الجهاز';
    $('link-close').textContent = 'إلغاء الربط';
    $('link-generate').classList.remove('hidden');
    $('link-approve').classList.add('hidden');
    $('link-code').textContent = code;
    renderLinkQr(code);
    $('link-wait').textContent = 'بانتظار التأكيد من الجهاز الآخر…';
    $('link-modal').classList.remove('hidden');
    $('link-modal').setAttribute('aria-hidden', 'false');
    try {
      const sb = await sbRaw();
      await sb.rpc('link_new', { p_code: code });
    } catch (e) { /* audit-ignore: the link poll retries */ }
    stopLinkPoll();
    linkPoll = setInterval(async () => {
      // never resurrect a session after the sheet was closed or the user signed out
      if (!document.querySelector('#link-modal') || document.querySelector('#link-modal').classList.contains('hidden')) {
        stopLinkPoll();
        return;
      }
      try {
        const sb = await sbRaw();
        const r = await sb.rpc('link_status', { p_code: code });
        const row = (Array.isArray(r.data) ? r.data[0] : r.data) || null;
        if (row && row.approved && row.handle) {
          stopLinkPoll();
          C.adopt({ id: row.user_id, handle: row.handle, name: row.name, avatar: row.avatar || '' });
          $('link-wait').textContent = 'تم الربط ✓';
          closeLinkModal();
          updateAccountRow();
          toast('تم ربط هذا الجهاز', 'success');
          S.leagueRows = null; S.leagueMe = null; S.leagueStamp = 0;
          try { loadSaved(); } catch (e) {}
          let sync = { action: '' };
          try { sync = await C.pullOrPush(); } catch (e) { dbg('sync failed:', (e && e.message) || e); }
          // the merge just replaced the local copy: re-read it before any screen
          // renders, otherwise the new device shows stale/empty stats until a reload
          try { loadSaved(); } catch (e) {}
          if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
          if (location.hash === '#/saved' || location.hash === '#/saved/') renderSaved();
          updateSavedBadge(); updateMenuCounts(); updateAccountRow();
          try { if (window.PortalLeague) await window.PortalLeague.syncWeek(); } catch (e) { dbg('league sync failed:', (e && e.message) || e); }
          renderLeague();
          // the account's saved questions and history are encrypted with the PIN;
          // a freshly linked device has none, so say what to do instead of
          // looking like the data vanished
          if (sync && sync.action === 'needs-pin') {
            toast('تم الربط — اضغط «تفعيل المزامنة هنا» وأدخل رمزك لتنزيل بياناتك', 'success');
            goHash('#/account');
          }
          return;
        }
        // approved, but the approving account has no server row: saying nothing
        // would leave this device spinning on the QR for ever
        if (row && row.approved) {
          stopLinkPoll();
          $('link-wait').textContent = 'الحساب على الجهاز الآخر غير مكتمل — سجّل الدخول عليه مرة، ثم أعد المحاولة.';
          return;
        }
        // the code lives ten minutes; after that there is nothing left to wait for
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          stopLinkPoll();
          $('link-wait').textContent = 'انتهى وقت الرمز — أغلق وأعد المحاولة.';
        }
      } catch (e) { /* audit-ignore: probe only */ }
    }, 3000);
  }

  function renderLinkQr(code) {
    const box = $('link-qr');
    if (!box) return;
    box.innerHTML = '';
    try {
      if (typeof qrcode !== 'function') return;
      const url = location.origin + location.pathname + '#/link?code=' + code;
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
    } catch (e) {}
  }

  function openLinkApprove() {
    const C = cloud();
    const acc = (C && C.account) ? C.account() : null;
    if (!acc) { openLoginModal(); return; }
    $('link-title').textContent = 'ربط جهاز آخر';
    $('link-close').textContent = 'إغلاق';
    $('link-generate').classList.add('hidden');
    $('link-approve').classList.remove('hidden');
    let pre = '';
    try {
      // the code is six digits — a \d{4} match used to hand the field only the
      // first four and every scan ended in a mismatch
      const m = location.hash.match(/code=(\d{6})/);
      if (m) pre = m[1];
    } catch (e) {}
    $('link-code-input').value = pre;
    $('link-modal').classList.remove('hidden');
    $('link-modal').setAttribute('aria-hidden', 'false');
    setTimeout(() => { try { $('link-code-input').focus(); } catch (e) {} }, 120);
  }

  let scanStream = null;
  let scanTimer = null;

  function stopScan() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (scanStream) {
      try { scanStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      scanStream = null;
    }
    const v = $('link-video');
    if (v) { v.classList.add('hidden'); try { v.srcObject = null; } catch (e) {} }
  }

  async function startScan() {
    const v = $('link-video');
    if (!v) return;
    if (!('BarcodeDetector' in window)) {
      toast('متصفحك ما يدعم المسح — اكتب الأرقام الظاهرة على الجهاز', 'error');
      return;
    }
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      v.srcObject = scanStream;
      v.classList.remove('hidden');
      await v.play().catch(() => {});
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      scanTimer = setInterval(async () => {
        try {
          const codes = await detector.detect(v);
          if (!codes || !codes.length) return;
          const raw = codes[0].rawValue || '';
          const m = raw.match(/code=(\d{6})/) || raw.match(/(\d{6})/);
          if (!m) return;
          $('link-code-input').value = m[1];
          stopScan();
          toast('انقر «نعم، اربط الجهاز» للتأكيد', 'success');
        } catch (e) { /* audit-ignore: probe only */ }
      }, 700);
    } catch (e) {
      toast('تعذر فتح الكاميرا — اكتب الأرقام', 'error');
      stopScan();
    }
  }

  async function approveLinkCode() {
    const C = cloud();
    const acc = (C && C.account) ? C.account() : null;
    if (!acc) { openLoginModal(); return; }
    const code = ($('link-code-input').value || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6 && code.length !== 4) { toast('اكتب الرمز المكوّن من 6 أرقام', 'error'); return; }
    try {
      const sb = await sbRaw();
      const r = await sb.rpc('link_approve', { p_code: code, p_user: acc.id });
      const okRow = Array.isArray(r.data) ? r.data[0] : r.data;
      if (r.error || okRow === false) { toast('الرمز غير صحيح أو انتهت مهلته', 'error'); return; }
      closeLinkModal();
      toast('تم ربط الجهاز الآخر ✓', 'success');
    } catch (e) { toast('تعذر الربط', 'error'); }
  }

  function closeLinkModal() {
    stopLinkPoll();
    stopScan();
    $('link-modal').classList.add('hidden');
    $('link-modal').setAttribute('aria-hidden', 'true');
  }

  async function sbRaw() {
    const C = cloud();
    // cloud.js keeps its own client; reuse it through a tiny bridge
    return C.sb();
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
      if (r && r.action === 'needs-pin') toast('بياناتك محمية — أدخل رمز الدخول على هذا الجهاز لتفعيل المزامنة', 'info');
      else if (r && r.action === 'downloaded') toast('تمت المزامنة من حساب تليجرام ✓');
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
      // two layers: the picture on top, the silhouette underneath, so a file that
      // no longer exists still shows a proper avatar instead of an empty circle
      return '<span class="' + cls + ' avatar-default" style="background-image:url(&quot;' + String(photo).replace(/"/g, '%22') +
        '&quot;),url(&quot;assets/avatar-default.svg&quot;);background-size:cover;background-position:center"></span>';
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
        (!S.leagueSubject ? '<span class="league-row-acc">' + (accuracyOf(r) !== null ? accuracyOf(r) + '%' : '—') + '</span>' : '');
      wirePlayerCard(row, r);
      box.appendChild(row);
    });
    updateLeagueMe(me, rows);
    icons();
  }

  // a league row is a person: opening it shows what they are good at this week
  function openPlayerCard(r) {
    const card = $('player-card');
    if (!card || !r) return;
    const acc = accuracyOf(r);
    const subs = Object.keys(r.per_subject || {})
      .map((id) => {
        const v = r.per_subject[id] || {};
        return { id, title: v.title || id, n: Number(v.n) || 0, xp: Number(v.xp) || 0 };
      })
      .filter((s) => s.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    const stat = (label, value) =>
      '<div class="player-stat"><span class="player-stat-value">' + escapeHtml(String(value)) +
      '</span><span class="player-stat-label">' + escapeHtml(label) + '</span></div>';
    card.innerHTML =
      '<div class="player-head">' +
        avatarHtml(r.avatar, r.name, 'player-avatar') +
        '<div class="player-head-text">' +
          '<h3 dir="auto">' + escapeHtml(r.name || 'لاعب') + '</h3>' +
          '<p>المركز ' + escapeHtml(String(r.rank || '—')) + ' هذا الأسبوع</p>' +
        '</div>' +
      '</div>' +
      '<div class="player-stats">' +
        stat('إجابة', r.xp) +
        stat('الدقة', acc === null ? '—' : acc + '%') +
        stat('المركز', r.rank || '—') +
      '</div>' +
      (subs.length
        ? '<div class="player-subjects"><span class="player-subjects-title">أكثر المواد</span>' +
          subs.map((s) =>
            '<div class="player-subject"><span dir="auto">' + escapeHtml(s.title) + '</span>' +
            '<b>' + s.n + '</b></div>').join('') +
          '</div>'
        : '') +
      '<p class="player-note">أرقام هذا الأسبوع فقط — بدون معرّف الحساب ولا أي بيانات شخصية.</p>';
    openDrawer('player-drawer');
    icons();
  }

  function wirePlayerCard(el, row) {
    if (!el) return;
    el.classList.add('is-clickable');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'بطاقة ' + (row.name || 'لاعب'));
    el.addEventListener('click', () => openPlayerCard(row));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPlayerCard(row); }
    });
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
      wirePlayerCard(slot, r);
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
        '<div class="league-me-sub">سجّل حسابك (اسم مستخدم + رمز 4 أرقام) وتظهر في الترتيب مع زملائك</div></div>' +
        '<button type="button" class="league-join-btn" data-action="join">' +
        '<i data-lucide="user-plus"></i><span>سجّل حسابك</span></button>';
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
      ctx.fillStyle = '#d9b26a';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = '#14161c';
      ctx.font = '700 ' + Math.round(r * 0.9) + 'px "MCSQuiz Arabic", sans-serif';
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
    const ACCENT = '#d9b26a', GOLD = '#d9b26a';
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
    const H = Math.max(520, Math.min(1350, header + Math.max(1, shown.length) * rowH + mineH + footerH + 30));

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
    glow.addColorStop(0, 'rgba(217,178,106,0.14)');
    glow.addColorStop(1, 'rgba(77,163,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 660);

    // brand row
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = '700 34px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('MCSQuiz', R, 96);
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.font = '500 26px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(data.week, L, 96);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(L, 132, W - L * 2, 2);

    // title
    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = '700 58px "MCSQuiz Arabic", sans-serif';
    ctx.fillText('ترتيب هذا الأسبوع', R, 226);
    ctx.fillStyle = MUTED;
    ctx.font = '500 28px "MCSQuiz Arabic", sans-serif';
    ctx.fillText(data.scope, R, 268);

    // column labels — makes it a table, not a list of guesses
    ctx.font = '600 26px "MCSQuiz Arabic", sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'right';
    ctx.fillText('اللاعب', R - 162, 306);
    ctx.textAlign = 'left';
    ctx.fillText('إجابات صحيحة', L, 306);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(L, 318, W - L * 2, 2);

    const medals = ['#d9b26a', '#c3ccda', '#c08a5c'];

    const drawRow = (r, y, opts) => {
      const h = opts.h;
      const isMe = !!mine && r.user_id === mine.user_id;
      const first = r.rank === 1;
      const avR = opts.av;
      const cy = y + h / 2;

      if (isMe) {
        ctx.fillStyle = 'rgba(217,178,106,0.14)';
        drawRoundRect(ctx, L - 14, y + 8, W - (L - 14) * 2, h - 16, 16);
        ctx.fill();
        ctx.strokeStyle = 'rgba(217,178,106,0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // rank at the right edge
      ctx.textAlign = 'right';
      ctx.fillStyle = medals[r.rank - 1] || MUTED;
      ctx.font = '700 40px "MCSQuiz Arabic", sans-serif';
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
      ctx.font = '600 32px "MCSQuiz Arabic", sans-serif';
      const nameX = R - 92 - avR - 26;
      ctx.fillText(r.name || 'لاعب', nameX, cy + 10);

      // the number on the left, where a table puts its values
      ctx.textAlign = 'left';
      ctx.fillStyle = first ? GOLD : INK;
      ctx.font = '700 38px "MCSQuiz Arabic", sans-serif';
      ctx.fillText(String(r.xp), L, cy + 16);
      const nw = ctx.measureText(String(r.xp)).width;
      ctx.fillStyle = MUTED;
      ctx.font = '500 22px "MCSQuiz Arabic", sans-serif';
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
      '&text=' + encodeURIComponent('دوري MCSQuiz — ترتيبي هذا الأسبوع');
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
      a.download = 'mcsquiz-league.png';
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
    if (!navigator.onLine) { toast('تحتاج إنترنت لإنشاء بطاقة الدوري', 'error'); return; }
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
        try { me = await L.myRow(); } catch (e) { dbg('myLeagueRow failed:', (e && e.message) || e); }
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
      const file = new File([blob], 'mcsquiz-league.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'دوري MCSQuiz' });
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

  // a phone sheet should also close by pulling it down, not only by the ✕
  function swipeToClose(overlayId, close) {
    const ov = $(overlayId);
    if (!ov) return;
    const card = ov.querySelector('.modal-card');
    if (!card) return;
    let startY = 0;
    let dy = 0;
    let tracking = false;
    const reset = (animate) => {
      card.style.transition = animate ? 'transform .18s ease, opacity .18s ease' : 'none';
      card.style.transform = '';
      card.style.opacity = '';
      ov.style.opacity = '';
    };
    ov.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1 || card.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      dy = 0;
      tracking = true;
      card.style.transition = 'none';
    }, { passive: true });
    ov.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      dy = e.touches[0].clientY - startY;
      if (dy <= 0) { reset(false); return; }
      if (dy > 8 && e.cancelable) e.preventDefault();
      card.style.transform = 'translateY(' + dy + 'px)';
      ov.style.opacity = String(Math.max(0.35, 1 - dy / 380));
    }, { passive: false });
    ov.addEventListener('touchend', () => {
      if (!tracking) return;
      tracking = false;
      if (dy > 90) {
        reset(true);
        close();
      } else {
        reset(true);
      }
      dy = 0;
    }, { passive: true });
    ov.addEventListener('touchcancel', () => { tracking = false; dy = 0; reset(true); }, { passive: true });
  }

  function closeLoginSheet() {
    closeLoginModal();
    closeDrawers();
  }

  // ---------------- wire up ----------------
  function bind() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (!$('leave-modal').classList.contains('hidden')) { hideLeaveModal(); return; }
        if (!$('tour-overlay').classList.contains('hidden')) return; // tour has its own skip
        if (closeOpenModals()) return;
        closeDrawers();
        return;
      }
    });
    window.addEventListener('hashchange', onHashChange);
    // a refresh, a swipe-down on the page or the system killing the tab: keep
    // the running quiz on disk so the next boot can put the student back in it
    window.addEventListener('pagehide', saveSessionSnapshot);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        saveSessionSnapshot();
      } else if (document.visibilityState === 'visible') {
        try {
          const C = cloud();
          if (navigator.onLine && C && C.linked && C.linked()) {
            if (C.needsSync && C.needsSync()) C.scheduleAutoSync('visibility', { delayMs: 800, retries: 2 });
          }
        } catch (e) {}
      }
    });
    window.addEventListener('focus', () => {
      try {
        const C = cloud();
        if (navigator.onLine && C && C.linked && C.linked()) {
          if (C.needsSync && C.needsSync()) C.scheduleAutoSync('focus', { delayMs: 1000, retries: 2 });
        }
      } catch (e) {}
    });
    // No native beforeunload dialog: the browser renders it in its own language
    // and cannot be styled. Leaving the app is guarded by the Arabic modal above,
    // and Telegram's own close confirmation when the mini app is closed.
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
      // leaving an unfinished quiz: stop its clock, or it keeps ticking in the
      // background for the rest of the session (a real zombie timer)
      try {
        if (S.session && S.session.timerId) { clearInterval(S.session.timerId); S.session.timerId = null; }
        if (S.session) S.session.pauseStart = null;
      } catch (e) {}
      const target = navPending || '';
      S.session = null;
      clearSessionSnapshot();
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
    // ---- handle accounts: login, account sheet, device linking ----
    const bindClick = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bindClick('login-submit', submitLogin);
    bindClick('login-close', () => { closeLoginModal(); closeDrawers(); });
    bindClick('login-skip', () => { closeLoginModal(); toast('تستخدم الآن بدون حساب'); });
    bindClick('login-link-device', () => { closeLoginModal(); generateLinkCode(); });
    bindClick('login-mode', () => { setLoginMode(loginMode === 'create' ? 'login' : 'create'); });
    swipeToClose('login-modal', closeLoginSheet);
    swipeToClose('link-modal', closeLinkModal);
    bindClick('account-link', () => { openLinkApprove(); });
    bindClick('player-close', () => { closeDrawers(); });
    // the league card offers the way in instead of naming a bot that no longer exists
    const leagueMe = $('league-me');
    if (leagueMe) {
      leagueMe.addEventListener('click', (e) => {
        const join = e.target && e.target.closest ? e.target.closest('[data-action="join"]') : null;
        if (!join) return;
        openLoginModal();
      });
    }
    bindClick('account-logout', async () => {
      // leaving an account is not a one-tap action on a shared device
      const C = cloud();
      const linkable = C && C.account && C.account();
      if (!confirm('تسجيل الخروج؟\n\n• المزامنة تتوقف على هذا الجهاز\n• محفوظاتك وسجلك تنمسح من هذا الجهاز — وتبقى بحسابك\n• رمزك ينمسح، فتحتاجه لتسجيل الدخول مرة ثانية')) return;
      if (linkable && C.pinOnDevice && C.pinOnDevice()) {
        if (navigator.onLine) {
          // last chance to keep what this device added while it was offline
          try { await C.pullOrPush(); } catch (e) { dbg('logout sync failed:', (e && e.message) || e); }
        } else if (!confirm('ماكو إنترنت — أي شي أضفته وما انزام راح ينمسح. تكمل؟')) {
          return;
        }
      }
      stopLinkPoll();
      if (C && C.signOut) C.signOut();
      if (C && C.clearPersonal) C.clearPersonal();
      try { loadSaved(); } catch (e) {}
      S.leagueRows = null; S.leagueMe = null; S.leagueStamp = 0;
      updateAccountRow();
      updateSavedBadge(); updateMenuCounts();
      goHash('#/');
      renderCatalog();
      toast('تم تسجيل الخروج — بياناتك محفوظة بحسابك', 'success');
    });
    bindClick('account-delete', async () => {
      const C = cloud();
      if (!C || !C.deleteAccount) return;
      if (!confirm('سيُحذف حسابك نهائياً: بياناتك المحفوظة، سجلك، ومكانك في الدوري. تكمل؟')) return;
      const pin = prompt('أدخل رمز الدخول (4 أرقام) لتأكيد الحذف:');
      if (!pin) return;
      try {
        await C.deleteAccount(pin);
        updateAccountRow();
        goHash('#/');
        toast('تم حذف الحساب — نراك', 'success');
      } catch (e) {
        const msg = String((e && e.message) || '');
        if (msg.indexOf('too_many_attempts') >= 0) toast('محاولات كثيرة — حاول بعد قليل', 'error');
        else if (msg.indexOf('bad_pin') >= 0) toast('الرمز غير صحيح', 'error');
        else toast('تعذر الحذف — تحقق من الاتصال', 'error');
      }
    });
    bindClick('account-unlock', async () => {
      const C = cloud();
      const acc = C && C.account ? C.account() : null;
      if (!acc) return;
      const pin = prompt('أدخل رمز الدخول (4 أرقام) لتفعيل المزامنة على هذا الجهاز:');
      if (!pin) return;
      try {
        await C.login(acc.handle, pin, acc.name);
        const r = await C.pullOrPush();
        try { loadSaved(); } catch (e) {}
        if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
        if (location.hash === '#/saved' || location.hash === '#/saved/') renderSaved();
        updateSavedBadge(); updateMenuCounts();
        renderAccount();
        toast(r && r.action === 'needs-pin' ? 'ما زال الرمز غير صحيح' : 'تم تفعيل المزامنة على هذا الجهاز', 'success');
      } catch (e) {
        const msg = String((e && e.message) || '');
        if (msg.indexOf('too_many_attempts') >= 0) toast('محاولات كثيرة — حاول بعد قليل', 'error');
        else if (msg.indexOf('bad_pin') >= 0) toast('الرمز غير صحيح', 'error');
        else toast('تعذر التفعيل — تحقق من الاتصال', 'error');
      }
    });
    bindClick('account-sync-now', async () => {
      if (!navigator.onLine) {
        toast('لا يوجد اتصال — المزامنة تتم تلقائياً عند رجوع النت', 'info');
        return;
      }
      const C = cloud();
      try {
        const r = await C.pullOrPush();
        try { loadSaved(); } catch (e) {}
        if (location.hash === '#/stats' || location.hash === '#/stats/') renderStats();
        if (location.hash === '#/saved' || location.hash === '#/saved/') renderSaved();
        updateSavedBadge(); updateMenuCounts();
        if (r && r.action === 'needs-pin') toast('بياناتك محمية — أدخل رمز الدخول على هذا الجهاز لتفعيل المزامنة', 'info');
        else toast('تمت المزامنة', 'success');
      } catch (e) { toast('تعذر المزامنة', 'error'); }
    });
    bindClick('link-scan', startScan);
    bindClick('profile-save', saveProfile);
    bindClick('avatar-more', () => {
      const grid = $('avatar-grid');
      const btn = $('avatar-more');
      const collapsed = grid.classList.toggle('collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if ($('avatar-more-label')) $('avatar-more-label').textContent = collapsed ? 'إظهار المزيد' : 'إخفاء';
      const mi = $('avatar-more-icon');
      if (mi) mi.setAttribute('data-lucide', collapsed ? 'chevron-down' : 'chevron-up');
      icons();
    });
    bindClick('pin-change', changePin);
    bindClick('account-close', () => {
      // back to wherever the account was opened from (the catalogue by default)
      goHash(S.accountReturn || '#/');
    });
    bindClick('link-yes', approveLinkCode);
    bindClick('link-no', closeLinkModal);
    bindClick('link-close', closeLinkModal);
    const loginHandle = $('login-handle');
    if (loginHandle) loginHandle.addEventListener('input', () => {
      loginHandle.value = String(loginHandle.value || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    });
    const loginName = $('login-name');
    if (loginName) loginName.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-handle').focus(); });
    if (loginHandle) loginHandle.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLogin(); });
    const liveExplToggle = $('live-expl-toggle');
    if (liveExplToggle) liveExplToggle.addEventListener('click', () => {
      const box = $('live-feedback-box');
      const body = $('live-explanation-text');
      setExplOpen(box, liveExplToggle, body, box.classList.contains('collapsed'));
    });
    const offlineBtn = $('menu-offline');
    if (offlineBtn) offlineBtn.addEventListener('click', prepareOffline);
    const menuAccount = $('menu-account');
    if (menuAccount) menuAccount.addEventListener('click', () => { handleAccountTap(); });
    window.addEventListener('online', () => {
      updateOfflineBanner(false);
      updateAccountRow();
      toast('عادت إشارة الإنترنت', 'success');
      try {
        const C = cloud();
        if (C && C.scheduleAutoSync) C.scheduleAutoSync('online', { delayMs: 1500, retries: 3 });
        else if (C && C.pushSoon) C.pushSoon();
      } catch (e) {}
    });
    window.addEventListener('offline', () => {
      updateOfflineBanner(true);
      updateAccountRow();
    });
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
        if (L && L.linked && L.linked() && L.syncWeek) L.syncWeek().catch((e) => dbg('league sync failed:', (e && e.message) || e));
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

    document.querySelectorAll('.lang-opt').forEach((b) => {
      b.addEventListener('click', () => setLang(b.dataset.lang));
    });
    ['lang-toggle-catalog', 'lang-toggle-session'].forEach((id) => {
      const b = $(id);
      if (b) b.addEventListener('click', toggleLang);
    });
    syncLangButtons();
    ['btn-bell', 'btn-bell-session'].forEach((id) => {
      const b = $(id);
      if (!b) return;
      b.addEventListener('click', () => {
        renderNotifList();
        closeDrawers();
        const m = $('notif-modal');
        if (m) { m.classList.remove('hidden'); m.setAttribute('aria-hidden', 'false'); }
        icons();
      });
    });
    const notifList = $('notif-list');
    if (notifList) {
      notifList.addEventListener('click', (e) => {
        const row = e.target && e.target.closest ? e.target.closest('.notif-row') : null;
        if (!row) return;
        markNotifRead(row.getAttribute('data-quiz'));
      });
    }
    bindClick('notif-read-all', markAllNotifsRead);
    document.querySelectorAll('.modal-overlay').forEach((ov) => {
      ov.addEventListener('click', (e) => {
        if (e.target === ov && ov.id !== 'leave-modal' && ov.id !== 'tour-overlay') {
          ov.classList.add('hidden');
          ov.setAttribute('aria-hidden', 'true');
        }
      });
    });
    bindClick('notif-close', () => {
      const m = $('notif-modal');
      if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true'); }
    });
    // pwa.js is loaded after app.js, so its handler stores the prompt after
    // this one runs: read the state on the next tick, not right now
    window.addEventListener('beforeinstallprompt', () => { setTimeout(refreshInstallRow, 0); });
    window.addEventListener('appinstalled', () => {
      try { lsSet('portal_installed_v1', '1'); } catch (e) {}
      setTimeout(refreshInstallRow, 0);
    });
    document.querySelectorAll('.range-opt').forEach((b) => {
      b.addEventListener('click', () => {
        S.statsRange = Number(b.dataset.range);
        saveUI();
        renderStats();
      });
    });

    const toggleTheme = () => {
      const root = document.documentElement;
      const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('portal_theme', next); } catch (e) {}
      syncMenuToggles();
    };
    const themeHeaderBtn = $('btn-theme-header');
    if (themeHeaderBtn) themeHeaderBtn.addEventListener('click', toggleTheme);
    const themeSessionBtn = $('btn-theme-header-session');
    if (themeSessionBtn) themeSessionBtn.addEventListener('click', toggleTheme);

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
      if (!ses) return;
      if (ses.replay && ses.replay.type === 'saved') {
        const items = (ses.replay.keys || []).map((k) => {
          const it = S.saved[k];
          return it ? { key: k, origin: it.origin || {}, snapshot: it.snapshot || it } : null;
        }).filter(Boolean);
        if (items.length) { startSavedPractice(items); beginAnswering(); return; }
      }
      startSession(ses.sub.subject_id, ses.ch.quiz_id, null);
      beginAnswering();
    });
    $('btn-retry-wrong').addEventListener('click', () => {
      const ses = S.session;
      if (!ses) return;
      const from = { questions: ses.questions, picks: ses.picks };
      if (ses.replay && ses.replay.type === 'saved') {
        const subset = window.PortalAnalytics.buildWrongOnly(from.questions, from.picks);
        if (!subset || !subset.length) { toast('لا توجد أخطاء لإعادتها — أحسنت!'); return; }
        const meta = { subjectId: ses.sub.subject_id, subjectTitle: ses.sub.subject_title, chapterNo: ses.ch.chapter_no, chapterLabel: ses.chapterLabel, topic: ses.title, quizId: null, retryWrong: true, replay: ses.replay };
        launchSession(subset, meta);
        beginAnswering();
        return;
      }
      startSession(ses.sub.subject_id, ses.ch.quiz_id, from);
      if (S.session && S.session.started === false) beginAnswering();
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
  const SHELL_VERSION = '1.7.16';
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
    } catch (e) { /* audit-ignore: probe only */ }
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

  function updateOfflineBanner(forceState) {
    const banner = $('offline-banner');
    if (!banner) return;
    const isOff = typeof forceState === 'boolean' ? forceState : (navigator.onLine === false);
    banner.classList.toggle('hidden', !isOff);
  }

  async function boot() {
    updateOfflineBanner();
    await guardShell();
    try { if (window.PortalLog) { window.PortalLog.restore(); window.PortalLog.info('boot', 'start href=' + location.href.slice(0, 80)); } } catch (e) {}
    try {
      const savedTheme = localStorage.getItem('portal_theme');
      if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
    } catch (e) {}
    // the sound setting is a preference, not a per-visit flag: it lives in the
    // burger menu now, so losing it on reload would be invisible and annoying
    try {
      const savedSound = localStorage.getItem('portal_sound');
      if (savedSound !== null) S.sound = savedSound === '1';
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
      // audit-ignore: debug only (?debug=1)
      if (DEBUG) { window.__portal = { S: S }; }
      {
        const badge = $('test-mode-badge');
        if (badge) {
          if (S.index && S.index.test_mode === true) badge.classList.remove('hidden');
          else badge.classList.add('hidden');
        }
      }
      // a QR / shared link opens the approval sheet with the code in the hash
      try {
        if (/^#\/link/.test(location.hash)) {
          setTimeout(() => {
            const C = cloud();
            if (C && C.account && C.account()) openLinkApprove();
            else openLoginModal();
          }, 900);
        }
      } catch (e) {}
      if (window.PortalLog) window.PortalLog.info('boot', 'ok subjects=' + (S.index ? S.index.subjects.length : 0) + ' test_mode=' + (S.index ? S.index.test_mode : '?'));
      logOfflineState();
      // Show the tour exactly once per device: mark it seen the moment it opens,
      // so a reload mid-tour never brings it back (it is replayable from the menu).
      try {
        const resume = sessionStorage.getItem('portal_tour_resume');
        if (resume !== null) {
          sessionStorage.removeItem('portal_tour_resume');
          tourSet(TOUR_KEY);
          setTimeout(() => tourShow(Number(resume) || 0), 600);
        } else if (!tourGet(TOUR_KEY)) {
          setTimeout(() => { if (tourIdx < 0) { tourSet(TOUR_KEY); tourShow(0); } }, 1200);
        }
      } catch (e) {}
      // silent background auto-sync on boot (pushes pending offline data or pulls remote updates)
      try {
        const C = cloud();
        if (navigator.onLine && C && C.linked && C.linked()) {
          C.scheduleAutoSync('boot', { delayMs: 2000, retries: 2 });
        }
      } catch (e) {}
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
            // If in the middle of a live exam, don't brutally reload in the user's face!
            if (S.session && S.session.started && !S.session.finished) {
              saveSessionSnapshot();
              S.pendingReload = true;
              toast('تحديث جديد متوفر — سيتفعّل عند انتهاء الاختبار', 'info');
              return;
            }
            // a first visit can be reloaded by the worker right as the tour
            // opens: remember it so it resumes instead of disappearing
            if (tourIdx >= 0) sessionStorage.setItem('portal_tour_resume', String(tourIdx));
            location.reload();
          }
        } catch (e) {}
      }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
