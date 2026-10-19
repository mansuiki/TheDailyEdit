export function calendarConnection(preferences) {
  return preferences.calendarProvider === 'apple' ? 'applecalendar' : 'googlecalendar';
}

export function selectedPersonalSources(preferences) {
  return [
    ...(preferences.paper.sections.inbox > 0 ? ['gmail'] : []),
    ...(preferences.paper.sections.calendar > 0 ? [calendarConnection(preferences)] : []),
  ];
}

export function missingPersonalSources(preferences, connections) {
  return selectedPersonalSources(preferences).filter((id) => connections[id]?.status !== 'active');
}

// A reader's explicit "Use account" action adds its page without changing other allocations.
export function includePersonalSource(preferences, id) {
  if (!['gmail', 'applecalendar', 'googlecalendar'].includes(id))
    throw Error('Unsupported personal source');
  const next = structuredClone(preferences);
  const section = id === 'gmail' ? 'inbox' : 'calendar';
  next.paper.sections[section] = Math.max(1, next.paper.sections[section] || 0);
  if (id !== 'gmail') next.calendarProvider = id === 'applecalendar' ? 'apple' : 'google';
  return next;
}
