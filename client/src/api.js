// Thin wrappers over the Replicate worker API (src/worker.js).
//
// Backend reality (no model catalog, no upload endpoint):
// - Models are STATIC (client/src/models.js, extracted from public/index.html
//   CATALOG) — the worker has no /api/models and treats modelId as opaque.
// - Predictions proxy the Replicate API (token stays server-side):
//     POST /api/replicate/predictions            { version|model, input }
//     POST /api/replicate/models/:owner/:name/predictions   { input }  (official only)
//     GET  /api/replicate/predictions/:id         → { id, status, output, error, logs }
//     POST /api/replicate/predictions/:id/cancel
//   Statuses: starting | processing | succeeded | failed | canceled.
// - Outputs are archived to R2 via POST /api/replicate/save-outputs
//     { urls, model, predictionId } → { saved[{key,size,contentType}], errors }.
// - Images: NO /api/upload. Local files become data URIs in the browser,
//   R2 files resolve via POST /api/cloud/resolve (data URI, 12MB cap), or paste a URL.
// - Enhance SSE is an OpenAI-style protocol (streamEnhance below).
import { MODELS, getModel, submitRoute } from './models';

const API = '';

async function json(res) {
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return { _raw: t };
  }
}

export function errText(v, fallback = '') {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => errText(x, '')).filter(Boolean).join('; ') || fallback;
  if (typeof v === 'object') return errText(v.message ?? v.error ?? v.detail ?? v.msg ?? v.title, fallback);
  return String(v);
}

// ─── Static catalog (no backend endpoint) ───
// Async wrappers preserve a uniform component call-shape; the catalog ones
// never touch the network (static import).
export async function fetchModels() {
  return MODELS;
}

export async function fetchModel(id) {
  const m = getModel(id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m; // { id, name, group, group_of, category, version, official?, description, schema }
}

export async function fetchHealth() {
  const res = await fetch(`${API}/api/health`);
  return json(res);
}

export async function submitGenerate({ modelId, params, enhancementId }) {
  const model = getModel(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  const route = submitRoute(model);
  const res = await fetch(`${API}${route.path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(route.body(params)),
  });
  const data = await json(res);
  if (!res.ok) {
    throw new Error(errText(data.detail, '') || errText(data.error, '') || errText(data.title, '') || `Prediction failed (${res.status})`);
  }
  if (!data.id) throw new Error(errText(data.error, '') || 'Prediction returned no id');
  if (enhancementId) {
    linkEnhancement({ externalJobId: data.id, enhancementId });
  }
  return data; // Replicate prediction { id, status, output?, error?, logs?, metrics? }
}

export async function pollPrediction(predictionId) {
  const res = await fetch(`${API}/api/replicate/predictions/${encodeURIComponent(predictionId)}`);
  const data = await json(res);
  if (!res.ok && !data.status) {
    throw new Error(errText(data.error, '') || errText(data.detail, '') || `Poll failed (${res.status})`);
  }
  return data; // { id, status: starting|processing|succeeded|failed|canceled, output?, error?, logs? }
}

export async function cancelPrediction(predictionId) {
  const res = await fetch(`${API}/api/replicate/predictions/${encodeURIComponent(predictionId)}/cancel`, { method: 'POST' });
  return json(res);
}

export function predictionOutputs(pred) {
  const o = pred?.output;
  if (!o) return [];
  return Array.isArray(o) ? o.filter((u) => typeof u === 'string') : [o];
}

export async function saveOutputs({ urls, model, jobId, predictionId }) {
  const res = await fetch(`${API}/api/replicate/save-outputs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, model, predictionId: predictionId || jobId || '' }),
  });
  return json(res);
}

export async function linkEnhancement({ externalJobId, enhancementId }) {
  try {
    await fetch(`${API}/api/history/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'replicate', external_job_id: externalJobId, enhancement_id: enhancementId }),
    });
  } catch {
    /* fire-and-forget */
  }
}

export async function rateJob({ externalJobId, rating }) {
  const res = await fetch(`${API}/api/history/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'replicate', external_job_id: externalJobId, rating }),
  });
  return json(res);
}

