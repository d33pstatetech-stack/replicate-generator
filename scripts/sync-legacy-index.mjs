// Regenerate the inlined data blocks inside the legacy public/index.html from the
// sanitized client/src modules, so the static Docker preview cannot drift from
// the React client or reintroduce removed content.
//
//   node scripts/sync-legacy-index.mjs public/index.html
//
import { readFileSync, writeFileSync } from 'node:fs';
import { CURATED_LORAS, OWN_LORAS, NSFW_LORAS } from '../client/src/loras-data.js';
import { MODELS } from '../client/src/models.js';

const target = process.argv[2];
let src = readFileSync(target, 'utf8');

function literal(arr, pad) {
  return '[\n' + arr.map((o) => pad + JSON.stringify(o, null, 2).split('\n').join('\n' + pad)).join(',\n') + '\n]';
}

// Replace `const NAME = [ ... ];` by walking bracket depth.
// The declaration marker deliberately EXCLUDES the opening bracket, because the
// replacement body supplies its own — including it would emit `= [[`.
function replaceBlock(text, name, body) {
  const decl = `const ${name} = `;
  const i = text.indexOf(decl);
  if (i < 0) throw new Error(`${name} not found`);
  let depth = 0, j = text.indexOf('[', i), end = -1;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced brackets for ${name}`);
  // swallow a trailing semicolon if present
  let after = end;
  if (text[after] === ';') after++;
  return text.slice(0, i) + decl + body + text.slice(after);
}

// 1. LoRA seed lists. The client module exposes USER_LORAS as a spread of the
//    two source lists, but the legacy bundle needs one flat literal, so the
//    combined set is materialised here.
const pickerList = [...CURATED_LORAS, ...OWN_LORAS];
src = replaceBlock(src, 'USER_LORAS', literal(pickerList, '  '));
src = replaceBlock(src, 'NSFW_LORAS', literal(NSFW_LORAS, '  '));

// 2. Model catalog. The legacy SPA stores schemas as named consts, so only the
//    entry list is regenerated here; schema consts are handled by the caller.
const catalogBody = '[\n' + MODELS.map((m) => '  ' + JSON.stringify({
  id: m.id, name: m.name, group: m.group, category: m.category,
  version: m.version, ...(m.official ? { official: true } : {}),
  description: m.description, schema: m.schema,
})).join(',\n') + '\n]';
src = replaceBlock(src, 'CATALOG', catalogBody);

writeFileSync(target, src, 'utf8');
console.log(`rewrote ${target}: ${pickerList.length} picker (${CURATED_LORAS.length} curated + ${OWN_LORAS.length} own), ${NSFW_LORAS.length} nsfw, ${MODELS.length} models`);
