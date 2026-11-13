/**
 * MCSQuiz — adaptive virtual-opponent difficulty, evaluated between matches.
 *
 * Scope: pure arithmetic over aggregate match outcomes supplied by the caller.
 * It never sees questions, answers, timing, names, accounts or a PIN, and it
 * performs no browser storage, cookie, network or clock access.
 *
 * Input is one aggregate window (usually the match that just ended):
 *   { wins: n, losses: n, ties: n } — non-negative integers, each <= 50.
 * Every field is optional; a missing field counts as 0. Unknown fields are
 * ignored, so a per-question payload such as { correct, answered } is simply
 * "no outcome data" rather than an error. The profile accumulates the totals
 * and holds one bounded adjustment.
 *
 * Guarantees:
 *   1. Bounds.   The adjustment always stays within +/- maxOffset.
 *   2. Gradual.  One call moves it by at most maxStep, and less while the
 *                evidence base is small (cold start) or the window is short.
 *   3. Cold start. Fewer than minSamples total matches never move it.
 *   4. Balance.  A window whose win/loss signal sits inside neutralBand does
 *                not move it, so alternating results cannot oscillate it.
 *   5. Determinism. The same profile and aggregate always produce the same
 *                result: no randomness, no time, no environment input.
 *
 * What this is not: not a model of the student, not a rating system, and not a
 * prediction. It makes no promise about the student's win rate. It nudges the
 * opponent a little after a match, and the caller is free to ignore the offset.
 *
 * Result reasons: 'updated', 'cold-start', 'balanced', 'at-limit', 'no-data',
 * 'malformed'. A malformed or empty aggregate leaves the profile unchanged.
 *
 * Privacy and reset:
 *   - A profile holds only counts, the bounded offset and its confidence.
 *     It holds no identifier, no timestamp and no free text.
 *   - Nothing is written anywhere. Persisting a profile is the caller's
 *     decision; this module never persists it.
 *   - resetProfile() returns a fresh profile. Dropping the old object is a
 *     complete erase; there is no hidden copy.
 *
 * Integration (later, not part of this change): after a VS match ends, call
 * recordAggregate(profile, { wins, losses, ties }), keep result.profile, and
 * read difficulty(profile).offset when the next opponent's accuracy is chosen.
 * The offset is a suggestion, not a requirement.
 */
