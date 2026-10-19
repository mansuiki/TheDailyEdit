import { XMLParser } from 'fast-xml-parser';
import { json, get, hash, now, cleanText, httpUrl } from './utils.mjs';
import { enrichArticles } from './parallel.mjs';
import { collectPersonal } from './composio.mjs';
import { collectAppleCalendar } from './apple-calendar.mjs';
import { collectCustomSection } from './custom-sections.mjs';
import { DEFAULT_PAPER } from '../shared/paper.mjs';
const xml = new XMLParser({ ignoreAttributes: false });
export async function hackerNews() {
  const ids = (await json('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 36);
  const items = await Promise.allSettled(
    ids.map((id) => json(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)),
  );
  return items
    .filter((r) => r.status === 'fulfilled' && r.value && !r.value.deleted && !r.value.dead)
    .map(({ value: i }) => ({
      id: `hn-${i.id}`,
      source: 'hn',
      sectionId: 'technology',
      sourceLabel: 'Hacker News',
      title: cleanText(i.title),
      excerpt: cleanText(i.text || ''),
      url: httpUrl(i.url) || `https://news.ycombinator.com/item?id=${i.id}`,
      discussionUrl: `https://news.ycombinator.com/item?id=${i.id}`,
      publishedAt: new Date(i.time * 1000).toISOString(),
      fetchedAt: now(),
      visibility: 'public',
      contentStatus: i.text ? 'excerpt' : 'headline',
      score: i.score,
      comments: i.descendants,
    }));
}
export async function googleNews(region) {
  const url =
    region === 'KR'
      ? 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'
      : 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
  const data = xml.parse(await (await get(url)).text());
  let items = data?.rss?.channel?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return items.slice(0, 36).map((i) => ({
    id: `google-${hash(String(i.guid?.['#text'] ?? i.guid ?? i.link))}`,
    source: 'google',
    sectionId: 'world',
    sourceLabel: typeof i.source === 'string' ? i.source : i.source?.['#text'] || 'Google News',
    publisherUrl: httpUrl(i.source?.['@_url']),
    title: cleanText(i.title),
    excerpt: '',
    url: httpUrl(i.link),
    publishedAt: isNaN(Date.parse(i.pubDate)) ? null : new Date(i.pubDate).toISOString(),
    fetchedAt: now(),
    visibility: 'public',
    contentStatus: 'headline',
  }));
}
const bbcFeeds = {
  world: 'world',
  business: 'business',
  science: 'science_and_environment',
  culture: 'entertainment_and_arts',
};
export async function bbcNews(section) {
  const feed = `https://feeds.bbci.co.uk/news/${bbcFeeds[section]}/rss.xml`;
  const data = xml.parse(await (await get(feed)).text());
  const items = [].concat(data?.rss?.channel?.item || []).slice(0, 12);
  return items.map((i) => ({
    id: `bbc-${hash(String(i.guid?.['#text'] || i.link))}`,
    source: `bbc-${section}`,
    sectionId: section,
    sourceLabel: 'BBC News',
    title: cleanText(i.title),
    excerpt: cleanText(i.description || '').slice(0, 1200),
    sourceSummary: cleanText(i.description || '').slice(0, 1200),
    url: httpUrl(i.link),
    publishedAt: isNaN(Date.parse(i.pubDate)) ? null : new Date(i.pubDate).toISOString(),
    fetchedAt: now(),
    visibility: 'public',
    contentStatus: i.description ? 'excerpt' : 'headline',
  }));
}
export async function news(preferences) {
  const paper = preferences.paper || DEFAULT_PAPER;
  const sources = [
    ...(preferences.sourceEnabled.hn && paper.sections.technology
      ? [['hn', () => hackerNews()]]
      : []),
    ...(preferences.sourceEnabled.google && paper.sections.world
      ? [['google', () => googleNews(preferences.region)]]
      : []),
    ...(preferences.sourceEnabled.bbc !== false
      ? Object.keys(bbcFeeds)
          .filter((id) => paper.sections[id] > 0)
          .map((id) => [`bbc-${id}`, () => bbcNews(id)])
      : []),
  ];
  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));
  const evidence = [],
    statuses = {};
  settled.forEach((r, i) => {
    statuses[sources[i][0]] = {
      ok: r.status === 'fulfilled',
      checkedAt: now(),
      count: r.status === 'fulfilled' ? r.value.length : 0,
      error: r.status === 'rejected' ? r.reason.message : null,
    };
    if (r.status === 'fulfilled') evidence.push(...r.value);
  });
  const customResults = await Promise.all(
    (paper.customSections || []).filter((s) => paper.sections[s.id] > 0).map(collectCustomSection),
  );
  customResults.forEach((r) => {
    evidence.push(...r.evidence);
    Object.assign(statuses, r.statuses);
  });
  try {
    const count = await enrichArticles(evidence, paper);
    statuses.parallel = { ok: true, count, checkedAt: now() };
  } catch (e) {
    statuses.parallel = { ok: false, error: e.message, checkedAt: now() };
  }
  return {
    evidence: [...new Map(evidence.map((e) => [e.id, e])).values()],
    statuses,
    notes: [
      ...customResults.flatMap((r) => r.notes),
      'Google News provides public regional headlines. Full-text claims are not inferred from titles.',
    ],
  };
}
export async function markets(preferences) {
  if (preferences.paper?.sections.markets === 0)
    return { quotes: [], evidence: [], statuses: {}, notes: [] };
  const requests = [
    ...preferences.coins.map((symbol) => ({ symbol, kind: 'coin' })),
    ...preferences.stocks.map((symbol) => ({ symbol, kind: 'stock' })),
  ];
  const settled = await Promise.allSettled(
    requests.map(async ({ symbol, kind }) => {
      if (kind === 'coin') {
        const d = (
          await json(`https://api.coinbase.com/v2/prices/${encodeURIComponent(symbol)}-USD/spot`)
        ).data;
        const price = Number(d?.amount);
        if (!Number.isFinite(price) || price <= 0) throw new Error('No price returned');
        return {
          symbol,
          kind,
          price,
          currency: d.currency || 'USD',
          changePercent: null,
          changeBasis: null,
          provider: 'Coinbase',
          url: `https://www.coinbase.com/price/${symbol.toLowerCase()}`,
          quotedAt: null,
          fetchedAt: now(),
          delayStatus: 'Polled spot price · exchange timestamp unavailable',
        };
      }
      if (process.env.FINNHUB_API_KEY) {
        const d = await json(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,
          { headers: { 'X-Finnhub-Token': process.env.FINNHUB_API_KEY } },
        );
        if (!d.c) throw new Error('No stock quote returned');
        return {
          symbol,
          kind,
          price: d.c,
          currency: 'USD',
          changePercent: d.dp,
          changeBasis: 'previous close',
          provider: 'Finnhub',
          url: `https://finance.yahoo.com/quote/${symbol}/`,
          quotedAt: new Date(d.t * 1000).toISOString(),
          fetchedAt: now(),
          delayStatus: 'Delay depends on the provider plan',
        };
      }
      const d = (
        await json(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        )
      ).chart?.result?.[0]?.meta;
      if (!d?.regularMarketPrice) throw new Error('No stock quote returned');
      return {
        symbol,
        kind,
        price: d.regularMarketPrice,
        currency: d.currency,
        changePercent: Number.isFinite(d.regularMarketChangePercent)
          ? d.regularMarketChangePercent
          : d.previousClose
            ? (100 * (d.regularMarketPrice - d.previousClose)) / d.previousClose
            : null,
        changeBasis: 'previous close',
        provider: 'Yahoo Finance',
        url: `https://finance.yahoo.com/quote/${symbol}/`,
        quotedAt: new Date(d.regularMarketTime * 1000).toISOString(),
        fetchedAt: now(),
        delayStatus: 'Unofficial endpoint · may be delayed',
      };
    }),
  );
  const quotes = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { ...requests[i], error: r.reason.message, fetchedAt: now() },
  );
  const evidence = quotes
    .filter((q) => !q.error)
    .map((q) => ({
      id: `quote-${q.symbol}-${hash(q)}`,
      source: 'markets',
      sourceLabel: q.provider,
      title: `${q.symbol} ${q.price} ${q.currency}`,
      excerpt: `Price ${q.price} ${q.currency}. ${q.changePercent != null ? `${q.changeBasis} change ${q.changePercent.toFixed(2)}%.` : ''} Quote timestamp: ${q.quotedAt || 'not provided'}. Fetched: ${q.fetchedAt}. ${q.delayStatus}. These quotes do not establish the cause of a price change.`,
      url: q.url,
      publishedAt: q.quotedAt,
      fetchedAt: q.fetchedAt,
      visibility: 'public',
      contentStatus: 'structured',
    }));
  return {
    quotes,
    evidence,
    statuses: {
      markets: {
        ok: quotes.some((q) => !q.error),
        checkedAt: now(),
        count: evidence.length,
        error:
          quotes
            .filter((q) => q.error)
            .map((q) => `${q.symbol}: ${q.error}`)
            .join('; ') || null,
      },
    },
  };
}
export async function personal(
  preferences,
  { collectMail = collectPersonal, collectCalendar = collectAppleCalendar } = {},
) {
  const pages = (preferences.paper || DEFAULT_PAPER).sections;
  const includeMail = pages.inbox > 0,
    includeCalendar = pages.calendar > 0;
  const apple = preferences.calendarProvider === 'apple';
  const requests = [];
  if (includeMail || (includeCalendar && !apple))
    requests.push({
      ids: [
        ...(includeMail ? ['gmail'] : []),
        ...(includeCalendar && !apple ? ['googlecalendar'] : []),
      ],
      read: () =>
        collectMail(preferences.timezone, {
          includeMail,
          includeCalendar: includeCalendar && !apple,
        }),
    });
  if (includeCalendar && apple) requests.push({ ids: ['applecalendar'], read: collectCalendar });
  const settled = await Promise.allSettled(requests.map((r) => r.read()));
  const result = { evidence: [], connections: {}, statuses: {}, notes: [] };
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      result.evidence.push(...r.value.evidence);
      Object.assign(result.connections, r.value.connections);
      Object.assign(result.statuses, r.value.statuses);
      result.notes.push(...(r.value.notes || []));
      for (const id of requests[i].ids)
        if (r.value.connections?.[id]?.status !== 'active' && !result.statuses[id])
          result.statuses[id] = {
            ok: false,
            count: 0,
            error: `Connect ${id} in Settings to include this source.`,
          };
    } else {
      for (const id of requests[i].ids)
        result.statuses[id] = { ok: false, count: 0, error: r.reason.message };
      result.notes.push(`Personal source unavailable: ${r.reason.message}`);
    }
  });
  return result;
}
