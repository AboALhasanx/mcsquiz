// Run with: node tests/test_vs_adaptive.js
//
// Pure-module tests for js/vs_adaptive.js: bounded gradual adjustment between
// matches, cold start, confidence, balance, determinism, malformed input and
// privacy/reset semantics. No browser, storage, network or production data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE_PATH = path.join(__dirname, '..', 'js', 'vs_adaptive.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');
const A = require(SOURCE_PATH);

let checks = 0;
const failures = [];

function check(name, condition, detail) {
  checks++;
  if (!condition) failures.push(name + (detail === undefined ? '' : ' — ' + String(detail)));
}

function close(actual, expected, epsilon) {
  return Math.abs(actual - expected) <= (epsilon === undefined ? 1e-9 : epsilon);
}

function same(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch (e) {
    return false;
  }
}

function isBounded(value, limit) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

function expectUnchanged(name, base, result, reason) {
  check(name + ' reports ' + reason, result.reason === reason, result.reason);
  check(name + ' is not applied', result.applied === false);
  check(name + ' delta is 0', result.delta === 0, result.delta);
  check(name + ' leaves the profile unchanged', same(result.profile, base));
}

// Local seeded PRNG (independent of the module; the module itself has none).
function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LIMITS = A.constants();

// ---------------------------------------------------------------- module surface
check('module exposes createProfile', typeof A.createProfile === 'function');
check('module exposes resetProfile', typeof A.resetProfile === 'function');
check('module exposes recordAggregate', typeof A.recordAggregate === 'function');
check('module exposes difficulty', typeof A.difficulty === 'function');
check('module exposes constants', typeof A.constants === 'function');
check('constants are frozen data', LIMITS.maxOffset === 0.12 && LIMITS.maxStep === 0.03, JSON.stringify(LIMITS));

const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'js/vs_adaptive.js' });
const browserApi = sandbox.window.PortalVSAdaptive;
check('loads in a bare browser-like sandbox with no storage or network',
  !!browserApi && typeof browserApi.recordAggregate === 'function');
if (browserApi) {
  const bare = browserApi.recordAggregate(browserApi.createProfile(), { wins: 3 });
  check('sandbox instance works without any host globals', bare.applied === true);
}

