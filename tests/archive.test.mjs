import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-edit-archive-test-'));
process.env.NEWSROOM_DATA_DIR = temp;
const { state, snapshot, editions, listPublications, readPublication } =
  await import('../server/store.mjs');
const { archivePublication } = await import('../server/archive.mjs');
const { buildDemoEdition, createDemoEdition, KOREA_DEMO_ID } =
  await import('../server/demo-edition.mjs');
const { assemblePages } = await import('../shared/paper.mjs');
const { localDate, dateWindow, readingState } = await import('../shared/edition.mjs');
const initial = structuredClone(state);
beforeEach(() => Object.assign(state, structuredClone(initial)));
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('the Korea fixture is explicitly fictional, has only three pages, and carries its historical local date separately from generation time', () => {
  const generatedAt = '2026-10-20T00:30:00.000Z';
  const fixture = buildDemoEdition(generatedAt);
  assert.equal(fixture.issue.kind, 'demo');
  assert.equal(fixture.issue.date, '2026-10-12');
  assert.equal(fixture.issue.timezone, 'Asia/Seoul');
  assert.equal(fixture.issue.publishedAt, generatedAt);
  assert.equal(fixture.issue.window.start, '2026-10-11T15:00:00.000Z');
  assert.equal(fixture.issue.window.end, '2026-10-12T15:00:00.000Z');
  assert.deepEqual(fixture.issue.identity.context, {
    place: 'South Korea',
    activity: '',
    interests: '',
  });
  assert.deepEqual(
    assemblePages(fixture).map((p) => p.id),
    ['front', 'inbox-1', 'calendar-1'],
  );
  assert.ok(
    fixture.sections.personal.evidence.every(
      (e) => e.demo && e.source === 'demo' && e.sourceLabel.includes('fictional'),
    ),
  );
  assert.ok(
    fixture.sections.personal.articles.every(
      (a) => a.demo && a.versions.length === 0 && a.review.length === 0,
    ),
  );
  assert.equal(fixture.sections.news.evidence.length, 0);
  assert.equal(fixture.sections.markets.articles.length, 0);
  assert.deepEqual(fixture.quotes, []);
  assert.deepEqual(fixture.connections, {});
  assert.equal(fixture.preferences.autoUpdate, false);
  assert.match(
    fixture.issue.coverage.notes.join(' '),
    /No historical Gmail or iCloud records were retrieved/,
  );
});

test('explicit demo creation is idempotent and leaves all current state and schedules untouched', () => {
  const before = JSON.stringify(state);
  const first = createDemoEdition();
  const again = createDemoEdition();
  assert.equal(first.issue.id, KOREA_DEMO_ID);
  assert.deepEqual(first, again);
  assert.equal(listPublications().filter((e) => e.id === KOREA_DEMO_ID).length, 1);
  assert.equal(JSON.stringify(state), before);
  const opened = readPublication(KOREA_DEMO_ID);
  opened.preferences.timezone = 'America/Los_Angeles';
  opened.sections.personal.articles[0].title = 'Attempted local change';
  assert.equal(readPublication(KOREA_DEMO_ID).preferences.timezone, 'Asia/Seoul');
  assert.notEqual(
    readPublication(KOREA_DEMO_ID).sections.personal.articles[0].title,
    'Attempted local change',
  );
});

test('saved layout, context, source text and prices are detached from subsequent current-state changes', () => {
  const view = buildDemoEdition('2026-10-19T18:00:00.000Z');
  view.issue.id = `issue-${randomUUID()}`;
  view.quotes = [{ symbol: 'TEST', price: 42, observedAt: '2026-10-12T01:00:00.000Z' }];
  const saved = archivePublication(view);
  const original = JSON.stringify(saved);
  Object.assign(state, {
    preferences: view.preferences,
    sections: view.sections,
    quotes: view.quotes,
    issue: view.issue,
  });
  state.preferences.timezone = 'America/Los_Angeles';
  state.preferences.paper.sections.technology = 4;
  state.preferences.context.place = 'San Francisco';
  state.issue.identity.title = 'A later name';
  state.sections.personal.articles[0].title = 'Current news';
  state.sections.personal.evidence[0].excerpt = 'Changed source record';
  state.quotes[0].price = 999;
  const reopened = readPublication(saved.issue.id);
  assert.equal(JSON.stringify(reopened), original);
  assert.equal(reopened.issue.identity.title, 'The Korea Brief');
  assert.equal(reopened.issue.date, '2026-10-12');
  assert.equal(reopened.quotes[0].price, 42);
  assert.equal(reopened.preferences.timezone, 'Asia/Seoul');
  assert.deepEqual(
    assemblePages(reopened).map((p) => p.id),
    ['front', 'inbox-1', 'calendar-1'],
  );
  assert.equal(readingState(reopened), reopened);
  assert.throws(() => archivePublication(reopened), /UNIQUE/);
});

test('completed issues survive the twenty-checkpoint pruning policy', () => {
  const ids = [];
  for (let i = 0; i < 24; i++) {
    const view = buildDemoEdition(`2026-10-19T18:00:${String(i).padStart(2, '0')}.000Z`);
    view.issue.id = `issue-${randomUUID()}`;
    archivePublication(view);
    ids.push(view.issue.id);
    state.edition = i + 1;
    snapshot();
  }
  assert.equal(editions().length, 20);
  assert.ok(listPublications().length >= 24);
  assert.ok(ids.every((id) => readPublication(id)?.issue.id === id));
});

test('archive local dates stay correct across Seoul midnight and DST transitions', () => {
  assert.equal(localDate('2026-10-11T15:00:00.000Z', 'Asia/Seoul'), '2026-10-12');
  assert.equal(localDate('2026-10-11T14:59:59.999Z', 'Asia/Seoul'), '2026-10-11');
  const fallBack = dateWindow('2026-11-01', '2026-11-01', 'America/Los_Angeles');
  assert.equal((Date.parse(fallBack.end) - Date.parse(fallBack.start)) / 3600000, 25);
  const springForward = dateWindow('2026-03-08', '2026-03-08', 'America/Los_Angeles');
  assert.equal((Date.parse(springForward.end) - Date.parse(springForward.start)) / 3600000, 23);
  assert.throws(() => dateWindow('2026-02-30', '2026-02-30', 'Asia/Seoul'));
});
