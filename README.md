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
  - Password: `ChangeMe!LocalAdmin2025` (change on first login!)
- Configure via `SEED_DEFAULT_ADMIN`, `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_EMAIL`.

## Local Lab PC Server Deployment

This section covers deploying ENotebook as a persistent server on a Windows lab PC using Docker.

### Prerequisites

- **Docker Desktop for Windows** (Windows 10/11 Home or Pro) — [download](https://www.docker.com/products/docker-desktop/)
- **Docker Engine** (Windows Server) — follow the [official guide](https://docs.docker.com/engine/install/)
- `openssl` available (included with Git for Windows, or WSL)

### Step-by-step deployment

1. **Clone the repository**

   ```bat
   git clone https://github.com/mhendzel2/ENotebook.git
   cd ENotebook
   ```

2. **Create and configure your environment file**

   ```bat
   copy .env.docker.example .env
   ```

   Open `.env` and replace every `REPLACE_WITH_OUTPUT_OF_openssl_rand_base64_32` with unique values:

   ```bash
   openssl rand -base64 32   # run twice — once for SESSION_SECRET, once for JWT_SECRET
   ```

   Also set a strong `DEFAULT_ADMIN_PASSWORD` (minimum 12 characters, mixed case + number + symbol).

3. **Start the stack**

   ```bat
   docker compose up -d
   ```

   On first start, Prisma migrations are applied automatically via the entrypoint script.

4. **Access the web UI**

   Open `http://localhost:4000` (or your server's LAN IP) in a browser.
   Log in with the admin credentials from your `.env` and **change the password immediately**.

5. **Verify health**

   ```bash
   curl http://localhost:4000/readyz
   # Expected: {"status":"ok","db":"ok"}
   ```

6. **(Optional) Bind to a specific network interface**

   Set `LISTEN_HOST=192.168.1.100` in `.env` to restrict the server to one LAN interface
   (e.g. wired Ethernet only, ignoring WiFi).

7. **(Optional) Local dev overrides**

   ```bat
   copy docker-compose.override.yml.example docker-compose.override.yml
   ```

   Edit `docker-compose.override.yml` to suit your dev environment (see file for details).
   **Never commit this file or use it in production.**

### Security notes

- `SESSION_SECRET` and `JWT_SECRET` **must** be set to unique random values — the server refuses to start otherwise.
- The PostgreSQL port is bound to `127.0.0.1` only, so the database is never exposed on the LAN.
- Keep your `.env` file out of version control (it is already in `.gitignore`).


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
