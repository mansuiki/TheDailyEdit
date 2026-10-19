import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseIdentity } from '../server/identity.mjs';
import { STARTER_PAPER, sectionCatalog } from '../shared/paper.mjs';

const prefs = {
  context: { place: 'San Francisco', activity: 'Building at a hackathon', interests: 'AI agents' },
  topics: ['AI'],
  identity: { mode: 'auto' },
  paper: STARTER_PAPER,
};
const plan = {
  title: 'The Builder Paper',
  description: 'A paper for a hackathon builder.',
  reason: 'The reader is building at a hackathon in San Francisco.',
  sectionOrder: sectionCatalog(STARTER_PAPER).map((s) => s.id),
};
test('a too-long naming explanation gets one strict repair without changing declared context', async () => {
  let calls = 0;
  const identity = await chooseIdentity(prefs, null, async (_prompt, input) => {
    calls++;
    assert.deepEqual(input.context, prefs.context);
    if (calls === 1) return { data: { ...plan, reason: 'x'.repeat(501) } };
    assert.match(input.validationErrors[0], /^reason:/);
    return { data: plan };
  });
  assert.equal(calls, 2);
  assert.equal(identity.reason, plan.reason);
  assert.deepEqual(identity.context, prefs.context);
});
test('invalid naming output stops after one repair with a readable error', async () => {
  let calls = 0;
  await assert.rejects(
    chooseIdentity(prefs, null, async () => {
      calls++;
      return { data: { ...plan, reason: 'x'.repeat(501) } };
    }),
    /could not finish naming your paper/,
  );
  assert.equal(calls, 2);
});
