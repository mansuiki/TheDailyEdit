import { get, hash } from './utils.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PAPER, sectionOf } from '../shared/paper.mjs';
import { randomUUID } from 'node:crypto';
const semanticSession = randomUUID();
let initialization;
export async function parallelRequest(endpoint, body) {
  if (!process.env.PARALLEL_API_KEY) throw new Error('Configure the Parallel API key.');
  const response = await get(`https://api.parallel.ai/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.PARALLEL_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return response.json();
}
const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {}
  for (const line of text.split('\n').reverse())
    if (line.startsWith('data: ')) {
      try {
        return JSON.parse(line.slice(6));
      } catch {}
    }
  throw new Error('Could not parse the Parallel response.');
}
async function rpc(method, params, id) {
  const res = await get('https://search.parallel.ai/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', ...(id ? { id } : {}), method, params }),
    signal: AbortSignal.timeout(25000),
  });
  if (res.headers.get('mcp-session-id'))
    headers['mcp-session-id'] = res.headers.get('mcp-session-id');
  const text = await res.text();
  if (!text.trim()) return;
  const body = parse(text);
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
const cacheFile = path.resolve(process.env.NEWSROOM_DATA_DIR || '.data', 'public-extracts.json');
let extractionCache = {};
try {
  extractionCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
} catch {}
export async function enrichArticles(evidence, paper = DEFAULT_PAPER) {
  const targets = Object.entries(paper.sections).flatMap(([id, pages]) =>
    pages > 0
      ? evidence
          .filter(
            (e) =>
              sectionOf(e) === id && !e.source?.startsWith('custom:') &&
              e.visibility === 'public' &&
              e.url &&
              e.source !== 'google' &&
              !e.url.includes('news.ycombinator.com'),
          )
          .slice(0, Math.min(12, pages * 3))
      : [],
  );
  const pending = [];
  let count = 0;
  for (const item of targets) {
    const cached = extractionCache[hash(item.url)];
    if (cached && Date.now() - cached.at < 2 * 60 * 60 * 1000) {
      Object.assign(item, cached.fields);
      count++;
    } else pending.push(item);
  }
  const batches = [];
  for (let i = 0; i < pending.length; i += 3) batches.push(pending.slice(i, i + 3));
  let next = 0;
  const errors = [];
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        try {
          count += await enrichBatch(batch);
        } catch (e) {
          errors.push(e);
        }
      }
    }),
  );
  for (const item of pending.filter((e) => e.extractedBy === 'Parallel'))
    extractionCache[hash(item.url)] = {
      at: Date.now(),
      fields: {
        excerpt: item.excerpt,
        contentStatus: item.contentStatus,
        extractedBy: item.extractedBy,
      },
    };
  extractionCache = Object.fromEntries(
    Object.entries(extractionCache)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 144),
  );
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cacheFile, JSON.stringify(extractionCache), { mode: 0o600 });
  if (!count && errors.length) throw errors[0];
  return count;
}
async function enrichBatch(targets) {
  if (!targets.length) return 0;
  let rows;
  if (process.env.PARALLEL_API_KEY) {
    const result = await parallelRequest('extract', {
      urls: targets.map((e) => e.url),
      objective:
        'Extract main factual claims, publication dates, limitations and context for a short English newspaper. Ignore navigation and unrelated content.',
      max_chars_total: 16500,
    });
    rows = result.results ?? [];
  } else {
    if (!initialization)
      initialization = (async () => {
        const r = await rpc(
          'initialize',
          {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'daily-me', version: '0.1.0' },
          },
          1,
        );
        headers['mcp-protocol-version'] = r.protocolVersion;
        await rpc('notifications/initialized', {});
      })();
    await initialization;
    const result = await rpc(
      'tools/call',
      {
        name: 'web_fetch',
        arguments: {
          urls: targets.map((e) => e.url),
          objective:
            'Extract the main factual claims and context for a short English personal newspaper summary. Include dates and key details.',
          session_id: semanticSession,
        },
      },
      3,
    );
    if (result.isError) throw new Error('Parallel extraction failed');
    let structured = result.structuredContent;
    if (!structured)
      for (const c of result.content ?? [])
        if (c.type === 'text')
          try {
            structured = JSON.parse(c.text);
            break;
          } catch {}
    rows = structured?.results ?? structured?.data?.results ?? [];
  }
  let count = 0;
  for (const target of targets) {
    const match = rows.find((r) => r.url === target.url || r.original_url === target.url);
    if (!match) continue;
    const excerpt = Array.isArray(match.excerpts)
      ? match.excerpts.join('\n')
      : (match.excerpt ?? match.content ?? match.full_content ?? '');
    if (excerpt) {
      target.excerpt = String(excerpt).slice(0, 5500);
      target.contentStatus = 'excerpt';
      target.extractedBy = 'Parallel';
      count++;
    }
  }
  return count;
}
