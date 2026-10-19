import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-edit-first-run-'));
process.env.NEWSROOM_DATA_DIR = dir;
const { state, listPublications } = await import('../server/store.mjs');
const { schedulerReady } = await import('../server/newsroom.mjs');
const { personal, markets } = await import('../server/sources.mjs');
const { collectPersonal } = await import('../server/composio.mjs');
const { publishCurrent, publicationJobs } = await import('../server/editions.mjs');
const { draftSchema } = await import('../server/cline.mjs');
const initial = structuredClone(state);
beforeEach(() => {
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, structuredClone(initial));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const never = async () => {
  throw Error('Unselected source was contacted');
};
test('omitted or null personal relevance copy stays empty without weakening article evidence validation', () => {
  const article = {
    id: 'test',
    title: 'A release',
    summary: 'A tool was released.',
    body: 'A tool was released.',
    topic: 'Tools',
    evidenceIds: ['hn-first'],
  };
  assert.equal(draftSchema.parse(article).whyYou, '');
  assert.equal(draftSchema.parse({ ...article, whyYou: null }).whyYou, '');
  assert.equal(draftSchema.safeParse({ ...article, whyYou: 42 }).success, false);
  assert.equal(draftSchema.safeParse({ ...article, evidenceIds: [] }).success, false);
});
test('fresh storage has no content or declared context and does not start the scheduler', () => {
  assert.equal(state.preferences.autoUpdate, false);
  assert.equal(state.preferences.paper.sections.inbox, 0);
  assert.equal(state.preferences.paper.sections.calendar, 0);
  assert.equal(listPublications().length, 0);
  assert.equal(Object.values(state.sections).flatMap((s) => s.evidence).length, 0);
  assert.ok(Object.values(state.preferences.context).every((v) => v === ''));
  state.preferences.autoUpdate = true;
  assert.equal(schedulerReady(state), false);
  state.issue = { id: 'first-published-issue' };
  assert.equal(schedulerReady(state), true);
});
test('disabled personal and market pages perform no collection or connection discovery', async () => {
  const result = await personal(state.preferences, { collectMail: never, collectCalendar: never });
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.connections, {});
  assert.deepEqual((await markets(state.preferences)).quotes, []);
  assert.deepEqual(
    (await collectPersonal('UTC', { includeMail: false, includeCalendar: false })).evidence,
    [],
  );
});
test('calendar-only selection does not read mail, and a mail failure does not block iCloud', async () => {
  state.preferences.paper.sections.calendar = 1;
  await personal(state.preferences, {
    collectCalendar: never,
    collectMail: async (_tz, opts) => {
      assert.deepEqual(opts, { includeMail: false, includeCalendar: true });
      return { evidence: [], connections: { googlecalendar: { status: 'disconnected' } } };
    },
  });
  state.preferences.calendarProvider = 'apple';
  state.preferences.paper.sections.inbox = 1;
  const result = await personal(state.preferences, {
    collectMail: async () => {
      throw Error('Sign in to Cline');
    },
    collectCalendar: async () => ({
      evidence: [{ id: 'calendar-1' }],
      connections: { applecalendar: { status: 'active' } },
    }),
  });
  assert.equal(result.evidence[0].id, 'calendar-1');
  assert.equal(result.statuses.gmail.ok, false);
});
test('first publication failure is visible and retry creates exactly one durable first issue', async () => {
  state.preferences.paper.sections.world = 0;
  state.preferences.identity = {
    mode: 'manual',
    title: 'The Test Paper',
    description: 'A source-backed test.',
  };
  const collectors = {
    news: async () => ({
      evidence: [
        {
          id: 'hn-first',
          source: 'hn',
          sectionId: 'technology',
          title: 'Release',
          excerpt: 'A tool was released.',
          visibility: 'public',
        },
      ],
    }),
    personal: async () => ({ evidence: [] }),
    markets: async () => ({ evidence: [], quotes: [] }),
  };
  await assert.rejects(
    publishCurrent({
      collectors,
      model: async (_system, input) => {
        if (!input.assignment)
          return {
            data: {
              title: 'The Test Paper',
              description: 'A test.',
              reason: 'Reader choice.',
              sectionOrder: input.sections.map((s) => s.id),
            },
          };
        throw Error('Sign in with cline auth');
      },
    }),
    /cline auth/,
  );
  assert.equal(state.issue, undefined);
  assert.equal(publicationJobs().at(-1).status, 'failed');
  assert.equal(listPublications().length, 0);
  const article = {
    id: 'first-story',
    title: 'A tool arrives',
    summary: 'A supported release.',
    body: 'A tool was released.',
    topic: 'Technology',
    whyYou: '',
    evidenceIds: ['hn-first'],
  };
  const issue = await publishCurrent({
    collectors,
    model: async (_s, input) => ({
      data: !input.assignment
        ? {
            title: 'The Test Paper',
            description: 'A source-backed test.',
            reason: 'The reader chose this title.',
            sectionOrder: input.sections.map((s) => s.id),
          }
        : input.drafts
          ? {
              brief: 'A release.',
              decisions: [
                { draftId: article.id, decision: 'accept', reason: 'Supported.', article },
              ],
            }
          : { drafts: [article] },
      durationMs: 1,
      model: 'test',
    }),
  });
  assert.equal(listPublications().length, 1);
  assert.equal(state.lastDailyDate, issue.issue.date);
  assert.equal(state.issue.identity.title, 'The Test Paper');
  const reload = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "const{state,listPublications}=await import('./server/store.mjs');console.log(JSON.stringify({auto:state.preferences.autoUpdate,title:state.issue.identity.title,count:listPublications().length}));",
    ],
    { cwd: process.cwd(), env: { ...process.env, NEWSROOM_DATA_DIR: dir }, encoding: 'utf8' },
  );
  assert.equal(reload.status, 0, reload.stderr);
  assert.deepEqual(JSON.parse(reload.stdout), { auto: false, title: 'The Test Paper', count: 1 });
});
