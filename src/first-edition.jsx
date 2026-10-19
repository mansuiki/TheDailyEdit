import React, { useState, useEffect } from 'react';
import { ArrowRight, Check, Newspaper } from 'lucide-react';
import { Button } from './components/ui/button';
import EditorContext from './editor-context';
import FirstAccounts, { accountLabels } from './first-accounts';
import {
  calendarConnection,
  includePersonalSource,
  missingPersonalSources,
  selectedPersonalSources,
} from '../shared/onboarding.mjs';
import { sectionCatalog, pageCount } from '../shared/paper.mjs';
import './first-edition.css';

export default function FirstEdition({ state, api, reload, configure, progress }) {
  const [prefs, setPrefs] = useState(() => structuredClone(state.preferences));
  const [topicsText, setTopicsText] = useState(() => state.preferences.topics.join(', '));
  const [step, setStep] = useState(() =>
    Math.min(4, Math.max(1, Number(location.hash.match(/^#setup\/(\d)/)?.[1]) || 1)),
  );
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [connecting, setConnecting] = useState('');
  const busy = saving || !!connecting || state.active.includes('edition');
  const calendarId = calendarConnection(prefs);
  const missingAccounts = missingPersonalSources(prefs, state.connections);
  const sections = sectionCatalog(prefs.paper),
    selected = sections.filter((s) => prefs.paper.sections[s.id] > 0);
  const set = (key, value) => setPrefs((p) => ({ ...p, [key]: value }));
  function editablePreferences(value = prefs) {
    const { feedback, ...editable } = value;
    return {
      ...editable,
      topics: topicsText
        .split(',')
        .map((topic) => topic.trim())
        .filter(Boolean),
    };
  }
  async function checkAccounts(ids) {
    setConnecting('check');
    setError('');
    try {
      await api('/connections/check', { toolkits: ids });
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting('');
    }
  }
  useEffect(() => {
    if (step === 3) void checkAccounts(['gmail', calendarId]);
  }, [step, calendarId]);
  async function connectAccount(id) {
    setConnecting(id);
    setError('');
    try {
      const next = includePersonalSource(prefs, id);
      await api('/preferences', editablePreferences(next), 'PUT');
      setPrefs(next);
      const connections = await api('/connections/check', { toolkits: [id] });
      if (connections[id]?.status !== 'active') await api(`/connections/${id}`);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting('');
    }
  }
  function move(next) {
    setStep(next);
    history.replaceState(null, '', `#setup/${next}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function save(next, publish = false) {
    setSaving(true);
    setError('');
    try {
      await api('/preferences', editablePreferences(), 'PUT');
      if (publish) {
        const ids = selectedPersonalSources(prefs);
        if (ids.length) {
          const connections = await api('/connections/check', { toolkits: ids });
          await reload();
          if (missingPersonalSources(prefs, connections).length) {
            move(3);
            setError(
              'One of your selected accounts needs attention. Connect it or turn off its page before publishing.',
            );
            return;
          }
        }
        await api('/editions');
      }
      await reload();
      move(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="first-edition workspace-page">
      <header className="page-heading">
        <span className="eyebrow">THE DAILY EDIT · YOUR FIRST EDITION</span>
        <h2>Your world. Your paper.</h2>
        <p>
          Tell the editor what matters. Choose your pages. We’ll collect real sources and turn them
          into your first newspaper.
        </p>
      </header>
      <ol className="setup-steps" aria-label="First edition setup">
        {['Your world', 'Your pages', 'Your accounts', 'To the presses'].map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? 'step' : undefined}>
            <span>{step > i + 1 ? <Check size={14} /> : `0${i + 1}`}</span>
            {label}
          </li>
        ))}
      </ol>
      {progress}
      <form
        className="setup-layout"
        onSubmit={(e) => {
          e.preventDefault();
          save(Math.min(4, step + 1), step === 4);
        }}
      >
        <fieldset className="settings-form" disabled={busy}>
          {step === 1 && (
            <>
              <EditorContext prefs={prefs} onChange={set} />
              <label>
                Topics you follow
                <input
                  value={topicsText}
                  onChange={(e) => setTopicsText(e.target.value)}
                  maxLength={500}
                  required
                />
              </label>
              <label>
                Edition time zone
                <input
                  value={prefs.timezone}
                  onChange={(e) => set('timezone', e.target.value)}
                  placeholder="America/Los_Angeles"
                  required
                />
              </label>
            </>
          )}
          {step === 2 && (
            <>
              <h3>Make room for what matters.</h3>
              <p className="setup-description">
                Start with a few pages. You can add more pages, sources and reporting teams in
                Settings at any time.
              </p>
              <div className="setup-section-list">
                {sections.map((s) => (
                  <label className="setup-section" key={s.id}>
                    <input
                      type="checkbox"
                      checked={prefs.paper.sections[s.id] > 0}
                      onChange={(e) =>
                        set('paper', {
                          ...prefs.paper,
                          sections: { ...prefs.paper.sections, [s.id]: e.target.checked ? 1 : 0 },
                        })
                      }
                    />
                    <span>
                      <strong>{s.label}</strong>
                      <small>
                        {s.desk === 'personal'
                          ? s.id === 'inbox'
                            ? 'Optional · Gmail connection required'
                            : 'Optional · Calendar connection required'
                          : s.description}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {!selected.length && (
                <p className="setup-description" role="status">
                  Choose at least one section to continue.
                </p>
              )}
              <label>
                News region
                <select value={prefs.region} onChange={(e) => set('region', e.target.value)}>
                  <option value="US">United States · English</option>
                  <option value="KR">South Korea · Korean sources, English reporting</option>
                </select>
              </label>
              {selected.some((s) => s.desk === 'personal') && (
                <p className="setup-description">
                  You’ll connect these accounts in the next step. Your Inbox and Your Week stay
                  separate from public news in the paper.
                </p>
              )}
            </>
          )}
          {step === 3 && (
            <FirstAccounts
              prefs={prefs}
              connections={state.connections}
              onChange={set}
              connect={connectAccount}
              check={checkAccounts}
              working={connecting}
            />
          )}
          {step === 4 && (
            <>
              <h3>Ready for your first issue.</h3>
              <p className="setup-description">
                {pageCount(prefs.paper)} pages planned, including the front page. The editor may
                publish fewer stories when sources are limited.
              </p>
              <ul className="setup-review">
                {selected.map((s) => (
                  <li key={s.id}>
                    <span>{s.label}</span>
                    <strong>
                      {prefs.paper.sections[s.id]}{' '}
                      {prefs.paper.sections[s.id] === 1 ? 'page' : 'pages'}
                    </strong>
                  </li>
                ))}
              </ul>
              {selectedPersonalSources(prefs).length > 0 && (
                <div className="setup-personal-review">
                  <strong>Your personal pages</strong>
                  {selectedPersonalSources(prefs).map((id) => (
                    <p key={id}>
                      {accountLabels[id]} ·{' '}
                      {state.connections[id]?.status === 'active' ? 'Connected' : 'Needs attention'}{' '}
                      ·{' '}
                      {id === 'gmail'
                        ? 'last 3 days, up to 12 messages'
                        : 'next 7 days, up to 30 events'}
                    </p>
                  ))}
                  <p>
                    Private excerpts go to your configured Cline model when you publish. If a
                    connected account has no records in this period, its page will say so.
                  </p>
                  <Button type="button" variant="ghost" onClick={() => move(3)}>
                    Change accounts
                  </Button>
                </div>
              )}
              <p className="setup-description">
                The editor will choose a newspaper name from your context, unless you chose a name
                yourself. Your first issue will also be saved in Archive.
              </p>
              <label className="setup-section">
                <input
                  type="checkbox"
                  checked={prefs.autoUpdate}
                  onChange={(e) => set('autoUpdate', e.target.checked)}
                />
                <span>
                  <strong>Keep my paper updated</strong>
                  <small>
                    Starts after your first successful issue. Updates run while this local server is
                    on.
                  </small>
                </span>
              </label>
              {prefs.autoUpdate && (
                <label>
                  Daily edition · {prefs.timezone}
                  <input
                    type="time"
                    value={prefs.dailyTime}
                    onChange={(e) => set('dailyTime', e.target.value)}
                    required
                  />
                </label>
              )}
              <p className="setup-description">
                Publishing uses your configured Cline model and credits. The first issue can take a
                few minutes. Collection, drafting and editor review appear here as the issue takes
                shape.
              </p>
            </>
          )}
          {error && (
            <p className="setup-error" role="alert">
              {error}
            </p>
          )}
          <div className="setup-actions">
            {step > 1 && (
              <Button type="button" variant="ghost" onClick={() => move(step - 1)}>
                Back
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                busy || (step > 1 && !selected.length) || (step === 3 && missingAccounts.length > 0)
              }
            >
              {busy ? 'Working…' : step === 4 ? 'Publish my first edition' : 'Continue'}
              <ArrowRight size={15} />
            </Button>
          </div>
        </fieldset>
        <aside className="setup-aside">
          <Newspaper size={23} />
          <h3>A newsroom of your own.</h3>
          <ol>
            <li>
              <strong>Collect</strong>
              <p>Hacker News, regional headlines and the sources you choose.</p>
            </li>
            <li>
              <strong>Write & edit</strong>
              <p>
                Reporters draft. An independent editor reviews and asks for revisions when needed.
              </p>
            </li>
            <li>
              <strong>Publish & keep</strong>
              <p>A paper to read, translate, print and revisit in your archive.</p>
            </li>
          </ol>
          <p>
            Gmail and Calendar are optional. Public news works without connecting either account.
          </p>
          <p>
            Cline CLI must be installed and signed in with <code>cline auth</code>.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              try {
                await api('/preferences', editablePreferences(), 'PUT');
                await reload();
                configure();
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Advanced settings
          </Button>
        </aside>
      </form>
    </section>
  );
}
