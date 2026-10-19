import { news, markets } from '../server/sources.mjs';
import { discoverConnections, connectionStates } from '../server/composio.mjs';
import { runCline } from '../server/cline.mjs';
const prefs = {
  region: 'US',
  sourceEnabled: { hn: true, google: true },
  coins: ['BTC', 'ETH'],
  stocks: ['AAPL', 'NVDA'],
};
const checks = [
  [
    'news',
    async () => {
      const r = await news(prefs);
      return { items: r.evidence.length, sources: r.statuses };
    },
  ],
  [
    'markets',
    async () => {
      const r = await markets(prefs);
      return r.quotes.map((q) => ({
        symbol: q.symbol,
        provider: q.provider,
        price: q.price,
        error: q.error,
      }));
    },
  ],
  ['connectors', async () => connectionStates(await discoverConnections())],
  [
    'cline',
    async () => {
      const r = await runCline('No tools. Return exactly {"ok":true}.', {
        task: 'Readiness check',
      });
      return { ok: r.data.ok, model: r.model, durationMs: r.durationMs };
    },
  ],
];
const results = await Promise.allSettled(
  checks.map(async ([name, check]) => ({ name, result: await check() })),
);
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  console.log(
    JSON.stringify(
      r.status === 'fulfilled' ? r.value : { name: checks[i][0], error: r.reason.message },
      null,
      2,
    ),
  );
}
process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
