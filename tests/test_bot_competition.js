// Run with: node tests/test_bot_competition.js
// Pure simulation checks for the virtual opponent; no browser, no storage, no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadBot(seed) {
  const MathShim = Object.create(Math);
  MathShim.random = seeded(seed);
  const sandbox = { window: {}, Math: MathShim, console };
  vm.runInNewContext(fs.readFileSync('js/vs_bot.js', 'utf8'), sandbox);
  return sandbox.window.PortalVSBot;
}

const QUESTION = {
  question: 'Which statement is correct?',
  options: ['alpha', 'beta', 'gamma', 'delta'],
  answer: 0
};

function accuracyRate(bot, legendId, round, myScore, oppScore, draws) {
  const legend = bot.getLegend(legendId);
  let correct = 0;
  for (let i = 0; i < draws; i++) {
    if (bot.decide(legend, QUESTION, round, myScore, oppScore, 0).isCorrect) correct++;
  }
  return correct / draws;
}

const bot = loadBot(20261113);

// 1. No accuracy cliff as the score gap crosses any single-answer threshold.
// The old step rules jumped 8-9 accuracy points the moment one answer crossed a
// threshold. A continuous curve must never show a jump of that size.
const gaps = [];
for (let gap = -2100; gap <= 2100; gap += 300) gaps.push(gap);
const rates = gaps.map(gap => accuracyRate(bot, 'cristiano', 2, 3000, 3000 + gap, 9000));
let maxJump = 0;
for (let i = 1; i < rates.length; i++) maxJump = Math.max(maxJump, Math.abs(rates[i] - rates[i - 1]));
assert.ok(maxJump < 0.06, `gap adjustment must be continuous, saw ${maxJump.toFixed(4)} jump`);
console.log(`PASS score-gap adjustment is continuous (max step ${maxJump.toFixed(4)})`);

// 2. Clutch no longer flattens every accurate legend onto one ceiling.
const maldini4 = accuracyRate(bot, 'maldini', 3, 3000, 3000, 6000);
const cristiano4 = accuracyRate(bot, 'cristiano', 3, 3000, 3000, 6000);
assert.ok(Math.abs(maldini4 - cristiano4) > 0.01,
  `deciding round must keep archetypes distinct: ${maldini4.toFixed(3)} vs ${cristiano4.toFixed(3)}`);
assert.ok(Math.max(maldini4, cristiano4) < 0.95,
  `no legend should pin the ceiling: ${Math.max(maldini4, cristiano4).toFixed(3)}`);
console.log(`PASS deciding round keeps legends distinct (${maldini4.toFixed(3)} vs ${cristiano4.toFixed(3)})`);

// 3. Bounds and timing invariants hold for every legend in every round.
for (const legend of bot.getLegends()) {
  for (let round = 0; round < 5; round++) {
    const rate = accuracyRate(bot, legend.id, round, 0, 0, 1500);
    assert.ok(rate > 0.3 && rate < 0.97, `${legend.id} round ${round} rate ${rate}`);
    const decision = bot.decide(legend, QUESTION, round, 0, 0, 0);
    assert.ok(decision.timeMs >= 3400 && decision.timeMs <= 10200, 'time inside the human window');
    assert.ok(decision.pickIndex >= 0 && decision.pickIndex < 4, 'pick inside the options');
    assert.equal(decision.isCorrect, decision.pickIndex === QUESTION.answer);
  }
}
console.log('PASS all legends stay inside accuracy and timing bounds');

// 4. Only genuine negation markers penalise the opponent.
const negation = [
  ['Which of these is NOT one of the five properties of a secure system?', true],
  ['Where can cybersecurity not be kept?', true],
  ['Which one is not a category of maintenance ?', true],
  ['A traffic flood makes a website unreachable for six hours.', false],
  ['The bank finds a program error and fixes it afterwards.', false],
  ['Which common belief about threats is wrong?', true]
];
for (const [stem, expected] of negation) {
  const decision = bot.decide(bot.getLegend('ronaldinho'),
    { question: stem, options: ['a', 'b', 'c', 'd'], answer: 0 }, 0, 0, 0, 0);
  assert.equal(decision.isNegation, expected, stem);
}
console.log('PASS only genuine negation wording is treated as a trap');
