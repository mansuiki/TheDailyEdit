export const SERVICE_NAME = 'The Daily Edit';
export const TAGLINE = 'Your world. Your paper.';
export const EMPTY_CONTEXT = { place: '', activity: '', interests: '' };
export const DEFAULT_IDENTITY = { mode: 'auto', title: '', description: '' };
export function localDate(at, timezone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function zonedMidnight(date, timezone) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
  )
    throw Error('Enter a valid date.');
  const target = Date.parse(`${date}T00:00:00Z`);
  let candidate = target;
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(
      format.formatToParts(new Date(candidate)).map((x) => [x.type, x.value]),
    );
    const actual = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    const diff = target - actual;
    candidate += diff;
    if (!diff) break;
  }
  if (localDate(candidate, timezone) !== date)
    throw Error('This local date does not exist in that time zone.');
  return new Date(candidate).toISOString();
}
export function dateWindow(startDate, endDate, timezone) {
  if (
    endDate < startDate ||
    (Date.parse(`${endDate}T12:00Z`) - Date.parse(`${startDate}T12:00Z`)) / 86400000 > 13
  )
    throw Error('Choose a range of 1–14 days.');
  return {
    startDate,
    endDate,
    timezone,
    start: zonedMidnight(startDate, timezone),
    end: zonedMidnight(addDays(endDate, 1), timezone),
  };
}
export function inWindow(record, window) {
  const s = Date.parse(window.start),
    e = Date.parse(window.end);
  if (record.source === 'gmail') {
    const t = Date.parse(record.publishedAt);
    return Number.isFinite(t) && t >= s && t < e;
  }
  const a = Date.parse(record.start),
    b = Date.parse(record.end);
  return Number.isFinite(a) && Number.isFinite(b) && a < e && b > s;
}
export function readingState(live) {
  if (live.archived) return live;
  return {
    ...live,
    preferences: { ...live.preferences, ...(live.issue?.readingPreferences || {}) },
  };
}
