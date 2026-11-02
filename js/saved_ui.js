/* MCQ Portal — saved_ui.js
 * Saved Questions (Review & Active Recall Deck) UI module.
 */
(function (global) {
  'use strict';

  function createSavedUI(ctx) {
    ctx = ctx || {};
    var $ = ctx.$ || function (id) { return document.getElementById(id); };
    var S = ctx.S || {};
    var SAVED_KEY = ctx.SAVED_KEY || 'portal_saved_v1';
    var escapeHtml = ctx.escapeHtml || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var arCount = ctx.arCount || function (n) { return String(n); };
    var qCount = ctx.qCount || function (n) { return String(n); };
    var savedCount = ctx.savedCount || function (n) { return String(n); };
    var icons = ctx.icons || function () { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); };
    var toast = ctx.toast || function (msg, type) { if (window.toast) window.toast(msg, type); };
    var saveUI = ctx.saveUI || function () {};
    var persistSaved = ctx.persistSaved || function () {};
    var markSavedRemoved = ctx.markSavedRemoved || function () {};
    var clearSavedRemoved = ctx.clearSavedRemoved || function () {};
    var saveKeyOf = ctx.saveKeyOf || function () { return ''; };
    var updateMenuCounts = ctx.updateMenuCounts || function () {};
    var startSavedPractice = ctx.startSavedPractice || function () {};
    var stemPair = ctx.stemPair || function (q) {
      if (!q) return [{ t: '', lang: 'ar' }];
      var t = (q.stem && (q.stem.ar || q.stem.en)) || q.question_ar || q.question || q.text || '';
      return [{ t: t, lang: 'ar' }];
    };
    var optsPair = ctx.optsPair || function (q, i) {
      if (!q || !q.options || !q.options[i]) return [{ t: '', lang: 'ar' }];
      var opt = q.options[i];
      var t = typeof opt === 'object' ? (opt.ar || opt.en || '') : String(opt);
      return [{ t: t, lang: 'ar' }];
    };
    var explText = ctx.explText || function (q) {
      if (!q) return '';
      var e = q.explanation;
      return typeof e === 'object' ? (e.ar || e.en || '') : String(e || '');
    };
    var lettersFor = ctx.lettersFor || function () { return ['أ', 'ب', 'ج', 'د']; };
    var richHtml = ctx.richHtml || function (t) { return escapeHtml(t); };

    function currentSaveKey() {
      var ses = S.session;
      if (!ses || !ses.questions[ses.idx] || !ses.questions[ses.idx].origin) return null;
      var q = ses.questions[ses.idx];
      return saveKeyOf(q.origin, q.id);
    }

    function updateSaveBtn() {
      var btn = $('btn-save-question');
      if (!btn) return;
      var key = currentSaveKey();
      btn.classList.toggle('is-saved', !!key && !!S.saved[key]);
      btn.setAttribute('aria-pressed', !!key && !!S.saved[key] ? 'true' : 'false');
    }

    function toggleSaveCurrent() {
      var ses = S.session;
      if (!ses) return;
      var q = ses.questions[ses.idx];
      if (!q || !q.origin) return;
      var key = saveKeyOf(q.origin, q.id);
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
      var b = $('saved-count-badge');
      if (b) {
        var n = Object.keys(S.saved).length;
        b.textContent = n > 99 ? '99+' : n;
        b.classList.toggle('hidden', n === 0);
      }
      updateMenuCounts();
    }

    function savedGroups() {
      var bySub = {};
      var strTopic = function (v) {
        if (!v) return '';
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return v.ar || v.en || '';
        return '';
      };
      Object.keys(S.saved).forEach(function (key) {
        var it = S.saved[key];
        if (!it || typeof it !== 'object') return;
        var q = it.snapshot || it.q || it;
        if (!q || typeof q !== 'object') return;
        var stem = (q.stem && (q.stem.ar || q.stem.en)) || q.stem_ar || q.question || q.question_ar || q.text || '';
        if (!stem) return;
        var o = it.origin || q.origin || {};
        var sid = o.subjectId || o.subject_id || it.sub || it.subjectId || 'other';
        var stitle = o.subjectTitle || o.subject_title || it.subjectTitle || (S.index && S.index.subjects && S.index.subjects.find(function (s) { return s.subject_id === sid; }) ? S.index.subjects.find(function (s) { return s.subject_id === sid; }).subject_title : 'أسئلة عامة');
        var cno = o.chapterNo !== undefined ? o.chapterNo : (o.chapter !== undefined ? o.chapter : (it.chapterNo !== undefined ? it.chapterNo : 1));
        var topic = strTopic(o.topic) || strTopic(it.topic);
        bySub[sid] = bySub[sid] || { subjectId: sid, subjectTitle: stitle, chapters: {} };
        var ch = bySub[sid].chapters[cno] = bySub[sid].chapters[cno] || { chapterNo: cno, topic: topic, items: [] };
        if (!ch.topic && topic) ch.topic = topic;
        ch.items.push({ key: key, origin: o, snapshot: it.snapshot || it.q || it });
      });
      return Object.keys(bySub).map(function (sid) {
        return {
          subjectId: sid,
          subjectTitle: bySub[sid].subjectTitle,
          chapters: Object.keys(bySub[sid].chapters).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return bySub[sid].chapters[n]; })
        };
      });
    }

    function renderSaved() {
      try {
        var sv = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
        if (sv && typeof sv === 'object') S.saved = sv;
      } catch (e) {} // audit-ignore: optional localStorage read
      var box = $('saved-groups');
      box.innerHTML = '';
      var topActions = $('saved-top-actions');
      if (topActions) topActions.innerHTML = '';

      var groups = savedGroups();
      var total = 0;
      groups.forEach(function (g) { g.chapters.forEach(function (c) { total += c.items.length; }); });
      $('saved-total-line').textContent = total === 0 ? '' :
        savedCount(total) + ' في ' + arCount(groups.length, { one: 'مادة واحدة', two: 'مادتين', few: 'مواد', many: 'مادة' });
      $('saved-empty-state').classList.toggle('hidden', total !== 0);

      var subBar = $('saved-subject-bar');
      var chBar = $('saved-chapter-bar');
      if (total === 0) {
        if (subBar) { subBar.innerHTML = ''; subBar.style.display = 'none'; }
        if (chBar) { chBar.innerHTML = ''; chBar.style.display = 'none'; }
        icons();
        return;
      }

      if (!S.savedSubject || !groups.some(function (g) { return g.subjectId === S.savedSubject; })) {
        S.savedSubject = groups[0].subjectId;
        S.savedChapter = null;
      }
      var sub = groups.find(function (g) { return g.subjectId === S.savedSubject; }) || groups[0];
      var subAll = [];
      sub.chapters.forEach(function (c) { c.items.forEach(function (it) { subAll.push(it); }); });

      if (topActions && subAll.length > 0) {
        var genSub = document.createElement('button');
        genSub.type = 'button';
        genSub.className = 'action-btn secondary-btn saved-gen-btn';
        genSub.innerHTML = '<i data-lucide="layers"></i><span>اختبار المادة (' + subAll.length + ')</span>';
        genSub.setAttribute('aria-label', 'توليد اختبار من كل محفوظ ' + sub.subjectTitle);
        genSub.addEventListener('click', function () {
          startSavedPractice(
            subAll,
            'اختبار محفوظ ' + sub.subjectTitle,
            'اختبار شامل (' + subAll.length + ' أسئلة)'
          );
        });
        topActions.appendChild(genSub);
      }

      if (subBar) {
        subBar.innerHTML = '';
        if (groups.length <= 1) {
          subBar.style.display = 'none';
          $('saved-total-line').textContent = sub.subjectTitle + ' · ' + savedCount(total);
        } else {
          subBar.style.display = '';
          groups.forEach(function (g) {
            var n = g.chapters.reduce(function (a, c) { return a + c.items.length; }, 0);
            var b = document.createElement('button');
            b.className = 'filter-chip' + (S.savedSubject === g.subjectId ? ' active' : '');
            b.textContent = g.subjectTitle + ' (' + n + ')';
            b.setAttribute('aria-pressed', S.savedSubject === g.subjectId ? 'true' : 'false');
            b.addEventListener('click', function () {
              S.savedSubject = g.subjectId;
              S.savedChapter = null;
              S.savedPage = 1;
              saveUI();
              renderSaved();
            });
            subBar.appendChild(b);
          });
        }
      }

      var chNos = sub.chapters.map(function (c) { return c.chapterNo; });
      if (S.savedChapter === null || S.savedChapter === undefined || (S.savedChapter !== 0 && !chNos.includes(S.savedChapter))) {
        S.savedChapter = chNos[0];
      }
      if (chBar) {
        chBar.innerHTML = '';
        if (chNos.length <= 1) {
          chBar.style.display = 'none';
        } else {
          chBar.style.display = '';
          var allChBtn = document.createElement('button');
          allChBtn.type = 'button';
          allChBtn.className = 'filter-chip chapter-chip' + (S.savedChapter === 0 ? ' active' : '');
          allChBtn.textContent = 'كل الفصول (' + subAll.length + ')';
          allChBtn.setAttribute('aria-pressed', S.savedChapter === 0 ? 'true' : 'false');
          allChBtn.addEventListener('click', function () {
            S.savedChapter = 0;
            S.savedPage = 1;
            saveUI();
            renderSaved();
          });
          chBar.appendChild(allChBtn);

          sub.chapters.forEach(function (chObj) {
            var n = chObj.chapterNo;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'filter-chip chapter-chip' + (S.savedChapter === n ? ' active' : '');
            b.textContent = 'فصل ' + n + ' (' + chObj.items.length + ')';
            b.setAttribute('aria-label', 'فصل ' + n);
            b.title = chObj.topic ? ('فصل ' + n + ' · ' + chObj.topic) : ('فصل ' + n);
            b.setAttribute('aria-pressed', S.savedChapter === n ? 'true' : 'false');
            b.addEventListener('click', function () {
              S.savedChapter = n;
              S.savedPage = 1;
              saveUI();
              renderSaved();
            });
            chBar.appendChild(b);
          });
          var act = chBar.querySelector('.filter-chip.active');
          if (act) { try { act.scrollIntoView({ inline: 'nearest', block: 'nearest' }); } catch (e) {} } // audit-ignore: scroll optional
        }
      }

      var activeCh = S.savedChapter === 0
        ? null
        : (sub.chapters.find(function (x) { return x.chapterNo === S.savedChapter; }) || sub.chapters[0]);
      var activeItems = activeCh ? activeCh.items : subAll;

      var chTopic = activeCh ? (activeCh.topic || '') : '';
      if (activeCh && !chTopic && S.index && Array.isArray(S.index.subjects)) {
        var idxSub = S.index.subjects.find(function (s) { return s.subject_id === sub.subjectId; });
        var idxCh = idxSub && (idxSub.chapters || []).find(function (ch) { return Number(ch.chapter_no) === Number(activeCh.chapterNo); });
        if (idxCh && idxCh.topic) chTopic = idxCh.topic.ar || idxCh.topic.en || '';
      }

      var wrap = document.createElement('div');
      wrap.className = 'saved-group saved-ledger-wrap';

      var head = document.createElement('div');
      head.className = 'saved-deck-header';
      var headInfo = document.createElement('div');
      headInfo.className = 'saved-deck-info';
      var deckTitle = activeCh
        ? ('الفصل ' + activeCh.chapterNo + (chTopic ? ' · ' + chTopic : ''))
        : ('كل فصول ' + sub.subjectTitle);
      headInfo.innerHTML =
        '<div class="saved-group-title">' + escapeHtml(deckTitle) + '</div>' +
        '<div class="saved-group-sub">' + qCount(activeItems.length) + ' للمراجعة</div>';
      head.appendChild(headInfo);

      var headControls = document.createElement('div');
      headControls.className = 'saved-deck-controls';

      var hideAnswers = Boolean(S.savedHideAnswers);
      var modeBtn = document.createElement('button');
      modeBtn.type = 'button';
      modeBtn.id = 'btn-saved-recall-mode';
      modeBtn.className = 'action-btn secondary-btn saved-mode-btn' + (hideAnswers ? ' active' : '');
      modeBtn.innerHTML = '<i data-lucide="' + (hideAnswers ? 'eye' : 'eye-off') + '"></i><span>' + (hideAnswers ? 'إظهار الحلول' : 'اختبر ذاكرتك') + '</span>';
      modeBtn.setAttribute('aria-pressed', hideAnswers ? 'true' : 'false');
      modeBtn.title = hideAnswers ? 'إظهار الإجابات الصحيحة لكل الأسئلة' : 'إخفاء الإجابات لتخمين الحل بنفسك قبل كشفه';
      modeBtn.addEventListener('click', function () {
        S.savedHideAnswers = !S.savedHideAnswers;
        saveUI();
        renderSaved();
      });
      headControls.appendChild(modeBtn);

      if (activeCh) {
        var train = document.createElement('button');
        train.type = 'button';
        train.className = 'action-btn secondary-btn saved-train-btn';
        train.innerHTML = '<i data-lucide="play"></i><span>اختبار الفصل</span>';
        train.setAttribute('aria-label', 'توليد اختبار لجابتر ' + activeCh.chapterNo);
        train.addEventListener('click', function () {
          startSavedPractice(
            activeCh.items,
            'اختبار محفوظ ' + sub.subjectTitle + ' جابتر ' + activeCh.chapterNo,
            'جابتر ' + activeCh.chapterNo + ' (' + activeCh.items.length + ' أسئلة)'
          );
        });
        headControls.appendChild(train);
      }

      head.appendChild(headControls);
      wrap.appendChild(head);

      var PAGE_SIZE = 8;
      var totalPages = Math.max(1, Math.ceil(activeItems.length / PAGE_SIZE));
      var curPage = Number(S.savedPage) || 1;
      if (curPage < 1) curPage = 1;
      if (curPage > totalPages) curPage = totalPages;
      S.savedPage = curPage;

      var startIdx = (curPage - 1) * PAGE_SIZE;
      var visibleItems = activeItems.slice(startIdx, startIdx + PAGE_SIZE);

      var cardsList = document.createElement('div');
      cardsList.className = 'saved-cards-list';

      visibleItems.forEach(function (it, idx) {
        var q = it.snapshot || it;
        if (!q || typeof q !== 'object') return;
        var globalNum = startIdx + idx + 1;
        var card = document.createElement('article');
        card.className = 'saved-q-card' + (hideAnswers ? ' is-masked' : '');

        var cardTop = document.createElement('div');
        cardTop.className = 'saved-q-top';
        var metaLeft = document.createElement('div');
        metaLeft.className = 'saved-q-meta';
        var chBadge = (!activeCh && it.origin && it.origin.chapterNo)
          ? '<span class="saved-q-ch-tag">فصل ' + escapeHtml(String(it.origin.chapterNo)) + '</span>'
          : '';
        metaLeft.innerHTML = '<span class="saved-q-num" dir="ltr">#' + globalNum + '</span>' + chBadge;
        cardTop.appendChild(metaLeft);

        var rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'icon-btn saved-unsave-btn';
        rm.innerHTML = '<i data-lucide="bookmark-minus"></i><span>إزالة</span>';
        rm.setAttribute('aria-label', 'إزالة السؤال من المحفوظ');
        rm.title = 'إزالة من المحفوظات';
        rm.addEventListener('click', function () {
          delete S.saved[it.key];
          markSavedRemoved(it.key);
          if (Object.keys(S.saved).length === 0) { S.savedSubject = null; S.savedChapter = null; }
          persistSaved(); updateSavedBadge(); renderSaved(); icons();
          toast('أُزيل من المحفوظ');
        });
        cardTop.appendChild(rm);
        card.appendChild(cardTop);

        var stemWrap = document.createElement('div');
        stemWrap.className = 'saved-q-stem';
        stemPair(q).forEach(function (sp, si) {
          var stem = document.createElement('p');
          stem.className = 'review-question-text' + (si > 0 ? ' review-question-text-sub' : '');
          stem.innerHTML = richHtml(sp.t);
          stem.setAttribute('dir', 'auto');
          stemWrap.appendChild(stem);
        });
        card.appendChild(stemWrap);

        if (hideAnswers) {
          var revealBtn = document.createElement('button');
          revealBtn.type = 'button';
          revealBtn.className = 'saved-reveal-btn';
          revealBtn.innerHTML = '<i data-lucide="eye"></i><span>إظهار الإجابة والشرح</span>';
          revealBtn.addEventListener('click', function () {
            card.classList.remove('is-masked');
            revealBtn.remove();
          });
          card.appendChild(revealBtn);
        }

        var solutionWrap = document.createElement('div');
        solutionWrap.className = 'saved-q-solution';

        for (var oi = 0; oi < 4; oi++) {
          if (oi !== q.correct) continue;
          var pair = optsPair(q, oi);
          var item = document.createElement('div');
          item.className = 'saved-correct-answer';
          item.setAttribute('dir', 'auto');
          var li = lettersFor(pair[0].lang);
          item.innerHTML =
            '<span class="saved-ans-badge">' + li[oi] + '</span>' +
            '<div class="saved-ans-text">' +
              pair.map(function (p) { return '<span class="opt-line opt-' + p.lang + '">' + richHtml(p.t) + '</span>'; }).join('') +
            '</div>';
          solutionWrap.appendChild(item);
        }

        var expl = explText(q);
        if (expl) {
          var exp = document.createElement('div');
          exp.className = 'saved-q-expl';
          exp.setAttribute('dir', 'auto');
          exp.innerHTML = '<span class="saved-expl-label">الشرح</span><div class="saved-expl-body">' + richHtml(expl) + '</div>';
          solutionWrap.appendChild(exp);
        }

        card.appendChild(solutionWrap);
        cardsList.appendChild(card);
      });

      wrap.appendChild(cardsList);

      if (totalPages > 1) {
        var pager = document.createElement('div');
        pager.className = 'history-pager saved-pager';
        var fromRow = startIdx + 1;
        var toRow = Math.min(activeItems.length, startIdx + PAGE_SIZE);
        pager.innerHTML =
          '<button type="button" class="history-page-btn" id="saved-prev-page" ' + (curPage <= 1 ? 'disabled' : '') + ' aria-label="الصفحة السابقة">' +
            '<i data-lucide="chevron-right" aria-hidden="true"></i>' +
            '<span>السابق</span>' +
          '</button>' +
          '<span class="history-page-info">' +
            'صفحة <strong>' + curPage + '</strong> من <strong>' + totalPages + '</strong>' +
            '<span class="history-page-range"> · (' + fromRow + '–' + toRow + ' من ' + activeItems.length + ')</span>' +
          '</span>' +
          '<button type="button" class="history-page-btn" id="saved-next-page" ' + (curPage >= totalPages ? 'disabled' : '') + ' aria-label="الصفحة التالية">' +
            '<span>التالي</span>' +
            '<i data-lucide="chevron-left" aria-hidden="true"></i>' +
          '</button>';
        wrap.appendChild(pager);

        var prevBtn = pager.querySelector('#saved-prev-page');
        var nextBtn = pager.querySelector('#saved-next-page');
        if (prevBtn) {
          prevBtn.onclick = function () {
            if (S.savedPage > 1) {
              S.savedPage--;
              renderSaved();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          };
        }
        if (nextBtn) {
          nextBtn.onclick = function () {
            if (S.savedPage < totalPages) {
              S.savedPage++;
              renderSaved();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          };
        }
      }

      box.appendChild(wrap);
      icons();
    }

    return {
      currentSaveKey: currentSaveKey,
      updateSaveBtn: updateSaveBtn,
      toggleSaveCurrent: toggleSaveCurrent,
      updateSavedBadge: updateSavedBadge,
      savedGroups: savedGroups,
      renderSaved: renderSaved
    };
  }

  global.PortalSavedUI = {
    create: createSavedUI
  };
})(window);
