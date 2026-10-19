# The Daily Edit

**Your world. Your paper.**

A personal newspaper that brings together the news you follow, your inbox, calendar and markets. Cline reporters write from collected sources; an editor reviews, requests revisions and selects stories for publication. Your location, current activity and interests shape the paper’s name, priorities and pages.

Started at the Cline hackathon in San Francisco.

## Features

- **A complete newspaper:** a front page and multiple inside pages, column layouts, photography, page navigation and an unfolded reading view.
- **Your own editorial teams:** built-in news, inbox, calendar and markets sections, plus custom teams following public YouTube channels or RSS/Atom feeds.
- **Natural-language settings:** describe what you want to read, how much space it deserves and when to update; review the editor’s proposed plan before applying it.
- **Visible editorial work:** open a story’s sources, reporter drafts, editor decisions and revisions. Related reading connects supporting sources and nearby topics.
- **Personal context:** issue names and editorial priorities use the context you provide. Keep a name, edit it manually or let the editor update it when your context changes.
- **Gmail and calendars:** read selected Gmail messages and Google Calendar or synced iCloud events. Calendar pages can calculate Apple Maps routes and suggested departure times.
- **Saved editions:** reopen a published paper with its original name, date, timezone, articles, sources, layout and available local images.
- **Translation and export:** English by default, on-demand Korean article translation, full-edition printing and individual page PNG capture.
- **Scheduled and partial updates:** refresh enabled sources on your schedule, update prices independently and retain the last successful content when a source fails.

## Requirements

- **Node.js 24+** and npm. A `.nvmrc` is included for Node version managers.
- **Cline CLI 3.0.73**, signed in to the **Cline provider** with a model configured and available credits. This integration uses its bundled ClineCore 0.0.95. A ChatGPT login alone does not configure the app’s current adapter.
- **macOS 14+ and Xcode Command Line Tools** for the optional iCloud Calendar and Apple Maps helpers. The full application has been verified on macOS; other platforms have not been verified end to end.

## Run locally

Clone the repository and enter the project directory. With nvm, run `nvm install` and `nvm use` after cloning to select the included Node version.

