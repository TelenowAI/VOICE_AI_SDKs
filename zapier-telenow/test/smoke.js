// Live smoke against a running Telenow API (default: local dev).
//
//   TELENOW_BASE_URL=http://localhost:3005 TELENOW_API_KEY=vai_live_… node test/smoke.js
//
// Exercises: auth test, sample-backed performList for every hook trigger,
// the REST-hook subscribe/unsubscribe cycle, dropdown triggers, and the
// find-calls search. Deliberately does NOT run creates.initiate_call —
// that would place a real PSTN call.

const zapier = require('zapier-platform-core');
const App = require('../index');

const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const authData = {
  api_key: process.env.TELENOW_API_KEY || 'vai_live_smoketest_integration_0075',
  base_url: process.env.TELENOW_BASE_URL || 'http://localhost:3005',
};

const ok = (label) => console.log(`  ✓ ${label}`);

(async () => {
  console.log(`Smoking against ${authData.base_url}`);

  const me = await appTester(App.authentication.test, { authData });
  if (!me.org_id) throw new Error('auth test returned no org_id');
  ok(`auth test → org "${me.org_name}" (key ${me.key_name})`);

  for (const key of ['call_ended', 'call_started', 'call_analyzed', 'recording_ready', 'tool_invoked']) {
    const rows = await appTester(App.triggers[key].operation.performList, { authData });
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${key} performList empty`);
    ok(`${key} performList → ${rows.length} sample(s)`);
  }

  const sub = await appTester(App.triggers.call_ended.operation.performSubscribe, {
    authData,
    targetUrl: 'https://hooks.zapier.com/hooks/catch/000000/smoketest',
    inputData: { include_transcript: true },
  });
  if (!sub.id) throw new Error('subscribe returned no id');
  ok(`performSubscribe → hook ${sub.id} (source=${sub.source})`);

  const fired = await appTester(App.triggers.call_ended.operation.perform, {
    authData,
    cleanedRequest: { event: 'call.ended', sessionId: 'x', durationSecs: 1 },
  });
  if (!Array.isArray(fired) || fired[0].event !== 'call.ended') throw new Error('perform mapping broken');
  ok('perform → maps inbound body to one Zap run');

  await appTester(App.triggers.call_ended.operation.performUnsubscribe, {
    authData,
    subscribeData: sub,
  });
  ok('performUnsubscribe → done (idempotent server-side)');

  const agents = await appTester(App.triggers.agent_list.operation.perform, { authData });
  ok(`agent_list → ${agents.length} agent(s): ${agents.map((a) => a.name).join(', ')}`);

  const numbers = await appTester(App.triggers.number_list.operation.perform, { authData });
  ok(`number_list → ${numbers.length} number(s)`);

  const calls = await appTester(App.searches.find_calls.operation.perform, {
    authData,
    inputData: { limit: 3 },
  });
  if (!Array.isArray(calls)) throw new Error('find_calls did not return an array');
  ok(`find_calls → ${calls.length} call(s)`);

  console.log('\nAll smoke checks passed.');
})().catch((e) => {
  console.error('\nSMOKE FAILED:', e.message);
  process.exit(1);
});
