import React, { useState, useEffect } from 'react';
import { MapPin, Navigation, RefreshCw, ArrowUpRight } from 'lucide-react';
function stamp(value, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}
export default function CalendarMap({ events, timezone, api }) {
  const ordered = [...events]
    .filter((e) => e.start)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const [chosen, setChosen] = useState(ordered[0]?.id || ''),
    [origin, setOrigin] = useState(''),
    [destination, setDestination] = useState(ordered[0]?.location || ''),
    [mode, setMode] = useState('driving'),
    [buffer, setBuffer] = useState(10),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const selected = ordered.find((e) => e.id === chosen),
    previous = ordered[ordered.findIndex((e) => e.id === chosen) - 1];
  useEffect(() => {
    setResult(null);
  }, [selected?.start, selected?.location]);
  function choose(id) {
    const i = ordered.findIndex((e) => e.id === id);
    setChosen(id);
    setDestination(ordered[i]?.location || '');
    setOrigin(ordered[i - 1]?.location || '');
    setResult(null);
    setError('');
  }
  const clear = (fn, value) => {
    fn(value);
    setResult(null);
  };
  async function calculate(e) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    setError('');
    try {
      setResult(
        await api('/routes', {
          origin,
          destination,
          mode,
          bufferMinutes: buffer,
          ...(selected && !selected.allDay
            ? { arrivalTime: new Date(selected.start).toISOString() }
            : {}),
        }),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const mapsUrl = `https://maps.apple.com/?saddr=${encodeURIComponent(origin)}&daddr=${encodeURIComponent(destination)}&dirflg=${mode === 'walking' ? 'w' : 'd'}`;
  return (
    <section className="calendar-route">
      <div className="map-title">
        <span className="eyebrow">
          <MapPin size={13} /> BETWEEN APPOINTMENTS
        </span>
        <h3>Your day, on the map.</h3>
        <p>Plan the journey as well as the meeting.</p>
      </div>
      <form onSubmit={calculate}>
        <label>
          Calendar event
          <select value={chosen} onChange={(e) => choose(e.target.value)}>
            <option value="">A route of my own</option>
            {ordered.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} · {stamp(e.start, timezone)}
              </option>
            ))}
          </select>
        </label>
        <div className="route-fields">
          <label>
            Starting from
            <input
              value={origin}
              onChange={(e) => clear(setOrigin, e.target.value)}
              placeholder="Previous venue, or a street address and city"
              required
              minLength={3}
              maxLength={300}
            />
          </label>
          <label>
            Going to
            <input
              value={destination}
              onChange={(e) => clear(setDestination, e.target.value)}
              placeholder="Event location, street address and city"
              required
              minLength={3}
              maxLength={300}
            />
          </label>
        </div>
        <div className="route-options">
          <label>
            Travel by
            <select value={mode} onChange={(e) => clear(setMode, e.target.value)}>
              <option value="driving">Car</option>
              <option value="walking">On foot</option>
            </select>
          </label>
          <label>
            Arrive early
            <select value={buffer} onChange={(e) => clear(setBuffer, Number(e.target.value))}>
              {[0, 5, 10, 15, 30].map((v) => (
                <option key={v} value={v}>
                  {v} minutes
                </option>
              ))}
            </select>
          </label>
          <button className="outline-button" disabled={busy}>
            {busy ? <RefreshCw size={14} className="spin" /> : <Navigation size={14} />}{' '}
            {busy ? 'Finding your route…' : 'Calculate with Apple Maps'}
          </button>
        </div>
        <p className="route-disclosure">
          Route locations, travel mode and arrival time are sent to Apple Maps when you calculate.
          No device location, email text or event title is shared. Estimates can change.
        </p>
      </form>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {result ? (
        <div className="route-result" role="region" aria-label="Calculated route">
          {result.mapUrl && (
            <img
              src={result.mapUrl}
              alt={`Apple Maps route from ${result.originName} to ${result.destinationName}`}
            />
          )}
          <div className="route-numbers">
            <div>
              <strong>
                {Math.ceil(result.durationSeconds / 60)} <small>min</small>
              </strong>
              <span>{mode === 'walking' ? 'Walking' : 'Driving'} estimate</span>
            </div>
            <div>
              <strong>
                {(result.distanceMeters / 1000).toFixed(1)} <small>km</small>
              </strong>
              <span>Route distance</span>
            </div>
            {result.leaveBy && (
              <div>
                <strong>
                  {new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date(result.leaveBy))}
                </strong>
                <span>Leave by · {buffer} min buffer</span>
              </div>
            )}
          </div>
          <p>
            <b>{result.originName}</b> → <b>{result.destinationName}</b>
          </p>
          <small>
            {result.originAddress} → {result.destinationAddress}
          </small>
          {previous?.end &&
            result.leaveBy &&
            Date.parse(previous.end) > Date.parse(result.leaveBy) && (
              <p className="inline-error">
                Your previous event ends after the suggested departure. This trip may not fit
                between appointments.
              </p>
            )}
          <div className="route-footer">
            <span>Apple Maps · checked {stamp(result.checkedAt, timezone)}</span>
            <a href={mapsUrl} target="_blank" rel="noreferrer">
              Open directions <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      ) : (
        <div className="map-empty">
          <Navigation size={26} />
          <span>
            {selected?.location
              ? 'Choose your starting point to see the route.'
              : 'Add a location to calculate a route.'}
          </span>
          <small>Actual routes and travel times appear here after calculation.</small>
        </div>
      )}
    </section>
  );
}
