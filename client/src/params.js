// Pure helpers for the Replicate catalog's JSON-Schema vocabulary.
// Mirrors public/index.html paramType / orderOf / defaultsFor / buildInput.
// Schema shape: { type, properties: { name: spec }, required: [] }.
// Spec shape: { type ('string'|'integer'|'number'|'boolean'|'array'), title,
//   description, default, enum[], minimum/maximum, format/'x-format',
//   items: { format, type }, 'x-order' }.

// LoRA/weight URLs must NEVER render as image upload zones (a data-URI'd
// multi-hundred-MB .safetensors would hang the tab) — always URL text inputs.
// (*_scale numeric fields are excluded — they render as plain numbers.)
//
// Numeric params are excluded too, and that is not cosmetic: `guidance_weight`,
// `style_weight`, `audio_weight` and `ip_adapter_weight` all contain "weight"
// and would otherwise fall through to the generic text box at the bottom of
// ParamForm, rendering a 0-7.5 guidance slider as a free-text field.
export function getParamType(name, spec = {}) {
  const n = String(name || '').toLowerCase();
  const t = String(spec?.type || '').toLowerCase();
  if (t !== 'number' && t !== 'integer' && t !== 'boolean' && (n.includes('lora') || n.includes('weight')) && !n.includes('scale')) return 'lora_url';
  if (spec.format === 'uri' || spec['x-format'] === 'uri' || name === 'image' || name === 'mask' || name === 'image_url') return 'image';
  if (name === 'last_image') return 'image';
  if (spec.type === 'array' && spec.items?.format === 'uri') return 'image_array';
  if (name === 'images_list' || (name.includes('image') && spec.type === 'array')) return 'image_array';
  if (spec.enum && spec.enum.length > 0) return 'select';
  if (spec.type === 'integer' && spec.minimum !== undefined && spec.maximum !== undefined) return 'range';
  if (spec.type === 'number' && spec.minimum !== undefined && spec.maximum !== undefined) return 'range';
  if (isScaleParam(name, spec)) return 'range';
  if (spec.type === 'integer' || spec.type === 'number') return 'number';
  if (spec.type === 'boolean') return 'boolean';
  return 'string';
}

/* LoRA strength fallback bounds. A numeric scale/strength param whose schema
   declares no bounds at all (qwen/qwen-image lora_scale, wan lora_strength_*)
   would otherwise render as a typeless number box. Schema bounds always win;
   the 0-2/step-0.05 fallback mirrors the {path, scale} convention and
   completed-run evidence (0.85-2.95 observed, default 1). */
export function isScaleParam(name, spec = {}) {
  const t = String(spec?.type || '').toLowerCase();
  if (t !== 'number' && t !== 'integer') return false;
  const n = String(name || '').toLowerCase();
  return /lora|adapter/.test(n) && /scale|strength/.test(n);
}

/* Bounds for a range control: schema minimum/maximum first, scale fallback
   when the schema is silent. Returns null when there is nothing to slide
   between. */
export function sliderBounds(name, spec = {}) {
  const lo = spec.min ?? spec.minimum;
  const hi = spec.max ?? spec.maximum;
  if (lo !== undefined && hi !== undefined && Number(hi) > Number(lo)) {
    return { min: Number(lo), max: Number(hi), step: rangeStep(spec) };
  }
  if (isScaleParam(name, spec)) return { min: 0, max: 2, step: 0.05 };
  return null;
}

/* Fine step for bounded numbers that declare none: integers stay whole,
   fractional ranges get ~100 detents on a 1/2/5 scale. A schema step always
   wins (lora_scale -1..3 was previously snapping to whole numbers). */
export function rangeStep(spec = {}) {
  if (spec.step !== undefined && spec.step !== null) return spec.step;
  const t = String(spec?.type || '').toLowerCase();
  if (t === 'integer') return 1;
  const lo = Number(spec.min ?? spec.minimum);
  const hi = Number(spec.max ?? spec.maximum);
  if (!(hi > lo) || !isFinite(hi - lo)) return 1;
  const raw = (hi - lo) / 100;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
}

