# Security

This app has no server, no login, and no accounts — there is nothing to
authenticate against. Anyone with access to the device/browser the app is
open in can see and edit everything, the same as any other local-first app
(a notes app, a spreadsheet). This is intentional per the app's design: it's
a tool for whoever is running the tournament, not a multi-tenant service.

## Data storage

All data (players, tournaments, matches, results) lives in the browser's
IndexedDB, scoped to the origin the app is served from. Nothing is sent to
any server — the app makes no network requests after the initial page/asset
load (verify with the browser's network tab: it should be silent).

Implications:

- Clearing site data/browsing data for this origin deletes everything.
  Export a backup (Settings → Export backup) before doing so.
- Data does not sync between devices or browsers. Each install is
  independent. Use export/import to move data between them.
- Anyone with physical/logged-in access to the browser profile has full
  read/write access to the data. If that's not an acceptable threat model
  for a given deployment, don't use this app as-is — it has no access
  control layer to add one to.

## Backup files

Exported backups are plain JSON with no encryption. Treat them like any
other local data file — store them somewhere with the access control you
need. Importing a backup validates its shape and schema version before
touching anything, and always asks for confirmation, since import replaces
all current data.

## Static hosting

The app is deployed as a static site (e.g. Cloudflare Pages). Standard
static-hosting security practices apply: HTTPS is provided by the host,
there's no server-side attack surface (no database, no API, no secrets) to
compromise. Keep dependencies updated (`npm audit`) since the built bundle
is what actually reaches users' browsers.
