// Run with: node tests/test_league_privacy.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storage = { getItem: () => null };
let account = { id: 'test', name: 'Test' };
const window = {
  PORTAL_SUPABASE: { url: 'https://example.invalid', key: 'test' },
  PortalCloud: { account: () => account, userId: () => 'u:' + account.id }
};
vm.runInNewContext(fs.readFileSync('js/league.js', 'utf8'), {
  window, localStorage: storage, navigator: { onLine: true },
  console, setTimeout, clearTimeout
});

async function runCase(read, expectedHidden, shouldFail) {
  let written = null;
  const query = {
    select() { return this; },
    eq() { return this; },
    maybeSingle() { return typeof read === 'function' ? read() : Promise.resolve(read); },
    upsert(row) { written = row; return Promise.resolve({ error: null }); }
  };
  window.PortalLeague._setClient({ from: () => query });
  if (shouldFail) {
    await assert.rejects(window.PortalLeague.syncWeek());
    assert.equal(written, null, 'failed visibility read must not write a public row');
  } else {
    await window.PortalLeague.syncWeek();
    assert.equal(written.hidden, expectedHidden);
    assert.equal(written.user_id, 'u:' + account.id);
  }
}

(async () => {
  await runCase({ data: { hidden: true }, error: null }, true, false);
  await runCase({ data: { hidden: false }, error: null }, false, false);
  await runCase({ data: null, error: null }, false, false);
  await runCase({ data: null, error: { message: 'read failed' } }, null, true);
  await runCase(() => Promise.reject(new Error('network failure')), null, true);
  assert.equal(window.PortalLeague.userId(), 'u:test');
  account = { id: 'other', name: 'Other' };
  window.PortalLeague.invalidateClient();
  assert.equal(window.PortalLeague.userId(), 'u:other', 'account switch must clear cached id');
  await runCase({ data: { hidden: true }, error: null }, true, false);
  console.log('5 visibility cases and account-switch isolation passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
