import { archivePublication } from './archive.mjs';
import { readPublication } from './store.mjs';
import { DEFAULT_PAPER } from '../shared/paper.mjs';
import { dateWindow } from '../shared/edition.mjs';
import { now } from './utils.mjs';

// A stable identity makes the explicit demo action idempotent across restarts.
// This fixture never reads connected accounts, current preferences or live feeds.
export const KOREA_DEMO_ID = 'issue-821e49a1-a4d6-487c-89ba-328386d06735';
const demoNotice = 'Demo edition · Illustrative data, not your historical records';
const limitation =
  'No historical Gmail or iCloud records were retrieved. The correspondence and calendar examples are fictional. South Korea is reader-supplied context; no city, attendance or personal activity is inferred.';

export function buildDemoEdition(generatedAt = now()) {
  const timezone = 'Asia/Seoul';
  const context = { place: 'South Korea', activity: '', interests: '' };
  const paper = {
    depth: 'standard',
    sections: {
      ...Object.fromEntries(Object.keys(DEFAULT_PAPER.sections).map((k) => [k, 0])),
      inbox: 1,
      calendar: 1,
    },
    customSections: [],
  };
  const preferences = {
    context,
    identity: {
      mode: 'manual',
      title: 'The Korea Brief',
      description: 'An illustrative personal edition set in South Korea.',
    },
    topics: [],
    instructions: 'Clearly label every example as fictional demo data.',
    region: 'KR',
    timezone,
    calendarProvider: 'apple',
    feedback: [],
    coins: [],
    stocks: [],
    sourceEnabled: { hn: false, google: false, bbc: false },
    autoUpdate: false,
    dailyTime: '08:00',
    intervals: { news: 900, personal: 300, markets: 60 },
    paper,
  };
  const source = (id, sectionId, title, excerpt, extra = {}) => ({
    id,
    sectionId,
    title,
    excerpt,
    sourceSummary: excerpt,
    source: 'demo',
    sourceLabel: 'Demo · fictional example',
    demo: true,
    visibility: 'demo',
    contentStatus: 'demo',
    publishedAt: '2026-10-11T23:00:00.000Z',
    fetchedAt: generatedAt,
    images: [],
    ...extra,
  });
  const evidence = [
    source(
      'demo-reading-list',
      'inbox',
      'Example correspondence: a reading list',
      'Fictional message for the demo: a sender shares a short reading list and asks which item to discuss. No sender, delivery or reading history is real.',
    ),
    source(
      'demo-weekly-note',
      'inbox',
      'Example correspondence: a weekly note',
      'Fictional message for the demo: a weekly note separates material to read from a question that needs a reply. It does not describe any actual correspondence.',
    ),
    source(
      'demo-planning-block',
      'calendar',
      'Fictional calendar example: planning time',
      'A fictional 30-minute planning block at 10:00 on October 12, 2026 in Asia/Seoul. No location, attendance or real calendar record is asserted.',
      {
        start: '2026-10-12T01:00:00.000Z',
        end: '2026-10-12T01:30:00.000Z',
        allDay: false,
        location: '',
      },
    ),
  ];
  const article = (id, index, fields) => ({
    id,
    desk: 'personal',
    sectionId: evidence[index].sectionId,
    pageInSection: 1,
    assignmentId: `${evidence[index].sectionId}-1`,
    revision: 1,
    language: 'en',
    demo: true,
    topic: 'DEMO · ILLUSTRATIVE',
    updatedAt: generatedAt,
    evidenceIds: [evidence[index].id],
    evidence: [structuredClone(evidence[index])],
    images: [],
    versions: [],
    review: [],
    whyYou: '',
    personalization: null,
    editorReason:
      'Handwritten illustrative copy for the demo. It was not produced from your connected accounts or an actual reporter/editor run.',
    appliedPreferences: preferences.instructions,
    ...fields,
  });
  const articles = [
    article('demo-korea-reading', 0, {
      importance: 80,
      title: 'A reading list, with room to choose',
      summary:
        'Illustrative inbox story: a fictional message becomes a short, readable item on your paper’s correspondence page.',
      body: 'This is a fictional inbox example for The Korea Brief. The example message contains a reading list and a question about what to discuss next. It is not an email from your account.\n\nThe layout shows how a personal newspaper can keep a small decision beside its supporting source. In a real edition, the reporter would cite the connected message and the editor would check that the summary stayed within that evidence.\n\nThe date and South Korea context belong to this demo setting. No city, work, travel or attendance has been inferred, and no historical news has been added.',
    }),
    article('demo-korea-correspondence', 1, {
      importance: 60,
      title: 'Separate the question from the reading',
      summary:
        'A second fictional example shows how an inbox page can distinguish an item to read from one that asks for a response.',
      body: 'The demo’s weekly note is an invented source record. It demonstrates a useful editorial distinction: some correspondence is background reading, while a question may deserve its own short item.\n\nThere is no real sender, deadline or obligation behind this example. Open Sources to see its full label and inspect exactly what the example contains. The archive preserves this text with the edition instead of replacing it with new messages.',
    }),
    article('demo-korea-calendar', 2, {
      importance: 70,
      title: 'One illustrative planning block, in local time',
      summary:
        'A fictional 10:00–10:30 planning block demonstrates the calendar page in Asia/Seoul. It is not a recovered appointment.',
      body: 'The calendar fixture places one fictional planning block at 10:00 on October 12, 2026, using Asia/Seoul. It exists only to demonstrate how the saved edition keeps its original local date and time.\n\nNo address is attached, so the paper makes no claim about a city or journey. Current traffic, travel estimates, news and market prices are absent from this past-dated demo.\n\nActual reconstruction, when requested separately, can only use past events still retained in the current calendar. Deleted events, earlier event versions and attendance cannot be recovered merely by opening an old date.',
    }),
  ];
  const blank = (desk) => ({
    desk,
    articles: [],
    evidence: [],
    notes: [],
    status: 'empty',
    error: null,
    review: [],
    revision: 0,
    lastChecked: generatedAt,
    lastPublished: generatedAt,
  });
  const sections = {
    news: blank('news'),
    personal: {
      ...blank('personal'),
      articles,
      evidence,
      status: 'published',
      notes: [demoNotice, limitation],
    },
    markets: blank('markets'),
  };
  const identity = {
    title: 'The Korea Brief',
    description: 'An illustrative personal edition set in South Korea.',
    reason:
      'Demo title based only on the reader-supplied South Korea setting. This fixture does not claim a verified historical location or activity.',
    context: structuredClone(context),
    topics: [],
    mode: 'manual',
    decidedAt: generatedAt,
    sectionOrder: [
      'inbox',
      'calendar',
      'technology',
      'world',
      'business',
      'science',
      'culture',
      'markets',
    ],
  };
  const issue = {
    id: KOREA_DEMO_ID,
    kind: 'demo',
    date: '2026-10-12',
    timezone,
    publishedAt: generatedAt,
    window: dateWindow('2026-10-12', '2026-10-12', timezone),
    identity,
    readingPreferences: structuredClone(preferences),
    demoNotice,
    coverage: {
      sourceCount: 3,
      articleCount: 3,
      statuses: { demo: { ok: true, count: 3 } },
      errors: [],
      notes: [
        demoNotice,
        limitation,
        'No historical public news, prices or travel times are included. Created at the displayed generation time, not issued on the displayed historical date.',
      ],
    },
  };
  return {
    version: 2,
    edition: KOREA_DEMO_ID,
    issue,
    preferences,
    sections,
    quotes: [],
    sourceStatus: issue.coverage.statuses,
    active: [],
    runtime: {},
    events: [],
    runs: [],
    connections: {},
  };
}

export function createDemoEdition() {
  const existing = readPublication(KOREA_DEMO_ID);
  return existing || archivePublication(buildDemoEdition());
}
