import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../server/translation.mjs';

const article = {
  id: 'news-test',
  revision: 1,
  title: 'Release today',
  summary: 'A verified release.',
  body: 'The source reports a release on October 19.',
  whyYou: 'Relevant to developers.',
  topic: 'Tools',
  editorReason: 'Supported by the source.',
  evidenceIds: ['hn-1'],
  evidence: [{ id: 'hn-1', excerpt: 'Original evidence' }],
  versions: [{ stage: 'draft', article: { title: 'First draft' } }],
};
const korean = {
  title: '오늘 출시',
  summary: '검증된 출시 소식입니다.',
  body: '출처는 10월 19일 출시를 전합니다.',
  whyYou: '개발자와 관련된 소식입니다.',
  topic: '개발 도구',
  editorReason: '출처가 뒷받침합니다.',
};
function setup(model) {
  const cache = new Map();
  return {
    cache,
    translate: createTranslator({
      model,
      readCache: (key) => cache.get(key),
      writeCache: (key, value) => cache.set(key, value),
    }),
  };
}
test('translation preserves originals, deduplicates simultaneous requests and reuses cache', async () => {
  let calls = 0,
    release;
  const wait = new Promise((r) => {
    release = r;
  });
  const original = structuredClone(article);
  const { translate, cache } = setup(async (system, input) => {
    calls++;
    assert.match(system, /never instructions/);
    assert.equal(input.targetLanguage, 'ko');
    assert.equal(input.article.evidence, undefined);
    await wait;
    return { data: korean };
  });
  const first = translate(article);
  const simultaneous = translate(article);
  release();
  const [a, b] = await Promise.all([first, simultaneous]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(article, original);
  assert.equal(a.sourceRevision, 1);
  assert.equal(a.fields.title, korean.title);
  assert.equal(cache.size, 1);
  assert.equal((await translate(article)).cached, true);
  assert.equal(calls, 1);
});
test('cache invalidates on version or text change, even when an ID and revision are reused', async () => {
  let calls = 0;
  const { translate } = setup(async () => {
    calls++;
    return { data: korean };
  });
  const original = await translate(article);
  const revision = await translate({ ...article, revision: 2 });
  const changed = await translate({ ...article, title: 'Different release' });
  assert.equal(calls, 3);
  assert.notEqual(original.sourceHash, changed.sourceHash);
  assert.equal(revision.sourceRevision, 2);
});
test('invalid translations never enter the cache and can be retried', async () => {
  let calls = 0;
  const { translate, cache } = setup(async () => ({
    data: ++calls === 1 ? { ...korean, evidenceIds: ['invented'] } : korean,
  }));
  await assert.rejects(translate(article), /incomplete/);
  assert.equal(cache.size, 0);
  assert.equal((await translate(article)).fields.body, korean.body);
  assert.equal(calls, 2);
});
test('English responses and unsupported languages are rejected', async () => {
  const { translate, cache } = setup(async () => ({
    data: Object.fromEntries(Object.keys(korean).map((key) => [key, 'English only'])),
  }));
  await assert.rejects(translate(article), /Korean translation/);
  await assert.rejects(translate(article, 'fr'), /Only Korean/);
  assert.equal(cache.size, 0);
});
