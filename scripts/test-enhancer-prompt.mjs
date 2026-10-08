// Runtime tests for the enhancer prompt pipeline in an app worker.
//
// This exists because a rename left the function body referencing a `guide`
// identifier that no longer existed: `const guideBlock = ctx.guideBlock`
// followed by `if (guide)`. `node --check` passed — it only validates syntax,
// not undefined identifiers — so the breakage reached production and every
// enhance failed with "guide is not defined".
//
// Executing the function is the only check that catches it. Code is sliced out
// of src/worker.js and evaluated, so the tests always run the shipped source
// rather than a copy that can drift.
//
// Two slices are used deliberately:
//
//   1. NARROW  - buildEnhancerSystemPrompt alone, with every module-scope
//      identifier it closes over supplied as a `new Function` parameter. A new
//      helper read inside the function therefore fails here until it is listed,
//      which is the original regression guard.
//   2. BROAD   - the real templates plus the real modality classifier, refusal
//      guard and resolver, so the shipped constants and regexes are what get
//      asserted against rather than stubs.
//
// Usage: node scripts/test-enhancer-prompt.mjs <path-to-worker.js>

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/test-enhancer-prompt.mjs <worker.js>');
  process.exit(2);
}

const src = fs.readFileSync(file, 'utf8');
const repoRoot = path.resolve(path.dirname(file), '..');

function sliceBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) throw new Error(`not found: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  if (end === -1) throw new Error(`not found: ${endMarker}`);
  return text.slice(start, end);
}

let failed = 0;
function ok(name) {
  console.log(`ok   ${name}`);
}
function fail(name, problems) {
  console.error(`FAIL ${name}\n      ${problems.join('\n      ')}`);
  failed++;
}

/* ------------------------------------------------------------------ */
/* 1. NARROW slice: buildEnhancerSystemPrompt with stubbed dependencies */
/* ------------------------------------------------------------------ */

// Structurally faithful stand-ins: same placeholders, same "The <noun> will be
// generated at ..." sentence and same trailing [audio clause] line, so the
// narrowing/stripping assertions mean the same thing here as with the real
// templates.
const STUB_TEMPLATE_IMAGE = 'IMAGE_TEMPLATE for [Media Generation Type] via [Model]. The image will be generated at [resolution] and [aspect ratio] (only include if useful).\n[audio clause]';
const STUB_TEMPLATE_VIDEO = 'VIDEO_TEMPLATE for [Media Generation Type] via [Model]. The video will be generated at [resolution] and [aspect ratio] (only include if useful).\n[audio clause]';
const MODEL_PRESETS = {
  default: 'PRESET_DEFAULT',
  seedance: 'PRESET_SEEDANCE',
  wan: 'PRESET_WAN',
  minimax: 'PRESET_MINIMAX',
  kling: 'PRESET_KLING',
};

const narrowSrc =
  sliceBlock(src, 'function buildEnhancerSystemPrompt', '\nasync function getPromptGuide') + '\nreturn buildEnhancerSystemPrompt;';

let build;
try {
  // eslint-disable-next-line no-new-func
  build = new Function(
    'ENHANCER_TEMPLATE_IMAGE',
    'ENHANCER_TEMPLATE_VIDEO',
    'isVideoMediaType',
    'MODEL_PRESETS',
    'hasDialogueCues',
    narrowSrc,
  )(STUB_TEMPLATE_IMAGE, STUB_TEMPLATE_VIDEO, (mt) => /video/i.test(String(mt || '')), MODEL_PRESETS, () => true);
} catch (e) {
  console.error(`FAIL could not evaluate buildEnhancerSystemPrompt: ${e.message}`);
  process.exit(1);
}

const base = { model: 'x', mediaType: 'text-to-image', aspectRatio: '1:1', resolution: null, duration: null, hasAudio: true };

const narrowCases = [
  {
    name: 'guide present injects block and suppresses the legacy preset',
    ctx: { ...base, guideBlock: 'GUIDE_TEXT_123' },
    expectContains: ['GUIDE_TEXT_123'],
    expectAbsent: ['PRESET_DEFAULT', 'undefined', '[object Object]'],
  },
  {
    name: 'no guide falls back to MODEL_PRESETS',
    ctx: { ...base, guideBlock: null },
    expectContains: ['PRESET_DEFAULT'],
    expectAbsent: ['GUIDE_TEXT_123', 'undefined', '[object Object]'],
  },
  {
    name: 'no guide + wan selects the wan preset',
    ctx: { ...base, model: 'wan2.6-image-to-video', mediaType: 'image-to-video', guideBlock: null },
    expectContains: ['PRESET_WAN'],
    expectAbsent: ['undefined'],
  },
  {
    name: 'no guide + seedance selects the seedance preset',
    ctx: { ...base, model: 'seedance-2.5-t2v', mediaType: 'text-to-video', guideBlock: null },
    expectContains: ['PRESET_SEEDANCE'],
    expectAbsent: ['undefined'],
  },
  {
    name: 'undefined guideBlock behaves as no guide',
    ctx: { ...base, guideBlock: undefined },
    expectContains: ['PRESET_DEFAULT'],
    expectAbsent: ['GUIDE_TEXT_123', 'undefined'],
  },
  {
    name: 'empty-string guideBlock behaves as no guide',
    ctx: { ...base, guideBlock: '' },
    expectContains: ['PRESET_DEFAULT'],
    expectAbsent: ['GUIDE_TEXT_123'],
  },
  {
    name: 'image mediaType selects the image template, video selects the video template',
    ctx: { ...base, mediaType: 'text-to-image', guideBlock: null },
    expectContains: ['IMAGE_TEMPLATE'],
    expectAbsent: ['VIDEO_TEMPLATE'],
  },
  {
    name: 'video mediaType selects the video template',
    ctx: { ...base, mediaType: 'text-to-video', guideBlock: null },
    expectContains: ['VIDEO_TEMPLATE'],
    expectAbsent: ['IMAGE_TEMPLATE'],
  },
  {
    name: 'no resolution drops the whole sentence in both templates',
    ctx: { ...base, resolution: null, aspectRatio: null, guideBlock: null },
    expectAbsent: ['[resolution] and [aspect ratio]', 'generated at  and'],
  },
  {
    name: 'audio clause removed when hasAudio is false',
    ctx: { ...base, hasAudio: false, guideBlock: null },
    expectAbsent: ['[audio clause]'],
  },
  {
    name: 'duration is only appended for video',
    ctx: { ...base, mediaType: 'text-to-image', duration: 8, guideBlock: null },
    expectAbsent: ['Video length: 8 seconds'],
  },
];

for (const c of narrowCases) {
  let out;
  try {
    out = build('a cat', c.ctx);
  } catch (e) {
    fail(c.name, [`threw: ${e.message}`]);
    continue;
  }
  const problems = [];
  for (const needle of c.expectContains || []) {
    if (!out.includes(needle)) problems.push(`missing ${JSON.stringify(needle)}`);
  }
  for (const needle of c.expectAbsent || []) {
    if (out.includes(needle)) problems.push(`unexpectedly contains ${JSON.stringify(needle)}`);
  }
  if (problems.length) fail(c.name, problems);
  else ok(c.name);
}

// The specific regression: a bare undefined identifier must throw loudly here
// rather than silently in production.
let threw = null;
try {
  build('a cat', { ...base, guideBlock: 'X' });
} catch (e) {
  threw = e;
}
if (threw) fail('guide path threw', [threw.message]);
else ok('guide path does not throw');

/* ------------------------------------------------------------------ */
/* 2. BROAD slice: real templates, real classifier, real refusal guard  */
/* ------------------------------------------------------------------ */

// From ENHANCER_TEMPLATE_IMAGE up to (not including) getPromptGuide. This
// carries the two templates, hasDialogueCues, isVideoMediaType, the whole
// modality ladder, the request-modality resolver, the refusal guard,
// deriveTechniques and buildEnhancerSystemPrompt. MODEL_PRESETS is the only
// module-scope constant outside the slice.
const broadSrc =
  sliceBlock(src, 'const ENHANCER_TEMPLATE_IMAGE', '\nasync function getPromptGuide') +
  '\nreturn { buildEnhancerSystemPrompt, deriveMediaTypeWorker, deriveModalityWorker, resolveEnhanceModalityWorker, normalizeRequestedModality, enhancementRejectReason, isVideoMediaType, ENHANCER_TEMPLATE_IMAGE, ENHANCER_TEMPLATE_VIDEO };';

let real;
try {
  // eslint-disable-next-line no-new-func
  real = new Function('MODEL_PRESETS', broadSrc)(MODEL_PRESETS);
} catch (e) {
  console.error(`FAIL could not evaluate the real enhancer block: ${e.message}`);
  process.exit(1);
}

const {
  buildEnhancerSystemPrompt: realBuild,
  deriveMediaTypeWorker,
  deriveModalityWorker,
  resolveEnhanceModalityWorker,
  normalizeRequestedModality,
  enhancementRejectReason,
} = real;

/* --- modality derivation from representative catalogue rows --- */
const modalityCases = [
  // group_of present (D1 harvested catalogue) — authoritative
  ['flux-dev group_of=image', { id: 'black-forest-labs/flux-dev', group_of: 'image', category: 'Text to Image' }, 'image', 'text-to-image'],
  ['sdxl group_of=image', { id: 'stability-ai/sdxl', group_of: 'image', category: 'Text to Image' }, 'image', 'text-to-image'],
  ['wan t2v group_of=video', { id: 'wan-video/wan-2.2-t2v-fast', group_of: 'video', category: 'Text to Video' }, 'video', 'text-to-video'],
  ['seedance group_of=video', { id: 'bytedance/seedance-2-5-t2v', group_of: 'video', category: '' }, 'video', 'text-to-video'],
  ['i2v group_of=video', { id: 'wan-video/wan-2.2-i2v-fast', group_of: 'video', category: 'Image to Video' }, 'video', 'image-to-video'],
  // The misfiling the old regex ladder produced: owner is "wan-video" but the
  // model is an image one. group_of settles it.
  ['wan-2.7-image-pro group_of=image', { id: 'wan-video/wan-2.7-image-pro', group_of: 'image', category: 'Text to Image' }, 'image', 'text-to-image'],
  ['flux-kontext group_of=image', { id: 'black-forest-labs/flux-kontext-pro', group_of: 'image', category: 'Image to Image' }, 'image', 'image-to-image'],
  ['audio group_of=audio', { id: 'some/tts-model', group_of: 'audio', category: 'Text to Speech' }, 'audio', 'audio-generation'],
  // No group_of: category then id ladder
  ['no group_of, category Image to Video', { id: 'mystery/model-1', category: 'Image to Video' }, 'video', 'image-to-video'],
  ['no group_of, category Text to Image', { id: 'mystery/model-2', category: 'Text to Image' }, 'image', 'text-to-image'],
  ['no group_of, id says video', { id: 'some-owner/kling-v2-master', category: '' }, 'video', 'text-to-video'],
  ['no group_of, id says image', { id: 'recraft/recraft-v3', category: '' }, 'image', 'text-to-image'],
  // Unknown everything: the conservative fallback must be image, never video
  ['unknown model falls back to image', { id: 'acme/thing-9000', category: '' }, 'image', 'text-to-image'],
  ['missing model falls back to image', null, 'image', 'text-to-image'],
];

for (const [name, model, wantModality, wantFlow] of modalityCases) {
  const gotMod = deriveModalityWorker(model);
  const gotFlow = deriveMediaTypeWorker(model);
  const problems = [];
  if (gotMod !== wantModality) problems.push(`modality ${gotMod} != ${wantModality}`);
  if (gotFlow !== wantFlow) problems.push(`mediaType ${gotFlow} != ${wantFlow}`);
  if (problems.length) fail(`derive: ${name}`, problems);
  else ok(`derive: ${name}`);
}

/* --- explicit body.modality wins over the derivation --- */
const overrideCases = [
  ['image override beats a video row', { id: 'wan-video/wan-2.2-t2v-fast', group_of: 'video' }, 'image', 'image', 'text-to-image'],
  ['video override beats an image row', { id: 'black-forest-labs/flux-dev', group_of: 'image' }, 'video', 'video', 'text-to-video'],
  ['absent falls back to the derivation', { id: 'black-forest-labs/flux-dev', group_of: 'image' }, undefined, 'image', 'text-to-image'],
  ['garbage is ignored, derivation stands', { id: 'wan-video/wan-2.2-t2v-fast', group_of: 'video' }, 'audio-gen', 'video', 'text-to-video'],
];
for (const [name, model, requested, wantModality, wantFlow] of overrideCases) {
  const got = resolveEnhanceModalityWorker(model, requested);
  const problems = [];
  if (got.modality !== wantModality) problems.push(`modality ${got.modality} != ${wantModality}`);
  if (got.mediaType !== wantFlow) problems.push(`mediaType ${got.mediaType} != ${wantFlow}`);
  if (problems.length) fail(`override: ${name}`, problems);
  else ok(`override: ${name}`);
}
{
  const problems = [];
  if (normalizeRequestedModality('IMAGE') !== 'image') problems.push('uppercase IMAGE should normalise');
  if (normalizeRequestedModality('') !== null) problems.push('empty should be null');
  if (normalizeRequestedModality(42) !== null) problems.push('number should be null');
  if (problems.length) fail('normalizeRequestedModality', problems);
  else ok('normalizeRequestedModality');
}

/* --- image template: no video vocabulary asked for --- */
{
  // An image model that a user gave a duration for: the old code appended
  // "Video length: 8 seconds" and asked for timestamps.
  const ctx = {
    model: 'black-forest-labs/flux-dev',
    mediaType: 'text-to-image',
    aspectRatio: '16:9',
    resolution: '1024x576',
    duration: 8,
    hasAudio: false,
    guideBlock: null,
  };
const out = realBuild('a lighthouse at dusk', ctx);
  // Guidance that only belongs in a video prompt. The literal strings "at 00:05"
  // and "0s-3s" DO appear in the image template — inside the prohibition that
  // forbids them — so they cannot be used as absence assertions; the video-only
  // asks below can.
  const banned = [
    'Video length:',
    'videographer jargon',
    'chase cam',
    'dolly out',
    'total length of the video',
    'sound effect cues',
    '[audio clause]',
    '[resolution]',
    '[Model]',
    'undefined',
  ];
  const required = [
    'STILL IMAGE',
    'Do NOT output timestamps',
    'Do NOT describe camera movement',
    'Do NOT reference duration',
    '1024x576 and 16:9',
  ];
  const problems = banned.filter((b) => out.includes(b));
  for (const r of required) if (!out.includes(r)) problems.push(`missing ${JSON.stringify(r)}`);
  if (problems.length) fail('image model prompt has no video vocabulary', problems);
  else ok('image model prompt has no video vocabulary');
}

/* --- video template: timestamp guidance retained --- */
{
  const ctx = {
    model: 'wan-video/wan-2.2-t2v-fast',
    mediaType: 'image-to-video',
    aspectRatio: '16:9',
    resolution: '720p',
    duration: 8,
    hasAudio: true,
    guideBlock: null,
  };
  const out = realBuild('a lighthouse at dusk', ctx);
  const problems = [];
  const required = [
    'at 00:05',
    'videographer jargon',
    'Video length: 8 seconds',
    'add timestamp directions accordingly',
    'sound effect cues',
    '720p and 16:9',
  ];
  for (const r of required) if (!out.includes(r)) problems.push(`missing ${JSON.stringify(r)}`);
  if (out.includes('STILL IMAGE')) problems.push('image template leaked into a video prompt');
  if (out.includes('[audio clause]')) problems.push('[audio clause] sentinel left in');
  if (problems.length) fail('video model prompt keeps timestamp guidance', problems);
  else ok('video model prompt keeps timestamp guidance');
}

/* --- image branch keeps audio false even for a wan-named image model --- */
{
  const ctx = {
    model: 'wan-video/wan-2.5-image-pro',
    mediaType: 'text-to-image',
    aspectRatio: null,
    resolution: null,
    duration: null,
    hasAudio: false,
    guideBlock: null,
  };
  const out = realBuild('a bowl of ramen', ctx);
  const problems = [];
  if (out.includes('sound effect cues')) problems.push('audio cue request present for a non-audio image model');
  if (out.includes('dialogue')) problems.push('dialogue formatting requested without dialogue cues');
  if (out.includes('The image will be generated at')) problems.push('resolution sentence not removed when no resolution is set');
  if (problems.length) fail('image model with no audio/resolution', problems);
  else ok('image model with no audio/resolution');
}

/* --- refusal guard --- */
/* Same shape as muapi/wavespeed: rejection reason, or null to persist. The
   old replicate guard returned a boolean and had a hard 400-character
   ceiling, so anything longer was accepted no matter how it opened. */
{
  const raw = 'a lone lighthouse on wet basalt at dusk, low clouds, cinematic wide shot';
  const REFUSAL_CASES = [
    ["I'm sorry, but I can't help with that request.", 'refusal'],
    ['I cannot create content of this nature. As an AI, I have to decline.', 'refusal'],
    ["I won't be able to assist with this prompt.", 'refusal'],
    // Comma form: 'sorry, but' is a listed opener. The em-dash form
    // ("Sorry - that violates ...") is NOT caught by the unified guard - see the
    // documented narrowing at the bottom of this block.
    ['Sorry, but that violates my content guidelines and I must decline.', 'refusal'],
    // S2 regression: the 400-char ceiling meant a refusal this long was stored
    // as a successful enhancement. 423 chars, opener inside the first 60.
    [
      "I'm sorry, but I can't help with that request, and I want to explain why at some length "
        + 'because the policy reasoning here is genuinely involved and the user is owed an '
        + 'explanation of the boundary rather than a bare error string. '.repeat(4),
      'refusal',
    ],
  ];
  for (const [text, expected] of REFUSAL_CASES) {
    const got = enhancementRejectReason(text, raw);
    if (got !== expected) fail(`refusal guard ${JSON.stringify(text.slice(0, 34))}`, [`got ${got}, want ${expected}`]);
    else ok(`refusal guard ${JSON.stringify(text.slice(0, 34))} -> ${expected}`);
  }
  const KEEP_CASES = [
    'a lone lighthouse on wet basalt at dusk, low clouds, cinematic wide shot, anamorphic flare, muted teal grade, 35mm film grain',
    'neon-soaked Tokyo alley in the rain, reflections on asphalt, a woman in a red coat mid-step, backlit by vending machines, shallow depth of field',
    'sunset over a wheat field, painterly oil on canvas, thick visible brushstrokes, warm amber and violet palette, high horizon line',
    // Quotes an apology inside the image itself - the quote guard must survive it.
    'A sign reading "No trespassing" nailed to a warped fence, overcast morning, documentary photography, 24mm, muted greens',
    // A short raw prompt may legitimately refine to something short.
    'cat',
  ];
  for (const text of KEEP_CASES) {
    const got = enhancementRejectReason(text, 'cat');
    if (got !== null) fail(`keep ${JSON.stringify(text.slice(0, 34))}`, [`rejected as ${got}`]);
    else ok(`keep ${JSON.stringify(text.slice(0, 34))}`);
  }
  // No upper length cap: a long *legitimate* enhancement is never a refusal,
  // but a long *refusal* is (asserted above).
  const long = 'detailed scene description, '.repeat(60) + 'composition and lens, soft rim light';
  if (enhancementRejectReason(long, raw)) fail('a long legitimate prompt was flagged', []);
  else ok('a long legitimate prompt is not flagged (no upper length cap)');
  // Relative floor: a long raw prompt that comes back as a disclaimer is caught.
  const disclaimer = 'That request is disallowed. '.repeat(20);
  const ratio = enhancementRejectReason(disclaimer, 'x '.repeat(900));
  if (ratio !== 'too_short') fail('long refusal with no opener caught by ratio rule', [`got ${ratio}`]);
  else ok('long refusal with no opener is caught by the ratio rule');

  // DOCUMENTED NARROWING, asserted so it cannot drift silently.
  //
  // The pre-convergence replicate guard had a 200-char opener window and a meta
  // tier ("violates my content guidelines") gated at <=200 chars, so it caught
  // an em-dash opener whose decline phrase sits past char 60. The unified
  // muapi/wavespeed guard opens a 60-char window and lists 'sorry, but' (comma
  // required), so this variant is no longer caught by the opener rule.
  //
  // Kept as-is deliberately: converging on one guard shape is the fix, and
  // widening the window or re-adding the meta tier is what put ~20 real
  // finetunes in the wrong bucket over in S3. Tracked, not silently lost.
  const emDash = 'Sorry \u2014 that violates my content guidelines and I must decline.';
  const emDashVerdict = enhancementRejectReason(emDash, raw);
  if (emDashVerdict !== null) fail('documented narrowing changed shape', [`got ${emDashVerdict}`]);
  else ok('documented narrowing: em-dash "Sorry - that violates" opener is NOT caught (tracked)');
}

/* ------------------------------------------------------------------ */
/* 3. reasoning_content must never be merged into the prompt text       */
/* ------------------------------------------------------------------ */

// Source-level assertions over the three accumulation sites. A behavioural
// test would need the full request handler and a live upstream; what actually
// broke was a source-level `delta.content || delta.reasoning_content`, so the
// regression guard is the absence of that pattern.
const SITES = [
  ['src/worker.js', src],
  ['public/index.html', fs.existsSync(path.join(repoRoot, 'public', 'index.html')) ? fs.readFileSync(path.join(repoRoot, 'public', 'index.html'), 'utf8') : ''],
  ['client/src/api.js', fs.existsSync(path.join(repoRoot, 'client', 'src', 'api.js')) ? fs.readFileSync(path.join(repoRoot, 'client', 'src', 'api.js'), 'utf8') : ''],
];
const MERGE = /content\s*\|\|\s*[^;\n]*reasoning_content/g;
for (const [label, text] of SITES) {
  if (!text) {
    ok(`reasoning_content not merged: ${label} (absent)`);
    continue;
  }
  const hits = text.match(MERGE);
  if (hits && hits.length) fail(`reasoning_content not merged: ${label}`, hits.map((h) => `found ${JSON.stringify(h.trim())}`));
  else ok(`reasoning_content not merged: ${label}`);
}

/* ------------------------------------------------------------------ */
/* 4. provider list + key resolution                                     */
/* ------------------------------------------------------------------ */

// Sliced from DEFAULT_LLM_PROVIDERS down to (not including) MODEL_PRESETS,
// plus resolveProviderApiKey from its own definition.
const defaultsSrc =
  sliceBlock(src, 'const DEFAULT_LLM_PROVIDERS', '\nconst MODEL_PRESETS') +
  '\n' +
  sliceBlock(src, 'function resolveProviderApiKey', '\nasync function getLLMConfigWorker') +
  '\nreturn { DEFAULT_LLM_PROVIDERS, resolveProviderApiKey };';
let prov;
try {
  // eslint-disable-next-line no-new-func
  prov = new Function(defaultsSrc)();
} catch (e) {
  console.error(`FAIL could not evaluate the provider block: ${e.message}`);
  process.exit(1);
}
const { DEFAULT_LLM_PROVIDERS, resolveProviderApiKey } = prov;

{
  const problems = [];
  const first = DEFAULT_LLM_PROVIDERS[0];
  if (!/experientiallabs\.ai/.test(first.baseUrl)) problems.push(`chain does not start at explabs: ${first.baseUrl}`);
  if (!/EXPLABS/.test(first.apiKeyEnv || '')) problems.push(`explabs entry has no EXPLABS_* apiKeyEnv (got ${first.apiKeyEnv})`);
  for (const p of DEFAULT_LLM_PROVIDERS) {
    if (!p.apiKeyEnv) problems.push(`${p.model} has no apiKeyEnv — it would fall back to the venice URL sniff`);
  }
  if (problems.length) fail('DEFAULT_LLM_PROVIDERS shape', problems);
  else ok(`DEFAULT_LLM_PROVIDERS shape (${DEFAULT_LLM_PROVIDERS.length} entries, explabs first)`);
}

{
  const env = { EXPLABS_API_KEY: 'EXPLABS_SECRET', OPENROUTER_API_KEY: 'OR_SECRET', VENICE_API_KEY: 'VENICE_SECRET' };
  const keyCases = [
    // The landmine: a new host with no apiKeyEnv was authenticated with the
    // OpenRouter key by the old substring sniff.
    [{ baseUrl: 'https://api.experientiallabs.ai/v1', model: 'm' }, 'OR_SECRET', 'unknown host falls back to OpenRouter (legacy)'],
    [{ baseUrl: 'https://api.experientiallabs.ai/v1', apiKeyEnv: 'EXPLABS_API_KEY', model: 'm' }, 'EXPLABS_SECRET', 'apiKeyEnv selects the named secret'],
    [{ baseUrl: 'https://api.experientiallabs.ai/v1', apiKeyEnv: 'OPENROUTER_API_KEY', model: 'm' }, 'OR_SECRET', 'apiKeyEnv overrides the URL sniff'],
    [{ baseUrl: 'https://api.venice.ai/api/v1', model: 'm' }, 'VENICE_SECRET', 'venice URL still resolves its own key'],
    [{ baseUrl: 'https://api.venice.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', model: 'm' }, 'OR_SECRET', 'explicit apiKeyEnv beats the venice URL'],
    [{ baseUrl: 'https://api.experientiallabs.ai/v1', apiKeyEnv: 'EXPLABS_API_KEY', apiKey: 'stored', model: 'm' }, 'stored', 'a stored apiKey wins over the env secret'],
    // A configured-but-absent secret must not silently borrow another host's key.
    [{ baseUrl: 'https://api.experientiallabs.ai/v1', apiKeyEnv: 'MISSING_SECRET', model: 'm' }, '', 'missing named secret yields empty, not another host key'],
  ];
  for (const [entry, want, name] of keyCases) {
    const got = resolveProviderApiKey(entry, env);
    if (got !== want) fail(`resolveProviderApiKey: ${name}`, [`got ${JSON.stringify(got)} want ${JSON.stringify(want)}`]);
    else ok(`resolveProviderApiKey: ${name}`);
  }
}

{
  // A stored llm_config row is the live chain and must still be honoured.
  const problems = [];
  const cfgSrc = sliceBlock(src, 'async function getLLMConfigWorker', '\nfunction redactLLMConfig');
  if (!/llm_config/.test(cfgSrc)) problems.push('getLLMConfigWorker no longer reads llm_config');
  if (problems.length) fail('getLLMConfigWorker still prefers the stored row', problems);
  else ok('getLLMConfigWorker still prefers the stored row');
}

console.log(failed ? `\nFAIL ${failed} case(s) in ${file}` : `\nPASS all cases in ${file}`);
process.exit(failed ? 1 : 0);