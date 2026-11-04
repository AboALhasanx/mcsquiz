/* MCQ Portal — review_ui.js
 * Review Hub UI: Spaced Repetition Decks, Weakness Trainer, and Custom Quiz Builder.
 * Mobile-first, fully accessible, RTL, zero AI-slop copy.
 */
(function (global) {
  'use strict';

  var selectedSource = 'due';
  var selectedCount = 10;

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function shuffle(array) {
    var arr = array.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
    }
    return arr;
  }

  function resolveQuestionByKey(key, banks, index) {
    if (!key || typeof key !== 'string') return null;
    var parts = key.split('|');
    if (parts.length < 3) return null;
    var subId = parts[0];
    var quizId = parts[1];
    var qid = parts[2];

    var bank = banks && banks[quizId];
    if (!bank || !Array.isArray(bank.questions)) return null;

    var q = null;
    for (var i = 0; i < bank.questions.length; i++) {
      if (bank.questions[i].id === qid) {
        q = bank.questions[i];
        break;
      }
    }
    if (!q) return null;

    var sub = (index && index.subjects) ? index.subjects.find(function (s) { return s.subject_id === subId; }) : null;
    var ch = sub && sub.chapters ? sub.chapters.find(function (c) { return c.quiz_id === quizId; }) : null;

    var qCopy = JSON.parse(JSON.stringify(q));
    qCopy.origin = {
      subjectId: subId,
      subjectTitle: (sub && sub.subject_title) || subId,
      chapterNo: ch ? ch.chapter_no : 1,
      chapterLabel: ch ? (ch.topicLabel || ch.label || ('جابتر ' + ch.chapter_no)) : '',
      quizId: quizId,
      topic: bank.topic || ''
    };

    return qCopy;
  }

  function updateBadge() {
    var badge = el('menu-review-count');
    if (!badge) return;
    if (!global.PortalReview) {
      badge.classList.add('hidden');
      return;
    }
    var store = global.PortalReview.loadStore();
    var dueKeys = global.PortalReview.getDueKeys(store);
    var count = dueKeys.length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
  }

  function render(index, banks, saved, startSessionFn) {
    if (!global.PortalReview) return;
    var R = global.PortalReview;
    var store = R.loadStore();
    var stats = R.getStats(store);

    // 1. Stats Grid
    var statDue = el('review-stat-due');
    var statWeak = el('review-stat-weak');
    var statTotal = el('review-stat-total');
    var statMastered = el('review-stat-mastered');

    if (statDue) statDue.textContent = String(stats.due);
    if (statWeak) statWeak.textContent = String(stats.weak);
    if (statTotal) statTotal.textContent = String(stats.total);
    if (statMastered) statMastered.textContent = String(stats.boxes[5] || 0);

    // 2. Decks Info
    var duePill = el('deck-due-pill');
    var btnDue = el('btn-start-due-review');
    if (duePill) duePill.textContent = stats.due + ' سؤال';
    if (btnDue) {
      btnDue.disabled = (stats.due === 0);
      btnDue.classList.toggle('disabled', stats.due === 0);
    }

    var weakPill = el('deck-weak-pill');
    var btnWeak = el('btn-start-weak-review');
    if (weakPill) weakPill.textContent = stats.weak + ' سؤال';
    if (btnWeak) {
      btnWeak.disabled = (stats.weak === 0);
      btnWeak.classList.toggle('disabled', stats.weak === 0);
    }

    // 3. Subject Select options in Custom Builder
    var subSelect = el('builder-subject-select');
    if (subSelect && index && Array.isArray(index.subjects)) {
      subSelect.innerHTML = index.subjects.map(function (s) {
        return '<option value="' + escapeHtml(s.subject_id) + '">' + escapeHtml(s.subject_title) + '</option>';
      }).join('');
    }

    updateBadge();

    // 4. Wire events once
    wireEvents(index, banks, saved, startSessionFn);

    if (global.lucide && global.lucide.createIcons) {
      global.lucide.createIcons();
    }
  }

  var eventsWired = false;
  function wireEvents(index, banks, saved, startSessionFn) {
    if (eventsWired) return;
    eventsWired = true;

    // Start Due Review Deck
    var btnDue = el('btn-start-due-review');
    if (btnDue) {
      btnDue.addEventListener('click', function () {
        if (!global.PortalReview || !startSessionFn) return;
        var dueKeys = global.PortalReview.getDueKeys();
        var questions = [];
        for (var i = 0; i < dueKeys.length; i++) {
          var q = resolveQuestionByKey(dueKeys[i], banks, index);
          if (q) questions.push(q);
          if (questions.length >= 40) break;
        }
        if (!questions.length) {
          if (global.PortalApp && global.PortalApp.toast) {
            global.PortalApp.toast('لا توجد أسئلة مستحقة للمراجعة اليوم');
          }
          return;
        }
        startSessionFn(shuffle(questions), 'مراجعة الأسئلة المستحقة', 'review');
      });
    }

    // Start Weakness Trainer Deck
    var btnWeak = el('btn-start-weak-review');
    if (btnWeak) {
      btnWeak.addEventListener('click', function () {
        if (!global.PortalReview || !startSessionFn) return;
        var weakKeys = global.PortalReview.getWeakKeys();
        var questions = [];
        for (var i = 0; i < weakKeys.length; i++) {
          var q = resolveQuestionByKey(weakKeys[i], banks, index);
          if (q) questions.push(q);
          if (questions.length >= 20) break;
        }
        if (!questions.length) {
          if (global.PortalApp && global.PortalApp.toast) {
            global.PortalApp.toast('لا توجد أخطاء مسجلة بعد — سجل الأخطاء فارغ');
          }
          return;
        }
        startSessionFn(questions, 'تدريب نقاط الضعف', 'custom');
      });
    }

    // Source chips
    var sourceChips = el('builder-source-chips');
    if (sourceChips) {
      sourceChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.builder-chip');
        if (!btn || !btn.dataset.source) return;
        sourceChips.querySelectorAll('.builder-chip').forEach(function (c) {
          c.classList.remove('active');
          c.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        selectedSource = btn.dataset.source;

        var subGroup = el('builder-subject-picker-group');
        if (subGroup) {
          subGroup.classList.toggle('hidden', selectedSource !== 'subject');
        }
      });
    }

    // Count chips
    var countChips = el('builder-count-chips');
    if (countChips) {
      countChips.addEventListener('click', function (e) {
        var btn = e.target.closest('.builder-chip');
        if (!btn || !btn.dataset.count) return;
        countChips.querySelectorAll('.builder-chip').forEach(function (c) {
          c.classList.remove('active');
          c.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-checked', 'true');
        selectedCount = Number(btn.dataset.count) || 10;
      });
    }

    // Start Custom Quiz
    var btnCustom = el('btn-start-custom-quiz');
    if (btnCustom) {
      btnCustom.addEventListener('click', function () {
        if (!startSessionFn) return;
        var pool = [];
        var title = 'كوز مخصص';

        if (selectedSource === 'due') {
          title = 'كوز مخصص · الأسئلة المستحقة';
          var dueKeys = global.PortalReview.getDueKeys();
          for (var i = 0; i < dueKeys.length; i++) {
            var q = resolveQuestionByKey(dueKeys[i], banks, index);
            if (q) pool.push(q);
          }
        } else if (selectedSource === 'weak') {
          title = 'كوز مخصص · نقاط الضعف';
          var weakKeys = global.PortalReview.getWeakKeys();
          for (var j = 0; j < weakKeys.length; j++) {
            var qw = resolveQuestionByKey(weakKeys[j], banks, index);
            if (qw) pool.push(qw);
          }
        } else if (selectedSource === 'saved') {
          title = 'كوز مخصص · الأسئلة المحفوظة';
          var savedObj = saved || {};
          Object.keys(savedObj).forEach(function (k) {
            var it = savedObj[k];
            if (it && it.snapshot) {
              pool.push(JSON.parse(JSON.stringify(it.snapshot)));
            }
          });
        } else if (selectedSource === 'subject') {
          var subSelect = el('builder-subject-select');
          var subId = subSelect ? subSelect.value : '';
          var sub = (index && index.subjects) ? index.subjects.find(function (s) { return s.subject_id === subId; }) : null;
          title = 'كوز مخصص · ' + ((sub && sub.subject_title) || 'مادة مختارة');
          if (sub && sub.chapters) {
            sub.chapters.forEach(function (ch) {
              var b = banks && banks[ch.quiz_id];
              if (b && Array.isArray(b.questions)) {
                b.questions.forEach(function (qRaw) {
                  var qWithOrigin = JSON.parse(JSON.stringify(qRaw));
                  qWithOrigin.origin = {
                    subjectId: sub.subject_id,
                    subjectTitle: sub.subject_title,
                    chapterNo: ch.chapter_no,
                    chapterLabel: ch.topicLabel || ch.label || ('جابتر ' + ch.chapter_no),
                    quizId: ch.quiz_id,
                    topic: b.topic || ''
                  };
                  pool.push(qWithOrigin);
                });
              }
            });
          }
        }

        if (!pool.length) {
          if (global.PortalApp && global.PortalApp.toast) {
            global.PortalApp.toast('لا توجد أسئلة متاحة في هذا الخيار');
          }
          return;
        }

        var finalQuestions = shuffle(pool).slice(0, selectedCount);
        startSessionFn(finalQuestions, title, 'custom');
      });
    }
  }

  global.PortalReviewUI = {
    render: render,
    updateBadge: updateBadge,
    resolveQuestionByKey: resolveQuestionByKey
  };

})(typeof window !== 'undefined' ? window : this);
