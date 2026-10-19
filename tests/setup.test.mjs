import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  findClineRuntime,
  configuredClineSettings,
  workerFailure,
} from '../server/cline-runtime.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-edit-setup-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('a missing CLI and an installation without its bundled runtime get distinct setup instructions', () => {
  assert.throws(() => findClineRuntime({ binary: path.join(directory, 'missing') }), {
    code: 'CLINE_NOT_INSTALLED',
  });
  const standalone = path.join(directory, 'standalone');
  fs.writeFileSync(standalone, '');
  assert.throws(() => findClineRuntime({ binary: standalone }), { code: 'CLINE_RUNTIME_MISSING' });
});

test('runtime discovery resolves a fresh npm prefix symlink without relying on this machine’s global installation', () => {
  const root = path.join(directory, 'lib/node_modules/cline');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/@cline/core/dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin/cline'), '');
  fs.writeFileSync(path.join(root, 'node_modules/@cline/core/package.json'), '{}');
  fs.writeFileSync(path.join(root, 'node_modules/@cline/core/dist/index.js'), '');
  const link = path.join(directory, 'cline');
  fs.symlinkSync(path.join(root, 'bin/cline'), link);
  assert.equal(findClineRuntime({ binary: link }), fs.realpathSync(root));
});

test('saved sign-in and model are both required; a different provider does not satisfy Cline setup', () => {
  for (const settings of [undefined, {}, { model: 'configured' }, { apiKey: 'test-only' }]) {
    const core = {
      ProviderSettingsManager: class {
        getProviderSettings(id) {
          assert.equal(id, 'cline');
          return settings;
        }
      },
      resolveLocalClineAuthToken: (value) => value?.apiKey,
    };
    assert.throws(() => configuredClineSettings(core), { code: 'CLINE_NOT_CONFIGURED' });
  }
  const settings = { model: 'configured', apiKey: 'test-only' };
  assert.equal(
    configuredClineSettings({
      ProviderSettingsManager: class {
        getProviderSettings() {
          return settings;
        }
      },
      resolveLocalClineAuthToken: (value) => value.apiKey,
    }),
    settings,
  );
});

test('worker errors retain actionable setup guidance without reflecting raw stderr or injected messages', () => {
  const message = workerFailure(
    JSON.stringify({ type: 'error', code: 'CLINE_NOT_CONFIGURED', message: 'private marker' }),
  );
  assert.match(message, /not configured yet/);
  assert.doesNotMatch(message, /private marker|expired/);
  for (const code of ['unknown', '__proto__']) {
    assert.doesNotMatch(
      workerFailure(JSON.stringify({ type: 'error', code, message: 'private marker' })),
      /private marker/,
    );
  }
});

const entry = fileURLToPath(new URL('../server/index.mjs', import.meta.url));
test('production startup without a build exits with the exact next command before listening', () => {
  const result = spawnSync(process.execPath, [entry, '--production'], {
    cwd: directory,
    env: {
      ...process.env,
      PORT: '0',
      NEWSROOM_DATA_DIR: path.join(directory, 'missing-build-data'),
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run npm run build before npm start/);
  assert.doesNotMatch(result.stdout, /The Daily Edit →/);
});

test('invalid ports exit visibly instead of claiming the app has started', () => {
  const result = spawnSync(process.execPath, [entry], {
    cwd: directory,
    env: {
      ...process.env,
      PORT: 'not-a-port',
      NEWSROOM_DATA_DIR: path.join(directory, 'invalid-port-data'),
    },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT must be a whole number/);
  assert.doesNotMatch(result.stdout, /The Daily Edit →/);
});
