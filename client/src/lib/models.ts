/**
 * Catalogue mapper for the Replicate app.
 *
 * Replicate is structurally different from the MuAPI and WaveSpeed apps: its
 * Worker has no model table and no /api/models route. The catalogue is a static
 * list in client/src/models.js, extracted from the legacy page, and the Worker
 * treats modelId as opaque. So this mapper adapts a real, hand-curated source
 * rather than reading D1 — the data is genuine, it just does not come from a
 * database.
 *
 * Two mockup fields have no honest source here and are handled accordingly:
 *   cost         Replicate does not expose per-model pricing, so every cost is
 *                0 and the UI labels those models "Free" rather than inventing
 *                a price.
 *   loraCapable  Filled by applySchema() once the real Replicate input schema
 *                loads, because that schema genuinely declares the adapter
 *                parameters.
 */
import { modelFamily, modelIsVideo } from '../lora-compat';
import type { Model, ModelSchema, ParamSpec } from './types';

export function toModel(entry: any, stats?: Stats): Model {
  const id = String(entry?.id || '');
  const s = stats?.get(id);
  // D1 rows carry a real run_count; the history table's model-stats adds the
  // user-facing rating. Prefer the local run count and fall back to stats so
  // the catalogue does not show zero for every model when history is empty.
  const runs = Number(entry?.run_count) || s?.runs || 0;
  return {
    id,
    name: entry?.name || id,
    family: entry?.family || entry?.category || '',
    category: entry?.category || '',
    group: normalizeGroup(entry),
    // Replicate does not publish per-model pricing. Kept at 0 and shown as
    // "Free"; a made-up figure would be worse than an honest blank.
    cost: Number(entry?.cost) || 0,
    dynamicPricing: false,
    runs,
    rating: s?.rating ?? null,
    summary: entry?.description || '',
    loraCapable: false,
    baseFamily: modelFamily(entry) || '',
    _row: entry,
  };
}

const GROUP_RULES: [RegExp, Model['group']][] = [
  [/3d|three[-_ ]?d|mesh|voxel/i, '3d'],
  [/video|animate|motion|t2v|i2v|v2v|avatar|lip[-_ ]?sync|talking|face[-_ ]?dance/i, 'video'],
  [/audio|speech|voice|sound|music|song|tts|stt|sing|sfx|transcri/i, 'audio'],
  [/image|picture|photo|draw|paint|illustrat|upscal|restor|enhanc|background|remove|edit|face|inpaint|logo|icon|render|thumbnail/i, 'image'],
  [/text|llm|chat|prompt|seo|translat|summar|classif|extract|ocr/i, 'text'],
];

export function normalizeGroup(entry: any): Model['group'] {
  // An explicit group from the harvest wins. It is derived from the Replicate
  // collections the model appears in, which beats a name regex: the regex
  // misfiled 67 of 1098 rows, including `wan-video/wan-2.7-image-pro` as image
  // purely because "image" appears in its name.
  const declared = entry?.group_of || entry?.group;
  if (declared === 'image' || declared === 'video' || declared === 'audio' || declared === '3d' || declared === 'text' || declared === 'other') {
    return declared;
  }
  // Legacy bundled-seed rows only carry `group`.
  const hay = [entry?.category, entry?.id, entry?.name].filter(Boolean).join(' ');
  for (const [re, g] of GROUP_RULES) if (re.test(hay)) return g;
  return modelIsVideo(entry) ? 'video' : 'image';
}

/** True when the model's own Replicate input schema declares an adapter slot. */
export function applySchema(model: Model, schema: ModelSchema | null): Model {
  if (!schema) return model;
  const hasLora = Object.entries(schema.params).some(([name, spec]) => isLoraParam(name, spec));
  return { ...model, loraCapable: hasLora };
}

function isLoraParam(name: string, spec: ParamSpec = {} as ParamSpec): boolean {
  const n = String(name || '').toLowerCase();
  if (n === 'extra_lora' || n === 'extra_lora_weights' || /(^|_)replicate_weights$/.test(n)) return true;
  if (/scale|strength|multiplier/.test(n)) return false;
  if (/lora|loras|adapter/.test(n)) return true;
  if (spec.type === 'array' && /\$ref/i.test(JSON.stringify(spec.items ?? {}))) return true;
  return false;
}

export type Stats = Map<string, { runs: number; rating: number | null }>;