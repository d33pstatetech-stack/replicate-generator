-- Replicate Orchestrator — D1 init for enhancer (mirrors muapi 0003)
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT CHECK(kind IN ('raw','enhanced','optimized','ai')) NOT NULL DEFAULT 'enhanced',
  prompt TEXT NOT NULL,
  enhanced TEXT,
  model_id TEXT,
  params_json TEXT,
  llm_provider TEXT,
  llm_model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prompts_kind ON prompts(kind);
CREATE INDEX IF NOT EXISTS idx_prompts_created ON prompts(created_at DESC);

CREATE TABLE IF NOT EXISTS llm_config (
  id INTEGER PRIMARY KEY CHECK(id=1),
  json TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
