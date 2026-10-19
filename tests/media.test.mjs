import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const mediaTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-me-media-'));
process.env.NEWSROOM_DATA_DIR = mediaTestDir;
after(() => fs.rmSync(mediaTestDir, { recursive: true, force: true }));
import assert from 'node:assert/strict';
const {
  isPublicAddress,
  publicMediaUrl,
  pageImage,
  relevantImage,
  normalizeImage,
  collectImages,
  downloadImage,
} = await import('../server/media.mjs');
const story = {
  id: 'hn-test',
  source: 'hn',
  visibility: 'public',
  title: 'Wine ported to OpenBSD',
  url: 'https://marc.info/?l=openbsd',
};

test('image retrieval blocks local, metadata, private and mapped loopback destinations', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.2.3.4',
    '172.16.1.1',
    '192.168.2.3',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    '0.0.0.0',
    '100.64.1.1',
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('8.8.8.8'), true);
  for (const u of [
    'http://localhost/a',
    'http://127.1/a',
    'http://0x7f000001/a',
    'http://192.168.0.1/a',
    'file:///tmp/a',
    'https://user:pass@example.com/a',
    'http://example.com:4310/a',
  ])
    assert.equal(publicMediaUrl(u), null, u);
  await assert.rejects(downloadImage('http://127.0.0.1:4310/api/state'));
});
test('original page image supports relative URLs and escaped query parameters', () => {
  const row = pageImage(
    '<meta content="/cover.png?a=1&amp;b=2" property="og:image">',
    'https://publisher.example/story',
    'Headline',
  );
  assert.equal(row.image_url, 'https://publisher.example/cover.png?a=1&b=2');
  assert.equal(row.source_page_url, 'https://publisher.example/story');
  assert.equal(
    pageImage(
      '<meta property="og:image" content="http://127.0.0.1/a">',
      'https://publisher.example/story',
      'Headline',
    ),
    null,
  );
});
test('image search disambiguates Wine software from wine bottles and labels related images', () => {
  const wrong = {
    title: 'Port Wine Bottle',
    image_url: 'https://photos.example/bottle.jpg',
    source_page_url: 'https://photos.example/wine',
  };
  assert.equal(relevantImage(wrong, story), false);
  assert.equal(normalizeImage(wrong, story), null);
  const related = normalizeImage(
    { ...wrong, title: 'Wine on OpenBSD: cross-platform development' },
    story,
  );
  assert.equal(related.relation, 'related');
  assert.equal(related.sourceHost, 'photos.example');
  assert.match(related.url, /^\/api\/media\/[a-f0-9]{18}$/);
});
test('private mail and calendar never reach Parallel image search', async () => {
  const priorKey = process.env.PARALLEL_API_KEY,
    priorFetch = globalThis.fetch;
  process.env.PARALLEL_API_KEY = 'test-only';
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('must not call');
  };
  try {
    const privateStory = { ...story, source: 'gmail', visibility: 'private' };
    assert.equal(
      normalizeImage(
        { image_url: 'https://public.example/a.jpg', source_page_url: story.url },
        privateStory,
      ),
      null,
    );
    const result = await collectImages([
      privateStory,
      { ...privateStory, source: 'applecalendar' },
    ]);
    assert.equal(result.count, 0);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.PARALLEL_API_KEY;
    else process.env.PARALLEL_API_KEY = priorKey;
  }
});
