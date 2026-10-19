import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-me-test-'));
process.env.NEWSROOM_DATA_DIR = temp;
const { state } = await import('../server/store.mjs');
const { refreshSection, publicState, mergeEvidence, mergeQuotes, dailyEditionKey } =
  await import('../server/newsroom.mjs');
const { validateReadTool } = await import('../server/composio.mjs');
const initial = structuredClone(state);
beforeEach(() => {
  Object.assign(state, structuredClone(initial));
});
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const evidence = [
  {
    id: 'hn-1',
    source: 'hn',
    title: 'Verified source',
    excerpt: 'A supported fact.',
    contentStatus: 'excerpt',
    fetchedAt: '2026-10-19T10:00:00Z',
  },
];
const article = {
  id: 'draft-1',
  title: '검증된 기사',
  summary: '근거에 맞는 요약입니다.',
  whyYou: '독자에게 유용합니다.',
  body: '근거에 있는 사실입니다.',
  topic: '테크',
  evidenceIds: ['hn-1'],
};
const wrap = (data) => ({ data, model: 'test-model', durationMs: 1, usage: {} });
const accept = (a = article) => ({
  brief: '편집 완료',
  decisions: [
    { draftId: a.id, decision: 'accept', reason: '근거와 일치', requestedChanges: '', article: a },
  ],
});
test('reporter → revision → final editor publishes once and preserves other desks', async () => {
  state.sections.markets.articles = [{ id: 'market-existing', title: '기존 시장 기사' }];
  const untouched = JSON.stringify(state.sections.markets);
  let calls = 0;
  const revised = { ...article, title: '수정된 기사' };
  const outputs = [
    { drafts: [article] },
    {
      brief: '수정 필요',
      decisions: [
        {
          draftId: article.id,
          decision: 'revise',
          reason: '제목 개선',
          requestedChanges: '제목을 명확히 하세요.',
          article: null,
        },
      ],
    },
    { drafts: [revised] },
    accept(revised),
  ];
  await refreshSection('news', {
    force: true,
    services: { collect: async () => ({ evidence }), model: async () => wrap(outputs[calls++]) },
  });
  assert.equal(calls, 4);
  assert.equal(state.sections.news.status, 'published');
  assert.equal(state.sections.news.articles[0].title, '수정된 기사');
  assert.equal(state.sections.news.articles[0].versions.length, 3);
  assert.equal(state.sections.news.review.length, 2);
  assert.equal(JSON.stringify(state.sections.markets), untouched);
});
test('unsupported evidence IDs fail closed and retain the last published articles', async () => {
  state.sections.news.articles = [{ id: 'previous', title: '이전 정상 기사' }];
  await refreshSection('news', {
    force: true,
    services: {
      collect: async () => ({ evidence }),
      model: async () => wrap({ drafts: [{ ...article, evidenceIds: ['made-up-id'] }] }),
    },
  });
  assert.equal(state.sections.news.status, 'error');
  assert.equal(state.sections.news.articles[0].id, 'previous');
  assert.match(state.sections.news.error, /source/);
});
test('a revision of one draft does not recommission already accepted stories', async () => {
  const second = {
    ...article,
    id: 'draft-2',
    title: 'A second source-backed angle',
    evidenceIds: ['hn-2'],
  };
  let calls = 0;
  await refreshSection('news', {
    force: true,
    services: {
      collect: async () => ({ evidence: [...evidence, { ...evidence[0], id: 'hn-2' }] }),
      model: async (_system, input) => {
        calls++;
        if (calls === 1) return wrap({ drafts: [article, second] });
        if (calls === 2)
          return wrap({
            brief: 'One precise revision.',
            decisions: [
              { draftId: article.id, decision: 'accept', reason: 'Supported.', article },
              {
                draftId: second.id,
                decision: 'revise',
                reason: 'Clarify.',
                requestedChanges: 'Keep attribution explicit.',
                article: null,
              },
            ],
          });
        if (calls === 3) {
          assert.equal(input.assignment.targetArticles, 1);
          assert.deepEqual(
            input.drafts.map((d) => d.id),
            ['draft-2'],
          );
          assert.deepEqual(input.requiredDraftIds, ['draft-2']);
          return wrap({ drafts: [second] });
        }
        return wrap(accept(second));
      },
    },
  });
  assert.equal(calls, 4);
  assert.equal(state.sections.news.articles.length, 2);
  assert.equal(
    state.sections.news.articles.find((a) => a.title === article.title).versions.length,
    2,
  );
  assert.equal(
    state.sections.news.articles.find((a) => a.title === second.title).versions.length,
    3,
  );
});
test('personal reporting covers every inbox and calendar record on separate pages', async () => {
  state.preferences.paper.sections.inbox = 1;
  state.preferences.paper.sections.calendar = 1;
  const personalEvidence = Array.from({ length: 17 }, (_, i) => ({
    ...evidence[0],
    id: `personal-source-${i}`,
    source: i < 12 ? 'gmail' : 'applecalendar',
    visibility: 'private',
  }));
  await refreshSection('personal', {
    services: {
      collect: async () => ({ evidence: personalEvidence }),
      model: async (_system, input) => {
        const a = {
          ...article,
          id: input.assignment.id,
          evidenceIds: input.evidence.map((e) => e.id),
        };
        return wrap(input.drafts ? accept(a) : { drafts: [a] });
      },
    },
  });
  assert.equal(state.sections.personal.status, 'published');
  assert.equal(state.sections.personal.articles.length, 2);
  assert.equal(state.sections.personal.articles.flatMap((a) => a.evidence).length, 17);
  assert.deepEqual(
    new Set(state.sections.personal.articles.map((a) => a.sectionId)),
    new Set(['inbox', 'calendar']),
  );
  assert.equal(state.sections.personal.coverage.assigned, 17);
});
test('unchanged source content skips all model calls', async () => {
  let calls = 0;
  const services = {
    collect: async () => ({ evidence }),
    model: async () => wrap(++calls === 1 ? { drafts: [article] } : accept()),
  };
  await refreshSection('news', { services });
  assert.equal(calls, 2);
  await refreshSection('news', {
    services: {
      ...services,
      collect: async () => ({
        evidence: evidence.map((e) => ({ ...e, fetchedAt: '2026-10-19T11:00:00Z' })),
      }),
    },
  });
  assert.equal(calls, 2);
  assert.equal(state.sections.news.revision, 1);
  assert.equal(state.runs[0].status, 'unchanged');
});
test('same-desk requests cannot race and overwrite a newer edition', async () => {
  let resume;
  const wait = new Promise((resolve) => {
    resume = resolve;
  });
  const running = refreshSection('news', {
    services: {
      collect: async () => {
        await wait;
        return { evidence: [] };
      },
    },
  });
  assert.deepEqual(await refreshSection('news'), { skipped: true });
  assert.deepEqual(publicState().active, ['news']);
  resume();
  await running;
  assert.equal(state.runs.length, 1);
});
test('one failing feed preserves its previous evidence with stale marker', () => {
  const previous = [...evidence, { id: 'google-old', source: 'google', title: 'Old headline' }];
  const next = mergeEvidence(
    previous,
    [{ id: 'google-new', source: 'google', title: 'New headline' }],
    { hn: { ok: false }, google: { ok: true } },
  );
  assert.deepEqual(
    next.map((e) => e.id),
    ['google-new', 'hn-1'],
  );
  assert.equal(next[1].stale, true);
});
test('a second request for revisions is held rather than looping forever', async () => {
  let calls = 0;
  const outputs = [
    { drafts: [article] },
    {
      brief: '수정',
      decisions: [
        {
          draftId: article.id,
          decision: 'revise',
          reason: '검토',
          requestedChanges: '더 명확하게',
          article: null,
        },
      ],
    },
    { drafts: [article] },
    {
      brief: '아직 부족',
      decisions: [
        { draftId: article.id, decision: 'revise', reason: '추가 근거 필요', article: null },
      ],
    },
  ];
  await refreshSection('news', {
    force: true,
    services: { collect: async () => ({ evidence }), model: async () => wrap(outputs[calls++]) },
  });
  assert.equal(calls, 4);
  assert.equal(state.sections.news.status, 'held');
  assert.equal(state.sections.news.articles.length, 0);
  assert.equal(state.sections.news.review.at(-1).decision, 'hold');
});
test('Composio transport rejects writes and injected fields', () => {
  assert.throws(() => validateReadTool('GMAIL_SEND_EMAIL', { to: 'someone@example.com' }));
  assert.throws(() => validateReadTool('GOOGLECALENDAR_CREATE_EVENT', {}));
  assert.throws(() =>
    validateReadTool('GMAIL_FETCH_EMAILS', {
      user_id: 'me',
      query: 'in:inbox',
      max_results: 12,
      verbose: true,
      include_payload: false,
      delete: true,
    }),
  );
});
test('daily editions follow the configured timezone, including DST', () => {
  const p = { timezone: 'America/Los_Angeles', dailyTime: '08:00' };
  assert.equal(dailyEditionKey(p, new Date('2026-10-19T14:59:00Z')), null);
  assert.equal(dailyEditionKey(p, new Date('2026-10-19T15:00:00Z')), '2026-10-19');
  assert.equal(dailyEditionKey(p, new Date('2026-11-02T15:59:00Z')), null);
  assert.equal(dailyEditionKey(p, new Date('2026-11-02T16:00:00Z')), '2026-11-02');
});
test('quote failures keep the last real timestamp and late replies cannot regress prices', () => {
  const previous = [{ symbol: 'BTC', price: 100, fetchedAt: '2026-10-19T10:01:00Z' }];
  const failed = mergeQuotes(previous, [
    { symbol: 'BTC', error: 'offline', fetchedAt: '2026-10-19T10:02:00Z' },
  ]);
  assert.equal(failed[0].price, 100);
  assert.equal(failed[0].fetchedAt, previous[0].fetchedAt);
  assert.equal(failed[0].stale, true);
  assert.deepEqual(
    mergeQuotes(previous, [{ symbol: 'BTC', price: 90, fetchedAt: '2026-10-19T10:00:00Z' }]),
    previous,
  );
});
