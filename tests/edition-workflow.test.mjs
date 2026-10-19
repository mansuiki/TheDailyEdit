import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-edit-workflow-'));
process.env.NEWSROOM_DATA_DIR = temp;
const { state, readPublication, listPublications } = await import('../server/store.mjs');
const { chooseIdentity } = await import('../server/identity.mjs');
const { publishCurrent } = await import('../server/editions.mjs');
const { publicState, refreshSection } = await import('../server/newsroom.mjs');
const { channelInput, parseFeed } = await import('../server/custom-sections.mjs');
const { paperSchema, validateProposal } = await import('../server/preferences.mjs');
const { buildAssignments, PAPER_SECTIONS, DEFAULT_PAPER } = await import('../shared/paper.mjs');
const initial = structuredClone(state);
beforeEach(() => Object.assign(state, structuredClone(initial)));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
test('retrying incomplete pages keeps finished stories, source dates, pending preferences and the previous archive intact', async () => {
  state.preferences.context = {
    place: 'San Francisco',
    activity: 'Cline hackathon',
    interests: 'Connectors',
  };
  state.preferences.paper = {
    ...DEFAULT_PAPER,
    customSections: [team],
    sections: { ...DEFAULT_PAPER.sections, technology: 1, [team.id]: 1 },
  };
  const records = [
    {
      id: 'tech-1',
      source: 'hn',
      sectionId: 'technology',
      title: 'Technology source',
      excerpt: 'A tool was released.',
    },
    {
      id: 'custom-1',
      source: 'custom:test',
      sectionId: team.id,
      title: 'Connector source',
      excerpt: 'A connector was released.',
    },
  ];
  let repair = false;
  const model = async (_system, input) => {
    if (!input.assignment) return wrap(plan);
    if (repair) assert.equal(input.assignment.sectionId, team.id);
    const a = {
      id: 'draft-' + input.assignment.id,
      title: input.assignment.sectionTitle,
      summary: 'A sourced release.',
      body: 'A supported description.',
      topic: 'Tools',
      whyYou: '',
      evidenceIds: input.evidence.map((e) => e.id),
    };
    if (!input.drafts) return wrap({ drafts: [a] });
    if (!repair && input.assignment.sectionId === team.id)
      return wrap({
        brief: 'Bad format',
        decisions: [{ decision: 'accept', article: { ...a, id: 'unknown' } }],
      });
    // A missing decision draftId is recoverable only from a known article.id.
    return wrap({
      brief: 'A useful release.',
      decisions: [{ decision: 'accept', reason: 'Supported.', article: a }],
    });
  };
  const first = await publishCurrent({
    model,
    collectors: {
      news: async () => ({ evidence: records }),
      personal: async () => ({ evidence: [] }),
      markets: async () => ({
        evidence: [],
        quotes: [{ symbol: 'TEST', price: 42, fetchedAt: '2026-10-19T01:00:00Z' }],
      }),
    },
  });
  assert.equal(first.issue.coverage.errors.length, 1);
  assert.equal(first.sections.news.articles.length, 1);
  const kept = structuredClone(first.sections.news.articles[0]);
  const old = JSON.stringify(readPublication(first.issue.id));
  state.preferences.context.place = 'A future reader context';
  const pending = JSON.stringify(state.preferences);
  repair = true;
  const never = async () => {
    throw Error('Retry must not recollect sources');
  };
  const next = await publishCurrent({
    model,
    retryIncomplete: true,
    collectors: { news: never, personal: never, markets: never },
  });
  assert.equal(next.issue.revisesIssueId, first.issue.id);
  assert.equal(next.issue.coverage.errors.length, 0);
  assert.equal(next.sections.news.articles.length, 2);
  assert.deepEqual(
    next.sections.news.articles.find((a) => a.sectionId === 'technology'),
    kept,
  );
  assert.deepEqual(next.quotes, first.quotes);
  assert.equal(next.issue.date, first.issue.date);
  assert.equal(JSON.stringify(readPublication(first.issue.id)), old);
  assert.equal(JSON.stringify(state.preferences), pending);
  assert.equal(next.issue.identity.context.place, 'San Francisco');
});
const team = {
  id: 'custom-composio',
  label: 'Composio Watch',
  description: 'Connector coverage',
  direction: 'Practical connectors; titles and descriptions only.',
  sources: [{ type: 'youtube', url: 'https://www.youtube.com/@Composio/videos' }],
};
const wrap = (data) => ({ data, model: 'test', durationMs: 1, usage: {} });
const plan = {
  title: 'The Builder Paper',
  description: 'A declared builder context.',
  reason: 'The reader declared SF and building.',
  sectionOrder: PAPER_SECTIONS.map((s) => s.id),
};

