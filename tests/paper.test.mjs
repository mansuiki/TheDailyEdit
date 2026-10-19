import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PAPER, buildAssignments, assemblePages, relatedItems } from '../shared/paper.mjs';
import {
  preferencesSchema,
  validateProposal,
  preferenceFingerprint,
} from '../server/preferences.mjs';
import { departurePlan, routeRequestSchema, routeMapFile } from '../server/routes.mjs';
const prefs = {
  topics: ['AI'],
  instructions: 'Factual reporting.',
  region: 'US',
  calendarProvider: 'apple',
  timezone: 'America/Los_Angeles',
  coins: ['BTC'],
  stocks: ['AAPL'],
  sourceEnabled: { hn: true, google: true, bbc: true },
  autoUpdate: true,
  intervals: { news: 900, personal: 300, markets: 60 },
  dailyTime: '08:00',
  paper: structuredClone(DEFAULT_PAPER),
  feedback: [{ articleId: 'private-feedback' }],
};
test('every enabled source is assigned exactly once; hidden sections do not get reporters', () => {
  const evidence = Array.from({ length: 50 }, (_, i) => ({
    id: `source-${i}`,
    sectionId: i < 36 ? 'technology' : 'world',
  }));
  evidence.push({ id: 'culture-hidden', sectionId: 'culture' });
  const jobs = buildAssignments('news', evidence, prefs.paper);
  const ids = jobs.flatMap((j) => j.evidence.map((e) => e.id));
  assert.equal(ids.length, 50);
  assert.equal(new Set(ids).size, 50);
  assert.equal(jobs.length, 4);
  assert.ok(!ids.includes('culture-hidden'));
  assert.ok(jobs.every((j) => j.targetArticles <= 3));
});
test('folio allocation preserves article assignment and does not duplicate stories on inside pages', () => {
  const articles = Array.from({ length: 6 }, (_, i) => ({
    id: `article-${i}`,
    desk: 'news',
    sectionId: 'technology',
    pageInSection: i < 3 ? 1 : 2,
  }));
  const state = {
    preferences: prefs,
    sections: {
      news: { articles, evidence: [], status: 'published' },
      personal: { articles: [], evidence: [] },
      markets: { articles: [], evidence: [] },
    },
  };
  const pages = assemblePages(state);
  assert.equal(pages.length, 10);
  assert.deepEqual(
    pages.filter((p) => p.sectionId === 'technology').map((p) => p.folio),
    ['B1', 'B2'],
  );
  assert.equal(pages.slice(1).flatMap((p) => p.articles).length, 6);
});
test('natural-language settings are validated and cannot change connector choice, inject credentials or exceed the page budget', () => {
  const proposed = validateProposal(
    {
      summary: 'More room for science.',
      changes: ['Science gets two pages.'],
      patch: { paper: { ...prefs.paper, sections: { ...prefs.paper.sections, science: 2 } } },
    },
    prefs,
  );
  assert.equal(proposed.preferences.paper.sections.science, 2);
  assert.equal(proposed.preferences.calendarProvider, 'apple');
  assert.equal(proposed.preferences.dailyTime, '08:00');
  assert.equal(proposed.baseFingerprint, preferenceFingerprint(prefs));
  assert.equal(proposed.preferences.feedback, undefined);
  assert.throws(() =>
    validateProposal(
      { summary: 'x', changes: ['x'], patch: { calendarProvider: 'google' } },
      prefs,
    ),
  );
  assert.throws(() =>
    validateProposal({ summary: 'x', changes: ['x'], patch: { apiKey: 'x' } }, prefs),
  );
  assert.throws(() =>
    preferencesSchema.parse({
      ...proposed.preferences,
      paper: {
        ...prefs.paper,
        sections: Object.fromEntries(Object.keys(prefs.paper.sections).map((k) => [k, 4])),
      },
    }),
  );
});
test('an instructions-only proposal preserves customized page counts and schedules', () => {
  const custom = {
    ...prefs,
    paper: { ...prefs.paper, depth: 'deep', sections: { ...prefs.paper.sections, science: 3 } },
  };
  const result = validateProposal(
    {
      summary: 'Focus on practical coverage.',
      changes: ['Update the editorial instructions.'],
      patch: { instructions: 'Prioritize practical developer stories.' },
    },
    custom,
  );
  assert.deepEqual(result.preferences.paper, custom.paper);
  assert.deepEqual(result.preferences.intervals, custom.intervals);
  assert.throws(() =>
    validateProposal({ summary: 'No change.', changes: ['None'], patch: {} }, custom),
  );
});
test('related public stories never expose personal records; weak topical matches are labeled more from the section', () => {
  const article = {
    id: 'a',
    title: 'OpenBSD Wine compatibility proposal',
    topic: 'Systems',
    desk: 'news',
    sectionId: 'technology',
    evidenceIds: ['hn-1'],
  };
  const privateStory = { ...article, id: 'private', desk: 'personal', sectionId: 'inbox' };
  const related = relatedItems(
    article,
    [article, privateStory, { ...article, id: 'b', title: 'OpenBSD Wine build advances' }],
    [{ id: 'secret', title: article.title, visibility: 'private' }],
  );
  assert.deepEqual(
    related.articles.map((r) => r.article.id),
    ['b'],
  );
  assert.equal(related.sources.length, 0);
});
test('calendar departure time accounts for route duration and buffer across midnight', () => {
  const plan = departurePlan(1800, '2026-10-20T00:15:00.000Z', 15);
  assert.equal(plan.leaveBy, '2026-10-19T23:30:00.000Z');
  assert.throws(() =>
    routeRequestSchema.parse({ origin: 'x', destination: 'y', mode: 'teleport' }),
  );
  assert.equal(routeMapFile('../../secret'), null);
});
