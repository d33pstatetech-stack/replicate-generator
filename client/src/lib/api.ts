/**
 * Real data layer for the redesigned Replicate console.
 *
 * Replicate's catalogue is static (client/src/models.js) rather than a D1
 * table, and predictions are proxied through the Worker so the API token stays
 * server-side. Nothing here is simulated.
 */
import {
  fetchModels as fetchCatalogModels,
  fetchModel as fetchCatalogModel,
  fetchModelSchema as fetchCatalogSchema,
  fetchModelStats,
  streamEnhance as postEnhance,
  submitGenerate,
  pollPrediction,
  predictionOutputs,
  cancelPrediction,
  resolveLoraUrl as apiResolveLoraUrl,
  fetchCustomLoras as apiCustomLoras,
  saveCustomLora as apiSaveCustomLora,
  deleteCustomLora as apiDeleteCustomLora,
  fetchLoraLibrary as apiLoraLibrary,
  fetchLoraVerifications as apiLoraVerifications,
} from '../api';
import { schemaDefaults } from '../models';
import { applySchema, toModel } from './models';
import type { Lora, Model, ModelSchema, ParamSpec } from './types';

type Stats = Map<string, { runs: number; rating: number | null }>;

const errText = (v: any, fallback = ''): string => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => errText(x, '')).filter(Boolean).join('; ') || fallback;
  if (typeof v === 'object') return errText(v.message ?? v.error ?? v.detail ?? v.msg, fallback);
  return String(v);
};

/**
 * The real catalogue plus real run counts and average ratings.
 *
 * Replicate's Worker returns `{ stats, total }` for model-stats, so both that
 * and a bare array are accepted.
 */
export async function fetchModels(): Promise<{ models: Model[]; statsFailed: boolean }> {
  // Real catalogue from D1. A failure here is survivable — api.js falls back
  // to the bundled seed — so the console still opens with something usable.
  let entries: any[];
  try {
    entries = await fetchCatalogModels();
  } catch {
    entries = [];
  }
  let stats: Stats | undefined;
  let statsFailed = false;
  try {
    const list: any[] = await fetchModelStats(400);
    stats = new Map(
      list.filter((r) => r && r.model).map((r) => [r.model, { runs: Number(r.runs) || 0, rating: r.avg_rating == null ? null : Number(r.avg_rating) }]),
    );
  } catch {
    statsFailed = true;
  }
  return { models: entries.map((e) => toModel(e, stats)), statsFailed };
}

/**
 * Real Replicate input schema. These are Replicate-style JSON Schema documents
 * (`{ type, required, properties }`), not the `{ params, defaults }` shape the
 * other two apps use, so they are converted here rather than in the components.
 */
export async function fetchSchema(id: string): Promise<ModelSchema> {
  // Prefer the harvested OpenAPI input schema from D1, which is what Replicate
  // itself serves, and fall back to the hand-written schema for the legacy
  // seed entries. A model with neither renders an empty param form rather
  // than failing, because the schema is advisory here — the Worker proxies the
  // real prediction and Replicate rejects invalid inputs itself.
  let raw: any = null;
  try {
    raw = await fetchCatalogSchema(id);
  } catch {
    raw = null;
  }
  if (!raw) {
    try {
      raw = (await fetchCatalogModel(id))?.schema ?? null;
    } catch {
      raw = null;
    }
  }
  if (!raw) return { params: {}, defaults: {} };
  const params: Record<string, ParamSpec> = raw.properties || {};
  return { params, defaults: schemaDefaults(raw) as Record<string, unknown>, raw };
}

export function withSchema(model: Model | null, schema: ModelSchema | null): Model | null {
  return model && schema ? applySchema(model, schema) : model;
}

/**
 * Replicate does not expose per-model pricing, so there is nothing real to
 * quote. Returns 0 and the UI shows "Free" instead of a fabricated figure.
 */
export async function estimateCost(): Promise<number> {
  return 0;
}

