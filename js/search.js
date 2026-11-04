/* MCQ Portal — search.js
 * In-Portal Comprehensive Search Engine.
 * Client-side, 100% offline, privacy-first, zero analytics or telemetry.
 * Advanced Arabic normalization, tokenization, prefix matching, field weighting, and 50-item cap.
 */
(function (global) {
  'use strict';

  var _items = [];
  var _isReady = false;

  // Arabic Diacritics regex
  var ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670]/g;
  var ARABIC_TATWEEL_RE = /\u0640/g;

  var EASTERN_DIGITS = {
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };
  var EASTERN_DIGITS_RE = /[٠-٩]/g;

  function replaceEasternDigit(d) {
    return EASTERN_DIGITS[d] || d;
  }

  // Normalization for both Arabic and English text
  function normalize(str) {
    if (!str || typeof str !== 'string') return '';
    var s = str.trim().toLowerCase();

    // 1. Remove tashkeel and tatweel
    s = s.replace(ARABIC_DIACRITICS_RE, '');
    s = s.replace(ARABIC_TATWEEL_RE, '');

    // 2. Normalize Alefs: أ, إ, آ, ٱ -> ا
    s = s.replace(/[أإآٱ]/g, 'ا');

    // 3. Normalize Ya / Alef Maqsura: ى -> ي
    s = s.replace(/ى/g, 'ي');

    // 4. Normalize Taa Marbuta: ة -> ه
    s = s.replace(/ة/g, 'ه');

    // 5. Normalize Hamza variants: ؤ -> و, ئ -> ي
    s = s.replace(/ؤ/g, 'و');
    s = s.replace(/ئ/g, 'ي');

    // 6. Eastern Arabic numerals to standard Latin digits
    s = s.replace(EASTERN_DIGITS_RE, replaceEasternDigit);

    // 7. Collapse whitespace
    s = s.replace(/\s+/g, ' ');

    return s;
  }

  // Split normalized text into distinct keywords/tokens
  function tokenize(str) {
    var norm = normalize(str);
    if (!norm) return [];
    var words = norm.split(/[^a-z0-9\u0621-\u064A]+/);
    var unique = [];
    var seen = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i].trim();
      if (w.length >= 1 && !seen[w]) {
        seen[w] = true;
        unique.push(w);
      }
    }
    return unique;
  }

  function extractText(field) {
    if (!field) return '';
    if (typeof field === 'string') return field;
    if (typeof field === 'object') {
      return (field.ar || '') + ' ' + (field.en || '');
    }
    return '';
  }

  function extractOptionsText(options) {
    if (!Array.isArray(options)) return '';
    var parts = [];
    for (var i = 0; i < options.length; i++) {
      parts.push(extractText(options[i]));
    }
    return parts.join(' ');
  }

  // Build the inverted search index from current S.index and S.banks
  function buildIndex(index, banks) {
    _items = [];
    if (!index || !Array.isArray(index.subjects) || !banks) {
      _isReady = false;
      return;
    }

    index.subjects.forEach(function (sub) {
      var subId = sub.subject_id;
      var subTitle = sub.subject_title || subId;
      var chapters = sub.chapters || [];

      chapters.forEach(function (ch) {
        var quizId = ch.quiz_id;
        var chNo = ch.chapter_no !== undefined ? ch.chapter_no : 1;
        var chLabel = ch.topicLabel || ch.label || ('جابتر ' + chNo);
        var bank = banks[quizId];
        if (!bank || !Array.isArray(bank.questions)) return;

        var topicTitle = bank.topic || (ch.topic && ch.topic.ar) || '';
        var conceptNorm = normalize(topicTitle);

        bank.questions.forEach(function (q) {
          if (!q || !q.id) return;
          var stemRaw = extractText(q.stem);
          var optsRaw = extractOptionsText(q.options);
          var explRaw = extractText(q.explanation);

          var stemNorm = normalize(stemRaw);
          var optsNorm = normalize(optsRaw);
          var explNorm = normalize(explRaw);

          var origin = {
            subjectId: subId,
            subjectTitle: subTitle,
            chapterNo: chNo,
            chapterLabel: chLabel,
            quizId: quizId,
            topic: topicTitle
          };

          var item = {
            id: q.id,
            key: subId + '|' + quizId + '|' + q.id,
            subjectId: subId,
            subjectTitle: subTitle,
            chapterNo: chNo,
            chapterLabel: chLabel,
            quizId: quizId,
            topic: topicTitle,
            origin: origin,
            q: q,
            stemRaw: stemRaw,
            stemNorm: stemNorm,
            optsNorm: optsNorm,
            explNorm: explNorm,
            conceptNorm: conceptNorm
          };

          _items.push(item);
        });
      });
    });

    _isReady = true;
  }

  function matchField(fieldNorm, token) {
    if (!fieldNorm || !token) return 0;
    // Exact word or prefix match
    var idx = fieldNorm.indexOf(token);
    if (idx === -1) return 0;

    // Boundary check: is it start of string or preceded by space?
    var isPrefix = (idx === 0 || fieldNorm.charAt(idx - 1) === ' ');
    if (isPrefix) {
      var end = idx + token.length;
      var isExact = (end === fieldNorm.length || fieldNorm.charAt(end) === ' ');
      return isExact ? 2 : 1; // 2 = exact word, 1 = prefix
    }
    return 0.5; // substring match
  }

  // Execute search query
  function query(searchStr, opts) {
    if (!_isReady || !searchStr || typeof searchStr !== 'string') return [];
    var qTokens = tokenize(searchStr);
    if (!qTokens.length) return [];

    var options = opts || {};
    var filterSubject = options.subjectId || null;
    var rawQueryNorm = normalize(searchStr);

    var results = [];

    for (var i = 0; i < _items.length; i++) {
      var item = _items[i];
      if (filterSubject && item.subjectId !== filterSubject) continue;

      var allTokensMatched = true;
      var totalScore = 0;

      for (var tIdx = 0; tIdx < qTokens.length; tIdx++) {
        var token = qTokens[tIdx];

        var mConcept = matchField(item.conceptNorm, token);
        var mStem = matchField(item.stemNorm, token);
        var mOpts = matchField(item.optsNorm, token);
        var mExpl = matchField(item.explNorm, token);

        if (mConcept === 0 && mStem === 0 && mOpts === 0 && mExpl === 0) {
          allTokensMatched = false;
          break; // AND semantics
        }

        // Weighted Scoring: concept (100) > stem (50) > option (20) > explanation (10)
        totalScore += (mConcept * 100) + (mStem * 50) + (mOpts * 20) + (mExpl * 10);
      }

      if (allTokensMatched) {
        // Bonus for exact phrase in stem
        if (rawQueryNorm.length > 2 && item.stemNorm.indexOf(rawQueryNorm) !== -1) {
          totalScore += 80;
        }

        results.push({
          item: item,
          q: item.q,
          origin: item.origin,
          score: totalScore
        });
      }
    }

    // Sort by score descending
    results.sort(function (a, b) {
      return b.score - a.score;
    });

    // Cap at 50 results
    var capped = results.slice(0, 50);

    return capped.map(function (res) {
      return {
        id: res.item.id,
        key: res.item.key,
        subjectId: res.item.subjectId,
        subjectTitle: res.item.subjectTitle,
        chapterNo: res.item.chapterNo,
        chapterLabel: res.item.chapterLabel,
        topic: res.item.topic,
        origin: res.origin,
        q: res.q,
        score: res.score
      };
    });
  }

  function isReady() {
    return _isReady;
  }

  function getItemsCount() {
    return _items.length;
  }

  global.PortalSearch = {
    normalize: normalize,
    tokenize: tokenize,
    buildIndex: buildIndex,
    query: query,
    isReady: isReady,
    getItemsCount: getItemsCount
  };

})(typeof window !== 'undefined' ? window : this);
