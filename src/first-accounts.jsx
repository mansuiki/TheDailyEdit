import React from 'react';
import { Mail, CalendarDays, CheckCircle2, ExternalLink } from 'lucide-react';
import { Button } from './components/ui/button';
import { calendarConnection, missingPersonalSources } from '../shared/onboarding.mjs';

export const accountLabels = {
  gmail: 'Gmail',
  applecalendar: 'iCloud Calendar',
  googlecalendar: 'Google Calendar',
};
const scope = {
  gmail: 'Your Inbox · last 3 days · up to 12 messages',
  applecalendar: 'Your Week · next 7 days · up to 30 iCloud events',
  googlecalendar: 'Your Week · next 7 days · up to 30 primary-calendar events',
};
function authURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
function connectionMessage(id, connection) {
  if (connection?.status === 'active') return 'Connected';
  if (connection?.message) return connection.message;
  if (id === 'applecalendar')
    return (
      {
        denied:
          'Allow Daily Me Calendar in System Settings → Privacy & Security → Calendars, then check again.',
        no_icloud:
          'Add your iCloud account in Apple Calendar and turn on calendar syncing, then check again.',
        not_configured:
          'The calendar helper needs setup on this Mac. Run npm run calendar:setup, then check again.',
        unsupported:
          'iCloud Calendar requires this app to run on a Mac. You can use Google Calendar instead.',
        initiated: 'Approve the Daily Me Calendar prompt on your Mac, then check again.',
        error: 'Could not check iCloud access. Try checking again.',
      }[connection?.status] || 'Ready to connect on this Mac'
    );
  return connection?.url ? 'Finish signing in with Google, then check again.' : 'Not connected yet';
}

export default function FirstAccounts({ prefs, connections, onChange, connect, check, working }) {
  const calendarId = calendarConnection(prefs);
  const missing = missingPersonalSources(prefs, connections);
  return (
    <>
      <h3>Bring your day into the paper.</h3>
      <p className="setup-description">
        Connect your inbox and calendar here. Using an account adds its page to your first issue.
        You can also continue with public news only.
      </p>
      <div className="setup-accounts">
        {['gmail', calendarId].map((id) => {
          const connection = connections[id];
          const connected = connection?.status === 'active';
          const section = id === 'gmail' ? 'inbox' : 'calendar';
          const included = prefs.paper.sections[section] > 0;
          const Icon = id === 'gmail' ? Mail : CalendarDays;
          const link = authURL(connection?.url);
          return (
            <section className="setup-account" key={id} aria-label={accountLabels[id]}>
              <div className="setup-account-heading">
                <Icon size={21} />
                <h4>{accountLabels[id]}</h4>
                {connected && <CheckCircle2 size={17} aria-label="Connected" />}
              </div>
              {id !== 'gmail' && (
                <label className="setup-calendar-choice">
                  Calendar account
                  <select
                    value={prefs.calendarProvider}
                    onChange={(e) => onChange('calendarProvider', e.target.value)}
                  >
                    <option value="apple">iCloud · Apple Calendar on this Mac</option>
                    <option value="google">Google Calendar</option>
                  </select>
                </label>
              )}
              <p className="setup-description">{scope[id]}</p>
              {id === 'applecalendar' && (
                <p className="setup-description">
                  Uses iCloud calendars synced to Apple Calendar. If macOS asks, choose Full Access
                  for Daily Me Calendar. This app only reads events.
                </p>
              )}
              <p
                className={`setup-account-status ${connected ? 'is-connected' : ''}`}
                role="status"
              >
                {working === id || working === 'check'
                  ? 'Checking connection…'
                  : connectionMessage(id, connection)}
              </p>
              <div className="setup-account-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!working}
                  onClick={() => connect(id)}
                >
                  {connected
                    ? included
                      ? 'Check connection'
                      : `Use ${accountLabels[id]}`
                    : id === 'applecalendar'
                      ? 'Connect iCloud Calendar'
                      : `Connect ${accountLabels[id]}`}
                </Button>
                {!connected && link && (
                  <a href={link} target="_blank" rel="noreferrer" className="setup-auth-link">
                    Continue with Google <ExternalLink size={13} />
                  </a>
                )}
              </div>
              {!connected && (link || ['initiated', 'denied'].includes(connection?.status)) && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!working}
                  onClick={() => check([id])}
                >
                  I’ve approved access — check again
                </Button>
              )}
              <label className="setup-account-include">
                <input
                  type="checkbox"
                  checked={included}
                  onChange={(e) =>
                    onChange('paper', {
                      ...prefs.paper,
                      sections: {
                        ...prefs.paper.sections,
                        [section]: e.target.checked
                          ? Math.max(1, prefs.paper.sections[section])
                          : 0,
                      },
                    })
                  }
                />
                <span>Include {id === 'gmail' ? 'Your Inbox' : 'Your Week'} in my first issue</span>
              </label>
            </section>
          );
        })}
      </div>
      <p className="setup-description">
        Nothing is collected until you publish. Selected mail and calendar excerpts will be read for
        your private paper and sent to your configured Cline model. No messages are sent and no
        events are changed.
      </p>
      {missing.length > 0 && (
        <p className="setup-connection-hint" role="status">
          Connect {missing.map((id) => accountLabels[id]).join(' and ')} or turn off their pages to
          continue.
        </p>
      )}
    </>
  );
}