/** Real streaming enhancement through the Worker's SSE route. */
export async function streamEnhance(
  rawPrompt: string,
  model: Model | null,
  onToken: (text: string) => void,
  signal?: AbortSignal,
  params: Record<string, unknown> = {},
): Promise<{ text: string; providerUsed: string; modelUsed: string; historyId: number | null }> {
  // Send the selected model's own group as `modality`. Model.group comes from
  // D1 group_of via normalizeGroup(), so this is the catalogue's answer rather
  // than a guess — and it stops the Worker deriving image-vs-video from an id
  // regex when the row already knows.
  const modality = model?.group === 'image' || model?.group === 'video' ? model.group : undefined;
  return postEnhance({ rawPrompt, modelId: model?.id || '', params, modality, signal, onToken, onMeta: () => {} } as any);
}

export interface SubmitResult {
  requestId: string;
  outputs: string[];
  cost: number;
  elapsedMs: number;
}

const POLL_MS = 2500;
const MAX_POLL_MS = 15 * 60 * 1000;

/**
 * Real generation against the Replicate API, proxied by the Worker.
 * Statuses are Replicate's: starting | processing | succeeded | failed | canceled.
 *
 * Note `starting` is mapped low on the progress bar on purpose. The custom
 * aznten models sit in `starting` indefinitely, so treating it as "barely begun"
 * rather than "nearly done" is the honest reading.
 */
export async function runGeneration(
  model: Model,
  params: Record<string, unknown>,
  onProgress: (p: number, phase: string) => void,
  signal: AbortSignal,
): Promise<SubmitResult> {
  const started = Date.now();
  const submitted: any = await submitGenerate({ modelId: model.id, params, enhancementId: null });
  const requestId = submitted.id || submitted.requestId;
  if (!requestId) throw new Error('Prediction returned no id');

  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (Date.now() - started > MAX_POLL_MS) {
      throw new Error(`No result after 15m. The prediction may still be running on Replicate. ID: ${requestId}`);
    }
    const d: any = await pollPrediction(requestId);
    const st = d?.status;
    const elapsed = (Date.now() - started) / 1000;

    if (st === 'succeeded') {
      onProgress(1, 'Complete');
      return { requestId, outputs: predictionOutputs(d), cost: 0, elapsedMs: Date.now() - started };
    }
    if (st === 'failed' || st === 'canceled' || st === 'cancelled') {
      const msg = errText(d?.error || d?.detail || d?.title, `Generation ${st}`);
      throw new Error(`${msg} [id: ${requestId}]`);
    }
    const pct = st === 'processing' ? 0.6 : st === 'starting' ? 0.15 : 0.35;
    onProgress(pct, `${st || 'working'} · ${elapsed.toFixed(0)}s`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/** Cancel a running prediction. Real route on the Worker. */
export async function cancelRun(requestId: string): Promise<void> {
  try {
    await cancelPrediction(requestId);
  } catch {
    /* best-effort */
  }
}

/* ---------------- LoRAs ---------------- */

export const resolveLoraUrl = apiResolveLoraUrl;
export const saveCustomLora = apiSaveCustomLora;
export const deleteCustomLora = apiDeleteCustomLora;

export async function fetchCustomLoras(): Promise<any[]> {
  try {
    return await apiCustomLoras();
  } catch {
    return [];
  }
}

/* ---------------- Central LoRA repository (Phase A read-only) ----------------
   Fail-soft by design: any failure returns null so callers keep the baked
   seed (offline / old-DB safety). Only a non-empty array replaces the seed. */
export async function fetchLibrary(): Promise<any[] | null> {
  try {
    return await apiLoraLibrary();
  } catch {
    return null;
  }
}

export async function fetchVerifications(): Promise<any[] | null> {
  try {
    return await apiLoraVerifications();
  } catch {
    return null;
  }
}

export function toLora(entry: any, custom = false): Lora {
  const id = String(entry?.id || entry?.repo || '');
  const src = String(entry?.repo_url || entry?.id || '');
  return {
    id,
    name: entry?.name || id,
    source: custom ? 'custom' : /civitai/i.test(src) ? 'civitai' : 'huggingface',
    repo: repoOf(entry),
    baseFamily: entry?.baseFamily || '',
    triggers: Array.isArray(entry?.triggers) ? entry.triggers : [],
    custom,
    entry,
  };
}

export function repoOf(entry: any): string {
  const u = String(entry?.repo_url || '');
  if (u) return u.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return String(entry?.id || '');
}