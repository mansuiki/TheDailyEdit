import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir, savePublication } from './store.mjs';
import { mediaFile } from './media.mjs';
import { assemblePages } from '../shared/paper.mjs';
export function archivePublication(input) {
  const copy = structuredClone(input);
  copy.archived = true;
  copy.active = [];
  copy.events = [];
  copy.runs = [];
  copy.connections = {};
  const directory = path.join(dataDir, 'publication-assets', copy.issue.id);
  const urls = new Map();
  function preserve(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(preserve);
      return;
    }
    if (typeof value.url === 'string' && value.url.startsWith('/api/media/')) {
      const original = value.url;
      if (!urls.has(original)) {
        const asset = mediaFile(new URL(original, 'http://localhost').pathname.split('/').at(-1));
        if (asset) {
          fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
          const extension =
            { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[
              asset.mime
            ] || 'jpg';
          const name = `${randomUUID()}.${extension}`;
          fs.copyFileSync(asset.file, path.join(directory, name));
          fs.chmodSync(path.join(directory, name), 0o600);
          urls.set(original, `/api/publication-assets/${copy.issue.id}/${name}`);
        } else urls.set(original, null);
      }
      value.url = urls.get(original);
      if (!value.url) value.unavailable = true;
    }
    Object.values(value).forEach(preserve);
  }
  preserve(copy.sections);
  copy.pages = assemblePages(copy);
  savePublication(copy);
  return copy;
}
export function publicationAsset(id, name) {
  if (!/^issue-[a-f0-9-]{36}$/.test(id) || !/^[a-f0-9-]{36}\.(png|webp|jpg|gif|avif)$/.test(name))
    return null;
  const file = path.join(dataDir, 'publication-assets', id, name);
  return fs.existsSync(file) ? file : null;
}
