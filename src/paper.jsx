import React, { useState, useRef, useMemo } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Layers,
  Plus,
  Sparkles,
  RefreshCw,
  Printer,
  ChevronDown,
} from 'lucide-react';
import {
  assemblePages,
  PAPER_SECTIONS,
  sectionCatalog,
  paperSection,
  sectionOf,
  relatedItems,
  pageCount,
} from '../shared/paper.mjs';
import CalendarMap from './calendar-map';
import './print.css';
const busyStates = ['collecting', 'writing', 'reviewing', 'revising'];
const safeUrl = (value) => {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const words = (text) => (text || '').trim().split(/\s+/).filter(Boolean).length;
function paragraphs(text) {
  return (text || '').split(/\n+/).filter(Boolean);
}
function PaperImage({ image, open }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return null;
  return (
    <figure className="print-photo">
      <button onClick={() => open(image)} aria-label={`Enlarge: ${image.title}`}>
        <img src={image.url} alt={image.title} loading="lazy" onError={() => setFailed(true)} />
      </button>
      <figcaption>
        {image.relation === 'source' ? 'Publisher image' : 'Related image'} · {image.sourceHost}
      </figcaption>
    </figure>
  );
}
function Byline({ article }) {
  return (
    <div className="print-byline">
      By the {article.sectionTitle || paperSection(sectionOf(article))?.label || 'Personal'} desk{' '}
      <span>
        · {article.demo ? 'Illustrative demo copy' : 'Editor reviewed'}
        {article.stale ? ' · Previous edition' : ''}
      </span>
    </div>
  );
}
function Story({
  article: a,
  open,
  openImage,
  featured = false,
  teaser = false,
  continueTo,
  feedback,
}) {
  const picture = a.images?.find((i) => i.relation === 'source');
  return (
    <article
      className={`print-story ${featured ? 'print-lead' : ''} ${teaser ? 'teaser-story' : ''}`}
    >
      <span className="print-kicker">{a.topic}</span>
      <button className="print-headline" onClick={() => open(a)}>
        <h3>{a.title}</h3>
      </button>
      <p className="print-deck">{a.summary}</p>
      <Byline article={a} />
      {a.whyYou && a.personalization && (
        <details className="paper-relevance">
          <summary>Why this matters to you</summary>
          <p>{a.whyYou}</p>
          <small>
            Based on your declared context: {Object.values(a.personalization.context).join(' · ')} ·{' '}
            {a.personalization.evidenceIds.length} cited source(s).
          </small>
        </details>
      )}
      {picture && featured && <PaperImage image={picture} open={openImage} />}
      <div className="print-body">
        {(teaser ? paragraphs(a.body).slice(0, 1) : paragraphs(a.body)).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="print-story-links">
        <button onClick={continueTo || (() => open(a))}>
          {continueTo ? 'Continued inside' : 'Sources, edits & translation'}{' '}
          <ArrowRight size={12} />
        </button>
        {!teaser && feedback && (
          <button
            className="print-feedback"
            onClick={() => feedback(a.id, 'more')}
            title="Guide future editions"
          >
            More like this <Plus size={11} />
          </button>
        )}
      </div>
    </article>
  );
}
function WireBriefs({ items, title = 'In brief', max = 5 }) {
  return (
    <section className="print-briefs">
      <h3>{title}</h3>
      {items.slice(0, max).map((e) => (
        <article key={e.id}>
          <span>
            {e.sourceLabel}
            {e.stale ? ' · Earlier source' : ''}
          </span>
          <a href={safeUrl(e.url)} target="_blank" rel="noreferrer">
            <h4>{e.title}</h4>
          </a>
          <p>
            {e.sourceSummary
              ? e.sourceSummary.slice(0, 170) + (e.sourceSummary.length > 170 ? '…' : '')
              : e.contentStatus === 'headline'
                ? 'Read the story →'
                : 'Continue reading →'}
          </p>
        </article>
      ))}
    </section>
  );
}
function MarketLedger({ quotes }) {
  return (
    <section className="market-ledger">
      <h3>The market ledger</h3>
      <p>Quotes are independent of the article’s publication snapshot.</p>
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Price</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <tr key={q.symbol}>
              <th>{q.symbol}</th>
              <td>
                {q.price
                  ? new Intl.NumberFormat('en-US', {
                      style: 'currency',
                      currency: q.currency || 'USD',
                    }).format(q.price)
                  : 'Unavailable'}
              </td>
              <td>
                {q.changePercent == null
                  ? 'Spot'
                  : `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <small>
        Equities may be delayed. Crypto spot change is not supplied. These are observations, not
        investment advice.
      </small>
    </section>
  );
}
function CalendarDiary({ events, timezone }) {
  return (
    <section className="calendar-diary">
      <h3>The week ahead</h3>
      {events
        .filter((e) => e.start)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
        .map((e) => (
          <div className="diary-entry" key={e.id}>
            <time>
              <b>
                {new Intl.DateTimeFormat('en-US', { timeZone: timezone, day: 'numeric' }).format(
                  new Date(e.start),
                )}
              </b>
              <span>
                {new Intl.DateTimeFormat('en-US', {
                  timeZone: timezone,
                  month: 'short',
                  weekday: 'short',
                }).format(new Date(e.start))}
              </span>
            </time>
            <div>
              <strong>{e.title}</strong>
              <span>
                {e.allDay
                  ? 'All day'
                  : new Intl.DateTimeFormat('en-US', {
                      timeZone: timezone,
                      hour: 'numeric',
                      minute: '2-digit',
                    }).format(new Date(e.start))}
              </span>
              <small>
                {e.location || 'No location in the calendar'}
                {e.stale ? ' · Earlier calendar data' : ''}
              </small>
            </div>
          </div>
        ))}
    </section>
  );
}
export function RelatedReading({ article, state, open }) {
  const all = Object.values(state.sections).flatMap((s) => s.articles),
    evidence = Object.values(state.sections).flatMap((s) => s.evidence);
  const related = relatedItems(article, all, evidence);
  if (!related.articles.length && !related.sources.length) return null;
  return (
    <section className="related-reading">
      <span className="eyebrow">KEEP READING</span>
      <h3>The story around the story.</h3>
      <div>
        {related.articles.map((r) => (
          <button key={r.article.id} onClick={() => open(r.article)}>
            <small>{r.reason}</small>
            <strong>{r.article.title}</strong>
            <ArrowRight size={14} />
          </button>
        ))}
        {related.sources.map((e) => (
          <a key={e.id} href={safeUrl(e.url)} target="_blank" rel="noreferrer">
            <small>Related source · {e.sourceLabel}</small>
            <strong>{e.title}</strong>
            <ArrowUpRight size={14} />
          </a>
        ))}
      </div>
    </section>
  );
}
export default function PaperReader({ state, open, openImage, feedback, action, api, configure }) {
  const pages = useMemo(() => assemblePages(state), [state]);
  const [currentId, setCurrentId] = useState(() =>
      location.hash.startsWith('#issue/')
        ? location.hash.split('/')[2] || 'front'
        : location.hash.startsWith('#paper/')
          ? location.hash.slice(7)
          : 'front',
    ),
    [mode, setMode] = useState('page'),
    [expanding, setExpanding] = useState(false);
  const top = useRef();
  const index = Math.max(
      0,
      pages.findIndex((p) => p.id === currentId),
    ),
    current = pages[index];
  const all = Object.values(state.sections).flatMap((s) => s.articles),
    sources = Object.values(state.sections).flatMap((s) => s.evidence);
  const publicStories = all
      .filter((a) => a.desk !== 'personal')
      .sort((a, b) => (b.importance || 0) - (a.importance || 0)),
    paper = state.preferences.paper;
  const identity = state.issue?.identity;
  const title = identity?.title || 'The Personal Paper';
  const catalogue = sectionCatalog(paper);
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: state.issue?.date ? 'UTC' : state.preferences.timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(state.issue?.date ? new Date(state.issue.date + 'T12:00:00Z') : new Date());
  const busy = state.active.some((d) => ['edition', 'news', 'personal', 'markets'].includes(d));
  function go(id) {
    setCurrentId(id);
    if (mode === 'all') {
      requestAnimationFrame(() =>
        document
          .getElementById(`sheet-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    history.replaceState(
      null,
      '',
      state.archived ? `#issue/${state.issue.id}/${id}` : `#paper/${id}`,
    );
  }
  function pageFor(a) {
    return (
      pages.find((p) => p.id !== 'front' && p.articles.some((x) => x.id === a.id)) ||
      pages.find((p) => p.sectionId === sectionOf(a))
    );
  }
  async function expand() {
    if (!paper || current.sectionId === 'front') return;
    setExpanding(true);
    try {
      const latest = await action('/state', null, 'GET');
      if (!latest) return;
      const { feedback: ignored, ...prefs } = latest.preferences;
      if (!(current.sectionId in prefs.paper.sections)) return;
      const next = {
        ...prefs.paper,
        sections: {
          ...prefs.paper.sections,
          [current.sectionId]: prefs.paper.sections[current.sectionId] + 1,
        },
      };
      const result = await action('/preferences', { ...prefs, paper: next }, 'PUT');
      if (result) await action('/editions');
    } finally {
      setExpanding(false);
    }
  }
  const lead = publicStories[0] || all[0];
  const supporting = publicStories.filter((a) => a.id !== lead?.id);
  const feature = supporting.find((a) => a.images?.some((i) => i.relation === 'source'));
  const adjacent = supporting.find((a) => a.id !== feature?.id);
  const sectionPicks = PAPER_SECTIONS.filter(
    (s) => s.desk === 'news' && s.id !== sectionOf(lead || {}),
  )
    .map((s) =>
      supporting.find(
        (a) => sectionOf(a) === s.id && a.id !== feature?.id && a.id !== adjacent?.id,
      ),
    )
    .filter(Boolean);
  const coverStories = [
    ...sectionPicks,
    ...supporting.filter(
      (a) => a.id !== feature?.id && a.id !== adjacent?.id && !sectionPicks.includes(a),
    ),
  ].slice(0, 3);
  const usedSections = catalogue
    .filter((s) => pages.some((p) => p.sectionId === s.id))
    .sort(
      (a, b) =>
        pages.findIndex((p) => p.sectionId === a.id) - pages.findIndex((p) => p.sectionId === b.id),
    );
  const goArticle = (a) => {
    const p = pageFor(a);
    p ? go(p.id) : open(a);
  };
  return (
    <div className={`paper-reader reading-${mode}`} ref={top}>
      <header className="newspaper-masthead edition-masthead">
        <div className="masthead-date">
          <strong>{today}</strong>
          <span>
            {state.archived ? 'Preserved issue' : 'Today’s paper'} · {pages.length} pages
          </span>
        </div>
        <button aria-label="Return to the front page" onClick={() => go('front')}>
          <h1>{title}</h1>
        </button>
        <div className="masthead-edition">
          <strong>THE PERSONAL EDITION</strong>
          <span>Published by The Daily Edit</span>
        </div>
      </header>
      {identity && (
        <div className="identity-caption">
          <span>{identity.description}</span>
          <details>
            <summary>Why this name?</summary>
            <p>{identity.reason}</p>
            <small>
              Reader-declared context:{' '}
              {Object.values(identity.context || {})
                .filter(Boolean)
                .join(' · ') || 'No place or activity supplied.'}
            </small>
          </details>
        </div>
      )}
      {state.archived && (
        <aside className="archived-note">
          {state.issue.kind === 'demo' ? (
            <strong>Demo edition · Illustrative data, not your historical records.</strong>
          ) : state.issue.kind === 'reconstructed' ? (
            <strong>Reconstructed edition</strong>
          ) : (
            <strong>Archived edition</strong>
          )}
          <span>
            Issue date: {state.issue.date} · {state.issue.timezone}. Created{' '}
            {new Intl.DateTimeFormat('en-US', {
              timeZone: state.issue.timezone,
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(state.issue.publishedAt))}
            .
          </span>
          {state.issue.coverage?.notes?.length > 0 && (
            <details>
              <summary>Source coverage & limitations</summary>
              {state.issue.coverage.notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </details>
          )}
        </aside>
      )}
      {state.issue?.coverage && (
        <details className="edition-coverage" data-no-capture>
          <summary>
            Edition coverage · {state.issue.coverage.sourceCount}{' '}
            {state.issue.kind === 'demo' ? 'example records' : 'source records'} ·{' '}
            {state.issue.coverage.articleCount} stories
          </summary>
          {[...(state.issue.coverage.notes || []), ...(state.issue.coverage.errors || [])].map(
            (note, i) => (
              <p key={i}>{note}</p>
            ),
          )}
          {Object.entries(state.issue.coverage.statuses || {})
            .filter(([, value]) => !value.ok)
            .map(([key, value]) => (
              <p key={key}>
                {key}: {value.error || 'Source unavailable for this issue.'}
              </p>
            ))}
        </details>
      )}
      {!state.archived && state.issue?.coverage?.errors?.length > 0 && (
        <aside className="edition-repair" data-no-capture>
          <div>
            <strong>Some pages need another edit.</strong>
            <p>
              Your published stories are ready to read. Retry the incomplete pages from the sources
              already collected.
            </p>
          </div>
          <button
            className="outline-button"
            disabled={busy}
            onClick={() => action('/editions/retry')}
          >
            <RefreshCw size={14} className={busy ? 'spin' : ''} />
            {busy ? 'Finishing pages…' : 'Finish incomplete pages'}
          </button>
        </aside>
      )}
      <nav className="paper-section-tabs" aria-label="Edition sections">
        <button
          className={current.sectionId === 'front' ? 'active' : ''}
          onClick={() => go('front')}
        >
          A · Front Page
        </button>
        {usedSections.map((s) => (
          <button
            key={s.id}
            className={current.sectionId === s.id ? 'active' : ''}
            onClick={() => go(pages.find((p) => p.sectionId === s.id).id)}
          >
            {s.letter} · {s.label}
            <small>{pages.filter((p) => p.sectionId === s.id).length}</small>
          </button>
        ))}
      </nav>
      <div className="reading-toolbar" data-no-capture>
        <div className="folio-controls" data-no-capture>
          <button onClick={() => go(pages[index - 1].id)} disabled={index === 0}>
            <ArrowLeft size={14} />
            Previous
          </button>
          <div>
            <b>{current.folio}</b>
            <span>
              {current.label} · Page {index + 1} of {pages.length}
            </span>
          </div>
          <button onClick={() => go(pages[index + 1].id)} disabled={index === pages.length - 1}>
            Turn the page
            <ArrowRight size={14} />
          </button>
        </div>
        <div className="reading-tools">
          <button aria-pressed={mode === 'page'} onClick={() => setMode('page')}>
            <BookOpen size={14} />
            Page by page
          </button>
          <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
            <Layers size={14} />
            Unfold all
          </button>
          {configure && (
            <button onClick={configure}>
              <Sparkles size={14} />
              Ask your editor
            </button>
          )}
          <button onClick={() => window.print()} aria-label="Print the full edition">
            <Printer size={15} />
          </button>
        </div>
      </div>

      {pages.map((page) => (
        <section
          id={`sheet-${page.id}`}
          key={page.id}
          className={`broadsheet ${page.sectionId === 'front' ? 'cover-sheet' : 'inside-sheet'}`}
          aria-label={`${page.folio} ${page.label}`}
          hidden={mode === 'page' && page.id !== current.id}
          data-current-page={page.id === current.id}
        >
          <div className="page-imprint">
            <strong>{title}</strong>
            <span>
              {today} · {state.issue?.timezone || state.preferences.timezone}
            </span>
            <span>Published by The Daily Edit</span>
          </div>
          {state.archived && state.issue.kind !== 'published' && (
            <p className="print-edition-label">
              {state.issue.kind === 'demo'
                ? 'DEMO EDITION · Illustrative data, not historical records'
                : 'RECONSTRUCTED EDITION'}{' '}
              · Created {state.issue.publishedAt}
            </p>
          )}
          {page.sectionId === 'front' ? (
            <>
              {state.quotes.length > 0 && (
                <div className="cover-ticker">
                  <span>MARKET WATCH</span>
                  {state.quotes.map((q) => (
                    <span key={q.symbol}>
                      <b>{q.symbol}</b>
                      {q.price
                        ? new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: q.currency || 'USD',
                            maximumFractionDigits: 2,
                          }).format(q.price)
                        : '—'}
                      <small>
                        {q.changePercent == null
                          ? 'SPOT'
                          : `${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`}
                      </small>
                    </span>
                  ))}
                  <button
                    onClick={() => go(pages.find((p) => p.sectionId === 'markets')?.id || 'front')}
                  >
                    Inside markets →
                  </button>
                </div>
              )}
              <div className="cover-grid">
                <div className="cover-main">
                  {lead ? (
                    <>
                      <div className="cover-lead">
                        <div>
                          <span className="print-kicker">THE LEAD · {lead.topic}</span>
                          <button className="print-headline" onClick={() => goArticle(lead)}>
                            <h2>{lead.title}</h2>
                          </button>
                          <p className="print-deck">{lead.summary}</p>
                          <Byline article={lead} />
                          <button className="print-jump" onClick={() => goArticle(lead)}>
                            Continue on {pageFor(lead)?.folio || 'the inside pages'}{' '}
                            <ArrowRight size={12} />
                          </button>
                          {adjacent && (
                            <article className="lead-related">
                              <span className="print-kicker">
                                ALSO IN {paperSection(sectionOf(adjacent))?.label}
                              </span>
                              <button
                                className="print-headline"
                                onClick={() => goArticle(adjacent)}
                              >
                                <h3>{adjacent.title}</h3>
                              </button>
                              <p>{adjacent.summary}</p>
                              <button className="print-jump" onClick={() => goArticle(adjacent)}>
                                Read on {pageFor(adjacent)?.folio} →
                              </button>
                            </article>
                          )}
                        </div>
                        {lead.images?.some((i) => i.relation === 'source') ? (
                          <PaperImage
                            image={lead.images.find((i) => i.relation === 'source')}
                            open={openImage}
                          />
                        ) : (
                          <div className="lead-column-text">
                            {paragraphs(lead.body)
                              .slice(0, 2)
                              .map((p, i) => (
                                <p key={i}>{p}</p>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="cover-supporting">
                        {coverStories.map((a) => (
                          <div key={a.id}>
                            <Story
                              article={a}
                              open={open}
                              openImage={openImage}
                              teaser
                              continueTo={() => goArticle(a)}
                              feedback={feedback}
                            />
                            <small className="jump-folio">
                              {pageFor(a)?.folio} ·{' '}
                              {paperSection(sectionOf(a), paper)?.label || a.sectionTitle}
                            </small>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="waiting-for-press">
                      <span className="eyebrow">THE FIRST EDITION</span>
                      <h2>
                        A world of stories.
                        <br />A paper of your own.
                      </h2>
                      <p>
                        Your newspaper is ready for its reporters. Publish an edition to fill these
                        pages with real reporting.
                      </p>
                      <button
                        className="outline-button"
                        disabled={busy}
                        onClick={() => action('/editions')}
                      >
                        {busy ? 'Reporters are working…' : 'Send to the newsroom'}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
                  {state.sections.news.evidence.length > 0 && (
                    <div className="cover-bottom-wire">
                      <WireBriefs
                        items={state.sections.news.evidence.filter(
                          (e) => !lead?.evidenceIds.includes(e.id),
                        )}
                        title="Across the wires"
                        max={3}
                      />
                    </div>
                  )}
                </div>
                <aside className="cover-rail">
                  {feature && (
                    <article className="rail-feature">
                      <PaperImage
                        image={feature.images.find((i) => i.relation === 'source')}
                        open={openImage}
                      />
                      <span className="print-kicker">{feature.topic}</span>
                      <button className="print-headline" onClick={() => goArticle(feature)}>
                        <h3>{feature.title}</h3>
                      </button>
                      <p>{feature.summary}</p>
                      <button className="print-jump" onClick={() => goArticle(feature)}>
                        Read on {pageFor(feature)?.folio} →
                      </button>
                    </article>
                  )}
                  <span className="rail-overline">YOUR PERSONAL BRIEFING · PRIVATE</span>
                  {[...state.sections.personal.articles]
                    .filter((a) => a.id !== lead?.id)
                    .sort(
                      (a, b) =>
                        (identity?.sectionOrder?.indexOf(sectionOf(a)) ?? 0) -
                        (identity?.sectionOrder?.indexOf(sectionOf(b)) ?? 0),
                    )
                    .slice(0, 2)
                    .map((a) => (
                      <article key={a.id}>
                        <span className="print-kicker">
                          {paperSection(sectionOf(a), paper)?.label || a.sectionTitle}
                        </span>
                        <button className="print-headline" onClick={() => goArticle(a)}>
                          <h3>{a.title}</h3>
                        </button>
                        <p>{a.summary}</p>
                        <button className="print-jump" onClick={() => goArticle(a)}>
                          Read on {pageFor(a)?.folio || 'the inside pages'} →
                        </button>
                      </article>
                    ))}
                  <section className="inside-index">
                    <h3>Inside today</h3>
                    {usedSections.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => go(pages.find((p) => p.sectionId === s.id).id)}
                      >
                        <span>{s.label}</span>
                        <i />
                        <b>
                          {s.letter}1
                          {paper?.sections[s.id] > 1 ? `–${s.letter}${paper.sections[s.id]}` : ''}
                        </b>
                      </button>
                    ))}
                  </section>
                  <div className="editor-postscript">
                    <span>FROM THE EDITOR</span>
                    <p>
                      {state.sections.news.brief?.slice(0, 300) ||
                        'Every story has a source. Every page has a purpose. Your interests decide what gets room.'}
                    </p>
                    {configure && <button onClick={configure}>Write to your editor ↗</button>}
                  </div>
                </aside>
              </div>
            </>
          ) : (
            <>
              <header className="running-head">
                <strong>{page.folio}</strong>
                <span>{title.toUpperCase()}</span>
                <span>{today}</span>
                {page.desk === 'personal' && <b>PRIVATE EDITION</b>}
              </header>
              <div className="section-nameplate">
                <div>
                  <span>
                    SECTION {page.folio[0]} · {page.articles.length} EDITED{' '}
                    {page.articles.length === 1 ? 'STORY' : 'STORIES'}
                  </span>
                  <h2>{page.label}</h2>
                  <p>{page.description}</p>
                </div>
                <div className="section-page-note">
                  <strong>{page.folio}</strong>
                  <span>{page.evidence.length} source records</span>
                  <small>
                    {busyStates.includes(page.status)
                      ? 'The desk is reporting…'
                      : 'Evidence-led reporting'}
                  </small>
                </div>
              </div>
              {page.error && <p className="page-notice">{page.error}</p>}
              <div className="inside-grid">
                <div className="inside-main">
                  {page.articles.length ? (
                    page.articles.map((a, i) => (
                      <Story
                        key={a.id}
                        article={a}
                        featured={i === 0}
                        open={open}
                        openImage={openImage}
                        feedback={feedback}
                      />
                    ))
                  ) : (
                    <div className="waiting-for-press">
                      <span className="eyebrow">AT THE NEWS DESK</span>
                      <h3>
                        {busyStates.includes(page.status)
                          ? 'This page is being reported.'
                          : 'Room for the next story.'}
                      </h3>
                      <p>
                        {page.evidence.length
                          ? 'The collected sources appear alongside this space. Publish this desk to commission edited reporting.'
                          : 'No sources have arrived for this page yet. Your editor will not invent a story to fill the space.'}
                      </p>
                      {!state.archived && (
                        <button
                          className="outline-button"
                          disabled={busyStates.includes(page.status)}
                          onClick={() => action(`/sections/${page.desk}/refresh`)}
                        >
                          <RefreshCw size={13} />
                          Report this section
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <aside className="inside-sidebar">
                  {page.sectionId === 'calendar' ? (
                    <CalendarDiary events={page.evidence} timezone={state.preferences.timezone} />
                  ) : page.sectionId === 'markets' ? (
                    <MarketLedger quotes={state.quotes} />
                  ) : (
                    <WireBriefs
                      items={page.evidence.filter(
                        (e) => !page.articles.some((a) => a.evidenceIds.includes(e.id)),
                      )}
                      max={5}
                    />
                  )}
                  <div className="page-editor-note">
                    <span>ON THIS PAGE</span>
                    <p>{page.description || 'Stories and reading selected for this edition.'}</p>
                    <b>
                      {page.articles.length} stories · {page.evidence.length} records
                    </b>
                  </div>
                  {page.articles[0] && (
                    <RelatedReading article={page.articles[0]} state={state} open={open} />
                  )}
                </aside>
              </div>
              {page.sectionId === 'calendar' && state.archived && (
                <p className="archived-note">
                  This diary is preserved with the issue. Current routes and travel estimates are
                  not calculated in archived editions.
                </p>
              )}
              {page.sectionId === 'calendar' && !state.archived && (
                <CalendarMap
                  events={page.evidence}
                  timezone={state.preferences.timezone}
                  api={api}
                />
              )}
              <details className="source-register">
                <summary>
                  Open the source register · {page.evidence.length} records{' '}
                  <ChevronDown size={13} />
                </summary>
                <p>
                  All records assigned to this page, including those the editor did not turn into a
                  story. Headline-only records have not been read as full articles.
                </p>
                <div>
                  {page.evidence.map((e) => (
                    <a key={e.id} href={safeUrl(e.url)} target="_blank" rel="noreferrer">
                      <small>
                        {e.sourceLabel} ·{' '}
                        {e.extractedBy
                          ? 'Extracted source'
                          : e.contentStatus === 'headline'
                            ? 'Headline only'
                            : 'Source excerpt'}
                      </small>
                      <strong>{e.title}</strong>
                      <ArrowUpRight size={13} />
                    </a>
                  ))}
                </div>
              </details>
            </>
          )}
          <div className="paper-colophon">
            <span>{title.toUpperCase()}</span>
            <span>
              {page.sectionId === 'front'
                ? `${sources.length} ${state.issue?.kind === 'demo' ? 'example records' : 'collected records'} · ${all.length} ${state.issue?.kind === 'demo' ? 'illustrative stories' : 'edited stories'} · ${pages.length} pages`
                : state.issue?.kind === 'demo'
                  ? 'Illustrative demo · Not actual reporting or personal records'
                  : 'Reported by Cline · Reviewed independently · Sources preserved'}
            </span>
            <b>{page.folio}</b>
          </div>
        </section>
      ))}
      <div className="reader-end" data-no-capture>
        <div>
          <strong>
            {current.folio} / {pages.at(-1).folio}
          </strong>
          <span>{current.label}</span>
        </div>
        <div>
          {current.sectionId !== 'front' && !state.archived && (
            <button
              className="text-button"
              disabled={
                expanding ||
                busy ||
                paper?.sections[current.sectionId] >= 4 ||
                pageCount(paper) >= 21
              }
              onClick={expand}
            >
              <Plus size={14} />
              {expanding ? 'Expanding…' : 'Give this section another page'}
            </button>
          )}
          <button
            className="outline-button"
            disabled={index === pages.length - 1}
            onClick={() => go(pages[index + 1].id)}
          >
            Turn the page
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
