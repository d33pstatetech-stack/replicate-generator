-- genai-history: shared prompt/media history for all frontends (replicate, muapi, dashboard, ...)
-- Applied once to the shared DB; every worker binds it as HISTORY.

CREATE TABLE IF NOT EXISTS enhancements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_app TEXT NOT NULL DEFAULT 'replicate',
  kind TEXT NOT NULL DEFAULT 'enhanced',
  raw_prompt TEXT NOT NULL,
  enhanced_prompt TEXT NOT NULL,
  target_provider TEXT NOT NULL DEFAULT '',
  target_model TEXT NOT NULL DEFAULT '',
  params_json TEXT NOT NULL DEFAULT '{}',
  loras_json TEXT NOT NULL DEFAULT '[]',
  llm_provider TEXT NOT NULL DEFAULT '',
  llm_model TEXT NOT NULL DEFAULT '',
  template_version TEXT NOT NULL DEFAULT '',
  retrieval_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enhancements_model ON enhancements(target_model);
CREATE INDEX IF NOT EXISTS idx_enhancements_created ON enhancements(created_at DESC);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_app TEXT NOT NULL DEFAULT 'replicate',
  provider TEXT NOT NULL DEFAULT 'replicate',
  model TEXT NOT NULL DEFAULT '',
  input_json TEXT NOT NULL DEFAULT '{}',
  loras_json TEXT NOT NULL DEFAULT '[]',
  enhancement_id INTEGER REFERENCES enhancements(id),
  external_job_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted',
  output_urls_json TEXT NOT NULL DEFAULT '[]',
  r2_keys_json TEXT NOT NULL DEFAULT '[]',
  cost_hint TEXT NOT NULL DEFAULT '',
  rating INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(provider, external_job_id);
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  template_text TEXT NOT NULL,
  slots_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (family, task, version)
);
CREATE INDEX IF NOT EXISTS idx_templates_family ON prompt_templates(family, task, active);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  chunk_hash TEXT NOT NULL DEFAULT '',
  chunk_text TEXT NOT NULL,
  vec_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (family, version, chunk_hash)
);
CREATE INDEX IF NOT EXISTS idx_chunks_family ON doc_chunks(family, version);
