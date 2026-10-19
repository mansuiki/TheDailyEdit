import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  Newspaper,
  Users,
  SlidersHorizontal,
  Mail,
  CalendarDays,
  Check,
  Plus,
  Minus,
  BookmarkCheck,
  X,
  Radio,
  Clock3,
  Link2,
  ShieldCheck,
  ExternalLink,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileText,
  BookOpen,
  Camera,
  Image as ImageIcon,
  ChevronDown,
  Search,
  Download,
  Languages,
} from 'lucide-react';
import { RaisedButton } from './components/ui/raised-button';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Badge } from './components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs';
import './theme.css';
import './style.css';
import './obsidian.css';
import './newspaper.css';
import PaperReader, { RelatedReading } from './paper';
import EditorBrief, { PageBudget } from './editor-brief';
import Archive from './archive';
import EditorContext from './editor-context';
import CustomSections from './custom-sections';
import FirstEdition from './first-edition';
import { readingState } from '../shared/edition.mjs';
import './edition.css';
import './typography.css';
import { getHeadlineFontCSS } from './lib/paper-font';
import { DEFAULT_PAPER } from '../shared/paper.mjs';
const labels = { news: 'News', personal: 'My Day', markets: 'Markets', editor: 'Editor' };
const statuses = {
  idle: 'Ready',
  collecting: 'Collecting sources',
  writing: 'Writing drafts',
  reviewing: 'Editor review',
  revising: 'Revising',
  published: 'Published',
  connection_required: 'Connect an account',
  error: 'Needs attention',
  held: 'Held',
  empty: 'No sources',
};
const phases = {
  collecting: 'Collect',
  writing: 'Write',
  reviewing: 'Review',
  revising: 'Revise',
  published: 'Publish',
  accept: 'Accepted',
  revise: 'Revision requested',
  hold: 'Held',
  empty: 'Waiting',
  error: 'Error',
  unchanged: 'Unchanged',
  preferences: 'Reader preferences',
  held: 'Held',
};
const busyStates = ['collecting', 'writing', 'reviewing', 'revising'];
function date(value, timezone = 'America/Los_Angeles') {
  if (!value) return 'Not yet';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
  } catch {
    return value;
  }
}
function url(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
async function api(path, body, method = 'POST') {
  const r = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'The request failed. Please try again.');
  return data;
}
function wire(items) {
  const hn = items.filter((e) => e.source === 'hn'),
    world = items.filter((e) => e.source === 'google');
  return Array.from({ length: Math.max(hn.length, world.length) }, (_, i) => [hn[i], world[i]])
    .flat()
    .filter(Boolean);
}
function excerpt(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```|\*\*/g, '');
}
export default function App() {
  const [state, setState] = useState(null),
    [tab, setTab] = useState('paper'),
    [selected, setSelected] = useState(null),
    [toast, setToast] = useState(''),
    [offline, setOffline] = useState(false),
    [image, setImage] = useState(null),
    [capturing, setCapturing] = useState(false),
    [capture, setCapture] = useState(null),
    [archived, setArchived] = useState(null);
  const paperRef = useRef();
  const toastTimer = useRef();
  const notify = (text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5000);
  };
  async function load() {
    try {
      const r = await fetch('/api/state');
      if (!r.ok) throw Error();
      setState(await r.json());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }
  useEffect(() => {
    load();
    const issueId = location.hash.match(/^#issue\/(issue-[a-f0-9-]{36})/)?.[1];
    if (issueId)
      api('/editions/' + issueId, undefined, 'GET')
        .then(setArchived)
        .catch((e) => notify(e.message));
    const sse = new EventSource('/api/events');
    let timer;
    sse.addEventListener('update', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 120);
    });
    sse.onerror = () => setOffline(true);
    sse.onopen = () => load();
    const polling = setInterval(load, 20000);
    return () => {
      sse.close();
      clearTimeout(timer);
      clearInterval(polling);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (state?.issue && location.hash.startsWith('#setup/')) {
      history.replaceState(null, '', '#paper/front');
      notify('Your first issue is ready and saved in Archive.');
    }
  }, [state?.issue?.id]);
  async function action(path, body, method) {
    try {
      const data = await api(path, body, method);
      await load();
      return data;
    } catch (error) {
      notify(error.message);
      return null;
    }
  }
  if (!state)
    return (
      <div className="loading-page">
        <p className="eyebrow">YOUR WORLD, THOUGHTFULLY EDITED.</p>
        <h1 className="masthead">The Daily Edit</h1>
        <p>
          {offline ? 'Check your connection to the local server.' : 'Connecting to your newsroom…'}
        </p>
        {offline && <button onClick={load}>Reconnect</button>}
      </div>
    );
  const isBusy = state.active.some((d) => ['edition', 'news', 'personal', 'markets'].includes(d));
  const reader = archived || readingState(state);
  const firstEdition =
    !state.issue && !Object.values(state.sections).some((s) => s.articles.length);
  function currentPaper() {
    setArchived(null);
    setSelected(null);
    setImage(null);
    setTab('paper');
    history.replaceState(null, '', '#paper/front');
  }
  function openIssue(issue) {
    setArchived(issue);
    setSelected(null);
    setImage(null);
    setTab('paper');
    history.replaceState(null, '', `#issue/${issue.issue.id}/front`);
    window.scrollTo(0, 0);
  }
  const tz = state.preferences.timezone;
  const newsArticles = [...state.sections.news.articles].sort(
    (a, b) =>
      Number(Boolean(b.images?.some((i) => i.relation === 'source'))) -
      Number(Boolean(a.images?.some((i) => i.relation === 'source'))),
  );
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
  async function capturePaper() {
    setCapturing(true);
    try {
      const { toBlob } = await import('html-to-image');
      await document.fonts.load('400 32px "Instrument Serif"');
      const fontEmbedCSS = await getHeadlineFontCSS();
      const blob = await toBlob(
        paperRef.current.querySelector('[data-current-page="true"]') || paperRef.current,
        {
          pixelRatio: 1.5,
          backgroundColor: '#FDFDFC',
          fontEmbedCSS,
          filter: (node) => !(node instanceof HTMLElement && node.hasAttribute('data-no-capture')),
        },
      );
      if (!blob) throw Error();
      setCapture({
        url: URL.createObjectURL(blob),
        name: `daily-edit-${reader.issue?.date || state.edition}.png`,
      });
    } catch (error) {
      notify('Could not capture this edition. Wait for the images to load and try again.');
      console.error('Newspaper capture failed', error);
    } finally {
      setCapturing(false);
    }
  }
  const feedback = async (id, kind) => {
    const result = await action('/feedback', { articleId: id, action: kind });
    if (result)
      notify(
        result.removed
          ? 'Feedback removed.'
          : 'Saved. Your editor will use this in the next edition.',
      );
  };
  return (
    <>
      <div className={`site-shell ${tab === 'paper' ? 'press-shell' : ''}`} ref={paperRef}>
        <header className="obsidian-header" data-no-capture>
          <button
            className="workspace-brand"
            onClick={currentPaper}
            aria-label="The Daily Edit home"
          >
            <Newspaper size={18} />
            <span>THE DAILY EDIT</span>
          </button>
          <nav aria-label="Main navigation">
            <div className="nav-tabs">
              {[
                ['paper', 'Today’s paper', Newspaper],
                ['archive', 'Archive', BookOpen],
                ['newsroom', 'Newsroom', Users],
                ['settings', 'Settings', SlidersHorizontal],
              ].map(([id, label, Icon]) => (
                <Button
                  variant="ghost"
                  key={id}
                  className={tab === id ? 'active' : ''}
                  aria-current={tab === id ? 'page' : undefined}
                  onClick={() => (id === 'paper' ? currentPaper() : setTab(id))}
                >
                  <Icon size={15} />
                  {label}
                  {id === 'newsroom' && isBusy && <span className="working-dot" />}
                </Button>
              ))}
            </div>
          </nav>
          <div className="header-actions">
            {tab === 'paper' && (!firstEdition || archived) && (
              <Button
                variant="ghost"
                className="capture-button"
                disabled={capturing}
                onClick={capturePaper}
                title="The PNG includes the personal briefing shown on this page."
              >
                <Camera size={15} />
                {capturing ? 'Saving…' : 'Save this page'}
              </Button>
            )}
            <RaisedButton
              className="publish-button"
              disabled={isBusy}
              onClick={() => (firstEdition ? currentPaper() : action('/editions'))}
            >
              <RefreshCw size={14} className={isBusy ? 'spin' : ''} />
              {isBusy ? 'Editing…' : firstEdition ? 'Set up your paper' : 'Publish edition'}
            </RaisedButton>
            <span className="avatar">M</span>
          </div>
        </header>
        {offline && (
          <div className="notice error">
            <AlertCircle size={16} />
            Connection lost. Reconnecting automatically.
          </div>
        )}
        {tab === 'paper' && firstEdition && !archived && (
          <FirstEdition
            state={state}
            api={api}
            reload={load}
            configure={() => setTab('settings')}
            progress={<PublicationProgress />}
          />
        )}
        {tab === 'paper' && (!firstEdition || archived) && (
          <>
            <div className="edition-state-bar" data-no-capture>
              {archived ? (
                <>
                  <strong>
                    {archived.issue.kind === 'demo'
                      ? 'Demo edition'
                      : archived.issue.kind === 'reconstructed'
                        ? 'Reconstructed edition'
                        : 'Archived edition'}
                  </strong>
                  <span>
                    {archived.issue.date} · {archived.issue.timezone} ·{' '}
                    {archived.issue.kind === 'demo'
                      ? 'Preserved demo'
                      : archived.issue.kind === 'reconstructed'
                        ? 'Preserved reconstruction'
                        : 'Preserved as published'}
                  </span>
                  <button onClick={currentPaper}>Return to current paper →</button>
                </>
              ) : (
                <>
                  <span>Your world. Your paper.</span>
                  <button onClick={() => setTab('archive')}>Browse past issues →</button>
                </>
              )}
            </div>
            <PaperReader
              key={archived?.issue.id || 'current'}
              state={reader}
              open={setSelected}
              openImage={setImage}
              feedback={archived ? null : feedback}
              action={action}
              api={api}
              configure={archived ? null : () => setTab('settings')}
            />
          </>
        )}
        {tab === 'archive' && <Archive api={api} onOpen={openIssue} notify={notify} />}
        {tab === 'about' && (
          <section className="workspace-page about-edition">
            <span className="eyebrow">THE DAILY EDIT</span>
            <h2>Your world. Your paper.</h2>
            <p>
              Started at a Cline hackathon in San Francisco, The Daily Edit turns real sources into
              a newspaper for one reader.
            </p>
            <p>
              The service stays the same. Your paper can change as your world does: a different
              place, a new project, a new interest. Your editor works from what you explicitly share
              and preserves the evidence behind each story.
            </p>
            <h3>A newsroom you can shape</h3>
            <p>
              Add a section and follow a YouTube channel or public feed. Page reporters draft from
              its sources, a separate editor reviews the work, and a finished issue is preserved in
              your archive. Source descriptions are not a substitute for watching a video.
            </p>
            <p>
              Demo story: compare a clearly labeled Korea sample edition with your current SF
              builder edition. Demo material is illustrative, never passed off as actual email or
              calendar history.
            </p>
          </section>
        )}
        {tab === 'newsroom' && <Newsroom state={state} action={action} />}
        {tab === 'settings' && <Settings state={state} action={action} notify={notify} />}
        <footer>
          <span className="footer-logo">The Daily Edit</span>
          <span>Your world. Your paper.</span>
          <button onClick={() => setTab('about')}>About The Daily Edit</button>
          <div>
            <span>Cline</span>
            <span>Composio</span>
            <span>Parallel</span>
            <a href="https://www.obsidianui.dev/" target="_blank" rel="noreferrer">
              ObsidianUI ↗
            </a>
          </div>
          <small>
            Your local newspaper · Updates while the server runs · Quotes are not investment advice.
          </small>
        </footer>
      </div>
      {capture && (
        <CaptureDialog
          capture={capture}
          close={() => {
            URL.revokeObjectURL(capture.url);
            setCapture(null);
          }}
        />
      )}
      {image && <ImageDialog image={image} close={() => setImage(null)} />}
      {selected && (
        <ArticleDialog
          key={`${selected.id}-${selected.revision}`}
          article={selected}
          open={setSelected}
          state={reader}
          close={() => setSelected(null)}
          feedback={archived ? null : feedback}
        />
      )}{' '}
      {toast && (
        <div role="status" className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
function Quotes({ state, action }) {
  return (
    <section className="quote-strip" aria-label="Watchlist quotes">
      <div className="ticker-label">
        <span className="status-dot" />
        MARKET WATCH<small>{state.preferences.intervals.markets}s refresh</small>
      </div>
      {[...state.preferences.coins, ...state.preferences.stocks].map((symbol) => {
        const q = state.quotes.find((q) => q.symbol === symbol);
        return (
          <div key={symbol} className="quote-item">
            <div>
              <strong>{symbol}</strong>
              <span className={q?.changePercent >= 0 ? 'positive' : 'negative'}>
                {q?.changePercent != null
                  ? `${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`
                  : q?.kind === 'coin'
                    ? 'SPOT'
                    : ''}
              </span>
            </div>
            <div className="quote-price">
              {q?.price
                ? new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: q.currency || 'USD',
                    maximumFractionDigits: 2,
                  }).format(q.price)
                : '—'}
            </div>
            <small
              title={
                q
                  ? `${q.delayStatus} · as of ${date(q.quotedAt, state.preferences.timezone)} · fetched ${date(q.fetchedAt, state.preferences.timezone)}`
                  : ''
              }
            >
              {q?.error
                ? 'Update failed · last quote'
                : q?.provider
                  ? `${q.provider}${q.kind === 'stock' ? ' · may be delayed' : ''}`
                  : 'Awaiting quotes'}
            </small>
            {q?.fetchedAt && (
              <small className="quote-time">
                Fetched {date(q.fetchedAt, state.preferences.timezone)}
                {q.quotedAt
                  ? ` · as of ${new Intl.DateTimeFormat('en-US', { timeZone: state.preferences.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(q.quotedAt))}`
                  : ''}
              </small>
            )}
          </div>
        );
      })}
      <button
        className="icon-button quote-refresh"
        aria-label="Refresh quotes"
        disabled={state.active.includes('quotes')}
        onClick={() => action('/quotes/refresh')}
      >
        <RefreshCw size={15} className={state.active.includes('quotes') ? 'spin' : ''} />
      </button>
    </section>
  );
}
function StoryImage({ image, onClick, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image?.url, image?.fetchedAt]);
  if (!image || failed) return null;
  return (
    <figure className={`story-image ${className}`}>
      <button
        className="image-button"
        onClick={onClick}
        aria-label={`Enlarge image: ${image.title}`}
      >
        <img src={image.url} alt={image.title} loading="lazy" onError={() => setFailed(true)} />
        <span className="image-expand">
          <ImageIcon size={13} /> Enlarge
        </span>
      </button>
      <figcaption>
        <span>{image.relation === 'source' ? 'Publisher image' : 'Related image'}</span>
        <a href={url(image.sourceUrl)} target="_blank" rel="noreferrer">
          {image.sourceHost} ↗
        </a>
      </figcaption>
    </figure>
  );
}
function Article({ article: a, state, open, feedback, variant = '', compact = false }) {
  const selected = state.preferences.feedback.find((f) => f.articleId === a.id)?.action;
  const [image, setImage] = useState(null);
  const picture = !compact && a.images?.find((i) => i.relation === 'source');
  return (
    <>
      <Card
        role="article"
        className={`article-card ${variant} ${compact ? 'compact' : ''} ${picture ? 'with-image' : ''}`}
      >
        {picture && <StoryImage image={picture} onClick={() => setImage(picture)} />}
        <div className="article-copy">
          <div className="article-meta">
            <Badge variant="secondary">{a.topic}</Badge>
            <span>
              {a.evidence.length} SOURCES · {Math.max(1, Math.ceil(a.body.length / 650))} MIN READ
            </span>
          </div>
          <button className="article-title" onClick={() => open(a)}>
            <h2>{a.title}</h2>
          </button>
          <p className="article-summary">{a.summary}</p>
          <div className="article-byline">
            {labels[a.desk]} reporter <span>· Editor reviewed</span>
          </div>
          {!compact && (
            <details className="article-context">
              <summary>
                Why it matters to you <ChevronDown size={12} />
              </summary>
              <p>{a.whyYou}</p>
            </details>
          )}
          <div className="article-bottom">
            <button className="read-link" onClick={() => open(a)}>
              Read more <ArrowRight size={14} />
            </button>
            <div className="feedback" aria-label="Article feedback">
              {[
                ['more', Plus, 'More like this'],
                ['less', Minus, 'Less like this'],
                ['known', BookmarkCheck, 'Already read'],
              ].map(([kind, Icon, label]) => (
                <button
                  key={kind}
                  className={selected === kind ? 'selected' : ''}
                  aria-label={`${a.title}: ${label}`}
                  title={label}
                  aria-pressed={selected === kind}
                  onClick={() => feedback(a.id, kind)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>
      {image && <ImageDialog image={image} close={() => setImage(null)} />}
    </>
  );
}
function NewsWire({ items }) {
  const [source, setSource] = useState('all'),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(6);
  const filtered = wire(items).filter(
    (e) =>
      (source === 'all' || e.source === source) &&
      `${e.title} ${e.sourceLabel}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="headline-section">
      <div className="wire-tools" data-no-capture>
        <div className="wire-filters" aria-label="Headline sources">
          {[
            ['all', 'All'],
            ['hn', 'Hacker News'],
            ['google', 'Google News'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-pressed={source === id}
              onClick={() => {
                setSource(id);
                setLimit(6);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="wire-search">
          <Search size={14} />
          <input
            aria-label="Search headlines"
            placeholder="Search headlines"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(6);
            }}
          />
        </label>
      </div>
      {filtered.slice(0, limit).map((e, i) => (
        <a className="headline-row" key={e.id} href={url(e.url)} target="_blank" rel="noreferrer">
          <span className="headline-index">{String(i + 1).padStart(2, '0')}</span>
          <div>
            <h4>{e.title}</h4>
            <span>
              {e.sourceLabel} <i>·</i> {e.extractedBy ? 'Excerpt verified' : 'Headline only'}
              {e.stale ? ' · previous collection' : ''}
            </span>
          </div>
          <ArrowUpRight size={15} />
        </a>
      ))}
      {!filtered.length && <p className="subtle-empty">No headlines match your search.</p>}
      {filtered.length > 6 && (
        <button
          className="show-more"
          onClick={() => setLimit(limit >= filtered.length ? 6 : limit + 6)}
        >
          {limit >= filtered.length ? 'Show less' : `More headlines (${filtered.length - limit})`}
          <ChevronDown size={14} />
        </button>
      )}
    </div>
  );
}
function PictureGallery({ items, open, loading }) {
  const [expanded, setExpanded] = useState(false);
  const seen = new Set();
  const pictures = items
    .flatMap((e) => (e.images || []).map((image) => ({ image, headline: e.title })))
    .filter(({ image }) => !seen.has(image.id) && seen.add(image.id));
  if (!pictures.length)
    return (
      <div className="subtle-empty">
        <ImageIcon size={24} />
        <p>
          {loading
            ? 'Finding images for this edition.'
            : 'No images with a verified source and relevant title yet.'}
        </p>
        <span>Stories remain available even when no suitable image is found.</span>
      </div>
    );
  return (
    <>
      <div className="picture-grid">
        {pictures.slice(0, expanded ? pictures.length : 3).map(({ image, headline }) => (
          <div key={image.id}>
            <StoryImage image={image} onClick={() => open(image)} />
            <h4>{headline}</h4>
          </div>
        ))}
      </div>
      {pictures.length > 3 && (
        <button className="show-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer images' : `More images (${pictures.length - 3})`}
          <ChevronDown size={14} />
        </button>
      )}
    </>
  );
}
function CaptureDialog({ capture, close }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      className="capture-dialog"
      ref={ref}
      aria-label="Edition capture preview"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="image-dialog-top">
        <strong>Capture edition</strong>
        <button className="icon-button" aria-label="Close capture" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="capture-preview">
        <img src={capture.url} alt="PNG of the complete newspaper" />
      </div>
      <div className="capture-actions">
        <span>This edition includes your personal briefing.</span>
        <a className="primary-button" href={capture.url} download={capture.name}>
          <Download size={15} /> Save PNG
        </a>
      </div>
    </dialog>
  );
}
function ImageDialog({ image, close }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      className="image-dialog"
      ref={ref}
      aria-label="Image viewer"
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="image-dialog-top">
        <span>
          {image.relation === 'source' ? 'Publisher image' : 'Related image'} · {image.provider}
        </span>
        <button className="icon-button" aria-label="Close image" onClick={close}>
          <X size={22} />
        </button>
      </div>
      <img src={image.url} alt={image.title} />
      <div className="image-dialog-caption">
        <p>{image.title}</p>
        <div>
          <a href={url(image.sourceUrl)} target="_blank" rel="noreferrer">
            Source: {image.sourceHost} <ExternalLink size={13} />
          </a>
          <a
            href={image.url}
            download={`daily-edit-${image.id}.${image.mime?.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'}`}
          >
            <Download size={13} /> Save image
          </a>
        </div>
        <small>
          Images not verified as photographs of the reported event are labeled “Related image.”
        </small>
      </div>
    </dialog>
  );
}
function Newsroom({ state, action }) {
  const [includeEarlier, setIncludeEarlier] = useState(false);
  const earlierCount = state.events.filter((e) => e.language !== 'en').length;
  const visibleEvents = state.events.filter((e) => includeEarlier || e.language === 'en');
  return (
    <section className="workspace-page">
      <div className="page-heading">
        <span className="eyebrow green">BEHIND EVERY GOOD STORY</span>
        <h2>Your newsroom.</h2>
        <p>Follow the real work, from source collection to the editor’s final word.</p>
      </div>
      <PublicationProgress />
      {!!state.issue?.coverage?.errors?.length && (
        <div className="publication-progress">
          <strong>Some pages need another editorial pass.</strong>
          <p>
            Retry those pages from their saved sources. Finished stories stay intact and the result
            is saved as a new issue.
          </p>
          <button
            className="outline-button"
            disabled={state.active.some((d) =>
              ['edition', 'news', 'personal', 'markets'].includes(d),
            )}
            onClick={() => action('/editions/retry')}
          >
            Retry incomplete pages
          </button>
        </div>
      )}
      <div className="workflow-banner">
        <span>
          <Link2 size={17} />
          Collect sources
        </span>
        <ArrowRight size={16} />
        <span>
          <FileText size={17} />
          Reporter drafts
        </span>
        <ArrowRight size={16} />
        <span>
          <Users size={17} />
          Editor review
        </span>
        <ArrowRight size={16} />
        <span>
          <BookOpen size={17} />
          Revise & publish
        </span>
        <small>One revision round maximum</small>
      </div>
      <div className="desk-grid">
        {Object.entries(state.sections).map(([id, s]) => (
          <div className="desk-card" key={id}>
            <div className="desk-avatar">
              {id === 'news' ? (
                <Newspaper />
              ) : id === 'personal' ? (
                <CalendarDays />
              ) : (
                <span>↗</span>
              )}
            </div>
            <span className="eyebrow">{id.toUpperCase()} DESK</span>
            <h3>{labels[id]} reporter</h3>
            <span className={`status-pill ${s.status}`}>{statuses[s.status]}</span>
            <div className="desk-stats">
              <span>
                <strong>{s.evidence.length}</strong>sources
              </span>
              <span>
                <strong>{s.articles.length}</strong>articles
              </span>
              <span>
                <strong>{s.revision}</strong>desk version
              </span>
            </div>
            <p>
              {s.error ||
                s.notes?.[0] ||
                'Reporting from collected sources and your editorial preferences.'}
            </p>
            <button
              className="outline-button full"
              disabled={state.active.includes('edition') || busyStates.includes(s.status)}
              onClick={() => action(`/sections/${id}/refresh`)}
            >
              <RefreshCw size={14} />
              Refresh this desk
            </button>
          </div>
        ))}
      </div>
      {!!state.preferences.paper.customSections?.length && (
        <section className="custom-newsroom">
          <div className="section-heading">
            <h3>Your section teams</h3>
            <span className="small muted">Separate reporter and editor runs</span>
          </div>
          <div className="desk-grid">
            {state.preferences.paper.customSections.map((team) => {
              const articles = state.sections.news.articles.filter((a) => a.sectionId === team.id);
              const records = state.sections.news.evidence.filter((e) => e.sectionId === team.id);
              return (
                <div className="desk-card" key={team.id}>
                  <span className="eyebrow">CUSTOM SECTION</span>
                  <h3>{team.label}</h3>
                  <p>{team.direction}</p>
                  <strong>
                    {team.label} reporters → {team.label} editor
                  </strong>
                  <p>
                    {records.length} source records · {articles.length} published stories ·{' '}
                    {state.preferences.paper.sections[team.id]} pages
                  </p>
                  <small>
                    {team.sources
                      .map((s) => (s.type === 'youtube' ? 'YouTube channel' : 'RSS / Atom'))
                      .join(' · ')}
                  </small>
                  <button
                    className="outline-button full"
                    disabled={state.active.some((d) =>
                      ['edition', 'news', 'personal', 'markets'].includes(d),
                    )}
                    onClick={() => action('/editions')}
                  >
                    Commission the next edition
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <div className="newsroom-bottom">
        <div>
          <div className="section-heading">
            <h3>Live editorial log</h3>
            <span className="muted small">Real execution events</span>
          </div>
          <div className="event-list">
            {visibleEvents.map((e) => (
              <div className="event-row" key={e.id}>
                <time>
                  {new Intl.DateTimeFormat('en-US', {
                    timeZone: state.preferences.timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hourCycle: 'h23',
                  }).format(new Date(e.time))}
                </time>
                <span className={`event-label ${e.phase}`}>{phases[e.phase] || e.phase}</span>
                <div>
                  <strong>{labels[e.desk]}</strong>
                  <p>{e.message}</p>
                  {e.requestedChanges && <blockquote>{e.requestedChanges}</blockquote>}
                </div>
              </div>
            ))}
          </div>
          {earlierCount > 0 && (
            <button className="text-button" onClick={() => setIncludeEarlier(!includeEarlier)}>
              {includeEarlier
                ? 'Hide earlier activity'
                : `Show earlier activity (${earlierCount}, original language)`}
            </button>
          )}
        </div>
        <aside>
          <div className="section-heading">
            <h3>Editorial decisions</h3>
          </div>
          {Object.values(state.sections).flatMap((s) =>
            s.review.map((r, i) => (
              <div className="review-card" key={s.desk + r.draftId + i}>
                <div>
                  <span className={`event-label ${r.decision}`}>{phases[r.decision]}</span>
                  <span className="muted small">
                    {labels[s.desk]} · Review {r.round}
                  </span>
                </div>
                <p>{r.reason}</p>
                {r.requestedChanges && <small>{r.requestedChanges}</small>}
              </div>
            )),
          )}
          {state.runs.slice(0, 4).map((r) => (
            <div className="run-summary" key={r.id}>
              <strong>{labels[r.desk]} run</strong>
              <span>
                {r.status === 'running'
                  ? 'In progress'
                  : `${((r.durationMs || 0) / 1000).toFixed(1)}s · ${r.calls.length} model calls`}
              </span>
              <small>
                {typeof r.calls[0]?.model === 'string' ? r.calls[0].model : 'Current Cline model'}
              </small>
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}
function PublicationProgress() {
  const [job, setJob] = useState(null);
  useEffect(() => {
    let alive = true;
    const read = () =>
      api('/publication-jobs', null, 'GET')
        .then((jobs) => {
          if (alive) setJob(jobs.filter((j) => j.kind === 'current').at(-1) || null);
        })
        .catch(() => {});
    read();
    const timer = setInterval(read, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!job) return null;
  return (
    <div className="publication-progress" role="status">
      <strong>
        {job.status === 'running'
          ? 'Preparing your next issue'
          : job.status === 'completed'
            ? 'Your issue is published and archived'
            : 'Publication needs attention'}
      </strong>
      <span>
        {job.error || job.step}
        {job.total ? ` · ${job.done}/${job.total} page assignments completed` : ''}
      </span>
      {job.status === 'running' && (
        <progress max={job.total || 1} {...(job.total ? { value: job.done || 0 } : {})} />
      )}
    </div>
  );
}
function Settings({ state, action, notify }) {
  const [prefs, setPrefs] = useState({ ...state.preferences }),
    [saving, setSaving] = useState(false),
    [connecting, setConnecting] = useState('');
  const [topics, setTopics] = useState(prefs.topics.join(', ')),
    [coins, setCoins] = useState(prefs.coins.join(', ')),
    [stocks, setStocks] = useState(prefs.stocks.join(', '));
  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const { feedback, ...data } = prefs;
    const split = (v) => [
      ...new Set(
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    const result = await action(
      '/preferences',
      {
        ...data,
        topics: split(topics),
        coins: split(coins.toUpperCase()),
        stocks: split(stocks.toUpperCase()),
      },
      'PUT',
    );
    setSaving(false);
    if (result) notify('Preferences saved for your next edition.');
  }
  async function connect(id) {
    setConnecting(id);
    const result = await action(`/connections/${id}`);
    setConnecting('');
    if (result?.status === 'active')
      notify('Connected. Refresh your personal briefing to read the latest sources.');
    else if (result?.message) notify(result.message);
  }
  return (
    <section className="workspace-page">
      <div className="page-heading">
        <span className="eyebrow green">MAKE IT YOURS</span>
        <h2>A good paper knows its reader.</h2>
        <p>Choose your interests, connected accounts, and publishing schedule.</p>
      </div>
      <EditorBrief
        state={state}
        api={api}
        onApplied={async (next) => {
          setPrefs({ ...state.preferences, ...next });
          setTopics(next.topics.join(', '));
          setCoins(next.coins.join(', '));
          setStocks(next.stocks.join(', '));
          await action('/state', undefined, 'GET');
          notify('Your newspaper plan is saved. Publish an edition to commission its pages.');
        }}
      />
      <div className="settings-grid">
        <form onSubmit={save} className="settings-form">
          <EditorContext prefs={prefs} onChange={set} current={state.issue?.identity} />
          <CustomSections
            paper={prefs.paper || DEFAULT_PAPER}
            onChange={(p) => set('paper', p)}
            api={api}
          />
          <section>
            <PageBudget
              paper={prefs.paper || DEFAULT_PAPER}
              onChange={(paper) => set('paper', paper)}
            />
            <label>
              Reporting depth
              <select
                value={prefs.paper?.depth || 'standard'}
                onChange={(e) =>
                  set('paper', { ...(prefs.paper || DEFAULT_PAPER), depth: e.target.value })
                }
              >
                <option value="standard">Standard · 3 short paragraphs</option>
                <option value="deep">Deep · more context when supported</option>
              </select>
            </label>
          </section>
          <section>
            <div className="setting-title">
              <span>01</span>
              <h3>Editorial direction</h3>
            </div>
            <label>
              Topics you follow
              <input
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="AI, developer tools, startups"
              />
              <small>Separate with commas. Up to 12 topics.</small>
            </label>
            <label>
              A note to your editor
              <textarea
                rows={4}
                maxLength={1500}
                value={prefs.instructions}
                onChange={(e) => set('instructions', e.target.value)}
              />
              <small>
                Example: Prioritize practical technology. Skip speculative investment predictions.
              </small>
            </label>
            <div className="two-fields">
              <label>
                Headline region
                <select value={prefs.region} onChange={(e) => set('region', e.target.value)}>
                  <option value="US">United States · English</option>
                  <option value="KR">South Korea · Korean</option>
                </select>
              </label>
              <label>
                Your time zone
                <select value={prefs.timezone} onChange={(e) => set('timezone', e.target.value)}>
                  {[
                    'America/Los_Angeles',
                    'Asia/Seoul',
                    'America/New_York',
                    'Europe/London',
                    'UTC',
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Calendar source
              <select
                value={prefs.calendarProvider || 'google'}
                onChange={(e) => set('calendarProvider', e.target.value)}
              >
                <option value="apple">Apple Calendar · iCloud (this Mac)</option>
                <option value="google">Google Calendar</option>
              </select>
              <small>Reads iCloud calendars synced to this Mac.</small>
            </label>
            <div className="checkboxes">
              {[
                ['hn', 'Hacker News'],
                ['google', 'Google News'],
                ['bbc', 'BBC News · World, Business, Science & Culture'],
              ].map(([id, label]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={prefs.sourceEnabled[id]}
                    onChange={(e) =>
                      set('sourceEnabled', { ...prefs.sourceEnabled, [id]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </section>
          <section>
            <div className="setting-title">
              <span>02</span>
              <h3>Your watchlist</h3>
            </div>
            <div className="two-fields">
              <label>
                Crypto symbols
                <input
                  value={coins}
                  onChange={(e) => setCoins(e.target.value)}
                  placeholder="BTC, ETH"
                />
              </label>
              <label>
                US stock symbols
                <input
                  value={stocks}
                  onChange={(e) => setStocks(e.target.value)}
                  placeholder="AAPL, NVDA"
                />
              </label>
            </div>
            <p className="help-text">
              Crypto uses Coinbase spot prices. Stocks use an unofficial Yahoo Finance endpoint and
              may be delayed. Configure a Finnhub key to use its official API.
            </p>
          </section>
          <section>
            <div className="setting-title">
              <span>03</span>
              <h3>Your publishing rhythm</h3>
            </div>
            <label className="toggle-row">
              <div>
                <strong>Automatic updates</strong>
                <small>Collects on your schedule while the server is running.</small>
              </div>
              <input
                type="checkbox"
                role="switch"
                checked={prefs.autoUpdate}
                onChange={(e) => set('autoUpdate', e.target.checked)}
              />
            </label>
            <div className="two-fields">
              <label>
                Daily edition time
                <input
                  type="time"
                  required
                  value={prefs.dailyTime}
                  onChange={(e) => set('dailyTime', e.target.value)}
                />
              </label>
              {[
                ['news', 'News refresh', [300, 900, 1800, 3600, 21600]],
                ['personal', 'Inbox & calendar refresh', [300, 900, 1800, 3600]],
                ['markets', 'Quote refresh', [30, 60, 300, 900]],
              ].map(([id, label, values]) => (
                <label key={id}>
                  {label}
                  <select
                    value={prefs.intervals[id]}
                    onChange={(e) =>
                      set('intervals', { ...prefs.intervals, [id]: Number(e.target.value) })
                    }
                  >
                    {values.map((s) => (
                      <option key={s} value={s}>
                        {s < 60 ? `${s} seconds` : `${s / 60} minutes`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="info-note">
              <Clock3 size={16} />
              <p>
                Desks are edited again when new evidence arrives. Quotes refresh without AI calls.
                If the server starts after your daily publishing time, it creates that day’s edition
                once.
              </p>
            </div>
          </section>
          <RaisedButton className="primary-button" disabled={saving} type="submit">
            {saving ? 'Saving…' : 'Save preferences'}
            <Check size={16} />
          </RaisedButton>
        </form>
        <aside>
          <div className="settings-card">
            <div className="setting-title">
              <Link2 size={18} />
              <h3>Connected services</h3>
            </div>
            <p className="muted small">
              Gmail and Google Calendar connect through Cline and Composio. iCloud uses the calendar
              on this Mac.
            </p>
            {[
              ['gmail', 'Gmail', 'Up to 12 inbox messages from the last 3 days', Mail],
              [
                'applecalendar',
                'Apple Calendar · iCloud',
                'iCloud on this Mac · next 7 days · up to 30 events',
                CalendarDays,
              ],
              [
                'googlecalendar',
                'Google Calendar',
                'Primary calendar · next 7 days · up to 30 events',
                CalendarDays,
              ],
            ].map(([id, label, desc, Icon]) => (
              <div className="service-card" key={id}>
                <div className="service-title">
                  <Icon size={20} />
                  <div>
                    <strong>{label}</strong>
                    <small>{desc}</small>
                  </div>
                  <span
                    className={`service-dot ${state.connections[id]?.status === 'active' ? 'connected' : ''}`}
                  />
                </div>
                <button
                  className="outline-button full"
                  disabled={!!connecting}
                  onClick={() => connect(id)}
                >
                  {connecting === id
                    ? 'Connecting…'
                    : state.connections[id]?.status === 'active'
                      ? 'Check connection'
                      : id === 'applecalendar'
                        ? 'Allow macOS calendar access'
                        : 'Connect account'}
                  <ArrowUpRight size={14} />
                </button>
                {id === 'applecalendar' && state.connections[id]?.message && (
                  <p className="small muted">{state.connections[id].message}</p>
                )}
                {url(state.connections[id]?.url) && state.connections[id]?.status !== 'active' && (
                  <a
                    className="auth-link"
                    href={state.connections[id].url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Continue with Google <ExternalLink size={13} />
                  </a>
                )}
              </div>
            ))}
            <button
              className="text-button"
              onClick={async () => {
                const r = await action('/connections/check');
                if (r)
                  notify(
                    Object.values(r).some((c) => c.status === 'active')
                      ? 'Connection status updated.'
                      : 'No active connection yet. Complete account sign-in or macOS calendar approval.',
                  );
              }}
            >
              <RefreshCw size={13} />
              Check after authorization
            </button>
            <div className="privacy-note">
              <ShieldCheck size={18} />
              <p>
                Email and calendar access is read-only. Private data stays in the local database and
                Cline execution history. Briefing and translation excerpts are sent to your
                configured Cline model provider.
              </p>
            </div>
          </div>
          <div className="settings-card">
            <span className="eyebrow">WHAT YOUR EDITOR REMEMBERS</span>
            <h3>Reader notes</h3>
            {state.preferences.feedback.length ? (
              state.preferences.feedback
                .slice(-5)
                .reverse()
                .map((f) => (
                  <div className="memory-item" key={f.articleId}>
                    <span>
                      {f.action === 'more'
                        ? '+ More like this'
                        : f.action === 'less'
                          ? '− Less like this'
                          : '✓ Already read'}
                    </span>
                    <p>{f.title}</p>
                  </div>
                ))
            ) : (
              <p className="muted small">
                Your feedback shapes what the editor selects and emphasizes next time.
              </p>
            )}
          </div>
          <div className="settings-card">
            <span className="eyebrow">SOURCE HEALTH</span>
            <h3>Source health</h3>
            {Object.entries(state.sourceStatus).map(([id, s]) => (
              <div className="source-health" key={id}>
                <span>
                  {id === 'hn'
                    ? 'Hacker News'
                    : id === 'google'
                      ? 'Google News'
                      : id === 'parallel'
                        ? 'Parallel'
                        : id === 'markets'
                          ? 'Markets'
                          : id}
                </span>
                <span className={s.ok ? 'green' : 'negative'}>
                  {s.ok ? <Check size={14} /> : <AlertCircle size={14} />} {s.count ?? 0}
                </span>
                {s.error && <small>{s.error}</small>}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
function ArticleDialog({ article: original, state, close, feedback, open }) {
  const ref = useRef();
  const [view, setView] = useState('story');
  const [image, setImage] = useState(null);
  const [translation, setTranslation] = useState(null);
  const [translated, setTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const a = translated && translation ? { ...original, ...translation.fields } : original;
  async function toggleTranslation() {
    if (translated) {
      setTranslated(false);
      return;
    }
    if (translation) {
      setTranslated(true);
      return;
    }
    setTranslating(true);
    setTranslationError('');
    try {
      const result = await api(`/articles/${encodeURIComponent(original.id)}/translate`, {
        targetLanguage: 'ko',
        revision: original.revision,
        ...(state.archived ? { editionId: state.issue.id } : {}),
      });
      setTranslation(result);
      setTranslated(true);
    } catch (error) {
      setTranslationError(error.message);
    } finally {
      setTranslating(false);
    }
  }
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={a.title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
      className="article-dialog"
    >
      {image && <ImageDialog image={image} close={() => setImage(null)} />}
      <div className="dialog-inner">
        <div className="dialog-top">
          <span className="footer-logo">The Daily Edit</span>
          <button className="icon-button" aria-label="Close article" onClick={close}>
            <X size={22} />
          </button>
        </div>
        <div className="article-meta">
          <span>
            {labels[a.desk]} · {a.topic}
          </span>
          <span>VERSION {a.revision}</span>
        </div>
        <div className="translation-toolbar">
          <span className="translation-label" role="status" aria-live="polite">
            {translating
              ? 'Translating with Cline…'
              : translated
                ? 'Korean · Machine translation'
                : 'English · Original edition'}
          </span>
          <Button
            variant="outline"
            onClick={toggleTranslation}
            disabled={translating}
            aria-pressed={translated}
          >
            {translating ? <RefreshCw size={15} className="spin" /> : <Languages size={15} />}
            {translating ? 'Translating…' : translated ? 'Show English' : 'Translate to Korean'}
          </Button>
        </div>
        {translationError && (
          <p className="translation-error" role="alert">
            {translationError}
          </p>
        )}
        <h2 lang={translated ? 'ko' : 'en'}>{a.title}</h2>
        <p className="dialog-summary" lang={translated ? 'ko' : 'en'}>
          {a.summary}
        </p>
        <div className="dialog-byline">
          {a.demo
            ? 'Illustrative demo copy · Not actual reporting'
            : `${a.sectionTitle || labels[a.desk]} reporter · Reviewed by the editor`}{' '}
          <span>{date(a.updatedAt, state.preferences.timezone)}</span>
        </div>
        <Tabs value={view} onValueChange={setView} className="article-tabs">
          <TabsList className="dialog-tabs">
            {[
              ['story', 'Story'],
              ['sources', `Sources ${a.evidence.length}`],
              ...(a.images?.length ? [['images', `Images ${a.images.length}`]] : []),
              ['history', 'Drafts & edits'],
            ].map(([id, label]) => (
              <TabsTrigger value={id} key={id}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="story">
            {translated && (
              <p className="translation-note">
                Translated on request. Sources and edit history remain in their original language.
              </p>
            )}
            {a.images?.[0] && (
              <StoryImage image={a.images[0]} onClick={() => setImage(a.images[0])} />
            )}
            <div className="article-body" lang={translated ? 'ko' : 'en'}>
              {a.body
                .split(/\n+/)
                .filter(Boolean)
                .map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
            </div>
            {a.whyYou && original.personalization && (
              <div className="why-you">
                <span>WHY THIS MATTERS TO YOU</span>
                <p lang={translated ? 'ko' : 'en'}>{a.whyYou}</p>
                <small>
                  Based on what you told your editor:{' '}
                  {Object.values(original.personalization.context).join(' · ')}. Linked to{' '}
                  {original.personalization.evidenceIds.length} cited source(s).
                </small>
              </div>
            )}
          </TabsContent>
          <TabsContent value="images">
            <div className="article-image-gallery">
              {a.images?.map((i) => (
                <StoryImage key={i.id} image={i} onClick={() => setImage(i)} />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="sources">
            <p className="small muted">
              {a.evidence.some((e) => e.sourceKind === 'video_metadata')
                ? 'Video sources include public titles, descriptions and publication dates. Video playback and transcripts are outside this collection.'
                : 'Source excerpts and dates collected for this edition are preserved below.'}
            </p>
            <details className="editor-verdict-details">
              <summary>Editor’s review</summary>
              <p lang={translated ? 'ko' : 'en'}>{a.editorReason}</p>
            </details>
            <div className="sources-list">
              {a.evidence.map((e) => (
                <div key={e.id}>
                  <span className="eyebrow">
                    {e.sourceLabel} ·{' '}
                    {e.sourceKind === 'video_metadata'
                      ? 'VIDEO DESCRIPTION'
                      : e.visibility === 'private'
                        ? 'PRIVATE'
                        : e.contentStatus === 'headline'
                          ? 'HEADLINE ONLY'
                          : 'EVIDENCE'}
                  </span>
                  <a href={url(e.url)} target="_blank" rel="noreferrer">
                    <h3>{e.title}</h3>
                    <ArrowUpRight size={16} />
                  </a>
                  <p>
                    {excerpt(e.excerpt).slice(0, 1400) ||
                      'Only the headline and metadata were collected. The full article has not been verified.'}
                  </p>
                  <small>
                    {e.demo
                      ? 'Illustrative date'
                      : e.source === 'hn'
                        ? 'Feed entry'
                        : 'Source published'}{' '}
                    {date(e.publishedAt, state.preferences.timezone)} ·{' '}
                    {e.demo ? 'Example created' : 'Collected'}{' '}
                    {date(e.fetchedAt, state.preferences.timezone)}
                    {e.extractedBy ? ` · ${e.extractedBy}` : ''}
                  </small>
                </div>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="history">
            <div className="history-list">
              <p className="muted small">
                {a.demo
                  ? 'Illustrative demo copy. No reporter or editor runs were performed for these examples.'
                  : 'Actual outputs from separate reporter and editor runs.'}
              </p>
              {a.versions.map((v, i) => (
                <div key={i}>
                  <span className="eyebrow">
                    {i + 1}.{' '}
                    {v.stage === 'draft'
                      ? 'REPORTER’S DRAFT'
                      : v.stage === 'revision'
                        ? 'REVISED DRAFT'
                        : 'EDITOR’S FINAL'}
                  </span>
                  <h3>{v.article.title}</h3>
                  <p>{v.article.summary}</p>
                  <details>
                    <summary>Read the full version</summary>
                    <p className="preserve-lines">{v.article.body}</p>
                  </details>
                </div>
              ))}
              {a.review.map((r, i) => (
                <div className="review-card" key={i}>
                  <strong>
                    {phases[r.decision]} · Review {r.round}
                  </strong>
                  <p>{r.reason}</p>
                  {r.requestedChanges && <p>{r.requestedChanges}</p>}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
        <RelatedReading article={original} state={state} open={open} />
        {feedback && (
          <div className="dialog-feedback">
            <span>Was this story useful?</span>
            <button className="outline-button" onClick={() => feedback(a.id, 'more')}>
              <Plus size={14} />
              More like this
            </button>
            <button className="text-button" onClick={() => feedback(a.id, 'less')}>
              Less like this
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
