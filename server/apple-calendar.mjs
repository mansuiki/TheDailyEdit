import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { now, cleanText, hash } from './utils.mjs';
const exec = promisify(execFile);
const app = path.resolve('.runtime/Daily Me Calendar.app');
const binary = path.join(app, 'Contents/MacOS/CalendarReader');
const authorizationFile = path.resolve('.data/apple-calendar-authorization.json');
let authorizing = false;
async function invoke(mode, window) {
  if (process.platform !== 'darwin') return { status: 'unsupported', checkedAt: now() };
  if (!fs.existsSync(binary)) return { status: 'not_configured', checkedAt: now() };
  // Launch Services preserves the approved app's TCC identity. Executing the
  // binary directly would inherit the terminal/Codex identity instead.
  const resultFile = path.resolve(`.data/calendar-bridge-${randomUUID()}.json`);
  fs.mkdirSync(path.dirname(resultFile), { recursive: true, mode: 0o700 });
  try {
    await exec('open', ['-g', '-n', '-W', app, '--args', mode, '--output', resultFile, ...(window ? ['--start', window.start, '--end', window.end] : [])], {
      timeout: 20000,
      maxBuffer: 64 * 1024,
    }).catch(() => {});
    // Launch Services can report success before a very short-lived helper has
    // written its result ("Unable to block on application"). The unique, atomic
    // result file is the completion signal, not open's process-wait behavior.
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(resultFile) && Date.now() < deadline) await delay(100);
    return JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  } finally {
    fs.rmSync(resultFile, { force: true });
  }
}
export async function appleCalendarStatus() {
  try {
    return await invoke('status');
  } catch {
    return {
      status: 'error',
      checkedAt: now(),
      error: 'Could not verify Apple Calendar access.',
    };
  }
}
export async function authorizeAppleCalendar() {
  const status = await appleCalendarStatus();
  if (status.status === 'active') return status;
  if (status.status === 'not_configured') throw Error('Run npm run calendar:setup first.');
  if (status.status === 'denied')
    return {
      ...status,
      message: 'Allow Daily Me Calendar in System Settings → Privacy & Security → Calendars.',
    };
  if (status.status !== 'permission_required') throw Error('Apple Calendar access requires macOS.');
  if (!authorizing) {
    authorizing = true;
    fs.mkdirSync(path.dirname(authorizationFile), { recursive: true, mode: 0o700 });
    // The user approves the native macOS permission sheet. Never grant access programmatically.
    exec('open', ['-n', '-W', app, '--args', 'authorize', '--output', authorizationFile], {
      timeout: 300000,
    })
      .catch(() => {})
      .finally(() => {
        authorizing = false;
      });
  }
  return {
    status: 'initiated',
    checkedAt: now(),
    message: 'Approve access in the macOS Daily Me Calendar permission dialog.',
  };
}
const exportSchema = z.object({
  status: z.string(),
  checkedAt: z.iso.datetime(),
  calendarCount: z.number().optional(),
  hasMore: z.boolean().optional(),
  events: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        start: z.iso.datetime(),
        end: z.iso.datetime(),
        allDay: z.boolean(),
        timezone: z.string(),
        location: z.string(),
        notes: z.string(),
        calendarTitle: z.string(),
      }),
    )
    .max(30)
    .optional(),
});
export function normalizeAppleCalendar(raw) {
  const data = exportSchema.parse(raw);
  const messages = {
    permission_required: 'Apple Calendar requires macOS permission.',
    denied: 'Calendar access was denied. Allow it in System Settings.',
    no_icloud: 'No synced iCloud calendar was found. Check your iCloud account in Apple Calendar.',
    not_configured: 'Set up the local Apple Calendar helper first.',
    unsupported: 'The local Apple Calendar connection requires macOS.',
    error: 'Apple Calendar read failed. Keeping previous sources.',
  };
  const evidence =
    data.status === 'active'
      ? (data.events || []).map((e) => ({
          id: `applecalendar-${hash([e.id, e.start])}`,
          source: 'applecalendar',
          sourceLabel: 'Apple Calendar · iCloud',
          title: cleanText(e.title),
          excerpt: cleanText(
            [
              `${e.start} → ${e.end}`,
              e.allDay ? 'All-day event' : '',
              e.timezone,
              e.location,
              e.notes,
            ]
              .filter(Boolean)
              .join(' · '),
          ),
          url: 'https://www.icloud.com/calendar/',
          publishedAt: null,
          fetchedAt: data.checkedAt,
          visibility: 'private',
          contentStatus: 'excerpt',
          start: e.start,
          end: e.end,
          allDay: e.allDay,
          timezone: e.timezone,
          location: e.location,
          calendarTitle: e.calendarTitle,
        }))
      : [];
  const error = messages[data.status] || null;
  return {
    evidence,
    connections: { applecalendar: { status: data.status, checkedAt: data.checkedAt } },
    statuses: {
      applecalendar: {
        ok: data.status === 'active',
        count: evidence.length,
        checkedAt: data.checkedAt,
        error,
      },
    },
    notes: [
      error ||
        `${data.calendarCount ?? 0} iCloud calendars · next 7 days · up to 30 events${data.hasMore ? ' (more events available)' : ''}`,
    ],
  };
}
export async function collectAppleCalendar(window) {
  try {
    if (window && !(await invoke('status')).supportsDateRange) throw Error('The installed calendar helper supports current events only; historical reading is not enabled.');
    const result = normalizeAppleCalendar(await invoke('read', window));
    if (window) result.notes = [result.statuses.applecalendar.error || `iCloud events currently retained for ${window.start} to ${window.end} (end exclusive), up to 30. This is not a historical calendar snapshot; entries may have changed or been removed.`];
    return result;
  } catch {
    return normalizeAppleCalendar({ status: 'error', checkedAt: now() });
  }
}
