# Replicate Prompt Orchestrator — Single-Page App

Orchestrate generative AI prompts on **Replicate.com** — schema-driven, like `muapi-prompt-generator` but for Replicate.

- **Select a model** → parameters auto-populate **only** with fields that model actually supports.
- **Constrained controls**: enums → dropdown, integers/numbers with `min`/`max` → clamped sliders/numbers, booleans → toggles, `format: uri` → upload-or-URL.
- **Conditional params**: e.g. `width`/`height` only enabled when `aspect_ratio=custom` and `go_fast=false` (matches the AZNTEN schema). Video model proves we **block 4K when max is 1080p**.
- **Single HTML file** — no build, Tailwind via CDN, Font Awesome.

## Quick start

1. Open `index.html` (double-click or `npx serve .`).
2. Paste your `REPLICATE_API_TOKEN` in the header (saved to `localStorage` only).
3. Pick `d33pstatetech-stack/aznten_replicate` and type a prompt (include `aznten` trigger word).
4. Tweak only the shown params — you can't pick an invalid resolution.
5. Hit **Generate** (`Prefer: wait` + automatic poll fallback). `GET /v1/predictions/{id}` polls every 2.5s.

## Folder

```
replicate-prompt-orchestrator/
  index.html            # <-- the SPA (single file)
  .env                  # API keys (gitignored) — copied from muapi-prompt-generator
  replicate_test.py     # stdlib smoke test (also works with `pip install replicate`)
  INSTALL_NOTES.md      # python vs cog vs direct fetch evaluation
```

## API keys

`.env` was created from `muapi-prompt-generator/.env` + `.dev.vars`:

```
REPLICATE_API_TOKEN=your_replicate_api_token_here
MUAPI_API_KEY=your_muapi_api_key_here
OPENROUTER_API_KEY=your_openrouter_api_key_here
VENICE_API_KEY=your_venice_api_key_here
HUGGINGFACE_API_KEY=your_huggingface_api_key_here
```

`.env` is gitignored. The SPA **never** ships the token — users paste it in the browser. For scripts, `export REPLICATE_API_TOKEN=...`.

## Replicate request (verified live)

```bash
export REPLICATE_API_TOKEN=<your-token-here>
curl -s -X POST \
  -H "Authorization: Bearer $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Prefer: wait" \
  -d '{
    "version": "d33pstatetech-stack/aznten_replicate:adbcf47ba36575b7d114c24331abf10a49420dab1a53f211aa507372721f7453",
    "input": {
      "model": "schnell",
      "prompt": "aznten a serene mountain landscape at sunrise, cinematic lighting, ultra detailed, 8k",
      "go_fast": true, "lora_scale": 1, "megapixels": "1",
      "num_outputs": 1, "aspect_ratio": "16:9", "output_format": "jpg",
      "guidance_scale": 3, "output_quality": 80, "num_inference_steps": 4
    }
  }' \
  https://api.replicate.com/v1/predictions
# → {"status":"succeeded","output":["https://replicate.delivery/.../out-0.jpg"]}
```

NSFW / nude prompts are **unrestricted by default**: `disable_safety_checker=true` is auto-injected. Verified 2026-09-02 on `aznten` — same nude prompt with `false` → `failed — All generated images contained NSFW content`, with `true` → `succeeded` in ~3s. Toggle `disable_safety_checker` in Parameters to re-enable filtering if desired.

## How validation mirrors muapi-prompt-generator

| muapi | this app |
|-------|----------|
| `/api/models` → `model_params.schema_json` per model | Embedded `CATALOG[].schema` + optional live fetch via `GET /v1/models/{owner}/{name}/versions/{id}` |
| Only render params where schema exists | `renderParams()` iterates `schema.properties` only |
| Type-aware widgets + `min`/`max` | `paramType()` → `range`/`number`/`select`/`boolean`/`image` with clamped inputs |
| Hide unsupported combos | `dependencyWhy()` disables `width`/`height` unless `custom` etc., shows lock badge |
| Payload preview | `payloadPreview` = `{version, input}` exactly what `POST /v1/predictions` sends |
| Polling | `Prefer: wait` first, then `GET /v1/predictions/{id}` every 2.5s |

## Adding a model

Click **+** in header → paste `owner/name` or `owner/name:version` → **Fetch Live Schema** (uses your token) or paste the `Input` schema JSON → **Add Model**. Curated seeds include an image LoRA, FLUX schnell/dev, SDXL, and a WAN video model to demo different constraint sets.

## Install options evaluated

See `INSTALL_NOTES.md`. TL;DR: SPA uses **direct fetch**; `pip install replicate` is great for backend scripts (`replicate_test.py` shows both); `cog` is for *publishing* models, not calling them.
