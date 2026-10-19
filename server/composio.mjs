// Cline 3.0.73 native connector transport. Credentials remain in Cline's store.
// The proxy contract is pinned to the installed Cline source; no Composio key is copied.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { inWindow } from '../shared/edition.mjs';
import { get, now, cleanText } from './utils.mjs';
let core, shared, tokenManager, meta, workflow, discovery, initialized;
const toolkits = ['gmail', 'googlecalendar'];
async function runtime() {
  if (!initialized)
    initialized = (async () => {
      const cli = fs.realpathSync(
        process.env.CLINE_BIN || execFileSync('which', ['cline'], { encoding: 'utf8' }).trim(),
      );
      let root = path.dirname(cli);
      while (!fs.existsSync(path.join(root, 'node_modules/@cline/core/package.json'))) {
        const parent = path.dirname(root);
        if (parent === root) throw new Error('Cline CLI installation not found.');
        root = parent;
      }
      core = await import(
        pathToFileURL(path.join(root, 'node_modules/@cline/core/dist/index.js')).href
      );
      shared = await import(
        pathToFileURL(path.join(root, 'node_modules/@cline/shared/dist/index.js')).href
      );
      tokenManager = new core.RuntimeOAuthTokenManager();
    })();
  await initialized;
  const settings = new core.ProviderSettingsManager().getProviderSettings('cline');
  const token =
    (await tokenManager.resolveProviderApiKey({ providerId: 'cline' }))?.apiKey ??
    core.resolveLocalClineAuthToken(settings);
  if (!token) throw new Error('Sign in with cline auth in your terminal first.');
  return { base: settings?.baseUrl || shared.getClineEnvironmentConfig().apiBaseUrl, token };
}
async function request(route, body) {
  const { base, token } = await runtime();
  const response = await get(base + route, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (result.error || result.success === false || result.data?.success === false)
    throw new Error('Cline Composio request failed. Check your connections.');
  return result.data ?? result;
}
async function execute(slug, args) {
  if (!meta) meta = await request('/api/v1/connectors/meta-tools/sessions');
  if (!meta.tools?.some((t) => t.slug === slug))
    throw new Error('This connector is unavailable for the current Cline account.');
  return request(`/api/v1/connectors/meta-tools/${slug}/execute`, {
    sessionId: meta.sessionId,
    arguments: args,
  });
}
export async function discoverConnections(force = false) {
  if (discovery && !force) return discovery;
  const data = await execute('COMPOSIO_SEARCH_TOOLS', {
    queries: [
      { use_case: 'Fetch recent Gmail emails with subjects and snippets' },
      { use_case: 'List upcoming Google Calendar events' },
    ],
    session: workflow ? { id: workflow } : { generate_id: true },
  });
  workflow = data.session?.id;
  if (!workflow) throw new Error('Could not create a Composio session.');
  discovery = data;
  return data;
}
export function connectionStates(data) {
  return Object.fromEntries(
    toolkits.map((toolkit) => {
      const s = data.toolkit_connection_statuses?.find((s) => s.toolkit === toolkit);
      return [
        toolkit,
        { status: s?.has_active_connection ? 'active' : 'disconnected', checkedAt: now() },
      ];
    }),
  );
}
export async function connect(toolkit) {
  if (!toolkits.includes(toolkit)) throw new Error('Unsupported service');
  const d = await discoverConnections(true);
  if (!d.toolkit_connection_statuses?.some((t) => t.toolkit === toolkit))
    throw new Error('Service not found.');
  const result = await execute('COMPOSIO_MANAGE_CONNECTIONS', {
    toolkits: [toolkit],
    session_id: workflow,
  });
  const item = result.results?.[toolkit];
  if (!item) throw new Error('Could not verify the connection.');
  return { status: String(item.status).toLowerCase(), url: item.redirect_url, checkedAt: now() };
}
const emailArgs = z
  .object({
    user_id: z.literal('me'),
    query: z.string().max(200),
    max_results: z.number().int().min(1).max(20),
    verbose: z.literal(true),
    include_payload: z.literal(false),
  })
  .strict();
const calendarArgs = z
  .object({
    calendarId: z.literal('primary'),
    timeMin: z.iso.datetime(),
    timeMax: z.iso.datetime(),
    timeZone: z.string().max(100),
    maxResults: z.number().int().min(1).max(100),
    singleEvents: z.literal(true),
    orderBy: z.literal('startTime'),
    fields: z.string().max(300),
  })
  .strict();
export function validateReadTool(slug, args) {
  if (slug === 'GMAIL_FETCH_EMAILS') return emailArgs.parse(args);
  if (slug === 'GOOGLECALENDAR_EVENTS_LIST') return calendarArgs.parse(args);
  throw new Error('The newsroom only allows approved read-only Gmail and Calendar tools.');
}
function content(response) {
  if (response?.successful === false || response?.success === false || response?.error)
    throw new Error('The connected service rejected the read. Please reconnect.');
  return response?.data ?? response;
}
export async function collectPersonal(
  timezone,
  { includeMail = true, includeCalendar = true, window } = {},
) {
  if (!includeMail && !includeCalendar)
    return { evidence: [], connections: {}, notes: [], statuses: {} };
  const discovered = await discoverConnections(true);
  const connections = connectionStates(discovered);
  const tools = [];
  if (includeMail && connections.gmail.status === 'active')
    tools.push({
      tool_slug: 'GMAIL_FETCH_EMAILS',
      arguments: {
        user_id: 'me',
        query: window
          ? `after:${Math.floor(Date.parse(window.start) / 1000) - 1} before:${Math.floor(Date.parse(window.end) / 1000)}`
          : 'in:inbox newer_than:3d',
        max_results: window ? 20 : 12,
        verbose: true,
        include_payload: false,
      },
    });
  if (includeCalendar && connections.googlecalendar.status === 'active')
    tools.push({
      tool_slug: 'GOOGLECALENDAR_EVENTS_LIST',
      arguments: {
        calendarId: 'primary',
        timeMin: now(),
        timeMax: new Date(Date.now() + 7 * 86400000).toISOString(),
        timeZone: timezone,
        maxResults: 30,
        singleEvents: true,
        orderBy: 'startTime',
        fields: 'items(id,status,summary,start,end,location,htmlLink,description),nextPageToken',
      },
    });
  if (!tools.length)
    return {
      evidence: [],
      connections,
      notes: ['Connect Gmail and Calendar to start your personal briefing.'],
    };
  for (const t of tools) {
    validateReadTool(t.tool_slug, t.arguments);
    if (!discovered.tool_schemas?.[t.tool_slug]?.hasFullSchema)
      throw new Error('The Composio tool schema has changed.');
  }
  const result = await execute('COMPOSIO_MULTI_EXECUTE_TOOL', {
    tools,
    sync_response_to_workbench: false,
    session_id: workflow,
    current_step: 'READING_PERSONAL_BRIEF',
    thought:
      'Read a bounded inbox sample and the next seven days of events for the user’s private newspaper.',
  });
  const evidence = [],
    notes = [],
    statuses = {};
  for (let i = 0; i < tools.length; i++) {
    const source = tools[i].tool_slug === 'GMAIL_FETCH_EMAILS' ? 'gmail' : 'googlecalendar';
    statuses[source] = {
      ok: false,
      checkedAt: now(),
      count: 0,
      error: 'No response from the connected service.',
    };
    const row = result.results?.[i];
    if (!row) {
      notes.push(`${tools[i].tool_slug}: No response`);
      continue;
    }
    let data;
    try {
      data = content(row.response ?? row);
    } catch (e) {
      notes.push(e.message);
      continue;
    }
    statuses[source] = {
      ok: true,
      checkedAt: now(),
      count: 0,
      hasMore: Boolean(data.nextPageToken || data.next_page_token),
    };
    if (tools[i].tool_slug === 'GMAIL_FETCH_EMAILS') {
      for (const m of data.messages ?? []) {
        const id = m.messageId ?? m.id;
        if (!id) continue;
        evidence.push({
          id: `gmail-${id}`,
          source: 'gmail',
          sourceLabel: 'Gmail',
          title: cleanText(m.subject || '(Untitled)'),
          excerpt: cleanText(m.preview?.body ?? m.messageText ?? m.snippet ?? '').slice(0, 900),
          url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(id)}`,
          publishedAt: m.messageTimestamp ?? null,
          fetchedAt: now(),
          visibility: 'private',
          contentStatus: 'excerpt',
          sender: cleanText(m.sender ?? m.from ?? ''),
          recordId: id,
        });
      }
      notes.push(
        window
          ? 'A sample of up to 20 messages currently retained in Gmail for the selected period, including archived mail. Not a complete mailbox or historical label snapshot.'
          : 'A sample of up to 12 inbox messages from the past 3 days, not a complete inbox summary.',
      );
    } else {
      for (const e of data.items ?? []) {
        if (e.status === 'cancelled') continue;
        const start = e.start?.dateTime ?? e.start?.date;
        evidence.push({
          id: `calendar-${e.id}`,
          source: 'googlecalendar',
          sourceLabel: 'Google Calendar',
          title: cleanText(e.summary || '(Untitled)'),
          excerpt: cleanText(
            [start, e.end?.dateTime ?? e.end?.date, e.location, e.description]
              .filter(Boolean)
              .join(' · '),
          ).slice(0, 1000),
          url: e.htmlLink || 'https://calendar.google.com',
          publishedAt: null,
          fetchedAt: now(),
          visibility: 'private',
          contentStatus: 'excerpt',
          start,
          end: e.end?.dateTime ?? e.end?.date,
          allDay: !!e.start?.date,
          recordId: e.id,
        });
      }
      notes.push(
        `Primary calendar · next 7 days · up to 30 events${data.nextPageToken ? ' (more events available)' : ''}`,
      );
    }
  }
  const filtered = window ? evidence.filter((e) => inWindow(e, window)) : evidence;
  if (window && filtered.length < evidence.length)
    notes.push(
      `${evidence.length - filtered.length} records excluded because their timestamp was missing or outside the requested period.`,
    );
  for (const [source, status] of Object.entries(statuses)) {
    status.count = filtered.filter((e) => e.source === source).length;
    status.hasMore ||= status.count >= (window ? 20 : 12);
  }
  if (window && !statuses.gmail)
    statuses.gmail = { ok: false, count: 0, error: 'Gmail is not connected.' };
  return { evidence: filtered, connections, notes, statuses };
}
