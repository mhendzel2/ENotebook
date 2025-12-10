
Electronic Lab Notebook – Architecture (Offline-First)
======================================================

Goals and scope
- Offline-first desktop app; local work in SQLite/sqlcipher; sync to central PC (PostgreSQL) when network is available.
- Shared methods/reagent recipes library readable by all; experiment entries private to owner plus manager access.
- Attachments (images/graphs) stored locally and centrally; also store hyperlink to original data location.
- Modalities supported: fluorescence microscopy, electron microscopy, biophysical cell dynamics, molecular biology, biochemistry.
- Role model: manager (full access), member (own data + shared methods), admin (ops).

Platform and stack
- Client: Electron + React; data layer via Prisma/Drizzle on SQLite (sqlcipher for at-rest encryption). UUID primary keys.
- Server: Node (NestJS/Express) + PostgreSQL on central PC; exposes HTTPS REST/gRPC for sync.
- Shared types package to align models between client/server; JSON schemas per modality for structured params.

Data model (core)
- users: id, name, email, role (manager/member/admin), password_hash, active, created_at.
- devices: id, user_id, name, last_seen_at (used for sync metadata).
- methods: id, title, category, steps JSON, reagents JSON, attachments JSON, created_by, version, updated_at, is_public (true).
- experiments: id, user_id (owner), title, project, modality enum, protocol_ref (method id), params JSON, observations JSON, results_summary, data_link, tags, created_at, updated_at, version.
- experiment_revisions: experiment_id, version, author_id, notes/diff, created_at (audit trail).
- attachments: id, experiment_id?, method_id?, filename, mime, size, blob/local_path, data_link, created_at.
- sync_state/log: device_id, last_pulled_at, last_pushed_at, status, error.

Modalities (params JSON suggestions)
- fluorescence: laser_lines, objectives, filters, exposure, channel_names, fluorophores.
- electron microscopy: voltage_kv, stain, grid_type, detector, magnification, dwell.
- biophysical (cell dynamics): frame_rate, roi_definition, tracking_params, stimulus_protocol.
- molecular biology: plasmid_id, primers, enzymes, thermocycler_profile.
- biochemistry: buffer_composition, temperature, reaction_time, kinetics_model.

Sync strategy
- IDs are UUIDs; rows carry updated_at + version. Local change queue tracks inserts/updates/deletes.
- On connect: push local changes (with version); pull server changes newer than last_pulled_at; merge into local.
- Conflict policy: if server version > local version on push, mark conflict. Last-writer-wins for non-critical scalar fields; notebook text/methods require user/manager review via conflict UI. Keep revision history for transparency.
- Attachments: store binary locally; upload in chunks; also store data_link to original file path/URL.

Access control
- Server enforces ACL on sync endpoints. Client caches only authorized data.
- member: CRUD own experiments; read shared methods; cannot see others’ experiments.
- manager: read/write all experiments; manage users; resolve conflicts.
- admin: operational/server-only tasks.

Security and compliance
- Local: sqlcipher encryption; optional per-user passphrase. Securely hash passwords (argon2/bcrypt). Keep audit via revisions.
- Transport: TLS for sync; signed requests (JWT per session); device_id recorded.
- Backups: server PostgreSQL backups + attachment storage backups; consider checksum verification on attachments.

UI outline
- Dashboard: recent experiments, sync status.
- Methods library: browse/search, view, copy to notebook, new version flow.
- Experiment editor: modality preset (fills params schema), protocol reference, observations/results, attachments upload, data link field.
- Attachments viewer: preview images/graphs.
- Sync status panel: last sync, pending queue, conflict list.
- Admin (manager): user management, role assignment, audit view, conflict resolution.

Implementation phases
1) Data layer: define shared types; set up Prisma/Drizzle models; migrations for SQLite/Postgres.
2) Sync service: local change queue, push/pull, conflict detection, revision logging.
3) UI: methods library + experiment editor with modality presets and attachments/data link support; sync status and conflict handling.
4) Security/roles: auth, ACL enforcement on server, role-gated UI, sqlcipher at-rest.