```bash
git clone https://github.com/mansuiki/TheDailyEdit.git
cd TheDailyEdit
npm ci
npm install -g cline@3.0.73  # Skip if already installed at this version
cline auth                  # Choose Cline, sign in, and configure a model
npm run dev
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310). A fresh checkout starts with no personal data or published issues.

1. **Your world:** enter your location, activity, interests and edition timezone.
2. **Your pages:** choose the sections and page counts. The starter paper has Technology and World, with three pages including the cover.
3. **Your accounts:** optionally connect Gmail and a calendar. Connecting an account includes its page; you can turn that page off before publishing.
4. **To the presses:** review the plan and select **Publish my first edition**.

Automatic updates start disabled. Account status checks do not read messages or events; collection starts when you publish enabled pages. Selected email/calendar excerpts are sent to your configured Cline model to write those stories.

For a production build on your computer:

```bash
npm run build
npm start
```

## Optional services

The app starts without a `.env` file. Copy [`.env.example`](.env.example) to `.env` only if you need custom configuration; preserve an existing file.

| Variable                | Purpose                                               | Default                                              |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `PORT`                  | Local HTTP port                                       | `4310`                                               |
| `CLINE_BIN`             | Absolute path to the Cline executable                 | Find `cline` on `PATH`                               |
| `NEWSROOM_DATA_DIR`     | Edition database and archive asset directory          | `.data`                                              |
| `NEWSROOM_PREVIEW_PORT` | Port for a separate empty-workspace preview           | `4311`                                               |
| `PARALLEL_API_KEY`      | Authenticated public-page extraction and image search | Anonymous extraction fallback; image search disabled |
| `FINNHUB_API_KEY`       | Stock quotes through Finnhub                          | Yahoo Finance quotes                                 |

Keys stay on the server. Do not use `VITE_*` variables for credentials. Gmail and Google Calendar use Cline’s Composio connection; no separate Composio key is configured in this app.

For iCloud and Apple Maps, build the optional native helpers once on your Mac:

```bash
npm run calendar:setup
npm run maps:setup
```

If the Swift compiler is missing, install Xcode Command Line Tools with `xcode-select --install` and finish that installation before building the helpers.

### Gmail and Google Calendar

In **Your accounts**, select **Connect Gmail**, or choose Google Calendar and connect it. Follow **Continue with Google**, approve access in Google's sign-in flow, then return and select **I've approved access — check again**. Review the included pages before publishing. If already connected, select **Use Gmail** or the corresponding calendar action.

For an existing newspaper, use **Settings → Connected services → Connect account**, then **Check after authorization**. Enable **Your Inbox** or **Your Week** in the page plan, save preferences and publish.

### iCloud Calendar and Apple Maps

Enable iCloud Calendars on your Mac and confirm the events appear in Apple Calendar. After building the helper, choose **iCloud · Apple Calendar on this Mac** in **Your accounts**, select **Connect iCloud Calendar** and approve the native macOS permission prompt. Return and check access again, then publish with **Your Week** included.

Apple requires full calendar access to read events; the helper implements reads only. It recognizes synced accounts named `iCloud` or `아이클라우드`. An existing approved helper can be reused. Its legacy name, **Daily Me Calendar**, is intentionally retained to preserve authorization. Do not rebuild it merely because the service name changed. Permissions can be managed in **System Settings → Privacy & Security → Calendars**.

After building the maps helper, select an event in **Your Week**, enter a starting location and choose **Calculate with Apple Maps**. An event location supplies the destination when available. Apple receives the route locations, mode and appointment time, not email text or event titles. Maps use entered locations rather than device geolocation, and current route estimates are disabled in archived editions.

## Commands

| Command                  | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `npm run dev`            | Start the Express + Vite development server                      |
| `npm test`               | Run isolated tests without network or model calls                |
| `npm run build`          | Build the browser app into `dist/`                               |
| `npm start`              | Serve the production build and API locally; build first          |
| `npm run preview:fresh`  | Build and serve a separate empty workspace on port 4311          |
| `npm run preflight`      | Check public feeds, connector status and a short paid Cline call |
| `npm run calendar:setup` | Build the optional macOS EventKit helper                         |
| `npm run maps:setup`     | Build the optional macOS MapKit helper                           |

Stop the server with **Ctrl+C**. Restarting preserves preferences, connections and editions. Scheduling runs only while the server is running and the computer is awake. `preview:fresh` creates a new `.data/previews/first-run-*` directory without clearing the main newspaper; it reuses this machine’s Cline login and native helpers.

## Troubleshooting

| Problem                                | What to check                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node cannot load `node:sqlite`         | Run `node --version` and use Node 24+ in the same terminal as the server                                                                         |
| Cline installation or model not found  | Check `cline --version`, use CLI 3.0.73, and run `cline auth` with the Cline provider and a configured model; set `CLINE_BIN` if needed          |
| Port already in use                    | Stop the previous server or set a different `PORT` in `.env`; for a fresh preview, set `NEWSROOM_PREVIEW_PORT`                                   |
| Google access pending or expired       | Reconnect through the account card, complete sign-in and check authorization again                                                               |
| iCloud not configured, denied or empty | Build the helper, check macOS Calendar permissions and confirm the iCloud account is synced in Apple Calendar                                    |
| Publication fails                      | Review the displayed error and Newsroom status; check Cline login/credits and retry. Use **Finish incomplete pages** for failed page assignments |
| Optional source unavailable            | Check its key or source status; other available sources remain usable                                                                            |

`npm run preflight` makes real network requests and a small Cline model call. It checks connector status without reading email or calendar content; it does not check the native iCloud helper.

## Sources and limits

| Section        | Data collected per refresh                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| News           | Up to 36 Hacker News items, 36 Google News headlines and 12 BBC items per enabled World/Business/Science/Culture section |
| Custom follows | Up to 12 entries per public YouTube or RSS/Atom source                                                                   |
| Inbox          | Up to 12 Gmail inbox messages from the last 3 days                                                                       |
| Calendar       | Up to 30 events from the selected calendar source over the next 7 days                                                   |
| Markets        | Coinbase crypto spot prices; Yahoo Finance or optional Finnhub stock quotes                                              |
| Images         | Publisher Open Graph images and optional Parallel Image Search for public stories                                        |

YouTube sources provide public titles, descriptions, links and dates, not video transcripts. Google News supplies regional headlines, not a private Google feed. Missing sources do not generate invented personal content. Prices can be delayed; published articles retain their price snapshots while the current quote strip updates separately.

A paper supports up to 20 inside pages, four pages per section and six custom sections with up to five sources each. Each inside page can contain up to three edited stories. Collected evidence stays available in the source register even when it is not featured in an article.

## Storage and privacy

The application is a local, single-user service bound to `127.0.0.1`. It has no public-server authentication or multi-user isolation.

Local state is stored in `.data/newsroom.sqlite`, with archive assets under `.data/publication-assets/`. Published issues are immutable snapshots, separate from the last 20 internal desk checkpoints; saved issues are not automatically pruned. Current preferences, live news and current travel estimates do not overwrite past editions.

`.data/`, `.env`, `.runtime/`, `node_modules/` and `dist/` are excluded from Git. Cline keeps its own credentials and model session records. Necessary personal excerpts and requested translations go to the configured Cline model provider. Private evidence is not sent to Parallel or public image search. Gmail and calendar tools are restricted to reads.

Keep the existing database, credentials and native helper when updating. The package name is `the-daily-edit`; legacy runtime identifiers remain compatible with existing accounts and saved papers.

## Development

The stack is **React + Vite**, **Express**, Node’s built-in **SQLite**, and **ClineCore**. The app owns collection, scheduling, validation and publication; reporters and editors run in isolated Node processes with tools and plugins disabled.

| Path                  | Responsibility                                                      |
| --------------------- | ------------------------------------------------------------------- |
| `src/`                | Newspaper reader, setup, settings, archive and newsroom UI          |
| `src/typography.css`  | Instrument Serif title styling                                      |
| `server/`             | API, source collection, Cline calls, editorial workflow and storage |
| `shared/`             | Page budgets, date/context rules and onboarding logic               |
| `native/`, `scripts/` | macOS helpers, preflight and fresh-workspace preview                |
| `tests/`              | Isolated tests with temporary stores and stubbed model calls        |
| `public/fonts/`       | Self-hosted fonts and their licenses                                |

Titles use **Instrument Serif Regular, 400**, with `font-synthesis: none` and a subtle `0.2px` text stroke. Page and paper backgrounds are `#FDFDFC`; title ink is `#0D0D0D`. Body and interface fonts retain their separate roles. The layout uses newspaper columns and [ObsidianUI](https://www.obsidianui.dev/) controls.

## License

Project code is [MIT licensed](LICENSE). Component and font attribution, including the Instrument Serif OFL license, is preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Publisher articles and images remain attributable to their sources.
