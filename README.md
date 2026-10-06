# Darts Tournament Manager

A fully static, installable, offline-first darts tournament manager. No
server, no login, no backend — everything runs in the browser and persists
locally via IndexedDB (through [Dexie.js](https://dexie.org)). Install it as
a PWA and it keeps working with no network connection at all.

Stack: React + TypeScript + Vite + Tailwind + shadcn/ui + React Router +
Dexie.js + Vitest.

## Features

- **League** (full round robin) and **Knockout** (single elimination)
  tournaments, 2–16 players.
- Per-stage match format (best of 3 / 5 / 7), configured at creation.
- Four League finals formats: Top 4 Round Robin (default), Top 4 Knockout,
  Direct Final, League Winner only.
- Correct bye handling and standard bracket seeding for any player count.
- 5-level standings tie-break cascade (Points → Leg Diff → Legs For →
  Head-to-Head → Play-off Required flag — never a silent alphabetical
  fallback).
- Undo the last confirmed result, with dependency checks so you can't
  silently corrupt a bracket or table.
- **Player withdrawals** mid-tournament: results already earned stay on the
  board, unfinished matches become walkovers, and the player can rejoin
  later (their matches are restored exactly as they were).
- One-tap **WhatsApp share** of the final results for a finished tournament.
- All-time player ranking across every finished tournament.
- Light, dark and system appearance themes.
- JSON backup export/import, and a full local reset.

## Architecture

```
src/lib/
  types.ts       data model (Tournament, Match, Player, TournamentPlayerResult, AppSettings)
  db.ts          Dexie schema + first-run seeding
  format.ts      bestOf -> legsToWin, valid-score rules (no draws)
  roundRobin.ts  league fixture generation + standings/tie-breaks
  knockout.ts    bracket seeding, byes, round naming
  engine.ts      stage orchestration: start/confirm/undo/finish a tournament
  players.ts     player CRUD (duplicate-name guard, delete-or-archive)
  ranking.ts     all-time ranking sort cascade
  backup.ts      zod-validated export/import/reset
  share.ts       WhatsApp share text (pt-BR) + clipboard helpers
src/pages/       one page per route (players, new tournament, tournament, history, settings)
src/components/darts/  MatchControl (scoring screen), BracketView, StandingsTable, MatchList
```

All tournament rules live in `src/lib/*` as pure functions with no React or
IndexedDB dependency (`db.ts`, `engine.ts`, `players.ts`, `backup.ts` are the
only files that touch Dexie) — see the `*.test.ts` files next to each module.

## Local development

```bash
npm install
npm run dev     # http://localhost:5173
npm run test    # vitest
npm run build   # production build to dist/, includes the service worker
```

## Deploying

This is a static site — any static host works. The intended target is
**Cloudflare Pages**:

1. `npm run build`
2. Deploy the `dist/` directory (Cloudflare Pages: connect the repo and set
   build command `npm run build`, output directory `dist`).

No server-side configuration, environment variables, or database is
required. A local fallback — serving `dist/` from any static file server, or
just opening it via a reverse proxy — also works identically, since the app
has no dependency on where it's hosted.

## Data & backups

Everything lives in the browser's IndexedDB, scoped to the origin the app is
served from. There is no server-side copy. Use **Settings → Export backup**
regularly, and especially right after finishing a tournament — losing the
browser profile/storage (or switching browsers/devices) without a backup
means losing the data. Import validates the file's schema version and asks
for confirmation before replacing anything.
