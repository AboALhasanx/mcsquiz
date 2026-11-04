/* MCQ Portal — search_ui.js
 * Comprehensive Search View UI Controller.
 * Debounced search, subject filtering, term highlighting, expandable question previews,
 * and seamless custom quiz launcher. Mobile-first, fully accessible RTL.
 */
(function (global) {
  'use strict';

  var activeSubject = null;
  var currentResults = [];
  var debounceTimer = null;
  var eventsWired = false;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function highlightMatches(text, queryTokens) {
    if (!text || !queryTokens || !queryTokens.length) return escapeHtml(text);
    var esc = escapeHtml(text);
    queryTokens.forEach(function (token) {
      if (!token || token.length < 2) return;
      var clean = token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      try {
        var re = new RegExp('(' + clean + ')', 'gi');
        esc = esc.replace(re, '<mark class="search-mark">$1</mark>');
      } catch (e) {}
    });
    return esc;
  }

  function render(index, banks, startPracticeFn) {
    if (!global.PortalSearch) return;
    var PS = global.PortalSearch;

    // 1. Build search index if not yet ready
    if (!PS.isReady() && index && banks) {
      PS.buildIndex(index, banks);
    }

    // 2. Render Subject Filter Rail
    renderSubjectBar(index);

    // 3. Wire UI events
    wireEvents(index, banks, startPracticeFn);

    // 4. If search input already has query, re-run
    var input = el('search-query-input');
    if (input && input.value.trim()) {
      runSearch(input.value.trim(), startPracticeFn);
    } else {
      showInitialState();
    }

    if (global.lucide && global.lucide.createIcons) {
      global.lucide.createIcons();
    }
  }

  function renderSubjectBar(index) {
    var bar = el('search-subject-bar');
    if (!bar) return;
    if (!index || !Array.isArray(index.subjects)) {
      bar.innerHTML = '';
      return;
    }

    var html = '<button type="button" class="filter-chip' + (activeSubject === null ? ' active' : '') +
               '" data-sub="all" role="radio" aria-checked="' + (activeSubject === null ? 'true' : 'false') + '">جميع المواد</button>';

    index.subjects.forEach(function (sub) {
      var isAct = (activeSubject === sub.subject_id);
      html += '<button type="button" class="filter-chip' + (isAct ? ' active' : '') +
              '" data-sub="' + escapeHtml(sub.subject_id) + '" role="radio" aria-checked="' + (isAct ? 'true' : 'false') + '">' +
              escapeHtml(sub.subject_title || sub.subject_id) + '</button>';
    });

    bar.innerHTML = html;
  }

  function showInitialState() {
    var list = el('search-results-list');
    if (list) list.innerHTML = '';
    var emptyEl = el('search-empty-state');
    if (emptyEl) emptyEl.classList.add('hidden');
    var initEl = el('search-initial-state');
    if (initEl) initEl.classList.remove('hidden');

    var countLabel = el('search-count-label');
    if (countLabel) countLabel.textContent = '0 نتيجة';

    var btnPractice = el('btn-start-search-practice');
    if (btnPractice) {
      btnPractice.disabled = true;
      btnPractice.classList.add('disabled');
    }
  }

  function runSearch(queryText, startPracticeFn) {
    if (!global.PortalSearch) return;
    var PS = global.PortalSearch;
    var q = (queryText || '').trim();

    var clearBtn = el('search-clear-btn');
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', q.length === 0);
    }

    if (!q) {
      currentResults = [];
      showInitialState();
      return;
    }

    var initEl = el('search-initial-state');
    if (initEl) initEl.classList.add('hidden');

    var opts = {};
    if (activeSubject) opts.subjectId = activeSubject;

    var results = PS.query(q, opts);
    currentResults = results;

    var countLabel = el('search-count-label');
    if (countLabel) {
      countLabel.textContent = results.length + ' سؤالاً مطابقاً';
    }

    var btnPractice = el('btn-start-search-practice');
    if (btnPractice) {
      btnPractice.disabled = (results.length === 0);
      btnPractice.classList.toggle('disabled', results.length === 0);
    }

    var emptyEl = el('search-empty-state');
    var list = el('search-results-list');

    if (!results.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (list) list.innerHTML = '';
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (!list) return;

    var queryTokens = PS.tokenize(q);
    var html = '';

    results.forEach(function (res, idx) {
      var qItem = res.q || {};
      var origin = res.origin || {};
      var stemAr = (qItem.stem && (qItem.stem.ar || qItem.stem.en)) || (typeof qItem.stem === 'string' ? qItem.stem : '');
      var stemEn = (qItem.stem && qItem.stem.en && qItem.stem.ar) ? qItem.stem.en : '';

      var highlightedAr = highlightMatches(stemAr, queryTokens);
      var highlightedEn = stemEn ? highlightMatches(stemEn, queryTokens) : '';

      var optionsHtml = '';
      if (Array.isArray(qItem.options)) {
        optionsHtml = '<div class="search-card-options-list">' +
          qItem.options.map(function (opt, oIdx) {
            var isCorr = (oIdx === qItem.correct);
            var optAr = (opt && (opt.ar || opt.en)) || (typeof opt === 'string' ? opt : '');
            var optHigh = highlightMatches(optAr, queryTokens);
            return '<div class="search-card-opt' + (isCorr ? ' is-correct' : '') + '">' +
              '<span class="search-opt-letter">' + String.fromCharCode(65 + oIdx) + '</span>' +
              '<span class="search-opt-text">' + optHigh + '</span>' +
              '</div>';
          }).join('') +
          '</div>';
      }

      var explText = (qItem.explanation && (qItem.explanation.ar || qItem.explanation.en)) ||
                     (typeof qItem.explanation === 'string' ? qItem.explanation : '');
      var explHtml = explText ? ('<div class="search-card-expl">' +
        '<div class="search-expl-head"><i data-lucide="lightbulb"></i> الشرح</div>' +
        '<div class="search-expl-body">' + highlightMatches(explText, queryTokens) + '</div>' +
        '</div>') : '';

      html += '<div class="search-result-card" data-card-idx="' + idx + '">' +
        '<div class="search-card-head">' +
          '<span class="search-sub-tag">' + escapeHtml(origin.subjectTitle || origin.subjectId) + ' · ' + escapeHtml(origin.chapterLabel || ('جابتر ' + origin.chapterNo)) + '</span>' +
        '</div>' +
        '<div class="search-card-stem" dir="auto">' + highlightedAr + '</div>' +
        (highlightedEn ? ('<div class="search-card-stem-en" dir="ltr">' + highlightedEn + '</div>') : '') +
        '<details class="search-card-details">' +
          '<summary class="search-details-toggle">' +
            '<span>معاينة الخيارات والشرح</span>' +
            '<i data-lucide="chevron-down" class="details-chevron"></i>' +
          '</summary>' +
          '<div class="search-details-body">' +
            optionsHtml +
            explHtml +
          '</div>' +
        '</details>' +
      '</div>';
    });

    list.innerHTML = html;

    if (global.lucide && global.lucide.createIcons) {
      global.lucide.createIcons();
    }
  }

  function wireEvents(index, banks, startPracticeFn) {
    if (eventsWired) return;
    eventsWired = true;

    // Search Input
    var input = el('search-query-input');
    if (input) {
      input.addEventListener('input', function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          runSearch(input.value, startPracticeFn);
        }, 120);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    }

    // Clear Button
    var clearBtn = el('search-clear-btn');
    if (clearBtn && input) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        input.focus();
        runSearch('', startPracticeFn);
      });
    }

    // Subject Filter Bar
    var subBar = el('search-subject-bar');
    if (subBar) {
      subBar.addEventListener('click', function (e) {
        var btn = e.target.closest('.filter-chip');
        if (!btn || !btn.dataset.sub) return;
        var subVal = btn.dataset.sub;
        activeSubject = (subVal === 'all') ? null : subVal;

        subBar.querySelectorAll('.filter-chip').forEach(function (c) {
          c.classList.remove('active');
          c.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');

        if (input) {
          runSearch(input.value, startPracticeFn);
        }
      });
    }

    // Start Practice with Search Results
    var btnPractice = el('btn-start-search-practice');
    if (btnPractice) {
      btnPractice.addEventListener('click', function () {
        if (!currentResults.length || !startPracticeFn) return;
        var inputVal = input ? input.value.trim() : '';
        var title = 'كوز من نتائج البحث' + (inputVal ? (' · ' + inputVal) : '');
        var pool = currentResults.slice(0, 40).map(function (res) {
          var copy = JSON.parse(JSON.stringify(res.q));
          copy.origin = JSON.parse(JSON.stringify(res.origin));
          return copy;
        });
        startPracticeFn(pool, title, 'custom');
      });
    }
  }

  global.PortalSearchUI = {
    render: render,
    runSearch: runSearch
  };

})(typeof window !== 'undefined' ? window : this);
