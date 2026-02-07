# Electronic Lab Notebook (ELN)

Offline-first desktop ELN with PostgreSQL (Docker-first local setup) and sync support for central deployments.

## Structure
- `apps/client` — Electron + React desktop app (renderer via Vite).
- `apps/server` — Express server with Prisma schema for PostgreSQL.
- `packages/shared` — Shared TypeScript types and constants.
- `docs` — Architecture and schema references.

## Getting started
1. Install deps: `npm install`.
2. Build shared package: `npm --workspace packages/shared run build`.
3. Client:
   - Dev renderer: `npm --workspace apps/client run dev:renderer`.
   - Dev main (Electron): `npm --workspace apps/client run dev:main` (ensure `VITE_DEV_SERVER_URL=http://localhost:5173`).
4. Server:
   - Copy `apps/server/.env.example` to `.env` and set `DATABASE_URL`.
   - Dev: `npm --workspace apps/server run dev`.

## Local default admin
- On first run (empty DB), the server seeds a default admin account unless disabled:
  - Username: `Admin`
  - Password: `D_Admin`
- Configure via `SEED_DEFAULT_ADMIN`, `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_EMAIL`.

## Notes
- Prisma schema lives in `apps/server/prisma/schema.prisma`; run `npx prisma migrate dev` after configuring env.
- Sync endpoints are stubbed; add conflict handling and persistence next.
- Renderer UI currently shows placeholder data; connect to local DB/sync service during implementation.

## Auth configuration

The server now uses signed sessions (JWT) instead of trusting a client-supplied `x-user-id` header.

- `AUTH_JWT_SECRET` (recommended in production): secret string (>= 32 chars) used to sign session and password-reset tokens.
- `CORS_ORIGINS` (recommended): comma-separated list of allowed origins (defaults to `http://localhost:5173`).
- `BOOTSTRAP_ADMIN_SECRET` (optional but recommended): if set, the first user registration requires `bootstrapSecret` to be provided.
- `ALLOW_INSECURE_X_USER_ID_AUTH` (not recommended): if set to `true`, re-enables legacy `x-user-id` authentication.
- `ALLOW_INSECURE_SYNC_HEADER_AUTH` (not recommended): if set to `true`, allows legacy `x-user-id` auth only for `/sync/*`.

Password policy: minimum 12 characters and must include at least 3 of (lowercase, uppercase, number, symbol).

## Password recovery (admin)
Passwords are stored as hashes and cannot be recovered, but they can be reset.

- If an admin is already signed in, they can generate a password reset token for a user via the admin API.
- If all admin access is lost, use the local admin scripts (requires database connectivity):
  - Windows: `npm.cmd --workspace apps/server run admin:list-users`
  - Windows: `npm.cmd --workspace apps/server run admin:set-user-password -- <email-or-user-id> --temp`
