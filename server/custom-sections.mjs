import { z } from 'zod';
import { XMLParser } from 'fast-xml-parser';
import { downloadPublic } from './media.mjs';
import { hash, cleanText, httpUrl, now } from './utils.mjs';
export const sourceSchema = z
  .object({ type: z.enum(['youtube', 'rss']), url: z.string().trim().min(3).max(500) })
  .strict();
export const customSectionSchema = z
  .object({
    id: z.string().regex(/^custom-[a-z0-9-]{1,50}$/),
    label: z.string().trim().min(1).max(40),
    description: z.string().max(160),
    direction: z.string().max(1200),
    sources: z.array(sourceSchema).min(1).max(5),
  })
  .strict();
const xml = new XMLParser({ ignoreAttributes: false });
const textTypes = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'application/rss+xml',
  'application/atom+xml',
  'text/plain',
]);
const read = async (url) => (await downloadPublic(url, textTypes)).bytes.toString('utf8');
export function channelInput(value) {
  const input = value.trim();
  if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) return { id: input };
  if (/^@[\p{L}\p{N}_.-]{1,100}$/u.test(input)) return { handle: input };
  let u;
  try {
    u = new URL(input);
  } catch {
    throw Error('Enter a YouTube channel URL, @handle or channel ID.');
  }
  if (
    !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname) ||
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error('Use a public youtube.com channel URL.');
  const match = u.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})(?:\/videos)?\/?$/);
  if (match) return { id: match[1] };
  const handle = decodeURIComponent(u.pathname).match(
    /^\/(@[\p{L}\p{N}_.-]{1,100})(?:\/videos)?\/?$/u,
  );
  if (handle) return { handle: handle[1] };
  throw Error('Use a channel /@handle or /channel/UC… URL, not a video or playlist.');
}
const resolved = new Map();
export async function resolveChannel(value) {
  const parsed = channelInput(value);
  if (parsed.id) return parsed.id;
  if (resolved.has(parsed.handle)) return resolved.get(parsed.handle);
  const html = await read(
    `https://www.youtube.com/${encodeURIComponent(parsed.handle).replace('%40', '@')}`,
  );
  const id =
    html.match(/"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"/)?.[1] ||
    html.match(/channel_id=(UC[A-Za-z0-9_-]{22})/)?.[1];
  if (!id) throw Error('YouTube did not expose this channel ID. Try its /channel/UC… URL.');
  resolved.set(parsed.handle, id);
  return id;
}
export function parseFeed(body, source, section) {
  const doc = xml.parse(body),
    atom = doc.feed,
    channel = doc.rss?.channel;
  if (!atom && !channel) throw Error('The source did not return an RSS or Atom feed.');
  const label = cleanText(atom?.title?.['#text'] || atom?.title || channel?.title || section.label);
  const rows = [].concat(atom?.entry || channel?.item || []).slice(0, 12);
  const items = rows
    .map((e) => {
      const video = e['yt:videoId'];
      const links = [].concat(e.link || []);
      const url =
        source.type === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(video)
          ? `https://www.youtube.com/watch?v=${video}`
          : httpUrl(
              typeof e.link === 'string'
                ? e.link
                : links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'],
            );
      const title = cleanText(e.title?.['#text'] || e.title || '');
      if (!url || !title) return null;
      const description = cleanText(
        e['media:group']?.['media:description'] ||
          e.description ||
          e.summary?.['#text'] ||
          e.summary ||
          '',
      ).slice(0, 2000);
      const date = e.published || e.pubDate || e.updated;
      return {
        id: `${section.id}-${hash([source.url, video || e.id || e.guid?.['#text'] || e.guid || url])}`,
        source: `custom:${section.id}:${hash(source.url)}`,
        sectionId: section.id,
        sectionTitle: section.label,
        sourceLabel: label,
        title,
        excerpt: description,
        sourceSummary: description,
        url,
        publishedAt: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
        fetchedAt: now(),
        visibility: 'public',
        contentStatus: description ? 'excerpt' : 'headline',
        sourceKind: source.type === 'youtube' ? 'video_metadata' : 'feed_excerpt',
        videoId: video || null,
      };
    })
    .filter(Boolean);
  return { label, items };
}
export async function readCustomSource(source, section) {
  source = sourceSchema.parse(source);
  const url =
    source.type === 'youtube'
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${await resolveChannel(source.url)}`
      : source.url;
  return parseFeed(await read(url), source, section);
}
export async function collectCustomSection(section) {
  const results = await Promise.allSettled(
    section.sources.map((s) => readCustomSource(s, section)),
  );
  const evidence = [],
    statuses = {};
  results.forEach((r, i) => {
    const id = `custom:${section.id}:${hash(section.sources[i].url)}`;
    statuses[id] = {
      ok: r.status === 'fulfilled',
      count: r.status === 'fulfilled' ? r.value.items.length : 0,
      error: r.status === 'rejected' ? r.reason.message : null,
      checkedAt: now(),
    };
    if (r.status === 'fulfilled') evidence.push(...r.value.items);
  });
  return {
    evidence: [...new Map(evidence.map((e) => [e.id, e])).values()],
    statuses,
    notes: [
      `${section.label}: up to 12 latest feed entries per source. YouTube coverage uses titles, descriptions and publication dates only; no video has been watched and no transcript is available.`,
    ],
  };
}
