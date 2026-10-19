import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findClineRuntime, configuredClineSettings } from '../server/cline-runtime.mjs';

let ready = true;
const report = (label, message) => console.log(`${label}: ${message}`);
console.log('The Daily Edit — local setup check');
if (Number(process.versions.node.split('.')[0]) < 24) {
  ready = false;
  report('FIX', 'Use Node.js 24 or newer; Node 24 is recommended.');
} else report('OK', `Node ${process.versions.node}`);
try {
  const root = findClineRuntime();
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  report(version === '3.0.73' ? 'OK' : 'NOTE', `Cline CLI ${version}; tested version is 3.0.73.`);
  const core = await import(
    pathToFileURL(path.join(root, 'node_modules/@cline/core/dist/index.js')).href
  );
  configuredClineSettings(core);
  report('OK', 'Cline provider has a saved sign-in and model.');
} catch (error) {
  ready = false;
  report('FIX', error.message);
}
report(
  'OPTIONAL',
  process.env.PARALLEL_API_KEY
    ? 'Parallel key configured.'
    : 'Parallel key not set; public feeds still work.',
);
report(
  'OPTIONAL',
  process.env.FINNHUB_API_KEY
    ? 'Finnhub key configured.'
    : 'Finnhub key not set; stocks use Yahoo Finance.',
);
if (process.platform === 'darwin') {
  report(
    'OPTIONAL',
    fs.existsSync('.runtime/Daily Me Calendar.app/Contents/MacOS/CalendarReader')
      ? 'iCloud helper built; approve access in the app when connecting.'
      : 'iCloud helper not built. Run npm run calendar:setup to use iCloud.',
  );
  report(
    'OPTIONAL',
    fs.existsSync('.runtime/RouteReader')
      ? 'Apple Maps helper built.'
      : 'Maps helper not built. Run npm run maps:setup to use routes.',
  );
} else
  report(
    'OPTIONAL',
    'iCloud and Apple Maps helpers require macOS; Google Calendar is available separately.',
  );
console.log(
  'No network requests or model calls were made. Saved credentials, credit balance and account permissions were not validated online.',
);
console.log(
  ready
    ? 'Ready for local startup. Run npm run dev.'
    : 'Complete the FIX items, then run npm run doctor again.',
);
process.exitCode = ready ? 0 : 1;
