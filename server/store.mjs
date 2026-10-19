import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { now } from './utils.mjs';
import { EMPTY_CONTEXT, DEFAULT_IDENTITY } from '../shared/edition.mjs';
import { DEFAULT_PAPER, STARTER_PAPER } from '../shared/paper.mjs';
export const dataDir = path.resolve(process.env.NEWSROOM_DATA_DIR || '.data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, 'newsroom.sqlite'));
db.exec(
  'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS editions (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);',
);
try {
  fs.chmodSync(path.join(dataDir, 'newsroom.sqlite'), 0o600);
} catch {}
const defaults = {
  version: 1,
  createdAt: now(),
  edition: 0,
  preferences: {
    topics: ['AI', 'Developer tools', 'Startups'],
    instructions:
      'Prioritize changes that matter to developers. Keep evidence and next steps concise, without hype.',
    region: 'US',
    calendarProvider: 'google',
    timezone: 'America/Los_Angeles',
    coins: ['BTC', 'ETH'],
    stocks: ['AAPL', 'NVDA'],
    sourceEnabled: { hn: true, google: true, bbc: true },
    paper: structuredClone(STARTER_PAPER),
    feedback: [],
    autoUpdate: false,
    intervals: { news: 900, personal: 300, markets: 60 },
    dailyTime: '08:00',
  },
  sections: Object.fromEntries(
    ['news', 'personal', 'markets'].map((desk) => [
      desk,
      {
        desk,
        articles: [],
        evidence: [],
        status: 'idle',
        lastChecked: null,
        lastPublished: null,
        fingerprint: null,
        revision: 0,
        error: null,
        review: [],
      },
    ]),
  ),
  quotes: [],
  connections: { gmail: { status: 'disconnected' }, googlecalendar: { status: 'disconnected' } },
  sourceStatus: {},
  events: [],
  runs: [],
  lastDailyDate: null,
};
const row = db.prepare('SELECT body FROM state WHERE id=1').get();
export const state = row ? JSON.parse(row.body) : defaults;
state.preferences.context ??= structuredClone(EMPTY_CONTEXT);
state.preferences.identity ??= structuredClone(DEFAULT_IDENTITY);
state.preferences.calendarProvider ??= 'google';
state.preferences.paper ??= structuredClone(DEFAULT_PAPER);
state.preferences.sourceEnabled.bbc ??= true;
const legacyTopics = { '개발 도구': 'Developer tools', 스타트업: 'Startups' };
state.preferences.topics = state.preferences.topics.map((t) => legacyTopics[t] || t);
if (
  state.preferences.instructions ===
  '개발자에게 중요한 변화를 먼저. 과장 없이, 근거와 다음 행동을 간결하게.'
)
  state.preferences.instructions = defaults.preferences.instructions;
state.connections.applecalendar ??= { status: 'permission_required' };
for (const section of Object.values(state.sections))
  if (['collecting', 'writing', 'reviewing', 'revising'].includes(section.status)) {
    section.status = 'idle';
    section.error = 'The previous run was interrupted by a server restart.';
  }
for (const run of state.runs)
  if (run.status === 'running') {
    run.status = 'interrupted';
    run.finishedAt = now();
  }
export function save() {
  db.prepare(
    'INSERT INTO state (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
  ).run(JSON.stringify(state));
}
export function snapshot() {
  const id = `edition-${state.edition}-${Date.now()}`;
  db.prepare('INSERT INTO editions VALUES (?,?,?)').run(
    id,
    now(),
    JSON.stringify({ sections: state.sections, edition: state.edition }),
  );
  db.prepare(
    'DELETE FROM editions WHERE id NOT IN (SELECT id FROM editions ORDER BY created_at DESC LIMIT 20)',
  ).run();
}
export function editions() {
  return db.prepare('SELECT id,created_at FROM editions ORDER BY created_at DESC LIMIT 20').all();
}
export function readEdition(id) {
  const row = db.prepare('SELECT body FROM editions WHERE id=?').get(id);
  return row ? JSON.parse(row.body) : null;
}

// Translation text can contain personal articles. Keep it in the local private DB,
// outside the state object returned to every browser poll.
db.exec(
  'CREATE TABLE IF NOT EXISTS translations (cache_key TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL)',
);
export function readTranslation(key) {
  const row = db.prepare('SELECT body FROM translations WHERE cache_key=?').get(key);
  return row ? JSON.parse(row.body) : null;
}
export function saveTranslation(key, translation) {
  db.prepare('INSERT OR REPLACE INTO translations VALUES (?,?,?)').run(
    key,
    now(),
    JSON.stringify(translation),
  );
  db.prepare(
    'DELETE FROM translations WHERE cache_key NOT IN (SELECT cache_key FROM translations ORDER BY created_at DESC, rowid DESC LIMIT 40)',
  ).run();
}

// User-visible, immutable completed issues. Never trimmed with desk checkpoints.
db.exec(
  'CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, published_at TEXT NOT NULL, metadata TEXT NOT NULL, body TEXT NOT NULL)',
);
export function savePublication(publication) {
  const articles = Object.values(publication.sections).flatMap((s) => s.articles);
  const { issue } = publication;
  const metadata = {
    id: issue.id,
    date: issue.date,
    timezone: issue.timezone,
    publishedAt: issue.publishedAt,
    kind: issue.kind,
    identity: issue.identity,
    pageCount: publication.pages.length,
    articleCount: articles.length,
    sourceCount: Object.values(publication.sections).reduce((n, s) => n + s.evidence.length, 0),
    cover: articles.find((a) => a.images?.length)?.images?.[0] || null,
    headlines: articles.slice(0, 3).map((a) => a.title),
    coverage: issue.coverage,
  };
  db.prepare('INSERT INTO publications VALUES (?,?,?,?)').run(
    issue.id,
    issue.publishedAt,
    JSON.stringify(metadata),
    JSON.stringify(publication),
  );
  return metadata;
}
export function listPublications() {
  return db
    .prepare('SELECT metadata FROM publications ORDER BY published_at DESC')
    .all()
    .map((r) => JSON.parse(r.metadata));
}
export function readPublication(id) {
  const row = db.prepare('SELECT body FROM publications WHERE id=?').get(id);
  return row ? JSON.parse(row.body) : null;
}