test('names stay stable without meaningful context changes, including adding a team; manual and locked modes persist', async () => {
  const prefs = {
    ...initial.preferences,
    context: { place: 'San Francisco', activity: 'Building', interests: 'AI' },
    identity: { mode: 'auto', title: '', description: '' },
  };
  let calls = 0;
  const model = async () => {
    calls++;
    return wrap(plan);
  };
  const first = await chooseIdentity(prefs, null, model);
  const added = {
    ...prefs,
    paper: {
      ...DEFAULT_PAPER,
      customSections: [team],
      sections: { ...DEFAULT_PAPER.sections, [team.id]: 1 },
    },
  };
  const same = await chooseIdentity(added, first, model);
  assert.equal(calls, 1);
  assert.equal(same.title, first.title);
  assert.equal(same.decidedAt, first.decidedAt);
  assert.ok(same.sectionOrder.includes(team.id));
  const locked = await chooseIdentity(
    { ...prefs, context: { ...prefs.context, place: 'South Korea' }, identity: { mode: 'locked' } },
    first,
    model,
  );
  assert.equal(locked.title, first.title);
  assert.equal(locked.context.place, 'South Korea');
  assert.equal(first.context.place, 'San Francisco');
  const manual = await chooseIdentity(
    { ...prefs, identity: { mode: 'manual', title: 'My Own Paper', description: 'My choice' } },
    first,
    model,
  );
  assert.equal(manual.title, 'My Own Paper');
  assert.equal(calls, 2);
  const empty = await chooseIdentity(
    { ...prefs, context: { place: '', activity: '', interests: '' }, topics: [] },
    null,
    () => {
      throw Error('should not infer context');
    },
  );
  assert.equal(empty.title, 'The Personal Paper');
});

