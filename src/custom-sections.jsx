import React, { useState } from 'react';
import { Plus, Rss, Youtube, Check, RefreshCw } from 'lucide-react';
export default function CustomSections({ paper, onChange, api }) {
  const [type, setType] = useState('youtube'),
    [url, setUrl] = useState(''),
    [label, setLabel] = useState(''),
    [direction, setDirection] = useState(''),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function check() {
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const p = await api('/sources/preview', { type, url });
      setPreview(p);
      if (!label) setLabel(p.label.slice(0, 40));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function add() {
    const id = `custom-${crypto.randomUUID()}`;
    onChange({
      ...paper,
      customSections: [
        ...(paper.customSections || []),
        {
          id,
          label: label.trim(),
          description: `Coverage selected from ${preview.label}.`.slice(0, 160),
          direction:
            direction ||
            'Select useful updates, explain the evidence, and avoid repeating older stories.',
          sources: [preview.source],
        },
      ],
      sections: { ...paper.sections, [id]: 1 },
    });
    setPreview(null);
    setUrl('');
    setLabel('');
    setDirection('');
  }
  return (
    <section className="custom-settings">
      <div className="setting-title">
        <span>TEAMS</span>
        <h3>A new section, a new reporting team</h3>
      </div>
      <p className="small muted">
        Follow a public YouTube channel or RSS/Atom feed. Each section gets page reporters and an
        independent editor. Save the plan, then publish to commission them.
      </p>
      {(paper.customSections || []).map((s) => (
        <div className="custom-team" key={s.id}>
          <strong>{s.label}</strong>
          <small>Reporter team → Section editor · {paper.sections[s.id] || 0} pages</small>
          <label>
            Section name
            <input
              value={s.label}
              maxLength={40}
              onChange={(e) =>
                onChange({
                  ...paper,
                  customSections: paper.customSections.map((t) =>
                    t.id === s.id ? { ...t, label: e.target.value } : t,
                  ),
                })
              }
            />
          </label>
          <label>
            Editor’s brief
            <textarea
              value={s.direction}
              maxLength={1200}
              onChange={(e) =>
                onChange({
                  ...paper,
                  customSections: paper.customSections.map((t) =>
                    t.id === s.id ? { ...t, direction: e.target.value } : t,
                  ),
                })
              }
            />
          </label>
          {s.sources.map((source, i) => (
            <div className="team-source" key={i}>
              {source.type === 'youtube' ? <Youtube size={15} /> : <Rss size={15} />}
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.url}
              </a>
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const sections = { ...paper.sections };
              delete sections[s.id];
              onChange({
                ...paper,
                sections,
                customSections: paper.customSections.filter((t) => t.id !== s.id),
              });
            }}
          >
            Remove from the next issue
          </button>
        </div>
      ))}
      {(paper.customSections || []).length < 6 && (
        <div className="new-team">
          <label>
            Source type
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPreview(null);
              }}
            >
              <option value="youtube">YouTube channel</option>
              <option value="rss">RSS or Atom feed</option>
            </select>
          </label>
          <label>
            Channel or feed URL
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreview(null);
              }}
              placeholder={
                type === 'youtube'
                  ? 'https://www.youtube.com/@Composio/videos'
                  : 'https://example.com/feed.xml'
              }
            />
          </label>
          <button
            type="button"
            className="outline-button"
            disabled={busy || url.trim().length < 3}
            onClick={check}
          >
            {busy ? <RefreshCw size={14} className="spin" /> : <Check size={14} />}{' '}
            {busy ? 'Checking source…' : 'Check source'}
          </button>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <div className="source-preview">
              <strong>{preview.label}</strong>
              <p>{preview.count} recent entries available</p>
              <ul>
                {preview.titles.slice(0, 3).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <label>
                New section name
                <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label>
                What should this team look for?
                <textarea
                  value={direction}
                  maxLength={1200}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder="Focus on agent connectors, practical demos and changes I can use at the hackathon."
                />
              </label>
              <button
                type="button"
                className="outline-button"
                disabled={
                  !label.trim() || Object.values(paper.sections).reduce((a, b) => a + b, 0) >= 20
                }
                onClick={add}
              >
                <Plus size={14} /> Add team to my plan
              </button>
              <small>
                Save preferences below to keep this team. YouTube reporting uses public titles and
                descriptions; it does not claim to watch videos.
              </small>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
