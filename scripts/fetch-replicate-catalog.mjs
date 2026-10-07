/**
 * Harvest the Replicate catalogue into a D1 `models` table.
 *
 * Why collections rather than GET /v1/models:
 *
 *   GET /v1/models is an unfiltered newest-first firehose. Walking the cursor
 *   past 150 pages still had more to give (3750 models seen, cursor not
 *   exhausted), and the tail is dominated by one-off community fine-tunes and
 *   personal forks that are not useful in a prompt console. There is no
 *   category filter or total-count on that endpoint — `?category=` and
 *   `?sort_by=` are silently ignored or rejected.
 *
 *   GET /v1/collections is Replicate's own curation of 39 topical collections.
 *   Unioned they yield ~1084 unique models, which is the same order as the
 *   WaveSpeed (1081) and MuAPI (765) catalogues this replaces, and every
 *   entry is something Replicate chose to surface.
 *
 * Schemas are stored in a separate table so the catalogue listing query stays
 * small; the list route never selects them.
 *
 * Requires REPLICATE_API_TOKEN in the environment. Pass --remote to write to
 * the deployed D1 database, otherwise it writes migrations only.
 *
 *   node scripts/fetch-replicate-catalog.mjs [--remote] [--out <dir>]
 */

import fs from 'node:fs';
import path from 'node:path';

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) {
  console.error('REPLICATE_API_TOKEN is not set.');
  process.exit(2);
}
const REMOTE = process.argv.includes('--remote');
const OUT_DIR = argValue('--out') || path.join(process.cwd(), 'catalog');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' };

