import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const setupErrors = {
  CLINE_NOT_INSTALLED:
    'Cline was not found. Install it with npm install -g cline@3.0.73, or set CLINE_BIN to its executable.',
  CLINE_RUNTIME_MISSING:
    'This Cline installation is missing the required runtime. Install Cline CLI 3.0.73 and run npm run doctor.',
  CLINE_NOT_CONFIGURED:
    'Cline is not configured yet. Run cline auth in your terminal, choose the Cline provider, sign in and select a model. Then try again.',
};

export function setupError(code) {
  return Object.assign(new Error(setupErrors[code]), { code });
}

export function findClineRuntime({
  binary = process.env.CLINE_BIN,
  findBinary = () => execFileSync('which', ['cline'], { encoding: 'utf8', stdio: 'pipe' }).trim(),
} = {}) {
  let executable;
  try {
    executable = fs.realpathSync(binary || findBinary());
  } catch {
    throw setupError('CLINE_NOT_INSTALLED');
  }
  let root = path.dirname(executable);
  while (!fs.existsSync(path.join(root, 'node_modules/@cline/core/package.json'))) {
    const parent = path.dirname(root);
    if (parent === root) throw setupError('CLINE_RUNTIME_MISSING');
    root = parent;
  }
  if (!fs.existsSync(path.join(root, 'node_modules/@cline/core/dist/index.js')))
    throw setupError('CLINE_RUNTIME_MISSING');
  return root;
}

export function configuredClineSettings(core) {
  const settings = new core.ProviderSettingsManager().getProviderSettings('cline');
  if (!settings?.model || !core.resolveLocalClineAuthToken(settings))
    throw setupError('CLINE_NOT_CONFIGURED');
  return settings;
}

// Only known setup messages cross the worker boundary; arbitrary stderr can contain private data.
export function workerFailure(stderr) {
  for (const line of stderr.trim().split('\n').reverse()) {
    try {
      const error = JSON.parse(line);
      if (error.type === 'error' && Object.hasOwn(setupErrors, error.code))
        return setupErrors[error.code];
    } catch {}
  }
  return /auth|401|login/i.test(stderr)
    ? 'Cline sign-in needs attention. Run cline auth, choose the Cline provider and check your model and credits.'
    : 'Cline did not finish. Run npm run doctor to check your setup, then try again.';
}
