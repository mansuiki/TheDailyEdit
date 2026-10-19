import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

// Each preview gets a new ignored database. Never reset the reader's main .data store.
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
const parent = path.resolve('.data/previews');
fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
const directory = fs.mkdtempSync(path.join(parent, 'first-run-'));
const port = process.env.NEWSROOM_PREVIEW_PORT || '4311';
console.log(`Fresh preview: http://127.0.0.1:${port}`);
console.log(`Separate data directory: ${directory}`);
const child = spawn(process.execPath, ['server/index.mjs', '--production'], {
  stdio: 'inherit',
  env: { ...process.env, NEWSROOM_DATA_DIR: directory, PORT: port },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