(function (global) {
  'use strict';

  var VERSION = 1;

  // Evidence needed before the offset may move at all.
  var MIN_SAMPLES = 3;
  // Matches after which confidence is fully established (linear, capped at 1).
  var CONFIDENCE_SAMPLES = 12;
  // A single aggregate window larger than this is treated as malformed input.
  var MAX_MATCHES_PER_UPDATE = 50;
  // Hard bounds on the suggested adjustment (fraction of opponent accuracy).
  var MAX_OFFSET = 0.12;
  // Hard bound on how far one call may move the adjustment.
  var MAX_STEP = 0.03;
  // Win/loss signal inside this band is treated as even and moves nothing.
  var NEUTRAL_BAND = 0.2;

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function isCount(v) {
    return isFiniteNumber(v) && v >= 0 && v === Math.floor(v);
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // Six decimals keep the profile stable across JSON round-trips.
  function round6(v) {
    return Math.round(v * 1000000) / 1000000;
  }

  function confidenceFor(samples) {
    return Math.min(1, samples / CONFIDENCE_SAMPLES);
  }

  function createProfile() {
    return {
      version: VERSION,
      wins: 0,
      losses: 0,
      ties: 0,
      samples: 0,
      offset: 0,
      confidence: 0,
      updates: 0,
      lastDelta: 0,
      lastReason: 'init'
    };
  }

  function resetProfile() {
    return createProfile();
  }

  // Counts from a stored profile; anything implausible becomes 0.
  function storedCount(v) {
    return isCount(v) && v <= 9007199254740991 ? v : 0;
  }

  // Rebuild a profile from untrusted input, clamping every numeric field.
  // Totals are re-derived from the outcome counts so confidence cannot be
  // inflated independently of the evidence.
  function normalizeProfile(raw) {
    var p = createProfile();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return p;

    p.wins = storedCount(raw.wins);
    p.losses = storedCount(raw.losses);
    p.ties = storedCount(raw.ties);
    p.samples = p.wins + p.losses + p.ties;
    p.offset = isFiniteNumber(raw.offset) ? round6(clamp(raw.offset, -MAX_OFFSET, MAX_OFFSET)) : 0;
    p.confidence = confidenceFor(p.samples);
    p.updates = storedCount(raw.updates);
    p.lastDelta = isFiniteNumber(raw.lastDelta) ? round6(clamp(raw.lastDelta, -MAX_STEP, MAX_STEP)) : 0;
    p.lastReason = typeof raw.lastReason === 'string' && raw.lastReason ? raw.lastReason : 'init';
    return p;
  }

  function cloneProfile(p) {
    return {
      version: VERSION,
      wins: p.wins,
      losses: p.losses,
      ties: p.ties,
      samples: p.samples,
      offset: p.offset,
      confidence: p.confidence,
      updates: p.updates,
      lastDelta: p.lastDelta,
      lastReason: p.lastReason
    };
  }

  // Returns null when the aggregate is not usable match-level data.
  function parseAggregate(aggregate) {
    if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)) return null;

    var out = { wins: 0, losses: 0, ties: 0 };
    var keys = ['wins', 'losses', 'ties'];
    for (var i = 0; i < keys.length; i++) {
      var value = aggregate[keys[i]];
      if (value === undefined) continue;
      if (!isCount(value) || value > MAX_MATCHES_PER_UPDATE) return null;
      out[keys[i]] = value;
    }
    return out;
  }

  function updateResult(profile, applied, reason, delta) {
    return { profile: profile, applied: applied, reason: reason, delta: delta };
  }

  /**
   * Record one aggregate window of completed matches and return a new profile.
   * Never mutates the input and never throws: unusable input is reported as
   * 'malformed' or 'no-data' with the profile returned unchanged.
   *
   * @param {object} profile   profile from createProfile()/this function
   * @param {object} aggregate { wins, losses, ties } since the last call
   * @returns {{profile: object, applied: boolean, reason: string, delta: number}}
   */
  function recordAggregate(profile, aggregate) {
    var base = normalizeProfile(profile);
    var parsed = parseAggregate(aggregate);
    if (!parsed) return updateResult(base, false, 'malformed', 0);

    var played = parsed.wins + parsed.losses + parsed.ties;
    if (played === 0) return updateResult(base, false, 'no-data', 0);

    var next = cloneProfile(base);
    next.wins = base.wins + parsed.wins;
    next.losses = base.losses + parsed.losses;
    next.ties = base.ties + parsed.ties;
    next.samples = next.wins + next.losses + next.ties;
    next.confidence = confidenceFor(next.samples);
    next.updates = base.updates + 1;
    next.lastDelta = 0;

    // Cold start: evidence is accumulating but the opponent stays put.
    if (next.samples < MIN_SAMPLES) {
      next.lastReason = 'cold-start';
      return updateResult(next, false, 'cold-start', 0);
    }

    // Signal in [-1, 1]: +1 all wins, -1 all losses, ties pull it to 0.
    var signal = (parsed.wins - parsed.losses) / played;
    if (Math.abs(signal) <= NEUTRAL_BAND) {
      next.lastReason = 'balanced';
      return updateResult(next, false, 'balanced', 0);
    }

    var strength = (Math.abs(signal) - NEUTRAL_BAND) / (1 - NEUTRAL_BAND);
    var support = Math.min(1, played / MIN_SAMPLES);
    var step = Math.min(MAX_STEP, MAX_STEP * next.confidence * strength * support);
    var direction = signal > 0 ? 1 : -1;
    var target = round6(clamp(base.offset + direction * step, -MAX_OFFSET, MAX_OFFSET));

    next.offset = target;
    next.lastDelta = round6(target - base.offset);

    if (next.lastDelta === 0) {
      next.lastReason = 'at-limit';
      return updateResult(next, false, 'at-limit', 0);
    }
    next.lastReason = 'updated';
    return updateResult(next, true, 'updated', next.lastDelta);
  }

  /**
   * Read-only view for the caller. Safe on null or corrupted profiles.
   *
   * @param {object} profile
   * @returns {{version: number, offset: number, confidence: number,
   *            samples: number, ready: boolean, tier: string,
   *            lastDelta: number, lastReason: string}}
   */
  function difficulty(profile) {
    var p = normalizeProfile(profile);
    var tier;
    if (p.samples < MIN_SAMPLES) tier = 'cold-start';
    else if (p.samples < CONFIDENCE_SAMPLES) tier = 'forming';
    else tier = 'steady';

    return {
      version: VERSION,
      offset: p.offset,
      confidence: p.confidence,
      samples: p.samples,
      ready: p.samples >= MIN_SAMPLES,
      tier: tier,
      lastDelta: p.lastDelta,
      lastReason: p.lastReason
    };
  }

  function constants() {
    return {
      minSamples: MIN_SAMPLES,
      confidenceSamples: CONFIDENCE_SAMPLES,
      maxMatchesPerUpdate: MAX_MATCHES_PER_UPDATE,
      maxOffset: MAX_OFFSET,
      maxStep: MAX_STEP,
      neutralBand: NEUTRAL_BAND
    };
  }

  var api = {
    version: VERSION,
    createProfile: createProfile,
    resetProfile: resetProfile,
    recordAggregate: recordAggregate,
    difficulty: difficulty,
    constants: constants
  };

  global.PortalVSAdaptive = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
