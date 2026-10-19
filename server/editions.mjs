import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { state, save, readPublication } from './store.mjs';
import { archivePublication } from './archive.mjs';
import { chooseIdentity, contextSchema } from './identity.mjs';
import { runCline } from './cline.mjs';
import { editAssignment, beginPublication, endPublication, broadcast, log } from './newsroom.mjs';
import * as sources from './sources.mjs';
import { collectPersonal } from './composio.mjs';
import { collectAppleCalendar } from './apple-calendar.mjs';
import { imagesForEvidence } from './media.mjs';
import { DEFAULT_PAPER, buildAssignments, sectionOf } from '../shared/paper.mjs';
import { dateWindow, inWindow, localDate } from '../shared/edition.mjs';
import { now } from './utils.mjs';
export const reconstructionSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().max(100),
    context: contextSchema,
  })
  .strict();
export function reconstructionWindow(input) {
  const r = reconstructionSchema.parse(input),
    window = dateWindow(r.startDate, r.endDate, r.timezone);
  if (r.endDate > r.date || r.startDate > r.date || r.date >= localDate(now(), r.timezone))
    throw Error('Choose a past edition date and a source range ending on or before it.');
  dateWindow(r.date, r.date, r.timezone);
  return window;
}
const jobs = new Map();
export function publicationJobs() {
  return [...jobs.values()].map((j) => structuredClone(j));
}
function update(job, patch) {
  Object.assign(job, patch);
}
function rememberJob(job) {
  jobs.set(job.id, job);
  for (const [id, old] of jobs) {
    if (jobs.size <= 30) break;
    if (old.status !== 'running') jobs.delete(id);
  }
}
function blank(desk) {
  return {
    desk,
    articles: [],
    evidence: [],
    notes: [],
    status: 'empty',
    error: null,
    pageErrors: {},
    review: [],
    revision: 0,
  };
}
async function editCollected({
  prefs,
  collected,
  issue,
  seed,
  model = runCline,
  progress = () => {},
}) {
  const sections = seed
    ? structuredClone(seed.sections)
    : Object.fromEntries(['news', 'personal', 'markets'].map((d) => [d, blank(d)]));
  const retryIds = seed
    ? new Set(Object.values(seed.sections).flatMap((s) => Object.keys(s.pageErrors || {})))
    : null;
  if (seed)
    for (const section of Object.values(sections)) {
      section.error = null;
      section.pageErrors = {};
      section.articles = section.articles.filter((a) => !retryIds.has(a.assignmentId));
    }
  const notes = [];
  const statuses = {};
  let quotes = [];
  for (const [desk, result] of Object.entries(collected)) {
    sections[desk].evidence = result.evidence || [];
    sections[desk].notes = result.notes || [];
    notes.push(...(result.notes || []));
    Object.assign(statuses, result.statuses || {});
    if (result.quotes) quotes = result.quotes;
  }
  const assignments = Object.keys(sections).flatMap((desk) =>
    buildAssignments(desk, sections[desk].evidence, prefs.paper)
      .filter((a) => !retryIds || retryIds.has(a.id))
      .map((a) => ({ ...a, desk })),
  );
  let cursor = 0,
    finished = 0;
  const errors = [];
  const runs = [];
  await Promise.all(
    Array.from({ length: Math.min(2, assignments.length) }, async () => {
      while (cursor < assignments.length) {
        const assignment = assignments[cursor++],
          section = sections[assignment.desk];
        const run = {
          id: randomUUID(),
          desk: assignment.desk,
          assignmentId: assignment.id,
          issueId: issue.id,
          startedAt: now(),
          status: 'running',
          calls: [],
          reason: 'publication',
        };
        runs.push(run);
        try {
          const result = await editAssignment({
            assignment,
            desk: assignment.desk,
            section,
            prefs,
            model,
            run,
            runId: run.id,
            editionContext: {
              kind: issue.kind,
              date: issue.date,
              timezone: issue.timezone,
              window: issue.window,
              generatedAt: issue.publishedAt,
              identity: issue.identity,
            },
            emit: (_desk, phase) =>
              progress(
                `${phase}: ${assignment.sectionTitle} ${assignment.page}`,
                finished,
                assignments.length,
              ),
          });
          section.articles.push(...result.accepted);
          section.review.push(...result.reviewHistory);
          section.brief = result.review.brief;
          section.status = result.accepted.length ? 'published' : 'held';
          run.status = result.accepted.length ? 'published' : 'held';
        } catch (error) {
          run.status = 'error';
          section.pageErrors[assignment.id] =
            error.name === 'ZodError'
              ? `Editorial output did not pass validation (${error.issues
                  .slice(0, 3)
                  .map((i) => `${i.path.join('.')}: ${i.code}`)
                  .join('; ')}).`
              : error.message;
          errors.push(
            `${assignment.sectionTitle} ${assignment.page}: ${section.pageErrors[assignment.id]}`,
          );
          section.error = 'Some assigned reporting could not be completed.';
        }
        run.finishedAt = now();
        run.durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
        finished++;
        progress('Editing pages', finished, assignments.length);
      }
    }),
  );
  if (seed && assignments.length && errors.length === assignments.length)
    throw Error(
      'The incomplete pages still did not pass review. Your current issue has been kept.',
    );
  for (const section of Object.values(sections)) {
    section.articles = [...new Map(section.articles.map((a) => [a.id, a])).values()];
    section.status = section.articles.length
      ? 'published'
      : section.error
        ? 'error'
        : section.evidence.length
          ? 'held'
          : 'empty';
    section.revision = section.articles.length ? 1 : 0;
    section.articles.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    section.lastPublished = issue.publishedAt;
    section.lastChecked = issue.publishedAt;
    section.articles = section.articles.map((a) => ({
      ...a,
      images:
        issue.kind === 'reconstructed'
          ? []
          : seed && !retryIds.has(a.assignmentId)
            ? a.images
            : imagesForEvidence(a.evidence),
    }));
    section.evidence = section.evidence.map((e) => ({
      ...e,
      images: issue.kind === 'reconstructed' ? [] : imagesForEvidence([e]),
    }));
  }
  issue.coverage = {
    statuses,
    notes,
    errors,
    sourceCount: Object.values(sections).reduce((n, s) => n + s.evidence.length, 0),
    articleCount: Object.values(sections).reduce((n, s) => n + s.articles.length, 0),
  };
  return {
    version: 2,
    edition: issue.id,
    issue,
    preferences: structuredClone(prefs),
    sections,
    quotes,
    sourceStatus: statuses,
    active: [],
    runtime: {},
    events: [],
    runs,
    connections: {},
  };
}
export async function publishCurrent({
  model = runCline,
  collectors = sources,
  retryIncomplete = false,
} = {}) {
  if (!beginPublication())
    throw Error('A current desk is still working. Publish when it finishes.');
  const job = {
    id: randomUUID(),
    kind: 'current',
    status: 'running',
    startedAt: now(),
    step: 'Commissioning the edition',
  };
  rememberJob(job);
  try {
    const seed = retryIncomplete ? readPublication(state.issue?.id || '') : null;
    if (seed) {
      // Include completed live desk updates since the previous publication;
      // preserve pending reader preferences separately from this issue's plan.
      seed.sections = structuredClone(state.sections);
      seed.quotes = structuredClone(state.quotes);
      seed.sourceStatus = structuredClone(state.sourceStatus);
    }
    if (
      retryIncomplete &&
      (!seed || !Object.values(seed.sections).some((s) => Object.keys(s.pageErrors || {}).length))
    )
      throw Error('There are no incomplete pages to retry.');
    const prefs = structuredClone(seed?.preferences || state.preferences);
    const identity = seed
      ? structuredClone(seed.issue.identity)
      : await chooseIdentity(prefs, state.issue?.identity, model);
    const issue = {
      id: `issue-${randomUUID()}`,
      kind: 'published',
      date: seed?.issue.date || localDate(now(), prefs.timezone),
      timezone: prefs.timezone,
      publishedAt: now(),
      identity,
      readingPreferences: prefs,
      ...(seed ? { revisesIssueId: seed.issue.id } : {}),
    };
    update(job, {
      step: seed
        ? 'Retrying incomplete pages from preserved sources'
        : 'Collecting current sources',
    });
    log(
      'editor',
      'collecting',
      seed
        ? 'Retrying only incomplete pages; completed reporting and its source period are preserved.'
        : 'The Daily Edit is collecting sources for a completed issue.',
    );
    const settled = await Promise.allSettled(
      ['news', 'personal', 'markets'].map((d) =>
        seed
          ? Promise.resolve({
              evidence: seed.sections[d].evidence,
              notes: seed.sections[d].notes,
              statuses: seed.sourceStatus,
              ...(d === 'markets' ? { quotes: seed.quotes } : {}),
            })
          : collectors[d](prefs),
      ),
    );
    const collected = Object.fromEntries(
      ['news', 'personal', 'markets'].map((d, i) => [
        d,
        settled[i].status === 'fulfilled'
          ? settled[i].value
          : {
              evidence: [],
              notes: [`${d} source collection failed: ${settled[i].reason.message}`],
              statuses: { [d]: { ok: false, error: 'Source collection failed.' } },
            },
      ]),
    );
    const view = await editCollected({
      prefs,
      collected,
      issue,
      model,
      seed,
      progress: (step, done, total) => {
        update(job, { step, done, total });
        if (step !== 'Editing pages')
          log(
            'editor',
            step.split(':')[0],
            `${step} · ${done}/${total} page assignments completed`,
          );
      },
    });
    if (!issue.coverage.articleCount)
      throw Error(
        state.issue
          ? 'No articles passed editorial review. The current issue has been kept.'
          : `No stories could be published. ${issue.coverage.errors[0] || 'Check that your selected pages have available sources.'} Check your sources and Cline sign-in, then try again.`,
      );
    issue.publishedAt = now();
    const publication = archivePublication(view);
    // Commit the completed current issue only after its immutable archive exists.
    state.sections = structuredClone(view.sections);
    if (!seed) state.quotes = view.quotes;
    state.sourceStatus = view.sourceStatus;
    state.issue = structuredClone(issue);
    if (!seed) state.lastDailyDate = issue.date;
    state.runs = [...view.runs, ...state.runs].slice(0, 40);
    state.edition++;
    for (const result of Object.values(collected))
      if (result.connections) Object.assign(state.connections, result.connections);
    log(
      'editor',
      'published',
      `${identity.title}: ${issue.coverage.articleCount} edited stories in a preserved issue.`,
    );
    update(job, {
      status: 'completed',
      step: 'Published',
      publicationId: issue.id,
      finishedAt: now(),
    });
    save();
    return publication;
  } catch (error) {
    update(job, { status: 'failed', error: error.message, finishedAt: now() });
    throw error;
  } finally {
    endPublication();
  }
}
export async function reconstruct(
  input,
  {
    model = runCline,
    collectMail = collectPersonal,
    collectCalendar = collectAppleCalendar,
    archive = archivePublication,
    progress = () => {},
  } = {},
) {
  const window = reconstructionWindow(input);
  // No live preferences, sections, quotes, clocks, connections or scheduler state are mutated.
  const prefs = {
    topics: input.context.interests
      ? [input.context.interests]
      : ['Personal correspondence', 'Calendar'],
    instructions:
      'Reconstruct only the selected retained personal records. Attribute every statement; distinguish historical plans from confirmed attendance. Do not import present-day interests or public information.',
    context: structuredClone(input.context),
    identity: { mode: 'auto', title: '', description: '' },
    timezone: input.timezone,
    region: 'KR',
    calendarProvider: 'apple',
    feedback: [],
    paper: {
      depth: 'standard',
      sections: Object.fromEntries(Object.keys(DEFAULT_PAPER.sections).map((k) => [k, 0])),
    },
    autoUpdate: false,
    coins: [],
    stocks: [],
    intervals: { news: 900, personal: 300, markets: 60 },
    dailyTime: '08:00',
    sourceEnabled: { hn: false, google: false, bbc: false },
  };
  progress('Reading retained Gmail and iCloud records');
  const results = await Promise.allSettled([
    collectMail(input.timezone, { includeCalendar: false, window }),
    collectCalendar(window),
  ]);
  const notes = [
    'Reconstructed from records retained at generation time, not a newspaper published on the historical date.',
    'Past iCloud events reflect the calendar as it exists now; deleted events and earlier versions cannot be recovered.',
    'No historical public news, market prices or travel times were retrieved. These sections are intentionally omitted.',
  ];
  const evidence = [],
    statuses = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      evidence.push(...r.value.evidence.filter((e) => inWindow(e, window)));
      notes.push(...r.value.notes);
      Object.assign(statuses, r.value.statuses);
    } else {
      const key = i ? 'applecalendar' : 'gmail';
      statuses[key] = { ok: false, count: 0, error: r.reason.message };
      notes.push(`${key}: ${r.reason.message}`);
    }
  });
  for (const id of ['inbox', 'calendar']) {
    const count = evidence.filter((e) => sectionOf(e) === id).length;
    prefs.paper.sections[id] = count > 6 ? 2 : 1;
  }
  const identity = await chooseIdentity(prefs, null, model);
  const issue = {
    id: `issue-${randomUUID()}`,
    kind: 'reconstructed',
    date: input.date,
    timezone: input.timezone,
    publishedAt: now(),
    window,
    identity,
    readingPreferences: structuredClone(prefs),
  };
  const view = await editCollected({
    prefs,
    collected: { personal: { evidence, notes, statuses } },
    issue,
    model,
    progress,
  });
  issue.publishedAt = now();
  return archive(view);
}
export function startReconstruction(input) {
  reconstructionWindow(input);
  if ([...jobs.values()].some((j) => j.kind === 'reconstructed' && j.status === 'running'))
    throw Error('A reconstruction is already running.');
  const job = {
    id: randomUUID(),
    kind: 'reconstructed',
    status: 'running',
    startedAt: now(),
    step: 'Reading the requested period',
  };
  jobs.set(job.id, job);
  void reconstruct(input, { progress: (step, done, total) => update(job, { step, done, total }) })
    .then((publication) =>
      update(job, {
        status: 'completed',
        step: 'Preserved in the archive',
        publicationId: publication.issue.id,
        finishedAt: now(),
      }),
    )
    .catch((e) => update(job, { status: 'failed', error: e.message, finishedAt: now() }));
  return job;
}
