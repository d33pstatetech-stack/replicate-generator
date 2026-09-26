# Replicate Prompt Orchestrator

A schema-driven prompt console for models on [Replicate](https://replicate.com). Pick a model and the form populates with only the parameters that model actually accepts — enums become dropdowns, bounded numbers become clamped inputs, booleans become toggles, and incompatible combinations are disabled with a reason rather than silently dropped.

It is the Replicate counterpart to [muapi-prompt-generator](https://github.com/d33pstatetech-stack/muapi-prompt-generator), and shares most of its front end: the same prompt enhancer, LoRA library, run history, and R2 output capture.

**Catalog:** 15 pinned models across FLUX, SDXL, Krea, Qwen-Image, and the Wan video families, with each model's input schema taken from its live upstream definition.

> **Scope note:** the *hosting layer* is free on Cloudflare's Free plan. Replicate *inference* is billed per model and per second, and is not free.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Why Cloudflare Workers, and what free hosting provides](#why-cloudflare-workers-and-what-free-hosting-provides)
- [Free tier budget](#free-tier-budget)
- [Where the free tier gets tight](#where-the-free-tier-gets-tight)
- [Data stores](#data-stores)
- [API reference](#api-reference)
- [Secrets and configuration](#secrets-and-configuration)
- [Local development](#local-development)
- [Deployment](#deployment)
- [Prompt enhancer](#prompt-enhancer)
- [LoRA library and compatibility filtering](#lora-library-and-compatibility-filtering)
- [Output capture and the Replicate expiry](#output-capture-and-the-replicate-expiry)
- [Adding a model](#adding-a-model)
- [Content scope](#content-scope)
- [Docker](#docker)
- [License](#license)

---

## Features

**Schema-driven parameters**
- 15 models with per-model input schemas sourced from live upstream definitions
- Type-aware widgets: enum → select, integer/number with `min`/`max` → clamped input, boolean → toggle, `format: uri` → upload or URL
- Conditional parameters disabled with a visible reason — `width`/`height` stay locked unless `aspect_ratio=custom`, and a 1080p-capped model will not accept 4K
- Live payload preview showing exactly what will be sent
- Curated seeds deliberately span different constraint sets (image LoRA wrapper, FLUX schnell/dev, SDXL, Krea, Qwen-Image, Wan 2.1/2.2/3.0) so the validation is exercised rather than assumed

**Generation**
- `Prefer: wait` first, then automatic polling of `GET /v1/predictions/{id}` every 2.5s
- Version-pinned submissions, with a model-alias route for official versionless models
- Multi-output gallery: every returned URL is surfaced, with a tab strip on the result card
- Per-run star rating and a shared D1-backed run log

**AI prompt enhancer**
- Model-aware prompt rewriting with a provider fallback chain
- Server-sent-event streaming, plus a buffered JSON mode
- Per-prompt persistence of raw text, enhanced text, model, params, and the LLM that produced it

**LoRA support**
- Browse Hugging Face and CivitAI, or resolve either from a pasted model-card URL
- Curated seed list of public community adapters, plus a separate bucket of uncensored adapters (see [Content scope](#content-scope))
- Custom LoRA library persisted in D1, deduplicated by source + repo + file
- Three-tier compatibility filtering against the selected model
- A documented Replicate-specific LoRA quirk surfaced in the UI, since bare `owner/repo` is misread as a model reference

**Interface**
- React 19 + Vite 8 + Tailwind 4, built to static assets and served from the edge
- Responsive down to mobile widths
- Prompt template library and settings modal for the enhancer's LLM chain, with keys redacted over the wire

---

## Architecture

```
client/           → React 19 + Vite + Tailwind 4 single-page app
  src/models.js   → the pinned catalog + per-model input schemas
  src/components/ → ModelPicker, ParamForm, Enhancer, LoraPicker, CloudPicker,
                    OutputCard, HistoryGrid, LibraryModal, SettingsModal, …
  src/hooks/      → useGeneration (submit + poll), useLlmConfig
  dist/           → build output, served as Worker static assets (git-ignored)
src/worker.js     → the Worker: every /api/* route, auth gate, proxying
migrations/       → 0001 prompt + LLM config tables
migrations-history/ → run log, enhancements, custom LoRAs, doc chunks
scripts/          → sync-legacy-loras.mjs, sync-legacy-index.mjs
public/           → legacy vanilla-JS front end for the static Docker preview
                    (see Dockerfile); superseded by client/ for the deployed app
replicate_docs/   → saved upstream llms.txt / schema references
replicate_test.py → stdlib smoke test against the Replicate API
```

The Worker only ever handles `/api/*`; static assets are served by Cloudflare's
asset pipeline via the `[assets]` binding, with `not_found_handling =
"single-page-application"` so client-side routing works on a cold load.

Two D1 databases and one R2 bucket carry state:

| Binding | Resource | Purpose |
|---|---|---|
| `DB` | D1 `replicate-orchestrator` | Prompt templates, doc chunks, enhancer prompts, LLM config |
| `HISTORY` | D1 `genai-history` | Run log, enhancements, custom LoRA library, judge verdicts |
| `OUTPUTS_BUCKET` | R2 `genai-assets` | Captured generation outputs |

`HISTORY` and the R2 bucket are the same resources the sibling apps use, which
is what lets one run be inspected from any of them.

---

## Why Cloudflare Workers, and what free hosting provides

This application is a good fit for the Workers Free plan for a structural
reason: **almost all of its work is waiting on someone else's network.** The
Worker receives a request, forwards it to Replicate or to an LLM provider, and
streams the response back. Cloudflare does not count time spent waiting on a
`fetch()` toward CPU time, so the 10 ms CPU ceiling that constrains
compute-bound Workers barely registers here.

What that provides in practice:

**Zero infrastructure cost to run.** No server to rent, no container to size, no
idle instance. A demo nobody opens for a month costs nothing to keep online.

**A global HTTPS endpoint with no origin to maintain.** Every deployment gets a
`*.workers.dev` hostname, or a custom domain with automatic certificates and
edge caching. There is nothing to patch, secure, or reboot.

**Deploys are atomic rollouts.** Publishing shifts traffic when the new version
is ready and keeps the previous one available for rollback. There is no session
state in the Worker to drain, because all state lives in D1 and R2.

**The API token never reaches the browser.** `REPLICATE_API_TOKEN` is stored as
an encrypted Worker secret and injected per request. The browser talks to
`/api/replicate/*` and never holds the token, which is also why the same
front end can be served as a static image with a bring-your-own-key fallback.

**Authentication happens at the edge, in the same place.** Cloudflare Access
rejects unauthenticated requests before they reach Worker code, so an
unauthenticated attempt costs nothing and never touches the token. The Worker
keeps a redundant `Cf-Access-Jwt-Assertion` check as defense in depth and
returns a JSON `401` for API clients instead of an HTML login page.

**Free R2 egress, which is the decisive one here.** Generated images and video
are the bulk of the traffic. Storing them in R2 and serving them back costs
nothing in bandwidth, which is what makes "keep every output in history" a
reasonable default rather than a bill.

**Static assets come from the edge cache.** The built front end ships as static
assets, so page loads do not consume Worker invocations the way dynamic routes
do.

---

## Free tier budget

Figures are the Workers Free plan limits this resource mix is measured against.
Daily limits reset at 00:00 UTC; monthly ones at the subscription renewal date.

| Resource | Free allowance | Relevance here |
|---|---|---|
| Worker requests | 100,000 / day | Page loads and every API call. Polling dominates. |
| Worker CPU | 10 ms / request | Rarely binding — the Worker is I/O bound and network wait is not counted. |
| Worker memory | 128 MB | Comfortable. |
| Subrequests | 50 external / 1,000 to Cloudflare services per request | A single generate call uses a handful. |
| Worker size | 64 MiB | Not close — plain JavaScript, no dependencies. |
| Static assets | 20,000 files, 25 MiB each per version | The Vite bundle is well inside this. |
| D1 rows read | 5,000,000 / day | Run-log and prompt queries. |
| D1 rows written | 100,000 / day | Run log, prompts, custom LoRAs. |
| D1 storage | 5 GB total | Shared `genai-history` database. |
| D1 egress | none | D1 is never charged for data transfer. |
| R2 storage | 10 GB-month / month | Output captures accumulate here. |
| R2 operations | 1M Class A / 10M Class B per month | Writes on capture, reads on replay. |
| R2 egress | free | The single largest practical win. |
| Access users | 50 seats | Ample for a private team tool. |

Since 1 September 2026, D1 on the Free plan *enforces* its daily row limits:
queries return an error once the limit is reached, and stored data is
unaffected. Cloudflare sends an email when a limit is hit.

---

## Where the free tier gets tight

- **Request count binds before CPU.** Polling every 2.5s for several minutes is
  dozens of requests for one generation. A busy day reaches 100,000 requests
  well before any single call approaches 10 ms of CPU.
- **The shared `genai-history` database is the shared bottleneck.** All the
  sibling apps write to it, so D1 limits are account-wide. Once several apps are
  active this is the first ceiling to watch, not the Worker.
- **R2 storage fills at 10 GB-month.** Output archives are what outgrow the free
  allowance first. A lifecycle rule that expires old objects keeps it predictable.
- **Access is capped at 50 seats.** Fine for a private tool, not a path to a
  public multi-tenant product.
- **10 ms CPU leaves no headroom.** Any future feature doing image processing,
  large JSON transforms, or crypto in the Worker would need `cpu_ms` raised,
  which is a Workers Paid capability.

---

## Data stores

**`replicate-orchestrator` (D1)** — `prompts` and `llm_config` from the
enhancer, plus `prompt_templates` and `doc_chunks` for the library and saved
upstream documentation.

**`genai-history` (D1)** — operational state, created defensively on first use
so a fresh database needs no migration step: `runs`, `enhancements`,
`custom_loras` (unique on source + repo + file), and `judge_verdicts`.

**`genai-assets` (R2)** — captured outputs under a `replicate/YYYYMMDD/…` key
prefix, replayed through the Worker with an extension-based content-type
fallback so objects stored as `application/octet-stream` still download with a
usable MIME type.

---

## API reference

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Build info and key status *(public)* |
| POST | `/api/replicate/predictions` | Submit a prediction — `{version, input}` or `{model, input}` |
| GET | `/api/replicate/save-outputs` → POST | Server-side fetch of output URLs into R2 |
| GET | `/api/replicate/file` | Stream a saved object back out of R2 |
| GET | `/api/hf/file` | Proxy a Hugging Face file for allowlisted repos |
| GET/POST | `/api/cloud/list`, `/api/cloud/file`, `/api/cloud/resolve` | Browse, fetch, and rehost R2 objects |
| POST | `/api/enhance` | Stream an enhanced prompt (SSE) |
| POST | `/api/optimize` | Same, buffered to JSON |
| GET/PUT | `/api/llm-config` | Read (redacted) or write the enhancer's LLM chain |
| GET | `/api/prompts` | List persisted prompts |
| POST | `/api/lora/resolve` | Resolve a Hugging Face or CivitAI model-card URL to LoRA file(s) |
| GET/POST/DELETE | `/api/loras/custom` | Shared custom LoRA library |
| GET | `/api/history/runs` | Run log with filters |
| POST | `/api/history/link` | Attach an enhancement to a run |
| POST | `/api/history/rate` | Star-rate a run |
| POST | `/api/judge` | Proxy to the Jev verifier |
| POST | `/api/judge/log` | Record a verdict for calibration |

Everything except `/api/health` sits behind the Access gate, so the token is
never reachable by an unauthenticated caller.

---

## Secrets and configuration

| Name | Required | Purpose |
|---|---|---|
| `REPLICATE_API_TOKEN` | yes | All prediction calls, kept server-side |
| `OPENROUTER_API_KEY` | for enhancer | Default LLM provider |
| `VENICE_API_KEY` | optional | Alternative LLM provider in the chain |
| `HUGGINGFACE_API_KEY` | optional | Lets `/api/hf/file` read allowlisted private repos |

Two plain vars control the private-LoRA proxy, both defaulting to a safe state:

| Var | Default | Purpose |
|---|---|---|
| `HF_PROXY_REPO_ALLOWLIST` | `""` (deny all) | Comma-separated `owner/repo` or `owner/*` entries the proxy may serve |
| `HF_PROXY_BASE_URL` | `""` (request origin) | Canonical origin advertised when rewriting Hugging Face URLs to the proxy |

`/api/hf/file` is reachable without a session, because Replicate's own servers
need to pull weights without holding Hugging Face credentials. That makes an
open proxy a real risk, so the allowlist is empty by default and only exact
entries or owner wildcards are honoured.

Secrets are set with `wrangler secret put` and injected per request. For local
development they live in `.dev.vars`, copied from `.dev.vars.example`.
`.dev.vars` and `.env` are git-ignored; never commit a populated copy.

---

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # add REPLICATE_API_TOKEN

# Front end (hot reload on :5173, talks to the Worker on :8787)
cd client
npm install
npm run dev

# Worker + local D1 (in a second terminal)
npx wrangler d1 execute replicate-orchestrator --local --file=migrations/0001_init.sql
npx wrangler dev
```

`wrangler dev` serves on `127.0.0.1`, and the auth gate treats loopback as
authenticated, so no Access setup is needed to develop locally. Client linting
is `npm run lint` in `client/` (oxlint).

---

## Deployment

```bash
# Schema, once per environment
npx wrangler d1 execute replicate-orchestrator --remote --file=migrations/0001_init.sql
npx wrangler d1 execute replicate-orchestrator --remote --config migrations-history --file=migrations-history/0001_history.sql

# Build the front end into client/dist
cd client && npm run build && cd ..

# Secrets
npx wrangler secret put REPLICATE_API_TOKEN
npx wrangler secret put OPENROUTER_API_KEY

# Publish
npx wrangler deploy
```

The `database_id` values in `wrangler.toml` are environment-specific; a fork
needs its own from `wrangler d1 create`.

**Access must be configured before the API is usable.** The Worker requires a
valid `Cf-Access-Jwt-Assertion` or `Cf-Access-Authenticated-User-Email` header
on every protected prefix and only exempts loopback. A deployment without a
matching Access application returns `401` on every route except `/api/health`,
even though the front end loads fine. Creating a self-hosted Access application
over the `*.workers.dev` hostname is the missing step in any fresh fork.

---

## Prompt enhancer

The enhancer rewrites a prompt for the specific target model, adding sound-effect
and dialogue cues when the target generates audio and timestamp directions for
video models based on the requested duration. Responses stream to the browser as
server-sent events and the full text is persisted once the stream completes.

Providers are tried in order until one succeeds:

1. `https://openrouter.ai/api/v1` — `liquid/lfm-2.5-2.6b:free`
2. `https://openrouter.ai/api/v1` — `openrouter/free`
3. `https://api.venice.ai/api/v1` — `venice-uncensored`

Venice model IDs change as their catalog rotates, so any Venice entry is worth
confirming before relying on it; a stale ID surfaces as a `404` that the chain
falls through. The chain is stored in the `llm_config` D1 row when set through
the settings modal and falls back to these defaults otherwise. Keys are resolved
per provider from the matching environment secret and are always redacted on read.

The system prompt is deliberately framed as format optimization only, so the
enhancer performs mechanical conversion for any subject matter and leaves
content policy to the downstream generative model.

---

## LoRA library and compatibility filtering

LoRAs can be browsed from Hugging Face and CivitAI, or resolved from a pasted
model-card URL through `POST /api/lora/resolve`. Anything added by hand joins a
shared library in D1, deduplicated on source + repo + file.

`client/src/loras-data.js` ships a small seed list of public community adapters,
one per family the compatibility filter understands, so the picker is useful on a
fresh clone. It is a starting point, not a curated endorsement. The seed
includes entries for FLUX.1, Qwen-Image, Krea, and Wan 2.1, which also keeps the
tier dots visible on a first run.

Picking a LoRA the selected model cannot load wastes a generation, so the
pickers filter by compatibility using a three-tier model in
`client/src/lora-compat.js`:

- **Verified** (green) — the exact LoRA and model pair has completed a real run. The list starts empty, since a pair only earns green once it has actually run; add a row to `VERIFIED_LORA_RUNS` when one does.
- **Likely** (yellow) — curated target, matching family and pipeline, tolerating minor version drift such as Wan 2.1 against 2.2. This is where most seed entries land.
- **Incompatible** (red) — family mismatch, pipeline mismatch, or a major version gap such as Wan 2.x against 3.x. Hidden unless show-all is enabled.

One Replicate-specific trap is surfaced in the UI: a bare `owner/repo` is
misread as a *model* reference rather than a LoRA, and other non-matching values
get downloaded as a tarball and fail to unpack. Use the `huggingface.co/owner/repo`
docs form, the direct `/resolve/main/*.safetensors` URL when a repo holds more
than one weight file, or the `.tar` from the training output page.

---

## Output capture and the Replicate expiry

Replicate-hosted output URLs are short-lived. On every successful run the app
posts the output URLs to `/api/replicate/save-outputs` and the Worker pulls each
file into the `genai-assets` R2 bucket under `replicate/YYYYMMDD/…`. No local
disk, no CORS involvement. The **R2 cloud save** toggle controls this and is on
by default; if R2 is unreachable it falls back to a local download.
`/api/replicate/file?key=…` serves a saved object back, and `/api/cloud/*`
browses the bucket.

---

## Adding a model

The **+** control in the header accepts `owner/name` or `owner/name:version`,
then fetches the live schema with the configured token, or accepts pasted
`Input` schema JSON. To add one to the curated catalog instead, append an entry
to `CATALOG` in `client/src/models.js` with its pinned version and schema, then
mirror it into the legacy preview:

```bash
node scripts/sync-legacy-index.mjs public/index.html
```

The curated seeds intentionally span different constraint sets — a LoRA wrapper,
FLUX schnell and dev, SDXL, Krea, Qwen-Image, and several Wan variants — so the
per-model validation is demonstrably doing work rather than passing everything
through.

---

## Content scope

This is a prompt-engineering tool, and it treats prompts as an optimization
problem rather than a content-moderation one.

**The enhancer does not filter.** Its system prompt frames the task as format
conversion, so it rewrites a prompt for the target model regardless of subject
matter and leaves policy to the downstream model.

**Safety toggles are surfaced, not forced.** Many Replicate models expose a
`disable_safety_checker` input. Where a model has one, the client defaults it to
`true` so an explicit request is not silently refused, and the control is shown
in the parameter form so the default is visible and reversible. When a provider
blocks an output regardless of that flag, the error is surfaced with a pointer
to the toggle rather than retried blindly.

**The LoRA picker has a second bucket.** Alongside the general seed list,
`NSFW_LORAS` in `client/src/loras-data.js` holds uncensored and adult-oriented
adapters under a separate picker variant so the default view stays clean. These
are ordinary public community checkpoints; the only thing distinguishing them is
which list they appear in. They are handled identically to any other adapter —
same schema, same compatibility tiers, same add-from-URL path.

Use of any adapter is subject to the licence of the individual checkpoint and to
the terms of the service actually generating the output.

---

## Docker

```bash
docker build -t replicate-orchestrator .
docker run --rm -p 8000:80 replicate-orchestrator
# Open http://localhost:8000 and paste a token in the browser (BYOK)
```

The image contains only `public/`, so no `.env`, key, or source enters it. The
SPA detects the missing proxy and falls back to direct browser calls — note that
Replicate does not return `Access-Control-Allow-Origin` for a `file://` (null)
origin, so serve the image over HTTP rather than opening the file directly. For
the full hidden-token backend, deploy to Cloudflare with `wrangler deploy`
instead.

---

## License

MIT
