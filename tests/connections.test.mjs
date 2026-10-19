import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConnections, checkedConnection } from '../server/connections.mjs';
import {
  includePersonalSource,
  missingPersonalSources,
  selectedPersonalSources,
} from '../shared/onboarding.mjs';
import { STARTER_PAPER } from '../shared/paper.mjs';

test('pending authorization keeps its return link while active or failed status never inherits a stale success', () => {
  const pending = { status: 'initiated', url: 'https://connect.composio.dev/link/example' };
  assert.equal(checkedConnection(pending, { status: 'disconnected' }).url, pending.url);
  assert.deepEqual(checkedConnection(pending, { status: 'active' }), { status: 'active' });
  assert.equal(checkedConnection({ status: 'active' }, { status: 'error' }).status, 'error');
});

test('adding an account enables only its page and preserves existing page budgets', () => {
  const prefs = { calendarProvider: 'google', paper: structuredClone(STARTER_PAPER) };
  const mail = includePersonalSource(prefs, 'gmail');
  assert.equal(prefs.paper.sections.inbox, 0);
  assert.equal(mail.paper.sections.inbox, 1);
  const calendar = includePersonalSource(mail, 'applecalendar');
  assert.equal(calendar.calendarProvider, 'apple');
  assert.equal(calendar.paper.sections.calendar, 1);
  assert.equal(calendar.paper.sections.technology, prefs.paper.sections.technology);
  calendar.paper.sections.inbox = 3;
  assert.equal(includePersonalSource(calendar, 'gmail').paper.sections.inbox, 3);
  assert.deepEqual(selectedPersonalSources(calendar), ['gmail', 'applecalendar']);
  assert.deepEqual(
    missingPersonalSources(calendar, {
      gmail: { status: 'active' },
      googlecalendar: { status: 'active' },
    }),
    ['applecalendar'],
  );
  calendar.paper.sections.calendar = 0;
  assert.deepEqual(missingPersonalSources(calendar, { gmail: { status: 'active' } }), []);
  assert.throws(() => includePersonalSource(prefs, 'other'));
});

test('iCloud status remains available when the Cline connection check fails', async () => {
  const states = await checkConnections(['gmail', 'applecalendar'], {
    discover: async () => {
      throw Error('Sign-in expired');
    },
    appleStatus: async () => ({ status: 'active', checkedAt: '2026-10-19T12:00:00.000Z' }),
  });
  assert.equal(states.gmail.status, 'error');
  assert.equal(states.applecalendar.status, 'active');
  assert.equal(states.googlecalendar, undefined);
});

test('checking iCloud alone does not contact Cline and pending/denied access is not connected', async () => {
  for (const status of ['permission_required', 'initiated', 'denied', 'no_icloud']) {
    const states = await checkConnections(['applecalendar'], {
      discover: () => {
        assert.fail('Unexpected Cline connection check');
      },
      appleStatus: async () => ({ status }),
    });
    const prefs = includePersonalSource({ paper: structuredClone(STARTER_PAPER) }, 'applecalendar');
    assert.deepEqual(missingPersonalSources(prefs, states), ['applecalendar']);
  }
});

test('connection checks return only requested services and perform no work for an empty list', async () => {
  const never = () => {
    assert.fail('Unexpected provider call');
  };
  assert.deepEqual(await checkConnections([], { discover: never, appleStatus: never }), {});
  const states = await checkConnections(['gmail'], {
    discover: async () => ({
      toolkit_connection_statuses: [
        { toolkit: 'gmail', has_active_connection: true },
        { toolkit: 'googlecalendar', has_active_connection: true },
      ],
    }),
    appleStatus: never,
  });
  assert.deepEqual(Object.keys(states), ['gmail']);
  assert.equal(states.gmail.status, 'active');
  await assert.rejects(
    checkConnections(['unknown'], { discover: never, appleStatus: never }),
    /Unsupported/,
  );
});
