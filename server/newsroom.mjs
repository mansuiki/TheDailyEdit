import { EventEmitter } from 'node:events';
import { state, save, snapshot } from './store.mjs';
import * as sources from './sources.mjs';
import {
  runCline,
  reporterSystem,
  editorSystem,
  draftsSchema,
  reviewSchema,
  validateEvidence,
} from './cline.mjs';
import { now, hash } from './utils.mjs';
import { randomUUID } from 'node:crypto';
import { collectImages, imagesForEvidence } from './media.mjs';
import { buildAssignments, DEFAULT_PAPER } from '../shared/paper.mjs';
export const events = new EventEmitter();
events.setMaxListeners(50);
const active = new Set();
const desks = ['news', 'personal', 'markets'];
const names = { news: 'News', personal: 'My Day', markets: 'Markets' };
export function broadcast() {
  save();
  events.emit('update');
}
export function log(desk, phase, message, extra = {}) {
  state.events.unshift({
    id: randomUUID(),
    desk,
    phase,
    message,
    time: now(),
    language: 'en',
    ...extra,
  });
  state.events = state.events.slice(0, 150);
  broadcast();
}
export function publicState() {
  return {
    ...state,
    sections: {
      ...state.sections,
      news: {
        ...state.sections.news,
        articles: state.sections.news.articles.map((a) => ({
          ...a,
          images: imagesForEvidence(a.evidence),
        })),
        evidence: state.sections.news.evidence.map((e) => ({
          ...e,
          images: imagesForEvidence([e]),
        })),
      },
    },
    active: [...active],
    runtime: {
      cline: true,
      scheduler: 'local',
      scope: 'single-user',
      parallelImages: Boolean(process.env.PARALLEL_API_KEY),
      privateDataHandling:
        'Gmail and calendar sources are stored locally. Briefing and translation excerpts are sent to your configured Cline model provider.',
    },
  };
}
export async function refreshMedia() {
  if (active.has('images') || !process.env.PARALLEL_API_KEY) return;
  active.add('images');
  events.emit('update');
  try {
    const s = state.sections.news;
    const targets = [
      ...s.articles.flatMap((a) => a.evidence),
      ...s.evidence.filter((e) => e.source === 'google').slice(0, 2),
      ...s.evidence,
    ];
    state.sourceStatus.parallelImages = await collectImages(targets);
  } catch (error) {
    state.sourceStatus.parallelImages = { ok: false, error: error.message, checkedAt: now() };
  } finally {
    active.delete('images');
    broadcast();
  }
}
function fingerprint(evidence) {
  return hash(evidence.map(({ fetchedAt, score, comments, ...e }) => e));
}
export function mergeEvidence(previous, current, statuses = {}) {
  const failed = new Set(
    Object.entries(statuses)
      .filter(([, s]) => !s.ok)
      .map(([id]) => id),
  );
  return [
    ...current,
    ...previous
      .filter((e) => failed.has(e.source) && !current.some((n) => n.id === e.id))
      .map((e) => ({ ...e, stale: true })),
  ];
}
export function mergeQuotes(previous, current) {
  return current.map((q) => {
    const old = previous.find((p) => p.symbol === q.symbol);
    if (old && Date.parse(old.fetchedAt) > Date.parse(q.fetchedAt)) return old;
    if (q.error) return { ...(old || q), error: q.error, stale: true, lastAttemptAt: q.fetchedAt };
    return { ...q, lastSuccessAt: q.fetchedAt };
  });
}
export async function refreshQuotes() {
  if (active.has('quotes')) return;
  active.add('quotes');
  try {
    const result = await sources.markets(state.preferences);
    state.quotes = mergeQuotes(state.quotes, result.quotes);
    Object.assign(state.sourceStatus, result.statuses);
    broadcast();
  } finally {
    active.delete('quotes');
    events.emit('update');
  }
}
function checkReviews(result, drafts, evidence) {
  const ids = new Set(drafts.map((d) => d.id));
  // An accepted article already carries its exact draft ID. Recover only that
  // unambiguous linkage; never guess an ID from order or bypass validation.
  const normalized = {
    ...result,
    decisions: Array.isArray(result?.decisions)
      ? result.decisions.map((r) =>
          r?.draftId == null && ids.has(r?.article?.id) ? { ...r, draftId: r.article.id } : r,
        )
      : result?.decisions,
  };
  const parsed = reviewSchema.parse(normalized);
  const seen = new Set();
  for (const r of parsed.decisions) {
    if (!ids.has(r.draftId) || seen.has(r.draftId))
      throw new Error('The editor returned an invalid article ID.');
    seen.add(r.draftId);
    if (r.decision === 'accept') {
      if (!r.article || r.article.id !== r.draftId) throw new Error('Edited article is missing.');
      validateEvidence(r.article, evidence);
    }
  }
  if (seen.size !== ids.size) throw new Error('Some drafts were not reviewed.');
  return parsed;
}
export async function editAssignment({
  assignment,
  desk,
  section,
  prefs,
  model,
  run,
  runId,
  emit = log,
  editionContext,
}) {
  const evidence = assignment.evidence;
  const input = {
    desk,
    assignment: { ...assignment, evidence: undefined },
    currentTime: now(),
    edition: editionContext,
    readerContext: prefs.context,
    timezone: prefs.timezone,
    preferences: {
      context: prefs.context,
      topics: prefs.topics,
      instructions: prefs.instructions,
      feedback: (prefs.feedback || []).slice(-20),
    },
    evidence,
    sourceNotes: section.notes,
  };
  section.status = 'writing';
  emit(
    desk,
    'writing',
    `${assignment.sectionTitle} reporter is drafting page ${assignment.page} from ${evidence.length} sources.`,
    {
      runId,
    },
  );
  const first = await model(reporterSystem, input);
  run.calls.push({
    role: 'reporter',
    durationMs: first.durationMs,
    model: first.model,
    usage: first.usage,
  });
  const drafts = draftsSchema.parse(first.data).drafts;
  if (new Set(drafts.map((d) => d.id)).size !== drafts.length)
    throw new Error('Duplicate draft IDs.');
  drafts.forEach((d) => validateEvidence(d, evidence));
  section.status = 'reviewing';
  emit(
    desk,
    'reviewing',
    `The editor is checking ${drafts.length} drafts for evidence, dates and repetition.`,
    {
      runId,
    },
  );
  const reviewRun = await model(editorSystem, { ...input, drafts });
  run.calls.push({
    role: 'editor',
    durationMs: reviewRun.durationMs,
    model: reviewRun.model,
    usage: reviewRun.usage,
  });
  let review = checkReviews(reviewRun.data, drafts, evidence);
  const reviewHistory = review.decisions.map((r) => ({ ...r, round: 1, time: now() }));
  review.decisions.forEach((r) =>
    emit(desk, r.decision, r.reason, {
      runId,
      draftId: r.draftId,
      requestedChanges: r.requestedChanges,
    }),
  );
  const revisions = review.decisions.filter((d) => d.decision === 'revise');
  const versions = new Map(
    drafts.map((d) => [d.id, [{ stage: 'draft', article: d, time: now() }]]),
  );
  if (revisions.length) {
    section.status = 'revising';
    emit(
      desk,
      'revising',
      `The reporter is revising ${revisions.length} drafts based on editorial feedback.`,
      { runId },
    );
    const revisedRun = await model(reporterSystem, {
      ...input,
      assignment: { ...input.assignment, targetArticles: revisions.length },
      task: `Revise ONLY the supplied drafts according to the editor. Return exactly ${revisions.length} drafts with these exact IDs: ${JSON.stringify(revisions.map((r) => r.draftId))}. Do not write replacements for accepted or held drafts.`,
      requiredDraftIds: revisions.map((r) => r.draftId),
      drafts: drafts.filter((d) => revisions.some((r) => r.draftId === d.id)),
      editorInstructions: revisions,
    });
    run.calls.push({
      role: 'revision',
      durationMs: revisedRun.durationMs,
      model: revisedRun.model,
      usage: revisedRun.usage,
    });
    const revised = draftsSchema.parse(revisedRun.data).drafts;
    const requested = new Set(revisions.map((r) => r.draftId));
    if (
      revised.length !== requested.size ||
      new Set(revised.map((d) => d.id)).size !== requested.size ||
      revised.some((d) => !requested.has(d.id))
    )
      throw new Error('Revised article IDs do not match the request.');
    revised.forEach((d) => {
      validateEvidence(d, evidence);
      versions.get(d.id).push({ stage: 'revision', article: d, time: now() });
    });
    section.status = 'reviewing';
    emit(desk, 'reviewing', 'The editor is reviewing the revised drafts.', { runId });
    const finalRun = await model(editorSystem, {
      ...input,
      drafts: revised,
      task: 'Final review. Hold if still unsupported. Only accept or hold; revision budget is exhausted.',
    });
    run.calls.push({
      role: 'final_editor',
      durationMs: finalRun.durationMs,
      model: finalRun.model,
      usage: finalRun.usage,
    });
    const final = checkReviews(finalRun.data, revised, evidence);
    final.decisions = final.decisions.map((r) =>
      r.decision === 'revise'
        ? { ...r, decision: 'hold', reason: `Revision limit reached: ${r.reason}` }
        : r,
    );
    reviewHistory.push(...final.decisions.map((r) => ({ ...r, round: 2, time: now() })));
    review = {
      brief: final.brief,
      decisions: review.decisions.map(
        (r) => final.decisions.find((f) => f.draftId === r.draftId) || r,
      ),
    };
  }
  const accepted = review.decisions
    .filter((r) => r.decision === 'accept')
    .map((r) => {
      const article = r.article;
      const id = `${desk}-${hash([assignment.sectionId, ...article.evidenceIds.slice().sort()])}`;
      const previous = section.articles.find((a) => a.id === id);
      return {
        ...article,
        whyYou:
          article.relevance?.contextKeys?.length &&
          article.relevance.contextKeys.every((k) => prefs.context?.[k])
            ? article.whyYou
            : '',
        personalization:
          article.relevance?.contextKeys?.length &&
          article.relevance.contextKeys.every((k) => prefs.context?.[k])
            ? {
                context: Object.fromEntries(
                  article.relevance.contextKeys.map((k) => [k, prefs.context[k]]),
                ),
                evidenceIds: article.relevance.evidenceIds,
              }
            : null,
        id,
        desk,
        language: 'en',
        sectionId: assignment.sectionId,
        sectionTitle: assignment.sectionTitle,
        pageInSection: assignment.page,
        assignmentId: assignment.id,
        revision: (previous?.revision || 0) + 1,
        updatedAt: now(),
        editorReason: r.reason,
        evidence: article.evidenceIds.map((id) => evidence.find((e) => e.id === id)),
        versions: [
          ...(versions.get(r.draftId) || []),
          { stage: 'published', article, time: now() },
        ],
        review: reviewHistory.filter((x) => x.draftId === r.draftId),
        appliedPreferences: prefs.instructions,
      };
    });
  return { accepted, reviewHistory, review };
}
async function mapAssignments(jobs, run) {
  const results = new Array(jobs.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const index = cursor++;
        try {
          results[index] = { status: 'fulfilled', value: await run(jobs[index]) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}
export async function refreshSection(desk, { force = false, reason = 'manual', services } = {}) {
  if (!desks.includes(desk) || active.has(desk) || active.has('edition')) return { skipped: true };
  active.add(desk);
  const section = state.sections[desk];
  const startedAt = now();
  const runId = randomUUID();
  const run = { id: runId, desk, startedAt, status: 'running', calls: [], reason };
  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 40);
  const prefs = structuredClone(
    state.issue?.readingPreferences
      ? {
          ...state.preferences,
          ...state.issue.readingPreferences,
          feedback: state.preferences.feedback,
        }
      : state.preferences,
  );
  const collect = services?.collect ?? sources[desk];
  const model = services?.model ?? runCline;
  section.lastAttempt = startedAt;
  section.status = 'collecting';
  section.error = null;
  log(desk, 'collecting', `${names[desk]} reporter is collecting live sources.`, { runId });
  try {
    const result = await collect(prefs);
    section.lastChecked = now();
    Object.assign(state.sourceStatus, result.statuses || {});
    if (result.connections) Object.assign(state.connections, result.connections);
    if (result.quotes) state.quotes = mergeQuotes(state.quotes, result.quotes);
    const evidence = mergeEvidence(section.evidence, result.evidence, result.statuses);
    section.evidence = evidence;
    if (desk === 'news') void refreshMedia();
    section.notes = result.notes || [];
    broadcast();
    if (!evidence.length) {
      if (
        desk === 'personal' &&
        Object.values(state.connections).some((c) => c.status === 'active')
      )
        section.articles = [];
      section.status =
        desk === 'personal' && !Object.values(state.connections).some((c) => c.status === 'active')
          ? 'connection_required'
          : 'empty';
      run.status = 'completed';
      log(
        desk,
        'empty',
        desk === 'personal'
          ? 'Connect your personal accounts to create a briefing.'
          : 'No sources available. Keeping the previous edition.',
        { runId },
      );
      return;
    }
    const nextFingerprint = hash({
      sources: fingerprint(evidence),
      paper: prefs.paper,
      context: prefs.context,
      topics: prefs.topics,
      instructions: prefs.instructions,
      feedback: prefs.feedback,
    });
    if (
      !force &&
      section.language === 'en' &&
      nextFingerprint === section.fingerprint &&
      section.articles.length
    ) {
      section.status = 'published';
      run.status = 'unchanged';
      log(desk, 'unchanged', 'Sources are unchanged. Keeping the existing articles.', { runId });
      return;
    }
    const assignments = buildAssignments(desk, evidence, prefs.paper || DEFAULT_PAPER);
    if (!assignments.length) {
      section.status = 'empty';
      run.status = 'completed';
      log(desk, 'empty', 'No enabled pages have sources. Adjust your newspaper plan.', { runId });
      return;
    }
    run.assignments = assignments.map(({ evidence, ...job }) => ({
      ...job,
      sourceCount: evidence.length,
    }));
    log(
      desk,
      'writing',
      `Assigning ${evidence.length} collected records to ${assignments.length} page reporters.`,
      { runId },
    );
    const results = await mapAssignments(assignments, (assignment) =>
      editAssignment({ assignment, desk, section, prefs, model, run, runId }),
    );
    const completed = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    section.pageErrors = Object.fromEntries(
      results.flatMap((r, i) =>
        r.status === 'rejected'
          ? [
              [
                assignments[i].id,
                'This page could not finish editorial review. Any earlier stories are marked as retained.',
              ],
            ]
          : [],
      ),
    );
    if (!completed.length) throw results.find((r) => r.status === 'rejected').reason;
    const failures = results.flatMap((r, i) => (r.status === 'rejected' ? [assignments[i]] : []));
    const accepted = completed.flatMap((r) => r.accepted);
    // A failed page retains its previous version; successful pages can still publish.
    if (failures.length) {
      accepted.push(
        ...section.articles
          .filter((a) => failures.some((job) => a.assignmentId === job.id))
          .map((a) => ({ ...a, stale: true })),
      );
      section.notes.push(
        `${failures.length} page assignments failed. Earlier versions are retained where available.`,
      );
      log(desk, 'error', section.notes.at(-1), { runId });
    }
    const unique = new Map(accepted.map((a) => [a.id, a]));
    accepted.splice(0, accepted.length, ...unique.values());
    const reviewHistory = completed.flatMap((r) => r.reviewHistory);
    const review = {
      brief: completed.map((r) => r.review.brief).join(' '),
      decisions: completed.flatMap((r) => r.review.decisions),
    };
    section.review = reviewHistory;
    section.brief = review.brief;
    section.coverage = {
      collected: evidence.length,
      assigned: assignments.reduce((n, j) => n + j.evidence.length, 0),
      assignments: assignments.length,
      failed: failures.length,
      edited: accepted.filter((a) => !a.stale).length,
      extracted: evidence.filter((e) => e.extractedBy).length,
    };
    if (accepted.length) {
      section.articles = accepted;
      section.language = 'en';
      section.lastPublished = now();
      section.revision++;
      section.fingerprint = nextFingerprint;
      section.status = 'published';
      state.edition++;
      snapshot();
      log(
        desk,
        'published',
        `${accepted.length} articles published · ${review.decisions.filter((r) => r.decision === 'hold').length} held`,
        { runId },
      );
    } else {
      section.status = 'held';
      log(desk, 'held', 'No articles accepted. Keeping the previous edition.', { runId });
    }
    run.status = 'completed';
  } catch (error) {
    section.status = 'error';
    section.error =
      error.name === 'ZodError'
        ? `Article output validation failed (${error.issues
            .slice(0, 3)
            .map((i) => i.path.join('.'))
            .join(', ')}). Keeping the previous edition.`
        : error.message;
    run.status = 'error';
    run.error = section.error;
    log(desk, 'error', section.error, { runId });
  } finally {
    run.finishedAt = now();
    run.durationMs = Date.now() - Date.parse(startedAt);
    active.delete(desk);
    broadcast();
  }
}
export async function refreshAll(options = {}) {
  const { publishCurrent } = await import('./editions.mjs');
  return publishCurrent(options);
}
export function beginPublication() {
  if (active.has('edition') || desks.some((d) => active.has(d))) return false;
  active.add('edition');
  events.emit('update');
  return true;
}
export function endPublication() {
  active.delete('edition');
  broadcast();
}
let tickRunning = false,
  lastQuoteAt = 0,
  lastDailyAttempt = 0;
export function dailyEditionKey(preferences, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: preferences.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const v = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${v.hour}:${v.minute}` >= preferences.dailyTime ? `${v.year}-${v.month}-${v.day}` : null;
}
export function startScheduler() {
  // One local scheduler owns cadence. Cline CLI owns all editorial runs; no duplicate Hub jobs.
  const timer = setInterval(async () => {
    if (tickRunning || active.has('edition') || !schedulerReady(state)) return;
    tickRunning = true;
    try {
      const p = state.preferences;
      const ts = Date.now();
      if (ts - lastQuoteAt >= p.intervals.markets * 1000) {
        lastQuoteAt = ts;
        void refreshQuotes().catch((e) => log('markets', 'error', e.message));
      }
      for (const desk of ['news', 'personal']) {
        const last = state.sections[desk].lastAttempt || state.sections[desk].lastChecked;
        if (last && ts - Date.parse(last) >= p.intervals[desk] * 1000)
          void refreshSection(desk, { reason: 'schedule' });
      }
      const date = dailyEditionKey(p);
      if (
        date &&
        state.lastDailyDate !== date &&
        ts - lastDailyAttempt > 3600000 &&
        active.size === 0
      ) {
        lastDailyAttempt = ts;
        state.lastDailyDate = date;
        broadcast();
        void refreshAll({ force: true, reason: 'daily' }).catch((e) =>
          log('editor', 'error', e.message),
        );
      }
    } finally {
      tickRunning = false;
    }
  }, 5000);
  timer.unref();
  return timer;
}
export function schedulerReady(current) {
  return Boolean(current.issue && current.preferences.autoUpdate);
}
