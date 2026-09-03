# Replicate Integration – Install Options Evaluated

## Chosen strategy for the SPA: **direct REST fetch**
- No build step, no bundling, works from a single HTML file.
- Endpoint: `POST https://api.replicate.com/v1/predictions` with `Authorization: Bearer $REPLICATE_API_TOKEN`
- Headers `Content-Type: application/json` + `Prefer: wait` (hold up to 60s, then poll).
- Body: `{ version: "owner/name:hash", input: { ...schema-validated } }`
- Poll: `GET https://api.replicate.com/v1/predictions/{id}` until `succeeded` | `failed`.

Verified 2026-08-28:
- NSFW prompt → `failed` with `NSFW content detected` ✓ (expected; proves auth + schema correct)
- Safe prompt `schnell` 4 steps → `succeeded` + `https://replicate.delivery/.../out-0.jpg` in ~1s ✓

This matches `https://skills.sh/replicate/skills/replicate` workflow and openapi `https://api.replicate.com/openapi.json`.

## Alternatives considered

### 1. replicate/replicate-python  (https://github.com/replicate/replicate-python)
```
pip install replicate
export REPLICATE_API_TOKEN=...
python -c "import replicate; print(replicate.run('black-forest-labs/flux-schnell', input={'prompt':'...'}))"
```
Pros: typed `FileOutput`, streaming, retries. Great for backend scripts / notebooks.
Cons: Requires Python runtime, not suitable for a browser-only SPA without a backend. Bundling it in browser would need complex polyfills.
Use when: you run a Python backend or want `replicate_test.py` in this repo. A `replicate_test.py` smoke test is included – stdlib only, optional SDK commented inside.

### 2. replicate/cog  (https://github.com/replicate/cog)
Cog packages a model into a Docker container to *deploy* to Replicate. It is not a client for *calling* Replicate. Use `cog` when you are authoring/training a model, not when orchestrating prompts. Installed via `brew install cog` or binary; not needed here.

### 3. Replicate MCP / JS client
`npm install replicate` works for Node. In-browser usage would still expose the token; same trade-off as direct fetch. For a single-file SPA, direct fetch is simpler and avoids dependencies.

### Verdict
- **SPA (browser):** direct fetch.
- **Smoke tests / automation:** `replicate_test.py` (stdlib) or `pip install replicate` for richer FileOutput.
- **Model authoring:** `cog` – out of scope.

## Skill reference
Skill install (as requested):
```
npx skills add https://github.com/replicate/skills --skill replicate
```
Docs header `Accept: text/markdown` returns markdown per skill README.

## Token handling warning
Never hardcode `REPLICATE_API_TOKEN` in HTML. The SPA reads it from:
1. input field (persisted in `localStorage` only on this browser),
2. `?token=` URL param for quick local testing (not recommended for sharing).
The `.env` in this folder is gitignored and holds the real secret for backend scripts.
