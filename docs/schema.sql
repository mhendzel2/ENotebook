
-- Electronic Lab Notebook schema (SQLite/PostgreSQL compatible where possible)

-- Users and devices
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('manager','member','admin')),
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT,
  last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Methods library (shared)
CREATE TABLE methods (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT, -- e.g., fluorescence, EM, biophysical, molecular, biochem
  steps JSON NOT NULL,       -- rich text/structured steps
  reagents JSON,             -- reagent recipes list
  attachments JSON,          -- attachment metadata array
  created_by TEXT REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_public BOOLEAN NOT NULL DEFAULT TRUE
);

-- Experiments (owner-private + manager access)
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id), -- owner
  title TEXT NOT NULL,
  project TEXT,
  modality TEXT NOT NULL CHECK (modality IN ('fluorescence','electron_microscopy','biophysical','molecular_biology','biochemistry')),
  protocol_ref TEXT REFERENCES methods(id),
  params JSON,              -- modality-specific structured parameters
  observations JSON,        -- rich text or blocks
  results_summary TEXT,
  data_link TEXT,           -- hyperlink to original data location
  tags JSON,                -- array of strings
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1
);

-- Audit trail for experiments
CREATE TABLE experiment_revisions (
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  version INTEGER NOT NULL,
  author_id TEXT REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (experiment_id, version)
);

-- Attachments: images/graphs linked to experiments or methods
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  experiment_id TEXT REFERENCES experiments(id),
  method_id TEXT REFERENCES methods(id),
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  blob_path TEXT,      -- local or server path to stored binary
  data_link TEXT,      -- hyperlink to original data location
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sync tracking
CREATE TABLE sync_state (
  device_id TEXT PRIMARY KEY REFERENCES devices(id),
  last_pulled_at TIMESTAMPTZ,
  last_pushed_at TIMESTAMPTZ,
  status TEXT,
  error TEXT
);

CREATE TABLE change_log (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices(id),
  entity_type TEXT NOT NULL,  -- users/methods/experiments/attachments
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('insert','update','delete')),
  version INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes to speed sync and lookup
CREATE INDEX idx_methods_updated_at ON methods(updated_at);
CREATE INDEX idx_experiments_user ON experiments(user_id);
CREATE INDEX idx_experiments_updated_at ON experiments(updated_at);
CREATE INDEX idx_change_log_entity ON change_log(entity_type, entity_id);
