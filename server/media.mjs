import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { hash } from './utils.mjs';
import { parallelRequest } from './parallel.mjs';

const directory = path.resolve(process.env.NEWSROOM_DATA_DIR || '.data', 'media');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const indexFile = path.join(directory, 'index.json');
let cache = {};
try {
  cache = Object.fromEntries(
    Object.entries(JSON.parse(fs.readFileSync(indexFile, 'utf8'))).filter(
      ([, v]) => v.version === 3,
    ),
  );
} catch {}
let collecting;
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}
export function publicMediaUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      !['https:', 'http:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      (u.port && !['80', '443'].includes(u.port))
    )
      return null;
    if (
      host === 'localhost' ||
      !host.includes('.') ||
      /\.(localhost|local|internal|lan)$/.test(host)
    )
      return null;
    if (ipaddr.isValid(host) && !isPublicAddress(host)) return null;
    return u.href;
  } catch {
    return null;
  }
}
// Resolve and pin the public address; revalidate every redirect, never forward credentials.
export async function downloadPublic(value, allowedTypes, hops = 0) {
  const safe = publicMediaUrl(value);
  if (!safe || hops > 3) throw new Error('Image URL is not allowed.');
  const u = new URL(safe);
  const records = await lookup(u.hostname, { all: true });
  if (!records.length || records.some((r) => !isPublicAddress(r.address)))
    throw new Error('Only public image addresses are allowed.');
  const pinned = records[0];
  return new Promise((resolve, reject) => {
    const transport = u.protocol === 'https:' ? https : http;
    const req = transport.get(
      u,
      {
        headers: {
          'User-Agent': 'DailyMe/0.1 (personal news reader)',
          Accept: [...allowedTypes].join(','),
        },
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
        signal: AbortSignal.timeout(10000),
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          downloadPublic(new URL(res.headers.location, u).href, allowedTypes, hops + 1).then(
            resolve,
            reject,
          );
          return;
        }
        const mime = String(res.headers['content-type'] || '').split(';')[0];
        if (
          res.statusCode !== 200 ||
          !allowedTypes.has(mime) ||
          Number(res.headers['content-length']) > 6000000
        ) {
          res.resume();
          reject(new Error('Unsupported image response.'));
          return;
        }
        let length = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          length += chunk.length;
          if (length > 6000000) {
            req.destroy(new Error('Image exceeds the size limit.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () =>
          length
            ? resolve({ bytes: Buffer.concat(chunks), mime, url: u.href })
            : reject(new Error('Empty image')),
        );
      },
    );
    req.on('error', reject);
  });
}
export const downloadImage = (value) => downloadPublic(value, types);
export function pageImage(html, pageUrl, title) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), m[2]]),
    );
    if (
      !['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(
        attributes.property || attributes.name,
      )
    )
      continue;
    try {
      const image = new URL(attributes.content.replace(/&amp;/g, '&'), pageUrl).href;
      if (publicMediaUrl(image))
        return { image_url: image, source_page_url: pageUrl, title, origin: 'page' };
    } catch {}
  }
  return null;
}
export function relevantImage(row, evidence) {
  try {
    if (row.origin === 'page') return true;
    const host = (u) => new URL(u).hostname.replace(/^www\./, '');
    if (row.source_page_url.replace(/\/$/, '') === evidence.url.replace(/\/$/, '')) return true;
    const tokens = [...new Set(evidence.title.toLowerCase().match(/[a-z0-9.]{4,}/g) || [])].filter(
      (t) =>
        ![
          'with',
          'from',
          'that',
          'this',
          'have',
          'will',
          'been',
          'after',
          'into',
          'news',
          'apps',
        ].includes(t),
    );
    const overlap = tokens.filter((t) => String(row.title).toLowerCase().includes(t)).length;
    if (overlap < 2) return false;
    if (host(row.source_page_url) === host(evidence.publisherUrl || evidence.url)) return true;
    // Technical names disambiguate software from similarly named objects (e.g. Wine bottles).
    const names =
      evidence.title.match(/\b(?:Wine|OpenBSD|Mac\.apk|MiniMax|Timestral|Mercury)\b/gi) || [];
    return (
      names.length > 0 &&
      names.every((name) => String(row.title).toLowerCase().includes(name.toLowerCase()))
    );
  } catch {
    return false;
  }
}
export function normalizeImage(row, evidence) {
  if (evidence.visibility !== 'public' || !['hn', 'google'].includes(evidence.source)) return null;
  const imageUrl = publicMediaUrl(row.image_url),
    sourceUrl = publicMediaUrl(row.source_page_url);
  if (!imageUrl || !sourceUrl || /\.svg(?:[?#]|$)/i.test(imageUrl)) return null;
  if (!relevantImage(row, evidence)) return null;
  if ((row.width && row.width < 300) || (row.height && row.height < 160)) return null;
  const id = hash(imageUrl);
  return {
    id,
    url: `/api/media/${id}`,
    originalUrl: imageUrl,
    sourceUrl,
    title: String(row.title || evidence.title).slice(0, 300),
    provider: row.origin === 'page' ? 'Original publisher image' : 'Parallel Image Search',
    sourceHost: new URL(sourceUrl).hostname.replace(/^www\./, ''),
    relation:
      sourceUrl.replace(/\/$/, '') === evidence.url?.replace(/\/$/, '') ? 'source' : 'related',
    fetchedAt: new Date().toISOString(),
    width: row.width,
    height: row.height,
  };
}
export function imagesForEvidence(evidence = []) {
  const seen = new Set();
  return evidence
    .filter((e) => e.visibility === 'public' && (['hn', 'google'].includes(e.source) || e.source?.startsWith('bbc-')))
    .flatMap((e) => cache[hash(e.url || e.id)]?.images || [])
    .filter((i) => !seen.has(i.id) && seen.add(i.id))
    .map((i) => ({
      ...i,
      provider: i.provider === '원문 대표 이미지' ? 'Original publisher image' : i.provider,
      url: `/api/media/${i.id}?v=3`,
    }));
}
export function mediaFile(id) {
  if (!/^[a-f0-9]{18}$/.test(id)) return null;
  const entry = Object.values(cache)
    .flatMap((v) => v.images)
    .find((v) => v.id === id);
  const file = path.join(directory, id);
  return entry && fs.existsSync(file) ? { file, mime: entry.mime } : null;
}
export function collectImages(evidence, { force = false } = {}) {
  if (collecting) return collecting;
  collecting = collect(evidence, force).finally(() => {
    collecting = null;
  });
  return collecting;
}
async function collect(evidence, force) {
  if (!process.env.PARALLEL_API_KEY)
    return { ok: false, count: 0, error: 'Parallel API key is not configured' };
  const targets = [
    ...new Map(
      evidence
        .filter((e) => e.visibility === 'public' && (['hn', 'google'].includes(e.source) || e.source?.startsWith('bbc-')) && e.url)
        .map((e) => [e.url, e]),
    ).values(),
  ].slice(0, 8);
  const errors = [];
  // Two requests at a time; public headlines only. Cache hits make scheduled refresh inexpensive.
  for (let n = 0; n < targets.length; n += 2)
    await Promise.all(
      targets.slice(n, n + 2).map(async (e) => {
        const key = hash(e.url),
          old = cache[key];
        if (!force && old && Date.now() - old.time < (old.images.length ? 86400000 : 3600000))
          return;
        try {
          let original;
          if (e.source === 'hn')
            try {
              const page = await downloadPublic(
                e.url,
                new Set(['text/html', 'application/xhtml+xml']),
              );
              original = pageImage(page.bytes.toString('utf8'), page.url, e.title);
            } catch {}
          const result = await parallelRequest('images/search', {
            search_queries: [
              `${e.title} ${e.url.includes('github.com/') ? new URL(e.url).pathname : ''}`.slice(
                0,
                200,
              ),
            ],
            mode: 'advanced',
            objective:
              'Find original images or product screenshots directly related to this exact news headline. Prefer the original publisher. Avoid generic stock photos and unrelated stories.',
            advanced_settings: { max_results: 5 },
          });
          const images = [];
          for (const row of [original, ...(result.results || []).slice(0, 5)].filter(Boolean)) {
            const image = normalizeImage(row, e);
            if (!image || images.some((i) => i.id === image.id)) continue;
            try {
              const downloaded = await downloadImage(image.originalUrl);
              fs.writeFileSync(path.join(directory, image.id), downloaded.bytes, { mode: 0o600 });
              images.push({ ...image, mime: downloaded.mime });
              if (images.length === 2) break;
            } catch {}
          }
          cache[key] = {
            version: 3,
            time: Date.now(),
            images: images.length ? images : old?.images || [],
          };
        } catch (error) {
          errors.push(error.message);
        }
      }),
    );
  cache = Object.fromEntries(
    Object.entries(cache)
      .sort((a, b) => b[1].time - a[1].time)
      .slice(0, 100),
  );
  fs.writeFileSync(indexFile, JSON.stringify(cache), { mode: 0o600 });
  return {
    ok: errors.length === 0,
    count: imagesForEvidence(targets).length,
    checkedAt: new Date().toISOString(),
    ...(errors.length ? { error: errors[0] } : {}),
  };
}
