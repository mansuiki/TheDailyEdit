import { discoverConnections, connectionStates } from './composio.mjs';
import { appleCalendarStatus } from './apple-calendar.mjs';
import { now } from './utils.mjs';

export const connectionIds = ['gmail', 'applecalendar', 'googlecalendar'];

export function checkedConnection(previous, status) {
  const url = status.status !== 'active' ? previous?.url : undefined;
  return { ...status, ...(url ? { url } : {}) };
}

// Status only: never reads inboxes/events or launches an authorization prompt.
export async function checkConnections(
  ids = connectionIds,
  { discover = discoverConnections, appleStatus = appleCalendarStatus } = {},
) {
  if (ids.some((id) => !connectionIds.includes(id))) throw Error('Unsupported connection');
  const requests = [];
  const googleIds = ids.filter((id) => id !== 'applecalendar');
  if (googleIds.length)
    requests.push({
      ids: googleIds,
      read: async () => {
        const states = connectionStates(await discover(true));
        return Object.fromEntries(googleIds.map((id) => [id, states[id]]));
      },
    });
  if (ids.includes('applecalendar'))
    requests.push({
      ids: ['applecalendar'],
      read: async () => ({ applecalendar: await appleStatus() }),
    });
  const results = await Promise.allSettled(requests.map((request) => request.read()));
  return Object.assign(
    {},
    ...results.map((result, i) =>
      result.status === 'fulfilled'
        ? result.value
        : Object.fromEntries(
            requests[i].ids.map((id) => [
              id,
              {
                status: 'error',
                checkedAt: now(),
                message:
                  id === 'applecalendar'
                    ? 'Could not check iCloud access. Try again on this Mac.'
                    : 'Could not check this account. Check Cline sign-in and try again.',
              },
            ]),
          ),
    ),
  );
}
