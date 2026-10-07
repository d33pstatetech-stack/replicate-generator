-- Replicate catalogue. Adds the `provider` / `version_id` / `run_count` /
-- `is_official` columns the shared models table needs, and a side table for
-- OpenAPI input schemas so the catalogue listing query stays narrow.
--
-- Schemas average several KB each, so keeping them out of `models` matters:
-- the list route selects ~10 columns across ~1100 rows.
--
--   wrangler d1 execute replicate-orchestrator --remote --file=migrations/0002_replicate_catalog.sql

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,             -- "owner/repo", or "owner/repo:version"
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT '',
  family TEXT,
  group_of TEXT,                   -- image | video | audio | 3d | text | other
  cost REAL DEFAULT 0,             -- Replicate publishes no per-model price
  cost_currency TEXT DEFAULT 'USD',
  dynamic_pricing INTEGER DEFAULT 0,
  endpoint TEXT NOT NULL DEFAULT '',
  playground_url TEXT,
  provider TEXT DEFAULT 'replicate',
  run_count INTEGER DEFAULT 0,
  is_official INTEGER DEFAULT 0,
  version_id TEXT,                 -- pinned latest_version.id, when known
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- No defensive ALTERs: this database had no `models` table, and an
-- `ALTER TABLE models ADD COLUMN provider` on the table created just above
-- fails as a duplicate column, aborting the whole file. The table is created
-- with every column it needs.
CREATE INDEX IF NOT EXISTS idx_models_group ON models(group_of);
CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
CREATE INDEX IF NOT EXISTS idx_models_runs ON models(run_count DESC);

-- Input schemas, keyed by model id. Kept separate for row size.
CREATE TABLE IF NOT EXISTS replicate_model_schemas (
  model_id TEXT PRIMARY KEY,
  schema_json TEXT NOT NULL,       -- Replicate OpenAPI Input schema
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Catalogue provenance, so a refresh is auditable and repeatable.
CREATE TABLE IF NOT EXISTS replicate_catalog_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model_count INTEGER,
  schema_count INTEGER,
  official_count INTEGER,
  source TEXT,                     -- how the catalogue was built
  generated_at TEXT DEFAULT (datetime('now'))
);