test('YouTube channel validation and feed parsing preserve source scope without inventing transcripts', () => {
  assert.deepEqual(channelInput(team.sources[0].url), { handle: '@Composio' });
  for (const input of [
    'https://youtube.com.evil.test/@Composio',
    'https://user:password@youtube.com/@Composio',
    'https://www.youtube.com/watch?v=123',
    'http://127.0.0.1/',
    'https://www.youtube.com/playlist?list=x',
  ])
    assert.throws(() => channelInput(input));
  const feed = parseFeed(
    '<feed><title>Composio</title><entry><yt:videoId>abcdefghijk</yt:videoId><title>A connector demo</title><published>2026-10-12T01:00:00Z</published><media:group><media:description>Public description only.</media:description></media:group></entry></feed>',
    team.sources[0],
    team,
  );
  assert.equal(feed.items[0].sourceKind, 'video_metadata');
  assert.equal(feed.items[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(feed.items[0].sectionId, team.id);
  assert.equal(feed.items[0].excerpt, 'Public description only.');
  assert.equal(feed.items[0].transcript, undefined);
  const paper = {
    ...DEFAULT_PAPER,
    customSections: [team],
    sections: { ...DEFAULT_PAPER.sections, [team.id]: 2 },
  };
  paperSchema.parse(paper);
  const records = Array.from({ length: 12 }, (_, i) => ({ ...feed.items[0], id: String(i) }));
  const assignments = buildAssignments('news', records, paper);
  assert.equal(assignments.length, 2);
  assert.equal(new Set(assignments.flatMap((j) => j.evidence.map((e) => e.id))).size, 12);
  assert.ok(assignments.every((j) => j.editorialDirection === team.direction));
  assert.throws(() => paperSchema.parse({ ...paper, sections: DEFAULT_PAPER.sections }));
  const proposal = validateProposal(
    { summary: 'Follow Composio.', changes: ['Add the team.'], patch: { paper } },
    initial.preferences,
  );
  assert.equal(proposal.preferences.paper.customSections[0].id, team.id);
  assert.equal(proposal.preferences.timezone, initial.preferences.timezone);
});

test('failed completed publication keeps the prior current paper and writes no archive', async () => {
  state.preferences.context = { place: '', activity: '', interests: '' };
  state.preferences.topics = [];
  state.issue = { id: 'previous', identity: null };
  state.sections.news.articles = [{ id: 'old', title: 'Keep this' }];
  const before = JSON.stringify({
      sections: state.sections,
      issue: state.issue,
      quotes: state.quotes,
    }),
    count = listPublications().length;
  const empty = async () => ({ evidence: [] });
  await assert.rejects(
    publishCurrent({
      collectors: { news: empty, personal: empty, markets: empty },
      model: () => {
        throw Error('No sources should not invoke reporters');
      },
    }),
    /No articles passed/,
  );
  assert.equal(
    JSON.stringify({ sections: state.sections, issue: state.issue, quotes: state.quotes }),
    before,
  );
  assert.equal(listPublications().length, count);
  assert.ok(!publicState().active.includes('edition'));
});

test('custom reporter and editor publish atomically, preserve declared context and snapshot, and exclude racing desk refreshes', async () => {
  state.preferences.context = {
    place: 'San Francisco',
    activity: 'Cline hackathon',
    interests: 'Connectors',
  };
  state.preferences.paper = {
    ...DEFAULT_PAPER,
    customSections: [team],
    sections: { ...DEFAULT_PAPER.sections, [team.id]: 1 },
  };
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  const record = {
    id: 'video-1',
    sectionId: team.id,
    source: 'custom:test',
    title: 'Connector release',
    excerpt: 'A supported connector announcement.',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    sourceKind: 'video_metadata',
  };
  const model = async (_system, input) => {
    if (!input.assignment) return wrap(plan);
    const article = {
      id: 'draft',
      title: 'Connector release',
      summary: 'The channel announced a connector.',
      body: 'The source is a public description.',
      whyYou: 'Relevant to the declared connector interest.',
      topic: 'Connectors',
      evidenceIds: ['video-1'],
      importance: 90,
      relevance: { contextKeys: ['interests'], evidenceIds: ['video-1'] },
    };
    return wrap(
      input.drafts
        ? {
            brief: 'Evidence checked.',
            decisions: [
              { draftId: 'draft', decision: 'accept', reason: 'Matches source metadata.', article },
            ],
          }
        : { drafts: [article] },
    );
  };
  const running = publishCurrent({
    model,
    collectors: {
      news: async () => {
        await wait;
        return { evidence: [record] };
      },
      personal: async () => ({ evidence: [] }),
      markets: async () => ({ evidence: [], quotes: [] }),
    },
  });
  assert.ok(publicState().active.includes('edition'));
  assert.deepEqual(await refreshSection('news'), { skipped: true });
  release();
  const saved = await running;
  assert.equal(saved.issue.identity.context.place, 'San Francisco');
  const article = saved.sections.news.articles[0];
  assert.equal(article.sectionId, team.id);
  assert.equal(article.versions.length, 2);
  assert.equal(article.review.length, 1);
  assert.deepEqual(article.personalization.context, { interests: 'Connectors' });
  assert.equal(state.issue.id, saved.issue.id);
  assert.ok(saved.pages.some((p) => p.sectionId === team.id));
  state.preferences.context.place = 'South Korea';
  state.sections.news.articles[0].title = 'Later live change';
  assert.equal(
    readPublication(saved.issue.id).sections.news.articles[0].title,
    'Connector release',
  );
  assert.equal(readPublication(saved.issue.id).issue.identity.context.place, 'San Francisco');
});
