import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import './archive.css';

function editionDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return date || 'Undated edition';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}
function generatedTime(at, timezone) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(at));
  } catch {
    return at || 'Not recorded';
  }
}
function ArchiveCover({ edition }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="archive-cover" aria-hidden="true">
      <span className="archive-cover-publisher">Published by The Daily Edit</span>
      <h3>{edition.identity?.title || 'Untitled edition'}</h3>
      <div className="archive-cover-rule">
        <span>{edition.date}</span>
        <span>{edition.pageCount} pages</span>
      </div>
      {edition.cover?.url && !failed && (
        <img src={edition.cover.url} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
      <div className="archive-cover-headlines">
        {(edition.headlines || []).map((headline, i) => (
          <strong key={`${i}-${headline}`}>{headline}</strong>
        ))}
      </div>
      <span className="archive-cover-caption">
        {edition.kind === 'demo'
          ? 'ILLUSTRATIVE DEMO'
          : edition.kind === 'reconstructed'
            ? 'RECONSTRUCTED EDITION'
            : 'PRESERVED EDITION'}
      </span>
    </div>
  );
}
export default function Archive({ api, onOpen, notify }) {
  const [editions, setEditions] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [opening, setOpening] = useState(null),
    [creating, setCreating] = useState(false),
    [query, setQuery] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api('/editions', null, 'GET');
      setEditions(Array.isArray(result) ? result : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    api('/editions', null, 'GET')
      .then((result) => {
        if (!cancelled) setEditions(Array.isArray(result) ? result : []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function open(id) {
    setOpening(id);
    setError('');
    try {
      onOpen(await api(`/editions/${encodeURIComponent(id)}`, null, 'GET'));
    } catch (e) {
      setError(e.message);
    } finally {
      setOpening(null);
    }
  }
  async function addDemo() {
    setCreating(true);
    setError('');
    try {
      await api('/demo-edition', {});
      await load();
      notify?.(
        'The Korea demo edition is saved. Its illustrative data is separate from your current newspaper.',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }
  const filtered = editions.filter((e) =>
    `${e.identity?.title || ''} ${e.date} ${e.identity?.context?.place || ''} ${e.identity?.context?.activity || ''}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const hasDemo = editions.some(
    (e) => e.kind === 'demo' && e.date === '2026-10-12' && e.timezone === 'Asia/Seoul',
  );
  return (
    <section className="workspace-page edition-archive">
      <header className="page-heading">
        <span className="eyebrow green">THE DAILY EDIT · YOUR COLLECTION</span>
        <h2>Past editions.</h2>
        <p>
          Reopen a paper as it was saved, with its original name, date, sources and page
          arrangement.
        </p>
      </header>
      <div className="archive-toolbar">
        <label className="archive-search">
          <Search size={16} />
          <input
            aria-label="Find an edition"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, date or context"
          />
        </label>
        <Button variant="outline" onClick={load} disabled={loading || creating}>
          <RefreshCw size={14} /> Refresh archive
        </Button>
      </div>
      <aside className="archive-demo-note">
        <div>
          <strong>A different setting, a different paper.</strong>
          <p>
            Compare your current paper with an illustrative South Korea edition dated October 12,
            2026. This demo uses fictional examples, not historical Gmail or iCloud records.
          </p>
        </div>
        {!hasDemo && (
          <Button variant="outline" onClick={addDemo} disabled={creating || loading}>
            <Plus size={14} />
            {creating ? 'Saving demo…' : 'Add Korea demo edition'}
          </Button>
        )}
        {hasDemo && (
          <span className="archive-demo-saved">
            <BookOpen size={15} /> Korea demo saved
          </span>
        )}
      </aside>
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="archive-loading" role="status">
          Loading saved editions…
        </p>
      )}
      {!loading && !editions.length && (
        <div className="archive-empty">
          <BookOpen size={27} />
          <h3>Your collection starts with a published issue.</h3>
          <p>
            Complete an edition from the paper, or add the labeled Korea demo above. Intermediate
            newsroom drafts are not listed here.
          </p>
        </div>
      )}
      {!loading && editions.length > 0 && !filtered.length && (
        <p role="status">No saved editions match “{query}”.</p>
      )}
      <div className="archive-grid">
        {filtered.map((e) => (
          <article className="archive-item" key={e.id}>
            <button
              className="archive-cover-button"
              aria-label={`Open ${e.identity?.title || 'edition'}, ${e.date}`}
              onClick={() => open(e.id)}
              disabled={opening !== null}
            >
              <ArchiveCover edition={e} />
            </button>
            <div className="archive-item-info">
              <span className="archive-kind">
                {e.kind === 'demo'
                  ? 'Demo edition · Illustrative data, not your historical records'
                  : e.kind === 'reconstructed'
                    ? 'Reconstructed edition'
                    : 'Published edition'}
              </span>
              <h3>{e.identity?.title || 'Untitled edition'}</h3>
              <time dateTime={e.date}>{editionDate(e.date)}</time>
              <span className="archive-timezone"> · {e.timezone}</span>
              <p>{e.identity?.description}</p>
              <dl className="archive-context">
                {e.identity?.context?.place && (
                  <>
                    <dt>Place</dt>
                    <dd>{e.identity.context.place}</dd>
                  </>
                )}
                {e.identity?.context?.activity && (
                  <>
                    <dt>Context</dt>
                    <dd>{e.identity.context.activity}</dd>
                  </>
                )}
              </dl>
              <div className="archive-counts">
                <span>{e.pageCount} pages</span>
                <span>{e.articleCount} stories</span>
                <span>
                  {e.sourceCount} {e.kind === 'demo' ? 'example records' : 'sources'}
                </span>
              </div>
              <small>
                {e.kind === 'published' ? 'Published' : 'Generated'}{' '}
                {generatedTime(e.publishedAt, e.timezone)} · {e.timezone}
              </small>
              <Button variant="outline" onClick={() => open(e.id)} disabled={opening !== null}>
                {opening === e.id ? 'Opening…' : 'Open this edition'}
                <ArrowRight size={14} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      <p className="archive-footnote">
        Completed editions are kept separately from temporary desk checkpoints. Opening a saved
        paper does not change your current sources, settings or automatic updates.
      </p>
    </section>
  );
}