/* An adapter INPUT carries weights; an adapter STRENGTH does not. The two are
   told apart by TYPE first, because the names collide:
     lora_weights  (string) -> a path/URL to load. This IS an adapter input.
     lora_scale    (number) -> how hard to apply it. This is NOT.
     lora_strength (number) -> ditto. This is NOT.
   The previous name-only veto (/scale|strength|weight|multiplier/ before the
   lora test) therefore rejected the single most common Replicate adapter
   input there is: 26 live models declare `lora_weights` as a string and were
   being rendered as an unvalidated plain text box while the Composer told the
   user "This model has no adapter parameter". It also accepted
   `fofr/face-to-sticker`, whose only "adapter" params are the numeric
   `ip_adapter_noise` / `ip_adapter_weight`. Type first, name second.
   lib/models.ts imports this function rather than keeping a second copy. */
export function isLoraParam(name, spec = {}) {
  const n = String(name || '').toLowerCase();
  const t = String(spec?.type || '').toLowerCase();
  // A number or a switch is a magnitude or a flag, never a weights path.
  if (t === 'number' || t === 'integer' || t === 'boolean') return false;
  if (n === 'extra_lora' || n === 'extra_lora_weights' || /(^|_)replicate_weights$/.test(n)) return true;
  if (/lora_weights|_lora_url$/.test(n)) return true;
  if (/scale|strength|weight|multiplier/.test(n)) return false;
  if (/lora|loras|adapter/.test(n)) return true;
  // An array of adapter objects: `lora_list` items carry a `$ref` to LoraItem.
  // Scoped to lora-named refs so unrelated object arrays (ModelItem, Shot,
  // DialogueTurn, GeminiTTSSpeaker) stop reading as adapters.
  if (t === 'array') {
    const items = JSON.stringify(spec?.items ?? {});
    if (/\$ref/i.test(items) && /lora/i.test(items)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------
   Tier B — the UNVERIFIED adapter slot.

   A model whose published schema declares no adapter parameter cannot be
   shown a verified LoRA field, because submitting `extra_lora` to it is a
   guess Replicate will reject. Some architectures may well support one (see
   TIER_B_FAMILIES in lib/models.ts).

   So Tier B gets an input that is OFF by default and only reaches the payload
   when the user explicitly opts in. `tierBLoraPayload` is the single place
   that decision is made, which is what makes it testable without a browser.
   ------------------------------------------------------------------ */
export const TIER_B_LORA_PARAM = 'extra_lora';

/** `{}` unless the user ticked the opt-in AND typed something. */
export function tierBLoraPayload({ optIn, token } = {}) {
  const t = String(token ?? '').trim();
  return optIn && t ? { [TIER_B_LORA_PARAM]: t } : {};
}

export function loraHintText() {
  return 'Verified against live runs on d33pstatetech-stack/aznten_replicate:\n  WORKS  a direct https://...safetensors URL\n  WORKS  a Replicate owner/name or a training .tar\n  FAILS  a HuggingFace owner/repo - Replicate tries to fetch it from\n         replicate.com/OWNER/NAME instead and the tarball download fails\n  FAILS  civitai.com/... on these endpoints\n  huggingface.co/owner/repo without https:// is also rejected\n  Array fields take one entry per line\n  Never upload a .safetensors file here - paste a URL';
}

export function sizeHintText() {
  return 'Format is width*height (e.g. 1024*1024)\nLimits vary by model — width/height fields show their own min/max where the schema defines them';
}

export function loraTokenIssues(tok) {
  const t = String(tok || '').trim();
  if (!t) return null;
  if (/^civitai:\d+(@\d+)?$/i.test(t)) return null;
  if (/^https?:\/\//i.test(t)) {
    if (/civitai\.com/i.test(t)) return null;
    if (!/\.safetensors(\?|#|$)/i.test(t) && !/\.tar(\?|#|$)/i.test(t)) return 'URL should point to a .safetensors file (or LoRA training .tar)';
    return null;
  }
  if (/^huggingface\.co\//i.test(t) || /^civitai\.com\//i.test(t)) return 'Add the https:// scheme — bare domains are misread';
  if (/^[^/\s]+\/[^/\s]+$/.test(t)) return null; // owner/repo (HF short, CivitAI, or Replicate) is valid here
  return 'Use huggingface.co/owner/repo, a full https://….safetensors URL, or owner/name';
}

export function loraSlotCount(spec = {}) {
  const m = /max\s*(\d+)/i.exec(spec.description || '');
  const n = m ? parseInt(m[1], 10) : 3;
  return Math.min(Math.max(n || 3, 1), 5);
}

export function prettyLabel(name, spec = {}) {
  return spec.title || String(name).replace(/_/g, ' ');
}

function orderOf(spec = {}) {
  return spec['x-order'] ?? spec['x_order'] ?? 99;
}

// Sort: schema x-order first, then required, then images → selects → numbers → booleans → strings.
export function sortParamEntries(entries, required = []) {
  const order = { image: 0, image_array: 0, lora_url: 1, select: 2, range: 3, number: 3, boolean: 4, string: 5 };
  const req = new Set(required);
  return [...entries].sort(([aName, aSpec], [bName, bSpec]) => {
    const ao = orderOf(aSpec);
    const bo = orderOf(bSpec);
    if (ao !== bo) return ao - bo;
    if (req.has(aName) && !req.has(bName)) return -1;
    if (!req.has(aName) && req.has(bName)) return 1;
    const aOrd = order[getParamType(aName, aSpec)] ?? 6;
    const bOrd = order[getParamType(bName, bSpec)] ?? 6;
    return aOrd - bOrd || aName.localeCompare(bName);
  });
}

// Normalize LoRA-ish values for submit: strings/objects → [{path, scale}].
export function normalizeLoraValue(v) {
  const fix = (u) => {
    let s = String(u ?? '').trim();
    if (/^huggingface\.co\//i.test(s)) s = 'https://' + s;
    return s;
  };
  let arr;
  if (Array.isArray(v)) arr = v;
  else {
    const t = String(v ?? '').trim();
    if (!t) return undefined;
    let j = null;
    if (/^[[{]/.test(t)) {
      try {
        j = JSON.parse(t);
      } catch {
        /* fall through to split */
      }
    }
    arr = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : t.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  }
  const norm = arr
    .map((el) =>
      el && typeof el === 'object'
        ? { path: fix(el.path || el.url || ''), scale: typeof el.scale === 'number' ? el.scale : 1 }
        : { path: fix(el), scale: 1 }
    )
    .filter((o) => o.path);
  return norm.length ? norm : undefined;
}

// Build the Replicate `input` object: { prompt, ...values }, mirroring
// public/index.html buildInput() — strip empties, coerce per schema
// (integer/number/boolean, string arrays split on newlines/commas with
// numeric-item support), default disable_safety_checker to true when present.
export function buildSubmitParams(prompt, values, schema) {
  const params = { prompt, ...values };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete params[k];
  }
  if (schema?.properties?.disable_safety_checker !== undefined && params.disable_safety_checker === undefined) {
    params.disable_safety_checker = true;
  }
  if (schema?.properties) {
    for (const [k, spec] of Object.entries(schema.properties)) {
      if (params[k] === undefined) continue;
      // Snap a hand-typed value onto the schema's enum, case-insensitively.
      // Replicate rejects "Jpg" for an enum of ["webp","jpg","png"], and a
      // dropdown makes the mistake impossible — but enum-less params and
      // pasted values still reach here, so normalise rather than trust.
      if (Array.isArray(spec.enum) && spec.enum.length) {
        const want = spec.enum.find((e) => String(e) === params[k]);
        if (want === undefined) {
          const hit = spec.enum.find((e) => String(e).toLowerCase() === String(params[k]).trim().toLowerCase());
          if (hit !== undefined) params[k] = hit;
        }
      }
      if (spec.type === 'integer') {
        const n = parseInt(params[k], 10);
        if (!Number.isNaN(n)) params[k] = n;
      } else if (spec.type === 'number') {
        const n = Number(params[k]);
        if (!Number.isNaN(n)) params[k] = n;
      } else if (spec.type === 'boolean') {
        params[k] = params[k] === true || params[k] === 'true' || params[k] === 1;
      } else if (spec.type === 'array' && typeof params[k] === 'string') {
        const arr = params[k].split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        if (spec.items?.type === 'number') {
          const nums = arr.map(Number);
          if (nums.length && nums.every((n) => !Number.isNaN(n))) params[k] = nums;
          else delete params[k];
        } else if (arr.length) params[k] = arr;
        else delete params[k];
      }
    }
  }
  for (const k of ['lora_list', 'loras']) {
    if (params[k] === undefined) continue;
    const norm = normalizeLoraValue(params[k]);
    if (norm) params[k] = norm;
    else delete params[k];
  }
  // lora_scales must match the number of lora_weights: trim extras so a
  // removed weight can never fail the run with a length mismatch.
  if (Array.isArray(params.lora_scales)) {
    const w = params.lora_weights;
    const weights = Array.isArray(w) ? w : String(w ?? '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (weights.length > 0 && params.lora_scales.length > weights.length) {
      params.lora_scales = params.lora_scales.slice(0, weights.length);
    }
  }
  return params;
}