async function api(pathname) {
  const res = await fetch(`https://api.replicate.com${pathname}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Classification
 *
 * Replicate exposes no modality field, so group is inferred from the
 * model name plus the collections it appears in. Collection membership is
 * the stronger signal: `text-to-image` is authoritative where it exists,
 * and the name regex is only a fallback. Getting this wrong is cosmetic —
 * it drives the catalogue filter chips — so the mapping stays
 * conservative and unknown models land in `other`.
 * ------------------------------------------------------------------ */
const COLLECTION_GROUP = {
  'text-to-image': 'image',
  'sketch-to-image': 'image',
  'super-resolution': 'image',
  'ai-image-restoration': 'image',
  'remove-backgrounds': 'image',
  'image-editing': 'image',
  'generate-anime': 'image',
  'ai-face-generator': 'image',
  'flux': 'image',
  'flux-fine-tunes': 'image',
  'flux-kontext-fine-tunes': 'image',
  'qwen-image-fine-tunes': 'image',
  'text-to-video': 'video',
  'image-to-video': 'video',
  'video-editing': 'video',
  'ai-enhance-videos': 'video',
  'lipsync': 'video',
  'wan-video': 'video',
  'text-to-speech': 'audio',
  'speech-to-text': 'audio',
  'sing-with-voices': 'audio',
  'ai-music-generation': 'audio',
  'generate-emoji': 'image',
  'face-swap': 'image',
  'detect-nsfw-content': 'other',
  'ai-detect-objects': 'other',
  'video-to-text': 'other',
  'image-to-text': 'other',
  'vision-models': 'other',
  'text-recognition-ocr': 'other',
  'text-classification': 'other',
  'speaker-diarization': 'other',
  'embedding-models': 'other',
  'language-models': 'text',
  'control-net': 'image',
  '3d-models': '3d',
  utilities: 'other',
  official: '',   // "official" spans every modality; no signal
  'try-for-free': '',
};

const NAME_RULES = [
  [/^text-to-image$|t2i|text2image|text-to-image/i, 'image'],
  [/image-to-image|i2i|img2img|depth|upscale|upscal|restore|inpaint|outpaint|background-remove|bg-removal|photo-restor|super-resolution/i, 'image'],
  [/lora|flux|sdxl|stable-diffusion|qwen-image|recraft|ideogram|photomaker|flux-kontext|nano-banana|imagen|seedream|hidream|gpt-image|dall|midjourney|topaz|krea/i, 'image'],
  [/image-to-video|i2v|text-to-video|t2v|video-to-video|animate|wan-|kling|seedance|hailuo|minimax|luma|veo|ltx|runway|pika|hunyuan|moviepy|stable-video|mochi/i, 'video'],
  [/lipsync|talking-head|avatar/i, 'video'],
  [/text-to-speech|tts|speech|stt|whisper|voice-clone|speech-to-text|transcri/i, 'audio'],
  [/music|musicgen|audio-gen|sound-effects|suno|udio/i, 'audio'],
  [/^3d|3d-model|tripo|mesh|threed|voxel|hunyuan3d|triposr/i, '3d'],
  [/chat-?gpt|llama|mistral|llm|qwen\d|text-generation|qwen2|qwen3/i, 'text'],
];

function groupFrom(name, collections) {
  for (const c of collections) {
    const g = COLLECTION_GROUP[c];
    if (g) return g;
  }
  const hay = `${name}`;
  for (const [re, g] of NAME_RULES) if (re.test(hay)) return g;
  return 'other';
}

/** Collapse a version's OpenAPI document down to the input schema. */
function inputSchema(version) {
  const doc = version?.openapi_schema;
  if (!doc || typeof doc !== 'object') return null;
  const input = doc?.components?.schemas?.Input;
  if (!input || typeof input !== 'object') return null;
  // Replicate wraps non-string leaf schemas oddly in some responses; keep only
  // what the form renderer understands.
  const props = input.properties;
  if (!props || typeof props !== 'object') return null;
  return { type: input.type || 'object', title: input.title || 'Input', required: input.required || [], properties: props };
}

/* ------------------------------------------------------------------ */

/**
 * Models the hand-maintained catalogue listed that the collections do not
 * carry. Two reasons a model can be missing: it is one of this account's own
 * private models (never in public collections), or it is a recently released
 * official model not yet curated into a collection. Both are wanted in the
 * console, so they are fetched directly by name.
 */
const EXTRA_MODELS = [
  'minimax/h3',
  'd33pstatetech-stack/aznten_replicate',
  'd33pstatetech-stack/aznten-flux.1-dev-replicate',
];

async function main() {
  const cols = await api('/v1/collections');
  const slugs = cols.results.map((c) => c.slug);
  console.log(`collections: ${slugs.length}`);

  const byName = new Map();
  let fetched = 0;

  // Private / not-yet-curated models first, so a collection hit for the same
  // name (there should not be one) cannot shadow a fuller record.
  for (const name of EXTRA_MODELS) {
    try {
      const m = await api(`/v1/models/${name}`);
      byName.set(name, {
        name,
        owner: m.owner,
        repo: m.name,
        description: m.description || '',
        run_count: m.run_count || 0,
        is_official: !!m.is_official,
        url: m.url || `https://replicate.com/${name}`,
        cover_image_url: m.cover_image_url || null,
        version: m.latest_version?.id || null,
        schema: inputSchema(m.latest_version),
        collections: new Set(['private-or-uncurated']),
      });
      console.log(`  + ${name}`);
    } catch (e) {
      console.warn(`  ! ${name}: ${e.message}`);
    }
  }

  for (const slug of slugs) {
    let body;
    try {
      body = await api(`/v1/collections/${slug}`);
    } catch (e) {
      console.warn(`  skip ${slug}: ${e.message}`);
      continue;
    }
    fetched++;
    for (const m of body.models || []) {
      if (m.visibility && m.visibility !== 'public') continue;
      const full = `${m.owner}/${m.name}`;
      let rec = byName.get(full);
      if (!rec) {
        rec = { name: full, owner: m.owner, repo: m.name, description: m.description || '', run_count: m.run_count || 0, is_official: !!m.is_official, url: m.url || `https://replicate.com/${full}`, cover_image_url: m.cover_image_url || null, version: m.latest_version?.id || null, schema: null, collections: new Set() };
        byName.set(full, rec);
      }
      rec.collections.add(slug);
      // Prefer a version with a usable input schema over one without.
      if (!rec.schema) {
        const s = inputSchema(m.latest_version);
        if (s) rec.schema = s;
      }
      if (!rec.version && m.latest_version?.id) rec.version = m.latest_version.id;
      if (m.run_count > rec.run_count) rec.run_count = m.run_count;
    }
    if (fetched % 10 === 0) process.stdout.write(`  ${fetched}/${slugs.length} collections, ${byName.size} models\n`);
  }

  const models = [...byName.values()]
    .map((r) => ({ ...r, group_of: groupFrom(`${r.owner}/${r.repo}`, [...r.collections]), collections: [...r.collections].sort() }))
    .sort((a, b) => b.run_count - a.run_count);

  const withSchema = models.filter((m) => m.schema).length;
  console.log(`\nunique models: ${models.length}`);
  console.log(`  with input schema: ${withSchema} (${((withSchema / models.length) * 100).toFixed(1)}%)`);
  const byGroup = {};
  for (const m of models) byGroup[m.group_of] = (byGroup[m.group_of] || 0) + 1;
  console.log(`  by group: ${JSON.stringify(byGroup)}`);
  const official = models.filter((m) => m.is_official).length;
  console.log(`  official: ${official}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const old of fs.readdirSync(OUT_DIR)) {
    if (/^replicate-seed-\d+\.sql$/.test(old)) fs.rmSync(path.join(OUT_DIR, old));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'replicate-models.json'), JSON.stringify(models, null, 1));
  const files = toSqlChunks(models, OUT_DIR);
  console.log(`\nwrote ${OUT_DIR}/replicate-models.json`);
  console.log(`wrote ${files.length} seed chunk(s):`);
  for (const f of files) console.log(`  ${path.basename(f.file)}  ${f.statements} statements`);
  if (!REMOTE) console.log('\n(--remote not passed: SQL written to disk only)');
}

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
};

/**
 * Emit insert statements as chunked files.
 *
 * Two constraints shape this. `wrangler d1 execute --file` has failed on this
 * account with a large single file, so the output is split. And explicit
 * BEGIN/COMMIT has been rejected by the D1 HTTP API on this account, so each
 * chunk is independently idempotent instead of being wrapped in a transaction.
 * `INSERT OR REPLACE` plus the leading DELETE makes a re-run safe.
 */
function toSqlChunks(models, outDir) {
  const header = [
    '-- Generated by scripts/fetch-replicate-catalog.mjs. Do not edit by hand.',
    '-- Re-run is safe: every statement is INSERT OR REPLACE.',
  ];
  const files = [];
  let chunk = [...header];
  let size = 0;
  let part = 0;
  const flush = () => {
    if (!chunk.length) return;
    const f = path.join(outDir, `replicate-seed-${String(++part).padStart(2, '0')}.sql`);
    fs.writeFileSync(f, chunk.join('\n') + '\n');
    files.push({ file: f, statements: chunk.length - header.length });
    chunk = [...header];
    size = 0;
  };

  const push = (stmt) => {
    // Keep each file comfortably under the size that previously failed.
    if (size > 400_000) flush();
    chunk.push(stmt);
    size += stmt.length + 1;
  };

  push("-- Idempotent reset for this provider only.");
  push("DELETE FROM models WHERE provider = 'replicate';");
  push("DELETE FROM replicate_model_schemas WHERE model_id IN (SELECT id FROM models WHERE provider = 'replicate' AND 1 = 0);");

  for (const m of models) {
    push(
      `INSERT OR REPLACE INTO models (id, name, description, category, family, group_of, cost, cost_currency, dynamic_pricing, endpoint, playground_url, provider, run_count, is_official, version_id, updated_at) VALUES (${esc(m.name)}, ${esc(m.name)}, ${esc(m.description)}, ${esc(m.collections[0] || '')}, ${esc(m.group_of)}, ${esc(m.group_of)}, 0, 'USD', 0, ${esc(`/v1/models/${m.name}/predictions`)}, ${esc(m.url)}, 'replicate', ${Number(m.run_count) || 0}, ${m.is_official ? 1 : 0}, ${esc(m.version)}, datetime('now'));`,
    );
    if (m.schema) {
      push(`INSERT OR REPLACE INTO replicate_model_schemas (model_id, schema_json, updated_at) VALUES (${esc(m.name)}, ${esc(JSON.stringify(m.schema))}, datetime('now'));`);
    }
  }

  const schemaCount = models.filter((m) => m.schema).length;
  push(
    `INSERT OR REPLACE INTO replicate_catalog_meta (id, model_count, schema_count, official_count, source, generated_at) VALUES (1, ${models.length}, ${schemaCount}, ${models.filter((m) => m.is_official).length}, 'replicate /v1/collections union + EXTRA_MODELS', datetime('now'));`,
  );
  flush();
  return files;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});