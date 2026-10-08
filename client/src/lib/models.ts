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
import { isLoraParam } from '../params';
import { getSchema as getBundledSchema } from '../models';
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

/**
 * Adapter params declared by the BUNDLED schema in client/src/models.js.
 *
 * The harvested D1 schema is preferred for everything, so a bundled adapter
 * param can be dropped the moment a D1 row exists for that model. The gate
 * runs on whatever `params` it is handed, so a dropped param silently
 * disappears: no LoRA field, and the Composer says "This model has no adapter
 * parameter." That is the regression the user reported — a model that used to
 * expose a LoRA input and no longer does.
 *
 * Measured 2026-10-08 against the live `replicate-orchestrator` D1: for all
 * seven bundled models that declare an adapter param, D1 declares the same one
 * (aznten x2 -> extra_lora + replicate_weights, qwen/qwen-image -> lora_weights
 * + replicate_weights + extra_lora_weights, wavespeedai wan-2.1 x3 ->
 * lora_weights, wan-video/wan2.1-with-lora -> lora_url). The harvest is a
 * superset, so this restores 0 models TODAY and is defence against the next
 * harvest that is not. Keep it: the alternative is a silent, data-dependent
 * regression with no test to catch it.
 */
export function bundledAdapterParams(modelId: string): Record<string, ParamSpec> {
  const bundled = getBundledSchema(modelId);
  const props = (bundled as any)?.properties;
  if (!props) return {};
  const out: Record<string, ParamSpec> = {};
  for (const [name, spec] of Object.entries<any>(props)) {
    if (isLoraParam(name, spec)) out[name] = spec as ParamSpec;
  }
  return out;
}

/**
 * The schema the form should render: D1 wins on every conflict, bundled
 * adapter params are added back only where D1 has no such key.
 *
 * Non-adapter bundled params are deliberately NOT merged. `minimax/h3` is the
 * one bundled model with no D1 schema row at all, so its hand-written
 * H3_SCHEMA is unreachable through lib/api.ts's fallback (that fallback reads
 * `row.schema`, and the D1 `models` table has no schema column) — a real gap,
 * but restoring invented param names for a harvested catalogue is a bigger
 * change than this issue. Flagged for a second look rather than done quietly.
 */
export function mergeBundledAdapterParams(modelId: string, schema: ModelSchema): ModelSchema {
  const extra = bundledAdapterParams(modelId);
  const names = Object.keys(extra);
  if (!names.length) return schema;
  const missing = names.filter((n) => !(n in schema.params));
  if (!missing.length) return schema;
  const params = { ...schema.params };
  for (const n of missing) params[n] = extra[n];
  return { ...schema, params };
}

/** Tier A: true when the model's own schema declares an adapter slot. */
export function applySchema(model: Model, schema: ModelSchema | null): Model {
  if (!schema) return model;
  const merged = mergeBundledAdapterParams(model.id, schema);
  const hasLora = Object.entries(merged.params).some(([name, spec]) => isLoraParam(name, spec as any));
  return { ...model, loraCapable: hasLora };
}

/* ------------------------------------------------------------------
   Tier A / Tier B — how much LoRA support a model actually has.

   Tier A  the provider's own schema declares an adapter param. Verified.
   Tier B  no adapter param in the schema, but the architecture is one this
           catalogue is known to serve adapters for. UNVERIFIED, opt-in only.
   none   no evidence at all. No LoRA UI.

   TIER_B_FAMILIES keys off lora-compat modelFamily(), the same ladder the rest
   of the app already uses. Membership rule, applied to live D1 on 2026-10-08
   (1098 models / 1087 schemas): a family qualifies when at least one of its
   models BOTH declares an adapter param AND does not have "lora" in its own id
   — i.e. proof that the BASE model of that architecture accepts adapters, not
   merely that a separate `-lora` sibling exists.

   Replicate is the only provider of the three where that proof exists:

     black-forest-labs/flux-fill-dev            lora_weights  (base, not -lora)
     black-forest-labs/flux-2-klein-4b-base-lora lora_weights
     prunaai/p-image                            lora_weights
     qwen/qwen-edit-multiangle                  lora_weights
     fermatresearch/magic-style-transfer        lora_weights

   Tier B candidates per family (family has >=1 base-model Tier A member):

     FLUX.1      44    flux-schnell, flux-dev, sdxl-lightning-4step, … 107 base A
     Qwen-Image  17    qwen edit/plus variants                         16 base A
     Wan (other) 16    wan-2.7 / wan-3.0                               1 base A
     FLUX.2       8    flux-2 klein/pro/flex variants                  2 base A
     Wan 2.1      2    wan-2.1 t2v/i2v base                            4 base A
                  --
                  87

   Excluded: Wan 2.2 and Krea, which have 0 adapter models in this catalogue
   despite Wan 2.2 being provably LoRA-capable on WaveSpeed — cross-provider
   inference is exactly the "likely" that must not ship silently.

   87 of them WILL be rejected by the provider: `black-forest-labs/flux-schnell`
   has no adapter param precisely because Replicate ships `flux-schnell-lora`
   separately. That is the honest state of the evidence, and it is why the slot
   is off by default and says so.
   ------------------------------------------------------------------ */
const TIER_B_FAMILIES: ReadonlySet<string> = new Set<string>([
  'FLUX.1',
  'FLUX.2',
  'Qwen-Image',
  'Wan 2.1',
  'Wan (other)',
]);

export type LoraTier = 'A' | 'B' | null;

/** What the UI needs to render an unverified adapter slot, or null. */
export interface TierBLora {
  family: string;
  reason: string;
}

/**
 * Tier B eligibility: a family on the allow-list, no adapter param in this
 * model's own (D1 + bundled-merged) schema, and not a trainer.
 */
export function tierBLoraFor(model: Model | null, schema: ModelSchema | null): TierBLora | null {
  if (!model || !schema) return null;
  const merged = mergeBundledAdapterParams(model.id, schema);
  if (Object.entries(merged.params).some(([n, s]) => isLoraParam(n, s as any))) return null;
  if (/train/i.test(model.id)) return null;
  const family = model.baseFamily || modelFamily(model._row) || '';
  if (!TIER_B_FAMILIES.has(family)) return null;
  return {
    family,
    reason: `${family} models in this catalogue accept adapters on some checkpoints, but ${model.name} declares no adapter parameter of its own.`,
  };
}

/**
 * Combined verdict, for the one line of copy the Composer shows.
 *
 * Derived from the MERGED schema rather than from `model.loraCapable`, so it
 * cannot disagree with `tierBLoraFor` about the same model — and so a model
 * whose adapter only exists in the bundled catalogue is reported as Tier A
 * rather than falling through to Tier B.
 */
export function loraTier(model: Model | null, schema: ModelSchema | null): LoraTier {
  if (!model || !schema) return null;
  if (Object.entries(mergeBundledAdapterParams(model.id, schema).params).some(([n, s]) => isLoraParam(n, s as any))) return 'A';
  return tierBLoraFor(model, schema) ? 'B' : null;
}

/** The adapter params this model's schema declares, D1 + bundled restore. */
export function adapterParams(schema: ModelSchema | null, modelId = ''): string[] {
  if (!schema) return [];
  const merged = modelId ? mergeBundledAdapterParams(modelId, schema) : schema;
  return Object.entries(merged.params)
    .filter(([name, spec]) => isLoraParam(name, spec as any))
    .map(([name]) => name);
}

export type Stats = Map<string, { runs: number; rating: number | null }>;