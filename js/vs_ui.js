/* MCQ Portal — vs_ui.js
 * 1v1 Real-Time Competitive Mode & Football Legends Duel Arena UI module.
 */
(function (global) {
  'use strict';

  function createVsUI(ctx) {
    ctx = ctx || {};
    var $ = ctx.$ || function (id) { return document.getElementById(id); };
    var S = ctx.S || {};
    var escapeHtml = ctx.escapeHtml || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var icons = ctx.icons || function () { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); };
    var toast = ctx.toast || function (msg, type) { if (window.toast) window.toast(msg, type); };
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
    var qLetters = ctx.qLetters || function () { return ['أ', 'ب', 'ج', 'د']; };
    var richHtml = ctx.richHtml || function (t) { return escapeHtml(t); };
    var goHash = ctx.goHash || function (h) { location.hash = h; };

    var vsState = {
      room: null,
      channel: null,
      role: null,
      opponent: null,
      questions: [],
      roundIndex: 0,
      myScore: 0,
      oppScore: 0,
      myPick: null,
      oppPick: null,
      myTimeMs: 0,
      oppTimeMs: 0,
      roundTimer: null,
      timeLeftSec: 12,
      roundStartMs: 0,
      myLockedIn: false,
      oppLockedIn: false,
      resolved: false,
      isBot: false,
      botLegend: null,
      botDecision: null,
      botTimer: null,
      botStageTimers: [],
      botStreak: 0
    };
    global.vsState = vsState;

    function vsPlayerInfo() {
      var uid = '';
      var uname = 'طالب';
      var uav = '';
      try {
        var C = window.PortalCloud;
        var a = (C && C.account) ? C.account() : null;
        if (a) {
          uid = 'u:' + a.id;
          uname = a.username || 'طالب';
          uav = a.avatar || '';
        }
      } catch (e) {} // audit-ignore: optional account lookup
      if (!uid) {
        var g = '';
        try { g = localStorage.getItem('portal_guest_id'); } catch (e) {} // audit-ignore: storage read
        if (!g) {
          g = 'g_' + Math.floor(Math.random() * 1000000);
          try { localStorage.setItem('portal_guest_id', g); } catch (e) {} // audit-ignore: storage write
        }
        uid = 'g:' + g;
        try { uname = localStorage.getItem('portal_guest_name') || 'ضيف'; } catch (e) {} // audit-ignore: guest name
      }
      return { id: uid, name: uname, avatar: uav };
    }

    function gatherVsQuestions(subjectId, chapterId, seed) {
      var pool = [];
      var banks = S.banks || {};
      Object.keys(banks).forEach(function (k) {
        var b = banks[k];
        if (!b || !b.questions || !b.questions.length) return;
        if (subjectId && subjectId !== 'all' && b.subject_id !== subjectId) return;
        if (chapterId && chapterId !== 'all' && b.quiz_id !== chapterId) return;
        b.questions.forEach(function (q) { pool.push(q); });
      });
      if (pool.length < 5) {
        Object.keys(banks).forEach(function (k) {
          var b = banks[k];
          if (b && b.questions && b.questions.length) {
            b.questions.forEach(function (q) { pool.push(q); });
          }
        });
      }
      return window.PortalVS ? window.PortalVS.pickVsQuestions(pool, seed || 12345, 5) : pool.slice(0, 5);
    }

    function updateVsLanguage() {
      var inlineText = $('vs-inline-lang-text');
      if (inlineText) inlineText.textContent = S.lang === 'en' ? 'عربي' : 'English';
      if (!vsState.questions || vsState.roundIndex == null) return;
      var q = vsState.questions[vsState.roundIndex];
      if (!q) return;

      var stems = stemPair(q);
      var qStem = $('vs-question-stem');
      if (qStem && stems[0]) qStem.innerHTML = richHtml(stems[0].t);

      var box = $('vs-options-list');
      if (box) {
        var letters = qLetters();
        var btns = box.querySelectorAll('.vs-opt-btn');
        btns.forEach(function (btn, idx) {
          var pair = optsPair(q, idx);
          var text = pair[0] ? pair[0].t : '';
          var letterSpan = btn.querySelector('.vs-opt-letter');
          var textSpan = btn.querySelector('.vs-opt-text');
          if (letterSpan) letterSpan.textContent = letters[idx] || '';
          if (textSpan) textSpan.innerHTML = richHtml(text);
        });
      }
    }

    function renderVs(hash) {
      var offCard = $('vs-offline-card');
      var lobby = $('vs-lobby');
      var waiting = $('vs-waiting');
      var arena = $('vs-arena');
      var result = $('vs-result');

      if (!navigator.onLine || !window.PortalVS || !window.PortalVS.configured()) {
        if (offCard) offCard.classList.remove('hidden');
        if (lobby) lobby.classList.add('hidden');
        if (waiting) waiting.classList.add('hidden');
        if (arena) arena.classList.add('hidden');
        if (result) result.classList.add('hidden');
        return;
      }
      if (offCard) offCard.classList.add('hidden');

      if (!vsState.room) {
        if (lobby) lobby.classList.remove('hidden');
        if (waiting) waiting.classList.add('hidden');
        if (arena) arena.classList.add('hidden');
        if (result) result.classList.add('hidden');
        setupVsLobby();
        setupVsResultActions();

        var m = (hash || '').match(/^#\/vs\/([0-9]{4})$/);
        if (m && m[1]) {
          var code = m[1];
          var pins = [$('vs-pin-1'), $('vs-pin-2'), $('vs-pin-3'), $('vs-pin-4')].filter(Boolean);
          for (var i = 0; i < code.length && i < pins.length; i++) {
            pins[i].value = code[i];
          }
          if (pins[3]) pins[3].focus();
        }
      }
      icons();
    }

    function setupVsLobby() {
      var subSelect = $('vs-select-subject');
      var chSelect = $('vs-select-chapter');
      if (subSelect && S.index && S.index.subjects) {
        subSelect.innerHTML = '<option value="all">جميع المواد (عشوائي)</option>' +
          S.index.subjects.map(function (s) { return '<option value="' + escapeHtml(s.subject_id) + '">' + escapeHtml(s.subject_title || s.subject_id) + '</option>'; }).join('');
        var updateChapters = function () {
          var sid = subSelect.value;
          if (!chSelect) return;
          if (sid === 'all') {
            chSelect.innerHTML = '<option value="all">جميع الفصول (عشوائي)</option>';
            chSelect.disabled = true;
            return;
          }
          chSelect.disabled = false;
          var sub = S.index.subjects.find(function (s) { return s.subject_id === sid; });
          var chs = (sub && sub.chapters) || [];
          chSelect.innerHTML = '<option value="all">جميع الفصول</option>' +
            chs.map(function (c) { return '<option value="' + escapeHtml(c.quiz_id) + '">' + escapeHtml(c.topicLabel ? (c.topicLabel + ' · ' + (c.topic && (c.topic.ar || c.topic.en) || '')) : (c.quiz_id)) + '</option>'; }).join('');
        };
        subSelect.onchange = updateChapters;
        updateChapters();
      }

      var pin1 = $('vs-pin-1');
      var pin2 = $('vs-pin-2');
      var pin3 = $('vs-pin-3');
      var pin4 = $('vs-pin-4');
      var pins = [pin1, pin2, pin3, pin4].filter(Boolean);
      pins.forEach(function (p, idx) {
        p.oninput = function () {
          p.value = p.value.replace(/\D/g, '').slice(-1);
          if (p.value && idx < pins.length - 1) pins[idx + 1].focus();
        };
        p.onkeydown = function (e) {
          if (e.key === 'Backspace' && !p.value && idx > 0) {
            pins[idx - 1].focus();
          }
        };
        p.onpaste = function (e) {
          e.preventDefault();
          var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
          for (var i = 0; i < text.length && i < pins.length; i++) {
            pins[i].value = text[i];
          }
          if (text.length >= 4 && pins[3]) pins[3].focus();
        };
      });

      var btnCreate = $('vs-btn-create-room');
      if (btnCreate) {
        btnCreate.onclick = async function () {
          btnCreate.disabled = true;
          try {
            var subId = (subSelect && subSelect.value) || 'all';
            var chId = (chSelect && chSelect.value) || 'all';
            var p = vsPlayerInfo();
            var room = await window.PortalVS.createRoom(subId, chId, p.id, p.name, p.avatar);
            enterVsWaiting(room);
          } catch (e) {
            toast('تعذر إنشاء الغرفة: ' + ((e && e.message) || ''), 'error');
          } finally {
            btnCreate.disabled = false;
          }
        };
      }

      var btnJoin = $('vs-btn-join-room');
      var joinStatus = $('vs-join-status');
      if (btnJoin) {
        btnJoin.onclick = async function () {
          var code = pins.map(function (p) { return p.value; }).join('');
          if (code.length < 4) {
            if (joinStatus) {
              joinStatus.textContent = 'يرجى إدخال الرمز المكون من 4 أرقام';
              joinStatus.classList.remove('hidden');
            }
            return;
          }
          if (joinStatus) joinStatus.classList.add('hidden');
          btnJoin.disabled = true;
          try {
            var p = vsPlayerInfo();
            var room = await window.PortalVS.joinRoom(code, p.id, p.name, p.avatar);
            enterVsArenaAsGuest(room);
          } catch (e) {
            if (joinStatus) {
              joinStatus.textContent = 'تعذر الانضمام: الرمز غير صحيح أو الغرفة ممتلئة';
              joinStatus.classList.remove('hidden');
            }
          } finally {
            btnJoin.disabled = false;
          }
        };
      }

      var qrStream = null;
      var qrScanTimer = null;

      var stopQrScanner = function () {
        if (qrScanTimer) {
          cancelAnimationFrame(qrScanTimer);
          qrScanTimer = null;
        }
        if (qrStream) {
          try {
            qrStream.getTracks().forEach(function (t) { t.stop(); });
          } catch (e) {} // audit-ignore: optional stream stop
          qrStream = null;
        }
        var modal = $('vs-qr-modal');
        if (modal) modal.classList.add('hidden');
        var video = $('vs-qr-video');
        if (video) video.srcObject = null;
      };

      var startQrScanner = async function () {
        var modal = $('vs-qr-modal');
        var video = $('vs-qr-video');
        if (!modal || !video) return;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast('الكاميرا غير متاحة في هذا الجهاز', 'error');
          return;
        }

        try {
          modal.classList.remove('hidden');
          icons();
          qrStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }
          });
          video.srcObject = qrStream;
          await video.play();

          var canvas = document.createElement('canvas');
          var ctx2d = canvas.getContext('2d', { willReadFrequently: true });
          var detector = null;
          if ('BarcodeDetector' in window) {
            try {
              detector = new window.BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {} // audit-ignore: BarcodeDetector fallback
          }

          var checkCode = function (raw) {
            if (!raw) return false;
            var m = String(raw).match(/(?:#\/vs\/|^)([0-9]{4})$/);
            if (m && m[1]) {
              var code = m[1];
              stopQrScanner();
              for (var i = 0; i < code.length && i < pins.length; i++) {
                pins[i].value = code[i];
              }
              if (btnJoin) btnJoin.click();
              return true;
            }
            return false;
          };

          var scanFrame = async function () {
            if (!qrStream || video.readyState < 2) {
              qrScanTimer = requestAnimationFrame(scanFrame);
              return;
            }

            if (detector) {
              try {
                var barcodes = await detector.detect(video);
                if (barcodes && barcodes.length) {
                  for (var k = 0; k < barcodes.length; k++) {
                    if (checkCode(barcodes[k].rawValue)) return;
                  }
                }
              } catch (e) {} // audit-ignore: detector frame scan
            }

            if (window.jsQR && ctx2d) {
              if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                canvas.width = video.videoWidth || 320;
                canvas.height = video.videoHeight || 320;
              }
              ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
              try {
                var imgData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
                var res = window.jsQR(imgData.data, imgData.width, imgData.height, {
                  inversionAttempts: 'dontInvert'
                });
                if (res && res.data && checkCode(res.data)) return;
              } catch (e) {} // audit-ignore: canvas scan frame error
            }

            qrScanTimer = requestAnimationFrame(scanFrame);
          };

          qrScanTimer = requestAnimationFrame(scanFrame);
        } catch (err) {
          stopQrScanner();
          toast('تعذر الوصول إلى الكاميرا', 'error');
        }
      };

      var btnScan = $('vs-btn-scan-qr');
      if (btnScan) btnScan.onclick = startQrScanner;

      var btnCloseScan = $('vs-btn-close-scanner');
      if (btnCloseScan) btnCloseScan.onclick = stopQrScanner;

      var qrModal = $('vs-qr-modal');
      if (qrModal && !qrModal._wired) {
        qrModal._wired = true;
        qrModal.onclick = function (e) {
          if (e.target === qrModal) stopQrScanner();
        };
      }

      document.querySelectorAll('.vs-legend-btn, .vs-legend-card').forEach(function (btn) {
        btn.onclick = function () {
          var legendId = btn.getAttribute('data-legend');
          if (legendId) startVsLegendDuel(legendId);
        };
      });

      var rivalIds = [$('vs-rival-ronaldinho'), $('vs-rival-maldini'), $('vs-rival-messi'), $('vs-rival-cristiano'), $('vs-rival-maradona')];
      var legendKeys = ['ronaldinho', 'maldini', 'messi', 'cristiano', 'maradona'];
      legendKeys.forEach(function (key, idx) {
        var el = rivalIds[idx];
        if (el && window.PortalVSBot && window.PortalVSBot.getRivalStats) {
          var st = window.PortalVSBot.getRivalStats(key);
          if (!st || st.played === 0) {
            el.textContent = 'المواجهات: لم تواجهه بعد';
          } else {
            el.textContent = 'المواجهات: ' + st.wins + ' فوز - ' + st.losses + ' خسارة' + (st.ties ? (' - ' + st.ties + ' تعادل') : '');
          }
        }
      });

      var legDetails = document.querySelector('details.vs-legends-section');
      if (legDetails && !legDetails._wired) {
        legDetails._wired = true;
        legDetails.addEventListener('toggle', function () {
          if (legDetails.open) icons();
        });
      }
    }

    function startVsLegendDuel(legendId) {
      if (!window.PortalVSBot) return;
      var legend = window.PortalVSBot.getLegend(legendId);
      if (!legend) return;

      var subSelect = $('vs-select-subject');
      var chSelect = $('vs-select-chapter');
      var subId = (subSelect && subSelect.value) || 'all';
      var chId = (chSelect && chSelect.value) || 'all';

      var p = vsPlayerInfo();
      var seed = Math.floor(Math.random() * 1000000) + 1;
      vsState.isBot = true;
      vsState.botLegend = legend;
      vsState.botStreak = 0;
      vsState.botDecision = null;
      if (vsState.botTimer) {
        clearTimeout(vsState.botTimer);
        vsState.botTimer = null;
      }
      if (vsState.botStageTimers && vsState.botStageTimers.length) {
        vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
      }
      vsState.botStageTimers = [];
      vsState.room = {
        room_id: 'legend_' + legend.id + '_' + Date.now(),
        subject_id: subId,
        chapter_id: chId,
        seed: seed
      };
      vsState.role = 'host';
      vsState.myScore = 0;
      vsState.oppScore = 0;
      vsState.opponent = {
        user_id: 'legend:' + legend.id,
        name: legend.name,
        avatar: legend.avatar
      };
      vsState.questions = gatherVsQuestions(subId, chId, seed);

      $('vs-lobby').classList.add('hidden');
      $('vs-waiting').classList.remove('hidden');
      $('vs-arena').classList.add('hidden');
      $('vs-result').classList.add('hidden');

      var waitTitle = $('vs-waiting-title');
      if (waitTitle) waitTitle.textContent = 'جاري الاتصال بحلبة المنافسة المباشرة...';
      var codeEl = $('vs-waiting-code');
      if (codeEl) codeEl.textContent = '----';
      var qrWrap = $('vs-qr-container');
      if (qrWrap) qrWrap.innerHTML = '';
      var btnCancel = $('vs-btn-cancel-waiting');
      if (btnCancel) {
        btnCancel.onclick = function () {
          cleanupVsTimers();
          $('vs-waiting').classList.add('hidden');
          $('vs-arena').classList.add('hidden');
          $('vs-lobby').classList.remove('hidden');
        };
      }

      var duelStep1 = setTimeout(function () {
        clearTimeout(duelStep1);
        if (!vsState.room || !vsState.isBot) return;
        if (waitTitle) waitTitle.textContent = 'تم الاتصال وقبول التحدي من ' + legend.name + '!';
        var duelStep2 = setTimeout(function () {
          clearTimeout(duelStep2);
          if (!vsState.room || !vsState.isBot) return;
          $('vs-waiting').classList.add('hidden');
          $('vs-arena').classList.remove('hidden');

          var meName = $('vs-me-name');
          var meScore = $('vs-me-score');
          var meAv = $('vs-me-avatar');
          var oppName = $('vs-opp-name');
          var oppScore = $('vs-opp-score');
          var oppAv = $('vs-opp-avatar');
          var oppBadge = $('vs-opp-badge');
          var oppBubble = $('vs-opp-locked-bubble');

          if (meName) meName.textContent = p.name;
          if (meScore) meScore.textContent = '0';
          if (meAv) meAv.textContent = (p.name || 'أ').trim()[0].toUpperCase();

          if (oppName) oppName.textContent = legend.name;
          if (oppScore) oppScore.textContent = '0';
          if (oppAv) {
            if (legend.avatar && legend.avatar.indexOf('/') !== -1) {
              oppAv.className = 'vs-pod-avatar avatar-default';
              oppAv.style.backgroundImage = 'url("' + legend.avatar + '"),url("assets/avatar-default.svg")';
              oppAv.style.backgroundSize = 'cover';
              oppAv.style.backgroundPosition = 'center';
              oppAv.innerHTML = '';
            } else {
              oppAv.innerHTML = '<span>' + (legend.avatarChar || legend.avatar) + '</span>';
              oppAv.className = 'vs-pod-avatar av-' + legend.id;
            }
          }
          if (oppBadge) oppBadge.textContent = legend.title;
          if (oppBubble) oppBubble.classList.add('hidden');

          for (var i = 0; i < 5; i++) {
            var dot = $('vs-dot-' + i);
            if (dot) dot.className = 'vs-dot' + (i === 0 ? ' is-current' : '');
          }

          startVsRound(0);
          icons();
        }, 500);
        vsState.botStageTimers.push(duelStep2);
      }, 700);
      vsState.botStageTimers.push(duelStep1);
      icons();
    }

    function enterVsWaiting(roomData) {
      vsState.room = roomData;
      vsState.role = 'host';
      vsState.myScore = 0;
      vsState.oppScore = 0;
      vsState.opponent = null;

      $('vs-lobby').classList.add('hidden');
      $('vs-waiting').classList.remove('hidden');
      $('vs-arena').classList.add('hidden');
      $('vs-result').classList.add('hidden');

      var codeEl = $('vs-waiting-code');
      if (codeEl) codeEl.textContent = roomData.code;

      var qrWrap = $('vs-qr-container');
      if (qrWrap && window.qrcode) {
        try {
          var qr = window.qrcode(0, 'M');
          var joinUrl = location.origin + location.pathname + '#/vs/' + roomData.code;
          qr.addData(joinUrl);
          qr.make();
          qrWrap.innerHTML = qr.createSvgTag({ scalable: true, margin: 1 });
        } catch (e) { // audit-ignore: optional qr render
          qrWrap.innerHTML = '';
        }
      }

      var btnCopy = $('vs-btn-copy-link');
      var copyText = $('vs-copy-btn-text');
      if (btnCopy) {
        btnCopy.onclick = async function () {
          var joinUrl = location.origin + location.pathname + '#/vs/' + roomData.code;
          try {
            await navigator.clipboard.writeText(joinUrl);
            if (copyText) copyText.textContent = 'تم نسخ الرابط!';
            var copyTimer = setTimeout(function () { clearTimeout(copyTimer); if (copyText) copyText.textContent = 'نسخ رابط الانضمام'; }, 2000);
          } catch (e) { // audit-ignore: clipboard fallback
            toast('تعذر نسخ الرابط', 'info');
          }
        };
      }

      var btnCancel = $('vs-btn-cancel-waiting');
      if (btnCancel) {
        btnCancel.onclick = function () {
          window.PortalVS.leaveRoom();
          vsState.room = null;
          $('vs-waiting').classList.add('hidden');
          $('vs-lobby').classList.remove('hidden');
        };
      }

      var p = vsPlayerInfo();
      window.PortalVS.connectRoom(roomData.room_id, 'host', p, {
        onPresenceSync: function (presenceState) {
          var guests = presenceState['guest'];
          if (guests && guests.length > 0 && !vsState.opponent) {
            vsState.opponent = guests[0];
            startVsMatchAsHost();
          }
        },
        onPresenceLeave: function () {
          toast('غادر المنافس الغرفة', 'info');
        },
        onOpponentReady: function () {},
        onOpponentLockedIn: function (payload) {
          handleVsOpponentLockedIn(payload);
        },
        onOpponentReveal: function (payload) {
          handleVsOpponentReveal(payload);
        }
      });
      icons();
    }

    function startVsMatchAsHost() {
      vsState.questions = gatherVsQuestions(vsState.room.subject_id, vsState.room.chapter_id, vsState.room.seed);
      var p = vsPlayerInfo();
      var meName = $('vs-me-name');
      var meScore = $('vs-me-score');
      var meAv = $('vs-me-avatar');
      var oppName = $('vs-opp-name');
      var oppScore = $('vs-opp-score');
      var oppAv = $('vs-opp-avatar');
      var oppBubble = $('vs-opp-locked-bubble');

      if (meName) meName.textContent = p.name;
      if (meScore) meScore.textContent = '0';
      if (meAv) meAv.textContent = (p.name || 'أ').trim()[0].toUpperCase();

      var opp = vsState.opponent;
      var oppBadge = $('vs-opp-badge');
      if (oppName) oppName.textContent = (opp && opp.name) || 'المنافس';
      if (oppScore) oppScore.textContent = '0';
      if (oppAv) {
        oppAv.style.backgroundImage = '';
        oppAv.className = 'vs-pod-avatar';
        oppAv.textContent = ((opp && opp.name) || 'م').trim()[0].toUpperCase();
      }
      if (oppBadge) oppBadge.textContent = 'المنافس';
      if (oppBubble) oppBubble.classList.add('hidden');

      for (var i = 0; i < 5; i++) {
        var dot = $('vs-dot-' + i);
        if (dot) dot.className = 'vs-dot' + (i === 0 ? ' is-current' : '');
      }

      $('vs-waiting').classList.add('hidden');
      $('vs-arena').classList.remove('hidden');

      var hostStartTimer = setTimeout(function () {
        clearTimeout(hostStartTimer);
        if (!vsState.room) return;
        window.PortalVS.sendStartRound(0, Date.now());
        startVsRound(0);
      }, 600);
      vsState.botStageTimers.push(hostStartTimer);
      icons();
    }

    function enterVsArenaAsGuest(roomData) {
      vsState.room = roomData;
      vsState.role = 'guest';
      vsState.myScore = 0;
      vsState.oppScore = 0;
      vsState.questions = gatherVsQuestions(roomData.subject_id, roomData.chapter_id, roomData.seed);

      var p = vsPlayerInfo();
      var meName = $('vs-me-name');
      var meScore = $('vs-me-score');
      var meAv = $('vs-me-avatar');
      var oppName = $('vs-opp-name');
      var oppScore = $('vs-opp-score');
      var oppAv = $('vs-opp-avatar');
      var oppBadge = $('vs-opp-badge');
      var oppBubble = $('vs-opp-locked-bubble');

      if (meName) meName.textContent = p.name;
      if (meScore) meScore.textContent = '0';
      if (meAv) meAv.textContent = (p.name || 'أ').trim()[0].toUpperCase();

      if (oppName) oppName.textContent = roomData.host_name || 'المضيف';
      if (oppScore) oppScore.textContent = '0';
      if (oppAv) {
        oppAv.style.backgroundImage = '';
        oppAv.className = 'vs-pod-avatar';
        oppAv.textContent = (roomData.host_name || 'م').trim()[0].toUpperCase();
      }
      if (oppBadge) oppBadge.textContent = 'المنافس';
      if (oppBubble) oppBubble.classList.add('hidden');

      for (var i = 0; i < 5; i++) {
        var dot = $('vs-dot-' + i);
        if (dot) dot.className = 'vs-dot' + (i === 0 ? ' is-current' : '');
      }

      window.PortalVS.connectRoom(roomData.room_id, 'guest', p, {
        onStartRound: function (payload) {
          startVsRound(payload.qIndex);
        },
        onOpponentLockedIn: function (payload) {
          handleVsOpponentLockedIn(payload);
        },
        onOpponentReveal: function (payload) {
          handleVsOpponentReveal(payload);
        },
        onPresenceLeave: function () {
          toast('انقطع اتصال المنافس', 'info');
        }
      });

      $('vs-lobby').classList.add('hidden');
      $('vs-arena').classList.remove('hidden');
      window.PortalVS.sendReady(true);
      icons();
    }

    function startVsRound(roundIndex) {
      vsState.roundIndex = roundIndex;
      vsState.myPick = null;
      vsState.oppPick = null;
      vsState.myLockedIn = false;
      vsState.oppLockedIn = false;
      vsState.resolved = false;
      vsState.timeLeftSec = 12;
      vsState.roundStartMs = Date.now();

      var oppBubble = $('vs-opp-locked-bubble');
      var flash = $('vs-round-flash');
      if (oppBubble) oppBubble.classList.add('hidden');
      if (flash) flash.classList.add('hidden');

      for (var i = 0; i < 5; i++) {
        var dot = $('vs-dot-' + i);
        if (dot) {
          if (i === roundIndex) {
            dot.classList.add('is-current');
          } else if (i > roundIndex) {
            dot.className = 'vs-dot';
          }
        }
      }

      var qCount = (vsState.questions && vsState.questions.length) || 5;
      var isFinal = (roundIndex === qCount - 1);
      var pill = $('vs-round-pill');
      if (pill) {
        pill.textContent = isFinal
          ? 'الجولة 5 من 5 (نقاط مضاعفة)'
          : ('الجولة ' + (roundIndex + 1) + ' من ' + qCount);
      }

      var catPill = $('vs-category-pill');
      if (catPill) {
        var catText = 'سؤال تنافسي';
        if (vsState.room && vsState.room.subject_id && vsState.room.subject_id !== 'all' && S.index && S.index.subjects) {
          var sub = S.index.subjects.find(function (s) { return s.subject_id === vsState.room.subject_id; });
          if (sub) catText = sub.subject_title || sub.subject_id;
        }
        catPill.textContent = catText;
      }

      var inlineLangText = $('vs-inline-lang-text');
      if (inlineLangText) {
        inlineLangText.textContent = S.lang === 'en' ? 'عربي' : 'English';
      }

      var q = (vsState.questions && vsState.questions[roundIndex]) || { question: { ar: 'السؤال غير متوفر' }, options: [], answer: 0 };
      var stems = stemPair(q);
      var qStem = $('vs-question-stem');
      if (qStem && stems[0]) qStem.innerHTML = richHtml(stems[0].t);

      var box = $('vs-options-list');
      if (box) {
        box.innerHTML = '';
        var letters = qLetters();
        var opts = (q.options || []);
        opts.forEach(function (o, idx) {
          var btn = document.createElement('button');
          btn.className = 'vs-opt-btn';
          btn.type = 'button';
          btn.setAttribute('role', 'radio');
          btn.setAttribute('aria-checked', 'false');
          var pair = optsPair(q, idx);
          var text = pair[0] ? pair[0].t : '';
          btn.innerHTML = '<span class="vs-opt-letter">' + letters[idx] + '</span><span class="vs-opt-text" dir="auto">' + richHtml(text) + '</span>';
          btn.onclick = function () { onVsPickOption(idx); };
          box.appendChild(btn);
        });
      }

      if (vsState.botTimer) {
        clearTimeout(vsState.botTimer);
        vsState.botTimer = null;
      }
      if (vsState.botStageTimers && vsState.botStageTimers.length) {
        vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
        vsState.botStageTimers = [];
      } else {
        vsState.botStageTimers = [];
      }

      var oppBadge = $('vs-opp-badge');
      var oppPod = $('vs-pod-opp');
      if (oppPod) {
        oppPod.classList.remove('is-reading', 'is-deliberating', 'is-hesitating', 'is-locked', 'is-correct', 'is-wrong');
      }
      if (oppBadge) {
        oppBadge.className = 'vs-pod-tag';
        oppBadge.textContent = (vsState.isBot && vsState.botLegend) ? 'يقرأ' : 'المنافس';
      }

      if (vsState.isBot && window.PortalVSBot && vsState.botLegend) {
        var botDec = window.PortalVSBot.decide(
          vsState.botLegend,
          q,
          roundIndex,
          vsState.myScore,
          vsState.oppScore,
          vsState.botStreak
        );
        vsState.botDecision = botDec;

        if (Array.isArray(botDec.stages)) {
          botDec.stages.forEach(function (st) {
            var botStageTimer = setTimeout(function () {
              if (vsState.resolved || vsState.oppLockedIn) return;
              if (oppBadge && st.text) oppBadge.textContent = st.text;
              if (oppBadge && st.phase) oppBadge.className = 'vs-pod-tag is-' + st.phase;
              if (oppPod) {
                oppPod.classList.remove('is-reading', 'is-deliberating', 'is-hesitating');
                if (st.phase && st.phase !== 'locked') oppPod.classList.add('is-' + st.phase);
              }
            }, st.delayMs);
            vsState.botStageTimers.push(botStageTimer);
          });
        }

        vsState.botTimer = setTimeout(function () {
          if (!vsState.resolved) {
            handleVsOpponentLockedIn({ timeMs: botDec.timeMs });
          }
        }, botDec.timeMs);
      }

      if (vsState.roundTimer) clearInterval(vsState.roundTimer);
      var timerText = $('vs-timer-text');
      var timerCircle = $('vs-timer-svg-circle');
      if (timerText) timerText.textContent = '12';
      if (timerCircle) {
        timerCircle.style.strokeDashoffset = '0';
        timerCircle.style.stroke = 'var(--accent)';
      }

      vsState.roundTimer = setInterval(function () {
        vsState.timeLeftSec--;
        var left = Math.max(0, vsState.timeLeftSec);
        if (timerText) timerText.textContent = String(left);
        if (timerCircle) {
          var fraction = left / 12;
          var offset = 144.5 * (1 - fraction);
          timerCircle.style.strokeDashoffset = String(offset);
          if (left <= 4) {
            timerCircle.style.stroke = 'var(--error, #EF4444)';
          } else if (left <= 7) {
            timerCircle.style.stroke = '#F59E0B';
          } else {
            timerCircle.style.stroke = 'var(--accent)';
          }
        }
        if (left <= 0) {
          clearInterval(vsState.roundTimer);
          vsState.roundTimer = null;
          if (!vsState.myLockedIn) {
            vsState.myLockedIn = true;
            vsState.myPick = -1;
            vsState.myTimeMs = 12000;
            if (!vsState.isBot && window.PortalVS) window.PortalVS.sendLockedIn(12000);
          }
          resolveVsRound();
        }
      }, 1000);
      icons();
    }

    function onVsPickOption(idx) {
      if (vsState.myLockedIn || vsState.resolved) return;
      vsState.myLockedIn = true;
      vsState.myPick = idx;
      vsState.myTimeMs = Math.min(12000, Date.now() - vsState.roundStartMs);

      var box = $('vs-options-list');
      if (box) {
        var btns = box.querySelectorAll('.vs-opt-btn');
        btns.forEach(function (b, i) {
          if (i === idx) b.classList.add('picked');
          b.disabled = true;
        });
      }

      if (!vsState.isBot && window.PortalVS) {
        window.PortalVS.sendLockedIn(vsState.myTimeMs);
      }
      if (vsState.oppLockedIn) {
        resolveVsRound();
      }
    }

    function handleVsOpponentLockedIn(payload) {
      vsState.oppLockedIn = true;
      vsState.oppTimeMs = payload.timeMs || 0;
      var oppBubble = $('vs-opp-locked-bubble');
      if (oppBubble) oppBubble.classList.remove('hidden');
      var oppBadge = $('vs-opp-badge');
      if (oppBadge) {
        oppBadge.textContent = 'جاهز';
        oppBadge.className = 'vs-pod-tag is-locked';
      }
      var oppPod = $('vs-pod-opp');
      if (oppPod) {
        oppPod.classList.remove('is-reading', 'is-deliberating', 'is-hesitating');
        oppPod.classList.add('is-locked');
      }
      if (vsState.myLockedIn) {
        resolveVsRound();
      }
    }

    function resolveVsRound() {
      if (vsState.resolved) return;
      vsState.resolved = true;
      if (vsState.roundTimer) {
        clearInterval(vsState.roundTimer);
        vsState.roundTimer = null;
      }
      if (vsState.botTimer) {
        clearTimeout(vsState.botTimer);
        vsState.botTimer = null;
      }
      if (vsState.botStageTimers && vsState.botStageTimers.length) {
        vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
        vsState.botStageTimers = [];
      }

      var oppBubble = $('vs-opp-locked-bubble');
      if (oppBubble) oppBubble.classList.add('hidden');

      var q = (vsState.questions && vsState.questions[vsState.roundIndex]) || { answer: 0 };
      var isCorrect = (vsState.myPick === q.answer);
      var qCount = (vsState.questions && vsState.questions.length) || 5;
      var isFinal = (vsState.roundIndex === qCount - 1);
      var earned = window.PortalVS ? window.PortalVS.computeScore(isCorrect, vsState.myTimeMs, 12000, isFinal) : 0;
      vsState.myScore += earned;

      var curDot = $('vs-dot-' + vsState.roundIndex);
      if (curDot) {
        curDot.classList.remove('is-current');
        curDot.classList.add(isCorrect ? 'is-correct-dot' : 'is-wrong-dot');
      }

      if (vsState.isBot && vsState.botDecision) {
        var botPick = vsState.botDecision.pickIndex;
        var botIsCorrect = vsState.botDecision.isCorrect;
        var botEarned = window.PortalVS ? window.PortalVS.computeScore(botIsCorrect, vsState.botDecision.timeMs, 12000, isFinal) : 0;
        handleVsOpponentReveal({ pickIndex: botPick, score: botEarned });
        if (botIsCorrect) {
          vsState.botStreak = Math.max(1, vsState.botStreak + 1);
        } else {
          vsState.botStreak = Math.min(-1, vsState.botStreak - 1);
        }
      } else if (window.PortalVS) {
        window.PortalVS.sendReveal(vsState.roundIndex, vsState.myPick, earned, vsState.myTimeMs);
      }

      var box = $('vs-options-list');
      if (box) {
        var btns = box.querySelectorAll('.vs-opt-btn');
        btns.forEach(function (b, i) {
          b.disabled = true;
          if (i === q.answer) b.classList.add('is-correct');
          else if (i === vsState.myPick && !isCorrect) b.classList.add('is-wrong');
        });

        if (typeof vsState.oppPick === 'number' && vsState.oppPick >= 0 && vsState.oppPick < btns.length) {
          var oppB = btns[vsState.oppPick];
          if (oppB) {
            oppB.classList.add('is-opp-picked');
            var oppTag = document.createElement('span');
            oppTag.className = 'vs-opt-opp-indicator';
            var oppName = (vsState.isBot && vsState.botLegend) ? vsState.botLegend.name : 'المنافس';
            oppTag.textContent = oppName;
            oppB.appendChild(oppTag);
          }
        }
      }

      var meScore = $('vs-me-score');
      if (meScore) meScore.textContent = String(vsState.myScore);

      var flash = $('vs-round-flash');
      if (flash) {
        flash.className = 'vs-round-flash ' + (isCorrect ? 'flash-correct' : 'flash-wrong');
        flash.textContent = isCorrect ? ('إجابة صحيحة +' + earned + ' نقطة') : 'إجابة غير صحيحة +0 نقطة';
        flash.classList.remove('hidden');
      }

      var nextRoundTimer = setTimeout(function () {
        clearTimeout(nextRoundTimer);
        if (!vsState.room) return;
        if (vsState.roundIndex < qCount - 1) {
          var nextIdx = vsState.roundIndex + 1;
          if (!vsState.isBot && vsState.role === 'host' && window.PortalVS) {
            window.PortalVS.sendStartRound(nextIdx, Date.now());
          }
          startVsRound(nextIdx);
        } else {
          showVsResult();
        }
      }, 2500);
      vsState.botStageTimers.push(nextRoundTimer);
    }

    function handleVsOpponentReveal(payload) {
      vsState.oppPick = payload.pickIndex;
      vsState.oppScore += (payload.score || 0);

      var oppScore = $('vs-opp-score');
      if (oppScore) oppScore.textContent = String(vsState.oppScore);

      var oppBadge = $('vs-opp-badge');
      var oppPod = $('vs-pod-opp');
      if (oppBadge && vsState.isBot && vsState.botDecision) {
        if (vsState.botDecision.isCorrect) {
          oppBadge.textContent = 'صائب';
          oppBadge.className = 'vs-pod-tag is-correct';
          if (oppPod) {
            oppPod.classList.remove('is-reading', 'is-deliberating', 'is-hesitating', 'is-locked', 'is-wrong');
            oppPod.classList.add('is-correct');
          }
        } else {
          oppBadge.textContent = 'أخطأ';
          oppBadge.className = 'vs-pod-tag is-wrong';
          if (oppPod) {
            oppPod.classList.remove('is-reading', 'is-deliberating', 'is-hesitating', 'is-locked', 'is-correct');
            oppPod.classList.add('is-wrong');
          }
        }
      }
    }

    function setupVsResultActions() {
      var btnRematch = $('vs-btn-rematch');
      if (btnRematch) {
        btnRematch.onclick = function () {
          if (btnRematch.disabled) return;
          btnRematch.disabled = true;
          setTimeout(function () { btnRematch.disabled = false; }, 800);
          if (!vsState.isBot && window.PortalVS) window.PortalVS.leaveRoom();
          if (vsState.botTimer) clearTimeout(vsState.botTimer);
          if (vsState.botStageTimers && vsState.botStageTimers.length) {
            vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
            vsState.botStageTimers = [];
          }
          var prevLegend = vsState.isBot ? vsState.botLegend : null;
          vsState.room = null;
          vsState.isBot = false;
          vsState.botLegend = null;
          $('vs-result').classList.add('hidden');
          if (prevLegend) {
            startVsLegendDuel(prevLegend.id);
          } else {
            $('vs-lobby').classList.remove('hidden');
            setupVsLobby();
          }
        };
      }

      var btnExit = $('vs-btn-exit');
      if (btnExit) {
        btnExit.onclick = function () {
          if (!vsState.isBot && window.PortalVS) window.PortalVS.leaveRoom();
          if (vsState.botTimer) clearTimeout(vsState.botTimer);
          if (vsState.botStageTimers && vsState.botStageTimers.length) {
            vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
            vsState.botStageTimers = [];
          }
          vsState.room = null;
          vsState.isBot = false;
          vsState.botLegend = null;
          $('vs-result').classList.add('hidden');
          $('vs-arena').classList.add('hidden');
          $('vs-waiting').classList.add('hidden');
          $('vs-lobby').classList.remove('hidden');
          if (goHash) goHash('#/');
          else location.hash = '#/';
        };
      }
    }

    function showVsResult() {
      if (vsState.roundTimer) {
        clearInterval(vsState.roundTimer);
        vsState.roundTimer = null;
      }
      if (vsState.botTimer) {
        clearTimeout(vsState.botTimer);
        vsState.botTimer = null;
      }
      if (vsState.botStageTimers && vsState.botStageTimers.length) {
        vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
        vsState.botStageTimers = [];
      }

      if (!vsState.isBot && vsState.role === 'host' && vsState.room && vsState.room.room_id && window.PortalVS) {
        var winnerId = null;
        var p = vsPlayerInfo();
        if (vsState.myScore > vsState.oppScore) winnerId = p.id;
        else if (vsState.oppScore > vsState.myScore) winnerId = vsState.opponent ? vsState.opponent.user_id : null;
        window.PortalVS.finishMatch(vsState.room.room_id, vsState.myScore, vsState.oppScore, winnerId).catch(function () {}); // audit-ignore: finish match best-effort
      }

      var iconEl = $('vs-result-icon');
      var titleEl = $('vs-result-title');
      var subEl = $('vs-result-sub');
      var oppLabel = (vsState.isBot && vsState.botLegend) ? vsState.botLegend.name : 'المنافس';
      if (vsState.myScore > vsState.oppScore) {
        if (titleEl) titleEl.textContent = vsState.isBot ? ('فوز مستحق على ' + oppLabel + '!') : 'فوز مستحق!';
        if (subEl) subEl.textContent = 'أداء استثنائي ودقة وسرعة في الإجابة';
        if (iconEl) iconEl.innerHTML = '<i data-lucide="trophy"></i>';
      } else if (vsState.myScore === vsState.oppScore) {
        if (titleEl) titleEl.textContent = vsState.isBot ? ('تعادل بطولي مع ' + oppLabel + '!') : 'تعادل قوي!';
        if (subEl) subEl.textContent = 'مواجهة متكافئة حتى اللحظة الأخيرة';
        if (iconEl) iconEl.innerHTML = '<i data-lucide="swords"></i>';
      } else {
        if (titleEl) titleEl.textContent = vsState.isBot ? ('تحدٍ قوي أمام ' + oppLabel + '!') : 'تحدٍ قوي!';
        if (subEl) subEl.textContent = oppLabel + ' كان أسرع، جرب مرة أخرى لتنتزع الصدارة';
        if (iconEl) iconEl.innerHTML = '<i data-lucide="target"></i>';
      }

      if (vsState.isBot && vsState.botLegend && window.PortalVSBot && window.PortalVSBot.recordMatchResult) {
        var outcome = (vsState.myScore > vsState.oppScore) ? 'win' : (vsState.myScore < vsState.oppScore ? 'loss' : 'tie');
        var st = window.PortalVSBot.recordMatchResult(vsState.botLegend.id, outcome);
        if (st && subEl) {
          subEl.textContent += ' • المواجهات: ' + st.wins + ' فوز - ' + st.losses + ' خسارة';
        }
        // Invalidate cached league rows so the duel bonus reflects immediately in the League table
        S.leagueRows = null;
        S.leagueStamp = 0;
        S.leagueRowsAllTime = null;
        S.leagueStampAllTime = 0;
      }

      var s1 = $('vs-final-p1-score');
      var s2 = $('vs-final-p2-score');
      if (s1) s1.textContent = String(vsState.myScore);
      if (s2) s2.textContent = String(vsState.oppScore);

      var p2Label = $('vs-final-p2-label');
      if (p2Label) {
        p2Label.textContent = oppLabel;
      }

      setupVsResultActions();

      $('vs-arena').classList.add('hidden');
      $('vs-result').classList.remove('hidden');
      icons();
    }

    function cleanupVsTimers() {
      var botTimer = vsState.botTimer;
      if (botTimer) clearTimeout(botTimer);
      vsState.botTimer = null;
      if (vsState.botStageTimers && vsState.botStageTimers.length) {
        vsState.botStageTimers.forEach(function (botStageTimer) { clearTimeout(botStageTimer); });
        vsState.botStageTimers = [];
      }
      if (vsState.roundTimer) { clearInterval(vsState.roundTimer); vsState.roundTimer = null; }
      if (!vsState.isBot && vsState.room && window.PortalVS && window.PortalVS.leaveRoom) {
        try { window.PortalVS.leaveRoom(); } catch (e) {} // audit-ignore: optional leaveRoom cleanup
      }
      vsState.room = null;
      vsState.isBot = false;
      vsState.botLegend = null;
      vsState.resolved = true;
    }

    return {
      vsState: vsState,
      renderVs: renderVs,
      updateVsLanguage: updateVsLanguage,
      cleanupVsTimers: cleanupVsTimers
    };
  }

  global.PortalVsUI = {
    create: createVsUI
  };
})(window);