// Cloud picker: worker list shape is { folders, objects[{key,size,uploaded}],
// truncated, cursor } with query { prefix, delimiter | recursive=1, cursor }.
export async function cloudList({ prefix = '', flat = false, cursor = null } = {}) {
  const q = new URLSearchParams({ prefix, ...(flat ? { recursive: '1' } : { delimiter: '/' }), ...(cursor ? { cursor } : {}) });
  const res = await fetch(`${API}/api/cloud/list?${q}`);
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error || data.message, `R2 list failed (${res.status})`));
  return data;
}

export function cloudFileUrl(key) {
  return `${API}/api/cloud/file?key=${encodeURIComponent(key)}`;
}

export async function cloudResolve(key) {
  const res = await fetch(`${API}/api/cloud/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error || data.message, `Resolve failed (${res.status})`));
  return data; // { url (data: URI, 12MB cap), key, via: 'data-uri' }
}

export async function fetchLlmConfig(signal) {
  const res = await fetch(`${API}/api/llm-config`, { signal });
  return json(res);
}

export async function saveLlmConfig(config) {
  await fetch(`${API}/api/llm-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: config }),
  }).catch(() => {});
}

// Streaming enhance — protocol: POST {rawPrompt, modelId, params} →
// SSE OpenAI-style chunks (choices[0].delta.content) + {history_id} event,
// X-Provider-Used / X-Model-Used headers, JSON fallback {enhanced,…}.
export async function streamEnhance({ rawPrompt, modelId, params, signal, onToken, onMeta }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50000);
  const onAbort = () => ctrl.abort();
  signal && signal.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API}/api/enhance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawPrompt, modelId, params }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      let msg = 'Enhance failed';
      try {
        const j = await res.json();
        msg = j.message || j.error || msg;
        if (j.providersTried?.length) msg += ` [tried: ${j.providersTried.join(' | ')}]`;
      } catch {
        try {
          msg = await res.text();
        } catch {
          /* keep default */
        }
      }
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type') || '';
    let full = '';
    let providerUsed = res.headers.get('X-Provider-Used') || '?';
    let modelUsed = res.headers.get('X-Model-Used') || '?';
    let historyId = null;
    if (ct.includes('text/event-stream') && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim();
          if (d === '[DONE]' || !d) continue;
          try {
            const j = JSON.parse(d);
            if (j.history_id) {
              historyId = j.history_id;
              continue;
            }
            const delta = j.choices?.[0]?.delta?.content || '';
            if (delta) {
              full += delta;
              onToken && onToken(full);
            }
          } catch {
            /* partial chunk */
          }
        }
      }
    } else {
      const data = await res.json();
      full = data.enhanced || data.optimized_prompt || '';
      if (data.history_id) historyId = data.history_id;
      providerUsed = data.providerUsed || providerUsed;
      modelUsed = data.modelUsed || modelUsed;
    }
    if (!full) throw new Error('Empty LLM response');
    onMeta && onMeta({ providerUsed, modelUsed, historyId, length: full.length });
    return { text: full, providerUsed, modelUsed, historyId };
  } finally {
    clearTimeout(timer);
    signal && signal.removeEventListener('abort', onAbort);
  }
}

// Add-from-URL: resolve an HF/CivitAI model-card URL to LoRA file(s).
export async function resolveLoraUrl(url) {
  const res = await fetch(`${API}/api/lora/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Resolve failed (${res.status})`));
  return data;
}

export async function fetchCustomLoras() {
  const res = await fetch(`${API}/api/loras/custom`);
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Custom LoRAs failed (${res.status})`));
  return Array.isArray(data.loras) ? data.loras : [];
}

export async function saveCustomLora(entry) {
  const res = await fetch(`${API}/api/loras/custom`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Save failed (${res.status})`));
  return data;
}

export async function deleteCustomLora(id) {
  const res = await fetch(`${API}/api/loras/custom/${id}`, { method: 'DELETE' });
  const data = await json(res);
  if (!res.ok) throw new Error(errText(data.error, `Delete failed (${res.status})`));
  return data;
}
