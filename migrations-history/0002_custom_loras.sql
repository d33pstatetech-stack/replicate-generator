-- Shared genai-history: user-added LoRAs (Add-from-URL), visible to all frontends.
-- Rows are shaped to match loras-data.js entries so picker filter/dots/Fill work unchanged.
CREATE TABLE IF NOT EXISTS custom_loras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,            -- 'hf' | 'civitai'
  repo TEXT NOT NULL,              -- 'owner/repo' (hf) or numeric model id (civitai)
  name TEXT NOT NULL,
  file TEXT NOT NULL DEFAULT '',
  repo_url TEXT NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  base_model TEXT NOT NULL DEFAULT '',
  pipeline TEXT NOT NULL DEFAULT 'text-to-image',
  triggers_json TEXT NOT NULL DEFAULT '[]',
  formats_json TEXT NOT NULL DEFAULT '{}',
  version_note TEXT NOT NULL DEFAULT '',
  nsfw INTEGER NOT NULL DEFAULT 0,  created_by TEXT NOT NULL DEFAULT 'ui',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, repo, file)
);
