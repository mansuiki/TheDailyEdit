import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-edit-assets-'));
process.env.NEWSROOM_DATA_DIR = temp;
fs.mkdirSync(path.join(temp, 'media'));
const formats = ['png', 'webp', 'gif', 'avif', 'jpeg'];
const assets = formats.map((format, i) => ({
  id: String(i + 1).padStart(18, '0'),
  mime: `image/${format}`,
}));
fs.writeFileSync(
  path.join(temp, 'media', 'index.json'),
  JSON.stringify({ fixture: { version: 3, images: assets } }),
);
for (const asset of assets)
  fs.writeFileSync(path.join(temp, 'media', asset.id), `bytes-${asset.mime}`);
const { archivePublication, publicationAsset } = await import('../server/archive.mjs');
const { readPublication } = await import('../server/store.mjs');
const { buildDemoEdition } = await import('../server/demo-edition.mjs');
after(() => fs.rmSync(temp, { recursive: true, force: true }));
test('archival images retain bytes and MIME extensions independently of the media cache, including versioned URLs', () => {
  const view = buildDemoEdition();
  view.issue.id = `issue-${randomUUID()}`;
  view.sections.personal.articles[0].images = assets.map((asset) => ({
    ...asset,
    url: `/api/media/${asset.id}?v=3`,
  }));
  const saved = archivePublication(view);
  fs.rmSync(path.join(temp, 'media'), { recursive: true, force: true });
  const reopened = readPublication(saved.issue.id);
  for (const [i, asset] of reopened.sections.personal.articles[0].images.entries()) {
    const name = asset.url.split('/').at(-1);
    assert.ok(name.endsWith(formats[i] === 'jpeg' ? '.jpg' : `.${formats[i]}`));
    const file = publicationAsset(saved.issue.id, name);
    assert.equal(fs.readFileSync(file, 'utf8'), `bytes-${assets[i].mime}`);
  }
  assert.equal(publicationAsset(saved.issue.id, '../../secret'), null);
  assert.equal(publicationAsset('../not-an-issue', randomUUID() + '.png'), null);
});
