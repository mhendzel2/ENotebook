# Electronic Lab Notebook – Architecture (Offline-First)

## Goals and Scope

- **Offline-first desktop app**: Local work in SQLite/sqlcipher; sync to central PC (PostgreSQL) when network is available.
- **Shared methods/reagent recipes library**: Readable by all; experiment entries private to owner plus manager access.
- **Attachments**: Images/graphs stored locally and centrally; also store hyperlink to original data location.
- **Modalities supported**: Fluorescence microscopy, electron microscopy, biophysical cell dynamics, molecular biology, biochemistry, flow cytometry.
- **Role model**: manager (full access), member (own data + shared methods), admin (ops), researcher, compliance_officer.
- **Real-time collaboration**: WebSocket-based presence and concurrent editing.
- **Compliance**: 21 CFR Part 11 compliant electronic signatures and audit trails.
- **Interoperability**: FAIR data principles support with .eln (RO-Crate) export format.

## Platform and Stack

| Component | Technology |
|-----------|------------|
| Client | Electron 28.2.3 + React 18.2 |
| Data Layer | Prisma 5.22 on SQLite (sqlcipher for encryption) |
| Server | Node.js + Express 4.18 |
| Database | PostgreSQL (production) / SQLite (local/development) |
| Real-time | Socket.IO 4.7 for WebSocket collaboration |
| Types | Shared TypeScript package (@eln/shared) with JSON schemas |

## Data Model

### Core Entities

```
users
├── id (UUID, PK)
├── name
├── email (unique)
├── role (manager/member/admin/researcher/compliance_officer)
├── passwordHash
├── active
└── createdAt

devices
├── id (UUID, PK)
├── userId (FK → users)
├── name
└── lastSeenAt

methods (protocols)
├── id (UUID, PK)
├── title
├── category
├── steps (JSON)
├── reagents (JSON)
├── attachments (JSON)
├── createdBy (FK → users)
├── version
├── isPublic
├── parentMethodId (for versioning)
└── updatedAt

experiments
├── id (UUID, PK)
├── userId (FK → users)
├── title
├── project
├── modality
├── protocolRef (FK → methods)
├── params (JSON)
├── observations (JSON)
├── resultsSummary
├── dataLink
├── tags (JSON)
├── status (draft/in_progress/completed/signed)
├── version
├── createdAt
└── updatedAt
```

### Inventory Management

```
locations (hierarchical)
├── id, name, description
├── parentId (self-reference)
└── temperature

inventoryItems
├── id, name, description
├── category (reagent/plasmid/antibody/primer/cell_line/sample/consumable)
├── catalogNumber, manufacturer, supplier
├── unit, properties (JSON)
└── safetyInfo, storageConditions

stocks
├── id, itemId, locationId
├── lotNumber, quantity, initialQuantity
├── expirationDate, receivedDate
├── barcode (unique), status
└── notes

experimentStocks (usage tracking)
├── experimentId, stockId
├── quantityUsed, usedAt
└── notes
```

### Compliance & Collaboration

```
signatures (21 CFR Part 11)
├── id, userId
├── signatureType (author/reviewer/approver/witness/verifier)
├── meaning (declaration)
├── timestamp, ipAddress, userAgent
├── experimentId? / methodId?
└── contentHash (integrity)

comments (threaded)
├── id, content, authorId
├── experimentId? / methodId?
├── parentId (for threads)
└── createdAt, updatedAt

notifications
├── id, userId, type, title, message
├── entityType, entityId
├── read, createdAt

apiKeys
├── id, userId, name
├── keyHash, keyPrefix
├── permissions (JSON), expiresAt
└── lastUsedAt, revokedAt

webhooks
├── id, userId, name, url, secret
├── events (JSON), active
└── lastTriggeredAt, failureCount
```

## Modality Schemas (JSON)

Each modality has a JSON Schema defining parameters and observations:

| Modality | Key Parameters |
|----------|----------------|
| Fluorescence | laser_lines, objectives, filters, exposure, channel_names, fluorophores |
| Electron Microscopy | voltage_kv, stain, grid_type, detector, magnification, dwell |
| Biophysical | frame_rate, roi_definition, tracking_params, stimulus_protocol |
| Molecular Biology | plasmid_id, primers, enzymes, thermocycler_profile |
| Biochemistry | buffer_composition, temperature, reaction_time, kinetics_model |
| Flow Cytometry | lasers, detectors, compensation_matrix, gating_strategy, cell_type |

## Dynamic Forms & Plugin System

- **JSON Schema (Draft-07)** definitions enable no-code extensibility
- **Plugin registry pattern** for modality registration
- **SchemaForm component** renders forms dynamically at runtime
- **ObservationsEditor** supports tables, cell counts, kinetic curves

## Real-Time Collaboration

### WebSocket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `join-document` | Client → Server | Enter collaborative editing |
| `user-joined` | Server → Clients | New collaborator notification |
| `cursor-move` | Client → Server | Share cursor position |
| `selection-change` | Client → Server | Share text selection |
| `edit` | Client → Server | Broadcast edit operation |
| `request-lock` | Client → Server | Request field lock |
| `lock-granted/denied` | Server → Client | Lock response |

### React Hooks

```typescript
useCollaboration(entityType, entityId)
// Returns: users, locks, updateCursor, requestLock, sendEdit, etc.

useNotifications()
// Returns: notifications, clearNotification
```

## Role-Based Access Control (RBAC)

