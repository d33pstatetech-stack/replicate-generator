// Pure helpers for the Replicate catalog's JSON-Schema vocabulary.
// Mirrors public/index.html paramType / orderOf / defaultsFor / buildInput.
// Schema shape: { type, properties: { name: spec }, required: [] }.
// Spec shape: { type ('string'|'integer'|'number'|'boolean'|'array'), title,
//   description, default, enum[], minimum/maximum, format/'x-format',
//   items: { format, type }, 'x-order' }.

// LoRA/weight URLs must NEVER render as image upload zones (a data-URI'd
// multi-hundred-MB .safetensors would hang the tab) — always URL text inputs.
// (*_scale numeric fields are excluded — they render as plain numbers.)
export function getParamType(name, spec = {}) {
  const n = String(name || '').toLowerCase();
  if ((n.includes('lora') || n.includes('weight')) && !n.includes('scale')) return 'lora_url';
  if (spec.format === 'uri' || spec['x-format'] === 'uri' || name === 'image' || name === 'mask' || name === 'image_url') return 'image';
  if (name === 'last_image') return 'image';
  if (spec.type === 'array' && spec.items?.format === 'uri') return 'image_array';
  if (name === 'images_list' || (name.includes('image') && spec.type === 'array')) return 'image_array';
  if (spec.enum && spec.enum.length > 0) return 'select';
  if (spec.type === 'integer' && spec.minimum !== undefined && spec.maximum !== undefined) return 'range';
  if (spec.type === 'number' && spec.minimum !== undefined && spec.maximum !== undefined) return 'range';
  if (spec.type === 'integer' || spec.type === 'number') return 'number';
  if (spec.type === 'boolean') return 'boolean';
  return 'string';
}

export function isLoraParam(name, spec = {}) {
  const n = String(name || '').toLowerCase();
  if (n === 'extra_lora' || n === 'extra_lora_weights' || /(^|_)replicate_weights$/.test(n)) return true;
  if (/scale|strength|weight|multiplier/.test(n)) return false;
  if (/lora|loras|adapter/.test(n)) return true;
  return false;
}

export function loraHintText() {
  return 'LoRA formats: huggingface.co/owner/repo, direct ….safetensors URL, civitai.com/…, Replicate owner/name, or training .tar. Arrays take one per line. Never upload a .safetensors file here.';
}

export function sizeHintText() {
  return 'Format: width*height (e.g. 1024*1024). Limits vary by model — width/height fields show their own min/max where the schema defines them.';
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
  return params;
}
