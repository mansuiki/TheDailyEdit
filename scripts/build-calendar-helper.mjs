import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
if (process.platform !== 'darwin') throw Error('Apple Calendar requires macOS.');
const app = path.resolve('.runtime/Daily Me Calendar.app');
fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
fs.writeFileSync(
  path.join(app, 'Contents/Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.dailyme.calendar-reader</string>
<key>CFBundleName</key><string>Daily Me Calendar</string>
<key>CFBundleDisplayName</key><string>Daily Me Calendar</string>
<key>CFBundleExecutable</key><string>CalendarReader</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSCalendarsFullAccessUsageDescription</key><string>Reads up to 30 iCloud events over the next 7 days, or an explicitly selected historical date range, for The Daily Edit. This app cannot add, edit or delete events. Selected excerpts are sent to your configured Cline model to write your briefing.</string>
<key>NSCalendarsUsageDescription</key><string>Reads a bounded selection of iCloud events for your personal newspaper.</string>
</dict></plist>`,
);
execFileSync(
  'xcrun',
  [
    'swiftc',
    'native/CalendarReader.swift',
    '-module-cache-path', path.resolve('.runtime/swift-module-cache'),
    '-o',
    path.join(app, 'Contents/MacOS/CalendarReader'),
    '-framework',
    'AppKit',
    '-framework',
    'EventKit',
  ],
  { stdio: 'inherit' },
);
execFileSync(
  'codesign',
  ['--force', '--sign', '-', '--identifier', 'dev.dailyme.calendar-reader', app],
  { stdio: 'inherit' },
);
console.log('Apple Calendar helper built. Calendar access has not been requested.');
