import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { hash } from './utils.mjs';
export const routeRequestSchema = z
  .object({
    origin: z.string().trim().min(3).max(300),
    destination: z.string().trim().min(3).max(300),
    mode: z.enum(['driving', 'walking']),
    arrivalTime: z.iso.datetime().optional(),
    bufferMinutes: z.number().int().min(0).max(90).default(10),
  })
  .strict();
const directory = path.resolve(process.env.NEWSROOM_DATA_DIR || '.data', 'routes');
const binary = path.resolve('.runtime/RouteReader');
const pending = new Map();
export function departurePlan(durationSeconds, arrivalTime, bufferMinutes = 10) {
  if (!arrivalTime) return {};
  const arrival = Date.parse(arrivalTime);
  if (!Number.isFinite(arrival) || !Number.isFinite(durationSeconds) || durationSeconds < 0)
    throw Error('Invalid route timing');
  return {
    arriveBy: new Date(arrival).toISOString(),
    leaveBy: new Date(arrival - durationSeconds * 1000 - bufferMinutes * 60000).toISOString(),
    bufferMinutes,
  };
}
export function routeMapFile(id) {
  if (!/^[a-f0-9]{18}$/.test(id)) return null;
  const file = path.join(directory, `${id}.png`);
  return fs.existsSync(file) ? file : null;
}
export async function calculateRoute(raw) {
  const request = routeRequestSchema.parse(raw);
  if (process.platform !== 'darwin' || !fs.existsSync(binary))
    throw Error('Apple Maps routing is available after running npm run maps:setup on this Mac.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = hash(request),
    file = path.join(directory, `${id}.json`);
  if (fs.existsSync(file)) {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - Date.parse(cached.checkedAt) < 10 * 60000) return { ...cached, cached: true };
  }
  if (pending.has(id)) return pending.get(id);
  const task = new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(Error('Apple Maps timed out. Try again.'));
    }, 45000);
    child.on('error', () => finish(Error('Could not start the Apple Maps helper.')));
    child.stdout.on('data', (data) => {
      stdout += data;
      if (stdout.length > 50000) {
        child.kill('SIGKILL');
        finish(Error('Unexpected route response.'));
      }
    });
    child.stderr.on('data', () => {});
    child.on('close', () => {
      try {
        const result = JSON.parse(stdout);
        if (result.error) return finish(Error(result.error));
        const validated = z
          .object({
            durationSeconds: z.number().nonnegative(),
            distanceMeters: z.number().nonnegative(),
            checkedAt: z.string(),
          })
          .passthrough()
          .parse(result);
        const value = {
          ...validated,
          ...departurePlan(validated.durationSeconds, request.arrivalTime, request.bufferMinutes),
          mapUrl: result.hasMap ? `/api/routes/${id}/map` : null,
        };
        fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
        finish(null, value);
      } catch {
        finish(Error('Apple Maps returned an incomplete route.'));
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ...request, imagePath: path.join(directory, `${id}.png`) }));
  });
  pending.set(id, task);
  try {
    return await task;
  } finally {
    pending.delete(id);
  }
}
