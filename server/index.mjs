import express from 'express';
import fs from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createDemoEdition } from './demo-edition.mjs';
import path from 'node:path';
import { z } from 'zod';
import { sourceSchema, readCustomSource, resolveChannel } from './custom-sections.mjs';
import { publicationAsset } from './archive.mjs';
import { publicationJobs, startReconstruction, publishCurrent } from './editions.mjs';
import {
  state,
  listPublications,
  readPublication,
  readTranslation,
  saveTranslation,
} from './store.mjs';
import { runCline } from './cline.mjs';
import { createTranslator } from './translation.mjs';
import {
  events,
  publicState,
  refreshAll,
  refreshSection,
  refreshQuotes,
  refreshMedia,
  startScheduler,
  broadcast,
  log,
} from './newsroom.mjs';
import { connect } from './composio.mjs';
import { authorizeAppleCalendar } from './apple-calendar.mjs';
import { checkConnections, checkedConnection, connectionIds } from './connections.mjs';
import { mediaFile } from './media.mjs';
import { preferencesSchema, interpretPreferences, preferenceFingerprint } from './preferences.mjs';
import { routeRequestSchema, calculateRoute, routeMapFile } from './routes.mjs';
const app = express();
const production = process.argv.includes('--production');
const port = Number(process.env.PORT || 4310);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be a whole number between 0 and 65535. Set PORT in .env and try again.');
  process.exit(1);
}
if (production && !fs.existsSync(path.resolve('dist/index.html'))) {
  console.error('Production build not found. Run npm run build before npm start.');
  process.exit(1);
}
const server = createHttpServer(app);
let vite;
const translate = createTranslator({
  model: runCline,
  readCache: readTranslation,
  writeCache: saveTranslation,
});
app.disable('x-powered-by');
// Local single-user app: reject cross-origin mutations and DNS rebinding hosts.
app.use((req, res, next) => {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname))
    return res.status(403).json({ error: 'Only localhost requests are allowed.' });
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.post('/api/sources/preview', async (req, res) => {
  try {
    const source = sourceSchema.parse(req.body);
    if (source.type === 'youtube')
      source.url = `https://www.youtube.com/channel/${await resolveChannel(source.url)}`;
    const result = await readCustomSource(source, { id: 'custom-preview', label: 'Preview' });
    res.json({
      source,
      label: result.label,
      count: result.items.length,
      titles: result.items.slice(0, 3).map((e) => e.title),
    });
  } catch (e) {
    res
      .status(400)
      .json({ error: e.name === 'ZodError' ? 'Enter a supported public source.' : e.message });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/state', (_req, res) => res.json(publicState()));
app.get('/api/media/:id', (req, res) => {
  const media = mediaFile(req.params.id);
  if (!media) return res.status(404).json({ error: 'Image not found.' });
  res
    .type(media.mime)
    .set('Cache-Control', 'private, max-age=86400')
    .sendFile(media.file, { dotfiles: 'allow' });
});
app.post('/api/routes', async (req, res) => {
  const parsed = routeRequestSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Enter both locations and a valid travel mode.' });
  res.json(await calculateRoute(parsed.data));
});
app.get('/api/routes/:id/map', (req, res) => {
  const file = routeMapFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'Map not found.' });
  res.type('png').sendFile(file, { dotfiles: 'allow' });
});
app.post('/api/media/refresh', (_req, res) => {
  if (!process.env.PARALLEL_API_KEY)
    return res.status(409).json({ error: 'Configure a Parallel API key first.' });
  void refreshMedia();
  res.status(202).json({ started: true });
});
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = () => res.write(`event: update\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
  send();
  events.on('update', send);
  const keepAlive = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => {
    events.off('update', send);
    clearInterval(keepAlive);
  });
});
app.post('/api/editions', (_req, res) => {
  if (publicState().active.some((d) => ['edition', 'news', 'personal', 'markets'].includes(d)))
    return res
      .status(409)
      .json({ error: 'Wait for the current desk to finish before publishing.' });
  void publishCurrent().catch((e) => log('editor', 'error', e.message));
  res.status(202).json({ started: true });
});
app.get('/api/publication-jobs', (_req, res) => res.json(publicationJobs()));
app.post('/api/editions/retry', (_req, res) => {
  if (publicState().active.some((d) => ['edition', 'news', 'personal', 'markets'].includes(d)))
    return res.status(409).json({ error: 'Wait for the current desk to finish.' });
  void publishCurrent({ retryIncomplete: true }).catch((e) => log('editor', 'error', e.message));
  res.status(202).json({ started: true });
});
app.post('/api/reconstructions', (req, res) => {
  try {
    res.status(202).json(startReconstruction(req.body));
  } catch (e) {
    res.status(400).json({
      error:
        e.name === 'ZodError'
          ? 'Check the edition date, period, time zone and context.'
          : e.message,
    });
  }
});
app.get('/api/publication-assets/:id/:name', (req, res) => {
  const file = publicationAsset(req.params.id, req.params.name);
  if (!file) return res.status(404).end();
  res.sendFile(file, { dotfiles: 'allow' });
});
app.post('/api/articles/:id/translate', async (req, res) => {
  const parsed = z
    .object({
      targetLanguage: z.literal('ko'),
      editionId: z.string().optional(),
      revision: z.number().int().positive(),
    })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Choose Korean and a valid article version.' });
  const sourceState = parsed.data.editionId ? readPublication(parsed.data.editionId) : state;
  const article = Object.values(sourceState?.sections || {})
    .flatMap((s) => s.articles)
    .find((a) => a.id === req.params.id);
  if (!article)
    return res.status(404).json({
      error: 'This article is no longer in the current edition. Reopen a story from today’s paper.',
    });
  if (article.revision !== parsed.data.revision)
    return res.status(409).json({
      error: 'A newer version is available. Close and reopen the article before translating.',
    });
  res.json(await translate(article, parsed.data.targetLanguage));
});
app.post('/api/sections/:desk/refresh', (req, res) => {
  if (!['news', 'personal', 'markets'].includes(req.params.desk))
    return res.status(400).json({ error: 'Unknown desk' });
  void refreshSection(req.params.desk, { force: true });
  res.status(202).json({ started: true });
});
app.post('/api/quotes/refresh', async (_req, res) => {
  await refreshQuotes();
  res.json({ ok: true });
});
app.post('/api/preferences/interpret', async (req, res) => {
  const parsed = z
    .object({ request: z.string().trim().min(3).max(2000) })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: 'Describe your newspaper in 3–2,000 characters.' });
  const current = structuredClone(state.preferences);
  res.json(await interpretPreferences(parsed.data.request, current, runCline));
});
app.post('/api/preferences/apply', (req, res) => {
  const parsed = z
    .object({ preferences: preferencesSchema, baseFingerprint: z.string() })
    .strict()
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: 'The proposed preferences are invalid. Ask the editor again.' });
  if (parsed.data.baseFingerprint !== preferenceFingerprint(state.preferences))
    return res.status(409).json({
      error:
        'Your preferences changed while this plan was being drafted. Ask the editor for a fresh plan.',
    });
  state.preferences = { ...state.preferences, ...parsed.data.preferences };
  log(
    'editor',
    'preferences',
    'The reader applied a new newspaper plan. Publish to commission the updated pages.',
  );
  res.json({ ok: true });
});
app.put('/api/preferences', (req, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error: 'Check your preferences.',
      details: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message),
    });
  state.preferences = { ...state.preferences, ...parsed.data };
  log(
    'editor',
    'preferences',
    'Editorial preferences and refresh schedule saved for the next edition.',
  );
  res.json({ ok: true });
});
app.post('/api/feedback', (req, res) => {
  const parsed = z
    .object({ articleId: z.string(), action: z.enum(['more', 'less', 'known']) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid feedback' });
  const article = Object.values(state.sections)
    .flatMap((s) => s.articles)
    .find((a) => a.id === parsed.data.articleId);
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  const removed = state.preferences.feedback.some(
    (f) => f.articleId === article.id && f.action === parsed.data.action,
  );
  state.preferences.feedback = state.preferences.feedback.filter((f) => f.articleId !== article.id);
  if (!removed)
    state.preferences.feedback.push({
      ...parsed.data,
      title: article.title,
      topic: article.topic,
      evidenceIds: article.evidenceIds,
      time: new Date().toISOString(),
    });
  state.preferences.feedback = state.preferences.feedback.slice(-100);
  broadcast();
  res.json({ ok: true, removed });
});
app.post('/api/connections/:toolkit', async (req, res, next) => {
  if (req.params.toolkit === 'check') return next();
  if (req.params.toolkit === 'applecalendar') {
    const result = await authorizeAppleCalendar();
    state.connections.applecalendar = result;
    broadcast();
    return res.json(result);
  }
  if (!['gmail', 'googlecalendar'].includes(req.params.toolkit))
    return res.status(400).json({ error: 'Unsupported connection' });
  const result = await connect(req.params.toolkit);
  state.connections[req.params.toolkit] = result;
  broadcast();
  res.json(result);
});
app.post('/api/connections/check', async (req, res) => {
  const parsed = z
    .object({ toolkits: z.array(z.enum(connectionIds)).max(3).optional() })
    .strict()
    .safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Choose a supported connection.' });
  const statuses = await checkConnections(parsed.data.toolkits);
  for (const [id, status] of Object.entries(statuses)) {
    // Keep a pending OAuth link available after returning from the provider.
    state.connections[id] = checkedConnection(state.connections[id], status);
  }
  broadcast();
  res.json(state.connections);
});
app.post('/api/demo-edition', (_req, res) => res.json(createDemoEdition()));
app.get('/api/editions', (_req, res) => res.json(listPublications()));
app.get('/api/editions/:id', (req, res) => {
  const edition = readPublication(req.params.id);
  res.status(edition ? 200 : 404).json(edition || { error: 'Edition not found.' });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));
app.use((error, _req, res, _next) =>
  res
    .status(500)
    .set('Cache-Control', 'no-store')
    .type('json')
    .json({ error: error.message || 'Request failed' }),
);
if (production) app.use(express.static(path.resolve('dist')));
else {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
server.once('error', async (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop the other server or set PORT to another number in .env.`
      : `Could not start the local server (${error.code || 'unknown error'}).`,
  );
  await vite?.close();
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log('The Daily Edit → http://127.0.0.1:' + server.address().port);
  startScheduler();
  void refreshMedia();
});
