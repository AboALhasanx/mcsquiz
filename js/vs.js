/* 1v1 Real-Time Competitive Mode (VS Mode) for MCSQuiz.
 * Powered by Supabase Realtime (Broadcast + Presence) on Elixir/Phoenix WebSockets.
 * Sub-50ms latency, zero database write pressure during live game ticks,
 * deterministic PRNG seeding for identical question permutation, and
 * two-phase reveal to prevent packet sniffing.
 */
(function (global) {
  'use strict';

  var CLIENT_URL = './vendor/npm/supabase-js.js';
  var clientPromise = null;
  var injectedClient = null;
  var currentChannel = null;

  function cfg() {
    var c = global.PORTAL_SUPABASE || {};
    return { url: (c.url || '').trim(), key: (c.key || '').trim() };
  }

  function configured() {
    var c = cfg();
    return !!(c.url && c.key);
  }

  function _setClient(c) {
    injectedClient = c;
    clientPromise = null;
  }

  async function client() {
    if (injectedClient) return injectedClient;
    if (!clientPromise) {
      clientPromise = (async function () {
        var c = cfg();
        if (!c.url || !c.key) throw new Error('not-configured');
        var mod = await import(CLIENT_URL);
        var uid = '';
        try {
          var a = global.PortalCloud && global.PortalCloud.account ? global.PortalCloud.account() : null;
          uid = a ? ('u:' + a.id) : '';
        } catch (e) { // audit-ignore: optional user extraction
          uid = '';
        }
        return mod.createClient(c.url, c.key, { global: { headers: { 'x-portal-user': uid } } });
      })().catch(function (e) {
        clientPromise = null;
        throw e;
      });
    }
    return clientPromise;
  }

  // Deterministic Mulberry32 32-bit PRNG
  function mulberry32(seed) {
    return function () {
      var t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Deterministically selects and shuffles questions according to room seed
  function pickVsQuestions(allQuestions, seed, count) {
    count = count || 5;
    if (!Array.isArray(allQuestions) || allQuestions.length === 0) return [];
    var rng = mulberry32(seed);
    var pool = allQuestions.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var temp = pool[i];
      pool[i] = pool[j];
      pool[j] = temp;
    }
    return pool.slice(0, Math.min(count, pool.length));
  }

  // Speed-based scoring formula: max 1000 pts per regular question, 2000 on final question
  function computeScore(isCorrect, timeTakenMs, totalTimeMs, isFinal) {
    if (!isCorrect) return 0;
    totalTimeMs = totalTimeMs || 12000;
    var ratio = Math.max(0, Math.min(1, (totalTimeMs - timeTakenMs) / totalTimeMs));
    var base = 500 + Math.floor(500 * ratio);
    return isFinal ? base * 2 : base;
  }

  // RPC: Create a new room with 4-digit code
  async function createRoom(subjectId, chapterId, hostId, hostName, hostAvatar) {
    var sb = await client();
    var r = await sb.rpc('portal_create_vs_room', {
      p_subject: subjectId,
      p_chapter: chapterId,
      p_host_id: hostId,
      p_host_name: hostName || 'مضيف',
      p_host_avatar: hostAvatar || ''
    });
    if (r.error) throw new Error(r.error.message || 'create-failed');
    return r.data;
  }

  // RPC: Join room by 4-digit code
  async function joinRoom(code, guestId, guestName, guestAvatar) {
    var sb = await client();
    var r = await sb.rpc('portal_join_vs_room', {
      p_code: String(code).trim(),
      p_guest_id: guestId,
      p_guest_name: guestName || 'ضيف',
      p_guest_avatar: guestAvatar || ''
    });
    if (r.error) throw new Error(r.error.message || 'join-failed');
    return r.data;
  }

  // RPC: Conclude match
  async function finishMatch(roomId, hostScore, guestScore, winnerId) {
    var sb = await client();
    var r = await sb.rpc('portal_finish_vs_match', {
      p_room_id: roomId,
      p_host_score: hostScore,
      p_guest_score: guestScore,
      p_winner_id: winnerId
    });
    if (r.error) throw new Error(r.error.message || 'finish-failed');
    return r.data;
  }

  // Realtime Channel connection
  async function connectRoom(roomId, role, playerInfo, handlers) {
    handlers = handlers || {};
    var sb = await client();
    if (currentChannel) {
      try {
        currentChannel.unsubscribe();
      } catch (e) { // audit-ignore: channel cleanup
        currentChannel = null;
      }
      currentChannel = null;
    }

    var ch = sb.channel('vs_room_' + roomId, {
      config: {
        broadcast: { self: false },
        presence: { key: role }
      }
    });

    ch.on('presence', { event: 'sync' }, function () {
      var state = ch.presenceState();
      if (handlers.onPresenceSync) handlers.onPresenceSync(state);
    });

    ch.on('presence', { event: 'leave' }, function (payload) {
      if (handlers.onPresenceLeave) handlers.onPresenceLeave(payload);
    });

    ch.on('broadcast', { event: 'vs_ready' }, function (msg) {
      if (handlers.onOpponentReady) handlers.onOpponentReady(msg.payload);
    });

    ch.on('broadcast', { event: 'vs_start_round' }, function (msg) {
      if (handlers.onStartRound) handlers.onStartRound(msg.payload);
    });

    ch.on('broadcast', { event: 'vs_locked_in' }, function (msg) {
      if (handlers.onOpponentLockedIn) handlers.onOpponentLockedIn(msg.payload);
    });

    ch.on('broadcast', { event: 'vs_reveal' }, function (msg) {
      if (handlers.onOpponentReveal) handlers.onOpponentReveal(msg.payload);
    });

    ch.on('broadcast', { event: 'vs_reaction' }, function (msg) {
      if (handlers.onOpponentReaction) handlers.onOpponentReaction(msg.payload);
    });

    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') {
        ch.track({
          user_id: playerInfo.id,
          name: playerInfo.name,
          avatar: playerInfo.avatar || '',
          role: role,
          online_at: new Date().toISOString()
        });
        if (handlers.onSubscribed) handlers.onSubscribed(ch);
      }
    });

    currentChannel = ch;
    return ch;
  }

  function sendReady(ready) {
    if (!currentChannel) return;
    currentChannel.send({
      type: 'broadcast',
      event: 'vs_ready',
      payload: { ready: !!ready }
    });
  }

  function sendStartRound(qIndex, timestamp) {
    if (!currentChannel) return;
    currentChannel.send({
      type: 'broadcast',
      event: 'vs_start_round',
      payload: { qIndex: qIndex, timestamp: timestamp || Date.now() }
    });
  }

  function sendLockedIn(timeMs) {
    if (!currentChannel) return;
    currentChannel.send({
      type: 'broadcast',
      event: 'vs_locked_in',
      payload: { timeMs: timeMs }
    });
  }

  function sendReveal(qIndex, pickIndex, score, timeMs) {
    if (!currentChannel) return;
    currentChannel.send({
      type: 'broadcast',
      event: 'vs_reveal',
      payload: { qIndex: qIndex, pickIndex: pickIndex, score: score, timeMs: timeMs }
    });
  }

  function sendReaction(type) {
    if (!currentChannel) return;
    currentChannel.send({
      type: 'broadcast',
      event: 'vs_reaction',
      payload: { type: type }
    });
  }

  function leaveRoom() {
    if (currentChannel) {
      try {
        currentChannel.unsubscribe();
      } catch (e) { // audit-ignore: channel cleanup
        currentChannel = null;
      }
      currentChannel = null;
    }
  }

  global.PortalVS = {
    configured: configured,
    createRoom: createRoom,
    joinRoom: joinRoom,
    finishMatch: finishMatch,
    connectRoom: connectRoom,
    sendReady: sendReady,
    sendStartRound: sendStartRound,
    sendLockedIn: sendLockedIn,
    sendReveal: sendReveal,
    sendReaction: sendReaction,
    leaveRoom: leaveRoom,
    pickVsQuestions: pickVsQuestions,
    computeScore: computeScore,
    mulberry32: mulberry32,
    _setClient: _setClient
  };
})(window);