const bannedSources = [
  /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bdocument\.cookie\b/,
  /\bXMLHttpRequest\b/, /\bfetch\s*\(/, /\bnavigator\./, /\bMath\.random\b/,
  /\bDate\.now\b/, /\bnew Date\b/, /\bconsole\./
];
for (const pattern of bannedSources) {
  check('source has no ' + pattern.source, !pattern.test(source));
}
check('source has no credential field or assignment', !/\bpin\s*[:=]|\.pin\b/i.test(source));

// ---------------------------------------------------------------- schema/privacy
const schema = A.createProfile();
check('profile fields are exactly the documented aggregate schema',
  same(Object.keys(schema).sort(),
    ['confidence', 'lastDelta', 'lastReason', 'losses', 'offset', 'samples', 'ties', 'updates', 'version', 'wins']),
  Object.keys(schema).sort().join(','));
for (const bannedKey of ['pin', 'name', 'user', 'userId', 'email', 'account', 'token', 'avatar', 'id']) {
  check('profile has no "' + bannedKey + '" field', !(bannedKey in schema));
}
check('a fresh profile is empty and neutral',
  schema.wins === 0 && schema.losses === 0 && schema.ties === 0 && schema.samples === 0 &&
  schema.offset === 0 && schema.confidence === 0 && schema.updates === 0 &&
  schema.lastDelta === 0 && schema.lastReason === 'init');
check('privacy: unknown aggregate fields are not copied into the profile',
  !('pin' in A.recordAggregate(schema, { wins: 3, pin: '9999', name: 'student' }).profile));

// ---------------------------------------------------------------- cold start
let profile = A.createProfile();
let view = A.difficulty(profile);
check('cold start: no samples, no offset, not ready',
  view.samples === 0 && view.offset === 0 && view.confidence === 0 &&
  view.ready === false && view.tier === 'cold-start');

let r = A.recordAggregate(profile, { wins: 1 });
check('cold start: first win accumulates evidence but does not move the offset',
  r.reason === 'cold-start' && r.applied === false && r.profile.samples === 1 &&
  r.profile.offset === 0 && close(r.profile.confidence, 1 / 12), r.profile.confidence);
r = A.recordAggregate(r.profile, { wins: 1 });
check('cold start: second win still does not move the offset',
  r.reason === 'cold-start' && r.applied === false && r.profile.samples === 2 && r.profile.offset === 0);

r = A.recordAggregate(r.profile, { wins: 1 });
check('cold start ends at the minimum sample count', r.reason === 'updated' && r.profile.samples === 3);
check('first adjustment is small, confidence- and window-scaled',
  close(r.delta, 0.0025) && close(r.profile.offset, 0.0025) &&
  r.delta <= LIMITS.maxStep / 3 + 1e-12 &&
  !close(r.profile.confidence, 1), r.delta + ' / ' + r.profile.confidence);
view = A.difficulty(r.profile);
check('after cold start the view is ready and forming',
  view.ready === true && view.tier === 'forming' && view.confidence === 0.25);

// ---------------------------------------------------------------- repeated wins
profile = A.createProfile();
let previous = A.difficulty(profile);
let seenUpdated = 0;
let seenLimit = 0;
let monotonicUp = true;
let stepsBounded = true;
for (let i = 0; i < 20; i++) {
  const res = A.recordAggregate(profile, { wins: 3 });
  const now = A.difficulty(res.profile);
  if (!(now.offset >= previous.offset)) monotonicUp = false;
  if (Math.abs(now.offset - previous.offset) > LIMITS.maxStep + 1e-12) stepsBounded = false;
  if (res.reason === 'updated') seenUpdated++;
  if (res.reason === 'at-limit') seenLimit++;
  previous = now;
  profile = res.profile;
}
check('repeated wins raise the offset monotonically', monotonicUp);
check('repeated wins stay within one maxStep per call', stepsBounded);
check('repeated wins never exceed maxOffset', isBounded(profile.offset, LIMITS.maxOffset) && close(profile.offset, LIMITS.maxOffset));
check('repeated wins stop at the limit instead of overshooting',
  seenUpdated > 0 && seenLimit > 0 && profile.lastReason !== 'updated');
check('at the limit, further wins still count as evidence',
  profile.samples === 60 && profile.updates === 20);

const atLimit = A.recordAggregate(profile, { wins: 3 });
check('a win at the limit is not applied and reports at-limit',
  atLimit.applied === false && atLimit.reason === 'at-limit' && atLimit.delta === 0);
check('a win at the limit still accumulates samples',
  atLimit.profile.samples === 63 && atLimit.profile.updates === 21 && atLimit.profile.offset === LIMITS.maxOffset);

// ---------------------------------------------------------------- repeated losses
profile = A.createProfile();
previous = 0;
let monotonicDown = true;
for (let i = 0; i < 20; i++) {
  const res = A.recordAggregate(profile, { losses: 3 });
  if (!(res.profile.offset <= previous)) monotonicDown = false;
  if (Math.abs(res.profile.offset - previous) > LIMITS.maxStep + 1e-12) stepsBounded = false;
  previous = res.profile.offset;
  profile = res.profile;
}
check('repeated losses lower the offset monotonically', monotonicDown);
check('repeated losses never fall below -maxOffset', isBounded(profile.offset, LIMITS.maxOffset) && close(profile.offset, -LIMITS.maxOffset));
check('a losing streak never raises the offset (no hidden win-rate target)', profile.offset < 0);

// ---------------------------------------------------------------- balance
profile = A.createProfile();
let balancedOffset = 0;
let balancedDrift = false;
for (let i = 0; i < 20; i++) {
  const res = A.recordAggregate(profile, { wins: 1, losses: 1 });
  if (res.profile.offset !== balancedOffset) balancedDrift = true;
  if (i > 0 && (res.reason !== 'balanced' || res.applied !== false)) balancedDrift = true;
  balancedOffset = res.profile.offset;
  profile = res.profile;
}
check('alternating win/loss windows never move the offset', balancedDrift === false && profile.offset === 0);
check('balanced evidence still builds confidence', profile.samples === 40 && profile.confidence === 1);

const tieOnly = A.recordAggregate(A.recordAggregate(profile, { ties: 3 }).profile, { ties: 3 });
check('tie-only windows are treated as balanced, not as a win or a loss',
  tieOnly.reason === 'balanced' && tieOnly.profile.offset === 0);

// ---------------------------------------------------------------- low-sample safety
const steady = A.recordAggregate(
  A.recordAggregate(
    A.recordAggregate(
      A.recordAggregate(A.createProfile(), { wins: 3 }).profile, { wins: 3 }).profile,
    { wins: 3 }).profile,
  { wins: 3 });
check('four full windows reach steady confidence', steady.profile.samples === 12 && steady.profile.confidence === 1);
const single = A.recordAggregate(steady.profile, { wins: 1 });
check('a single-match window moves at most one third of maxStep',
  single.applied === true && single.delta > 0 &&
  Math.abs(single.delta - LIMITS.maxStep / 3) < 1e-9 && Math.abs(single.delta) < LIMITS.maxStep,
  single.delta);

const winBranch = A.recordAggregate(steady.profile, { wins: 3 });
const lossBranch = A.recordAggregate(steady.profile, { losses: 3 });
check('equal windows move the offset symmetrically in both directions',
  close(winBranch.delta, -lossBranch.delta) && close(winBranch.delta, LIMITS.maxStep));

// ---------------------------------------------------------------- continuity
const baseProfile = A.recordAggregate(A.createProfile(), { wins: 2, losses: 1 }).profile;
const before = JSON.parse(JSON.stringify(baseProfile));
const firstRun = A.recordAggregate(baseProfile, { wins: 2, losses: 1 });
const secondRun = A.recordAggregate(baseProfile, { wins: 2, losses: 1 });
check('same profile and aggregate are deterministic', same(firstRun, secondRun));
check('recordAggregate does not mutate its input', same(baseProfile, before));
check('recordAggregate returns a new profile object', firstRun.profile !== baseProfile);

const frozen = Object.freeze(Object.assign({}, baseProfile));
const frozenResult = A.recordAggregate(frozen, { wins: 1 });
check('a frozen profile can be read without throwing', frozenResult.profile.samples === 4);

const roundTripped = JSON.parse(JSON.stringify(firstRun.profile));
check('a JSON round-trip preserves the difficulty view',
  same(A.difficulty(roundTripped), A.difficulty(firstRun.profile)));
check('a JSON round-trip preserves the next result',
  same(A.recordAggregate(roundTripped, { wins: 1 }), A.recordAggregate(firstRun.profile, { wins: 1 })));

// ---------------------------------------------------------------- malformed input
const invalidAggregates = [
  null, undefined, 42, 'wins', true, [], () => {},
  { wins: NaN }, { wins: Infinity }, { wins: -Infinity }, { wins: -1 }, { wins: -0.001 },
  { wins: 1.5 }, { wins: '3' }, { wins: null }, { wins: true }, { wins: {} },
  { wins: 1e9 }, { losses: 51 }, { ties: Number.MAX_SAFE_INTEGER + 1 },
  { wins: 3, losses: NaN }
];
for (const aggregate of invalidAggregates) {
  let result;
  let threw = false;
  try {
    result = A.recordAggregate(baseProfile, aggregate);
  } catch (e) {
    threw = true;
  }
  const label = 'malformed aggregate ' + (typeof aggregate === 'object' ? JSON.stringify(aggregate) : String(aggregate));
  check(label + ' does not throw', threw === false);
  if (!threw) expectUnchanged(label, baseProfile, result, 'malformed');
}

for (const aggregate of [{}, { wins: 0, losses: 0, ties: 0 }, { correct: 9, answered: 10 }, { matches: 4 }]) {
  const result = A.recordAggregate(baseProfile, aggregate);
  expectUnchanged('question-level/empty input ' + JSON.stringify(aggregate), baseProfile, result, 'no-data');
}

const exactLimit = A.recordAggregate(baseProfile, { wins: LIMITS.maxMatchesPerUpdate });
check('the documented maximum window is accepted', exactLimit.applied === true || exactLimit.reason === 'at-limit');

// ---------------------------------------------------------------- damaged profiles
const damaged = {
  version: 1, wins: 'x', losses: NaN, ties: Infinity,
  offset: 99, confidence: 9, updates: -3, lastDelta: 99, lastReason: 5
};
let damagedView;
let damagedThrew = false;
try {
  damagedView = A.difficulty(damaged);
} catch (e) {
  damagedThrew = true;
}
check('a damaged profile does not throw', damagedThrew === false);
if (!damagedThrew) {
  check('a damaged profile is clamped to the documented bounds',
    isBounded(damagedView.offset, LIMITS.maxOffset) && close(damagedView.offset, LIMITS.maxOffset) &&
    damagedView.confidence === 0 && damagedView.samples === 0 && damagedView.ready === false);
}
const recovered = A.recordAggregate(damaged, { wins: 3 });
check('a damaged profile recovers to finite, bounded values',
  isBounded(recovered.profile.offset, LIMITS.maxOffset) &&
  recovered.profile.samples === 3 &&
  recovered.profile.confidence === 0.25 &&
  Number.isFinite(recovered.profile.lastDelta) &&
  Math.abs(recovered.profile.lastDelta) <= LIMITS.maxStep + 1e-12);
check('difficulty(null) returns safe defaults',
  same(A.difficulty(null), {
    version: 1, offset: 0, confidence: 0, samples: 0, ready: false,
    tier: 'cold-start', lastDelta: 0, lastReason: 'init'
  }));

// ---------------------------------------------------------------- tiers/confidence
profile = A.createProfile();
const confidences = [];
for (let i = 1; i <= 14; i++) {
  const res = A.recordAggregate(profile, { wins: 1 });
  profile = res.profile;
  confidences.push(profile.confidence);
  if (i === 2) check('two matches are still cold-start', A.difficulty(profile).tier === 'cold-start');
  if (i === 3) check('three matches start forming', A.difficulty(profile).tier === 'forming');
  if (i === 12) check('twelve matches reach steady', A.difficulty(profile).tier === 'steady');
}
let confidenceMonotonic = true;
for (let i = 1; i < confidences.length; i++) {
  if (confidences[i] < confidences[i - 1]) confidenceMonotonic = false;
}
check('confidence grows monotonically', confidenceMonotonic);
check('confidence never exceeds 1', confidences.every(c => c <= 1) && confidences[confidences.length - 1] === 1);

// ---------------------------------------------------------------- seeded sequences
function runSeed(seed) {
  const rand = mulberry32(seed);
  let p = A.createProfile();
  let prevOffset = 0;
  let finite = true;
  let bounded = true;
  let gradual = true;
  let consistent = true;
  for (let i = 0; i < 400; i++) {
    const aggregate = {
      wins: Math.floor(rand() * 5),
      losses: Math.floor(rand() * 5),
      ties: Math.floor(rand() * 5)
    };
    if (aggregate.wins + aggregate.losses + aggregate.ties === 0) aggregate.ties = 1;
    const res = A.recordAggregate(p, aggregate);
    const viewNow = A.difficulty(res.profile);
    if (![viewNow.offset, viewNow.confidence, res.profile.lastDelta].every(Number.isFinite)) finite = false;
    if (!isBounded(viewNow.offset, LIMITS.maxOffset) || !isBounded(viewNow.confidence, 1)) bounded = false;
    if (Math.abs(viewNow.offset - prevOffset) > LIMITS.maxStep + 1e-12) gradual = false;
    if (res.profile.samples !== res.profile.wins + res.profile.losses + res.profile.ties) consistent = false;
    prevOffset = viewNow.offset;
    p = res.profile;
  }
  return { profile: p, finite, bounded, gradual, consistent };
}

const seedRun = runSeed(20261113);
check('seeded sequence: every value stays finite', seedRun.finite);
check('seeded sequence: offset and confidence stay bounded', seedRun.bounded);
check('seeded sequence: no step exceeds maxStep', seedRun.gradual);
check('seeded sequence: totals stay consistent with their parts', seedRun.consistent);
check('seeded sequence: the profile remains JSON-serializable and finite',
  Number.isFinite(seedRun.profile.offset) &&
  seedRun.profile.samples === seedRun.profile.wins + seedRun.profile.losses + seedRun.profile.ties);

const replay = runSeed(20261113);
check('seeded sequence: replay from the same seed is identical',
  same(seedRun.profile, replay.profile));

// ---------------------------------------------------------------- reset semantics
const used = A.recordAggregate(A.createProfile(), { wins: 3 }).profile;
const fresh = A.resetProfile();
check('resetProfile returns an empty profile', same(fresh, A.createProfile()));
check('resetProfile shares no reference with the used profile',
  fresh !== used && JSON.stringify(fresh) !== JSON.stringify(used));
check('reset is a complete erase: no old counts or offset survive',
  fresh.wins === 0 && fresh.losses === 0 && fresh.ties === 0 &&
  fresh.offset === 0 && fresh.confidence === 0 && fresh.updates === 0);

// ---------------------------------------------------------------- report
if (failures.length) {
  console.error(`${failures.length} of ${checks} checks failed:`);
  for (const failure of failures) console.error('  FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log(`${checks} checks passed (adaptive difficulty module: bounded, gradual, deterministic, no storage)`);
}
