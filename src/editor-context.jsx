import React from 'react';
import { EMPTY_CONTEXT, DEFAULT_IDENTITY } from '../shared/edition.mjs';
export default function EditorContext({ prefs, onChange, current }) {
  const context = prefs.context || EMPTY_CONTEXT,
    identity = prefs.identity || DEFAULT_IDENTITY;
  return (
    <section className="context-settings">
      <div className="setting-title">
        <span>CONTEXT</span>
        <h3>Your world, right now</h3>
      </div>
      <p className="small muted">
        Tell your editor what is true. Unknown details stay unknown. Changes shape the next
        published issue.
      </p>
      {[
        ['place', 'Where are you?', 'San Francisco, United States'],
        ['activity', 'What are you working on?', 'Building at a Cline hackathon'],
        [
          'interests',
          'What matters in this context?',
          'Practical AI tools, connectors and getting a demo shipped',
        ],
      ].map(([key, label, placeholder]) => (
        <label key={key}>
          {label}
          <input
            value={context[key]}
            maxLength={key === 'place' ? 200 : 400}
            placeholder={placeholder}
            onChange={(e) => onChange('context', { ...context, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Newspaper naming
        <select
          value={identity.mode}
          onChange={(e) => onChange('identity', { ...identity, mode: e.target.value })}
        >
          <option value="auto">Editor chooses when my context changes</option>
          <option value="locked">Keep my current newspaper name</option>
          <option value="manual">Use a name I choose</option>
        </select>
      </label>
      {identity.mode === 'manual' && (
        <>
          <label>
            Newspaper title
            <input
              value={identity.title}
              maxLength={60}
              required
              onChange={(e) => onChange('identity', { ...identity, title: e.target.value })}
            />
          </label>
          <label>
            Short description
            <input
              value={identity.description}
              maxLength={180}
              onChange={(e) => onChange('identity', { ...identity, description: e.target.value })}
            />
          </label>
        </>
      )}
      {current && (
        <p className="small muted">
          Published as <strong>{current.title}</strong> · {current.reason}
        </p>
      )}
      <small>
        The Daily Edit is the service. Your newspaper has its own name. Names are decided at
        publication, never on page load.
      </small>
    </section>
  );
}
