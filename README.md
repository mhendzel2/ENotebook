# Electronic Lab Notebook (ELN)

Offline-first desktop ELN with local SQLite storage (sqlcipher optional) and sync to a central PostgreSQL server when network is available.

## Structure
- `apps/client` — Electron + React desktop app (renderer via Vite).
- `apps/server` — Express/Nest-ready server with Prisma schema for PostgreSQL (or SQLite for dev).
- `packages/shared` — Shared TypeScript types and constants.
- `docs` — Architecture and schema references.

## Getting started
1. Install deps: `npm install`.
2. Build shared package: `npm --workspace packages/shared run build`.
3. Client:
   - Dev renderer: `npm --workspace apps/client run dev:renderer`.
   - Dev main (Electron): `npm --workspace apps/client run dev:main` (ensure `VITE_DEV_SERVER_URL=http://localhost:5173`).
4. Server:
   - Copy `apps/server/.env.example` to `.env` and set `DB_PROVIDER`/`DATABASE_URL`.
   - Dev: `npm --workspace apps/server run dev`.

## Notes
- Prisma schema lives in `apps/server/prisma/schema.prisma`; run `npx prisma migrate dev` after configuring env.
- Sync endpoints are stubbed; add conflict handling and persistence next.
- Renderer UI currently shows placeholder data; connect to local DB/sync service during implementation.
