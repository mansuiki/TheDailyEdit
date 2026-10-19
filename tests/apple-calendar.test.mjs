import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAppleCalendar } from '../server/apple-calendar.mjs';
const event = {
  id: 'recurring',
  title: '팀 일정',
  start: '2026-10-20T16:00:00.000Z',
  end: '2026-10-20T17:00:00.000Z',
  allDay: false,
  timezone: 'America/Los_Angeles',
  location: '',
  notes: '준비 자료 확인',
  calendarTitle: '업무',
};
const result = (events) => ({
  status: 'active',
  checkedAt: '2026-10-19T19:00:00.000Z',
  calendarCount: 1,
  events,
});
test('recurring occurrences retain separate IDs, source timezone, and private visibility', () => {
  const data = normalizeAppleCalendar(
    result([
      event,
      {
        ...event,
        start: '2026-10-21T16:00:00.000Z',
        end: '2026-10-21T17:00:00.000Z',
        allDay: true,
      },
    ]),
  );
  assert.notEqual(data.evidence[0].id, data.evidence[1].id);
  assert.equal(data.evidence[0].timezone, event.timezone);
  assert.equal(data.evidence[0].visibility, 'private');
  assert.equal(data.evidence[1].allDay, true);
  assert.match(data.evidence[1].excerpt, /All-day event/);
});
test('denied access is a source failure, distinct from an authorized empty calendar', () => {
  const denied = normalizeAppleCalendar({ status: 'denied', checkedAt: result([]).checkedAt });
  const empty = normalizeAppleCalendar(result([]));
  assert.equal(denied.statuses.applecalendar.ok, false);
  assert.equal(denied.connections.applecalendar.status, 'denied');
  assert.equal(empty.statuses.applecalendar.ok, true);
  assert.equal(empty.evidence.length, 0);
});
test('calendar bridge rejects more than 30 events and malformed dates', () => {
  assert.throws(() => normalizeAppleCalendar(result(Array(31).fill(event))));
  assert.throws(() => normalizeAppleCalendar(result([{ ...event, start: 'not-a-date' }])));
});