### Permissions

| Permission | Description |
|------------|-------------|
| `experiment:create` | Create new experiments |
| `experiment:read:own` | View own experiments |
| `experiment:read:all` | View all experiments |
| `experiment:update:own` | Edit own experiments |
| `experiment:sign` | Apply signatures |
| `method:publish` | Publish methods |
| `inventory:*` | Inventory management |
| `admin:*` | System administration |

### Role Hierarchy

```
guest → member → researcher → manager → admin
                    ↘
              compliance_officer
```

## Electronic Signatures (21 CFR Part 11)

### Signature Types & Meanings

| Type | Example Meanings |
|------|------------------|
| Author | "I am the author and certify accuracy" |
| Reviewer | "I have reviewed and found it complete" |
| Approver | "I approve this record for release" |
| Witness | "I observed the work described" |
| Verifier | "I verified data against source documents" |

### Security Features

- Content hash for integrity verification
- Hash chain for tamper detection
- Optional re-authentication
- IP address and user agent logging

## Audit Trail

- **Immutable logs** with hash chain
- **Tracks**: CRUD operations, signatures, exports, logins
- **Verification endpoint** to detect tampering
- **Export**: JSON/CSV for compliance reporting

## Export Formats (FAIR Data)

| Format | Use Case |
|--------|----------|
| JSON | Complete data with structure |
| CSV | Spreadsheet analysis |
| PDF/HTML | Immutable reports |
| ZIP | Archives with attachments |
| **.eln (RO-Crate)** | eLabFTW interoperability |

### .eln Format

Conforms to [TheELNFileFormat](https://github.com/TheELNConsortium/TheELNFileFormat):

```
experiment.eln (ZIP archive)
├── ro-crate-metadata.json    # RO-Crate metadata
├── experiments/
│   └── {id}.json             # Experiment data
├── attachments/
│   └── {id}/                 # Experiment attachments
├── manifest.json             # File manifest
└── README.md                 # Human-readable description
```

## REST API

### Authentication

- Header: `x-api-key` (API key authentication)
- Header: `x-user-id` (Session authentication)

### Endpoints

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/experiments` | GET, POST | List/create experiments |
| `/experiments/:id` | GET, PUT, DELETE | Single experiment |
| `/methods` | GET, POST | List/create methods |
| `/inventory` | GET, POST | Inventory items |
| `/stocks` | GET, POST, PUT | Stock management |
| `/signatures` | GET, POST | Electronic signatures |
| `/audit` | GET | Audit trail |
| `/export/eln/:id` | GET | Export to .eln |
| `/export/pdf/:id` | GET | Export to PDF |
| `/api-keys` | GET, POST, DELETE | API key management |

### API Key Scopes

- `read` - Read access to data
- `write` - Create/update data
- `admin` - Administrative functions
- `export` - Export data

## Sync Strategy

1. **IDs**: UUIDs for conflict-free generation
2. **Versioning**: `updated_at` + `version` per row
3. **Change Queue**: Local tracking of inserts/updates/deletes
4. **Push/Pull**: 
   - Push local changes with version
   - Pull server changes newer than `last_pulled_at`
   - Merge into local
5. **Conflicts**: 
   - Last-writer-wins for scalar fields
   - User review for text/methods
   - Keep revision history
6. **Real-time**: WebSocket notifications trigger sync

## Security

### Local Security

- SQLCipher encryption for local database
- Optional per-user passphrase
- Argon2/bcrypt password hashing

### Transport Security

- TLS for all sync traffic
- JWT session tokens
- Device ID tracking

### API Security

- API keys: SHA-256 hashed, scoped permissions
- Rate limiting (production)
- Input validation (UUID format)
- XSS prevention (HTML escaping)

## Implementation Status

| Phase | Status |
|-------|--------|
| 1. Data Layer | ✅ Complete |
| 2. Sync Service | ✅ Complete |
| 3. UI Components | ✅ Complete |
| 4. Security/Roles | ✅ Complete |
| 5. Inventory | ✅ Complete |
| 6. JSON Schema & Plugins | ✅ Complete |
| 7. Real-time Collaboration | ✅ Complete |
| 8. Compliance (Signatures, Audit) | ✅ Complete |
| 9. REST API | ✅ Complete |

## File Structure

```
ENotebook/
├── apps/
│   ├── client/                    # Electron + React
│   │   ├── src/
│   │   │   ├── main.ts           # Electron main process
│   │   │   ├── preload.ts        # Context bridge
│   │   │   ├── renderer/         # React application
│   │   │   │   ├── components/   # UI components
│   │   │   │   ├── hooks/        # React hooks
│   │   │   │   └── services/     # Client services
│   │   │   └── services/         # Electron services
│   │   └── package.json
│   └── server/                    # Express API
│       ├── src/
│       │   ├── index.ts          # Server entry
│       │   ├── middleware/       # Auth, permissions
│       │   ├── routes/           # API routes
│       │   └── services/         # Business logic
│       ├── prisma/
│       │   └── schema.prisma     # Database schema
│       └── package.json
├── packages/
│   └── shared/                    # Shared types/schemas
│       └── src/
│           ├── types.ts          # TypeScript types
│           ├── index.ts          # Exports
│           ├── schemas/          # JSON Schemas
│           └── plugins/          # Plugin system
├── docs/
│   ├── architecture.md           # This document
│   └── schema.sql               # SQL reference
└── package.json                   # Monorepo root
```
