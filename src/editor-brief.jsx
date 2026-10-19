import React, { useState } from 'react';
import { Sparkles, ArrowRight, Check, RefreshCw, Plus, Minus } from 'lucide-react';
import { PAPER_SECTIONS, sectionCatalog, DEFAULT_PAPER, pageCount } from '../shared/paper.mjs';
export function PageBudget({ paper = DEFAULT_PAPER, onChange }) {
  return (
    <div className="page-budget">
      <div className="budget-heading">
        <strong>Your edition, by section</strong>
        <span>{pageCount(paper)} pages including A1</span>
      </div>
      <div className="budget-bar" aria-label="Page allocation">
        <i style={{ flex: 1 }} title="Front page: 1" />
        {sectionCatalog(paper)
          .filter((s) => paper.sections[s.id])
          .map((s, i) => (
            <i
              key={s.id}
              style={{ flex: paper.sections[s.id], opacity: 0.95 - i * 0.08 }}
              title={`${s.label}: ${paper.sections[s.id]} pages`}
            />
          ))}
      </div>
      <div className="budget-grid">
        {sectionCatalog(paper).map((s) => (
          <div key={s.id}>
            <span>
              <b>{s.letter}</b>
              {s.label}
            </span>
            <div className="page-stepper">
              {onChange && (
                <button
                  type="button"
                  aria-label={`Remove a ${s.label} page`}
                  disabled={!paper.sections[s.id] || pageCount(paper) <= 2}
                  onClick={() =>
                    onChange({
                      ...paper,
                      sections: { ...paper.sections, [s.id]: paper.sections[s.id] - 1 },
                    })
                  }
                >
                  <Minus size={12} />
                </button>
              )}
              <strong>{paper.sections[s.id]}</strong>
              {onChange && (
                <button
                  type="button"
                  aria-label={`Add a ${s.label} page`}
                  disabled={paper.sections[s.id] >= 4 || pageCount(paper) >= 21}
                  onClick={() =>
                    onChange({
                      ...paper,
                      sections: { ...paper.sections, [s.id]: paper.sections[s.id] + 1 },
                    })
                  }
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p>
        One front page. Each inside page has a lead, up to two supporting stories, and source
        briefs. Empty reporting space is never filled with invented news.
      </p>
    </div>
  );
}
export default function EditorBrief({ state, api, onApplied }) {
  const [request, setRequest] = useState(''),
    [proposal, setProposal] = useState(null),
    [busy, setBusy] = useState(false),
    [applying, setApplying] = useState(false),
    [error, setError] = useState('');
  async function interpret(e) {
    e.preventDefault();
    setBusy(true);
    setProposal(null);
    setError('');
    try {
      setProposal(await api('/preferences/interpret', { request }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setApplying(true);
    setError('');
    try {
      await api('/preferences/apply', {
        preferences: proposal.preferences,
        baseFingerprint: proposal.baseFingerprint,
      });
      onApplied(proposal.preferences);
      setProposal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }
  return (
    <section className="editor-brief">
      <div className="brief-intro">
        <span className="eyebrow">
          <Sparkles size={14} /> A LETTER TO YOUR EDITOR
        </span>
        <h3>“Make this paper feel like me.”</h3>
        <p>
          Tell your editor what to cover, how much room it deserves, and when your paper should
          arrive. English or Korean is welcome.
        </p>
      </div>
      <form onSubmit={interpret}>
        <label htmlFor="editor-request">What would you like in your newspaper?</label>
        <textarea
          id="editor-request"
          value={request}
          onChange={(e) => {
            setRequest(e.target.value);
            setProposal(null);
          }}
          maxLength={2000}
          rows={3}
          required
          minLength={3}
          placeholder="Give AI and developer tools three pages, world news two, and keep my inbox and week separate. More context, fewer quick summaries. Publish at 8 AM."
        />
        <div className="brief-actions">
          <button
            type="button"
            className="text-button"
            onClick={() =>
              setRequest(
                'Give technology two pages, world news two, business and science one each, and keep my inbox, calendar and markets on their own pages. Use deeper reporting. Keep my other settings.',
              )
            }
            disabled={busy}
          >
            Try a full newspaper brief
          </button>
          <button className="outline-button" disabled={busy || !request.trim()}>
            {busy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}{' '}
            {busy ? 'Your editor is planning…' : 'Draft my newspaper plan'}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {proposal && (
        <div className="proposal-preview" role="region" aria-label="Proposed newspaper plan">
          <span className="eyebrow">EDITOR’S PROPOSED PLAN</span>
          <h4>{proposal.summary}</h4>
          <ul>
            {proposal.changes.map((c, i) => (
              <li key={i}>
                <Check size={13} />
                {c}
              </li>
            ))}
          </ul>
          <PageBudget paper={proposal.preferences.paper} />
          <div className="brief-actions">
            <span>Nothing changes until you apply this plan.</span>
            <button className="primary-button" disabled={applying} onClick={apply}>
              {applying ? 'Applying…' : 'Apply this plan'}
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
