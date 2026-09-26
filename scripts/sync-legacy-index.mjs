// Regenerate the inlined data blocks inside the legacy public/index.html from the
// sanitized client/src modules, so the static Docker preview cannot drift from
// the React client or reintroduce removed content.
//
//   node scripts/sync-legacy-index.mjs public/index.html
//
import { readFileSync, writeFileSync } from 'node:fs';
import { CURATED_LORAS, NSFW_LORAS } from '../client/src/loras-data.js';
import { MODELS } from '../client/src/models.js';

const target = process.argv[2];
let src = readFileSync(target, 'utf8');

function literal(arr, pad) {
  return '[\n' + arr.map((o) => pad + JSON.stringify(o, null, 2).split('\n').join('\n' + pad)).join(',\n') + '\n]';
}

// Replace `const NAME = [ ... ];` or `= { ... };` by walking bracket depth.
function replaceBlock(text, name, body, opener) {
  const startMark = `const ${name} = ${opener}`;
  const i = text.indexOf(startMark);
  if (i < 0) throw new Error(`${name} not found`);
  const open = opener[0];
  const close = open === '{' ? '}' : ']';
  let depth = 0, j = text.indexOf(open, i), end = -1;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced brackets for ${name}`);
  // swallow a trailing semicolon if present
  let after = end;
  if (text[after] === ';') after++;
  return text.slice(0, i) + startMark + body + text.slice(after);
}

// 1. LoRA seed lists (USER_LORAS is the legacy name for the curated list)
src = replaceBlock(src, 'USER_LORAS', literal(CURATED_LORAS, '  '), '[');
src = replaceBlock(src, 'NSFW_LORAS', literal(NSFW_LORAS, '  '), '[');

// 2. Model catalog. The legacy SPA stores schemas as named consts, so only the
//    entry list is regenerated here; schema consts are handled by the caller.
const catalogBody = '[\n' + MODELS.map((m) => '  ' + JSON.stringify({
  id: m.id, name: m.name, group: m.group, category: m.category,
  version: m.version, ...(m.official ? { official: true } : {}),
  description: m.description, schema: m.schema,
})).join(',\n') + '\n]';
src = replaceBlock(src, 'CATALOG', catalogBody, '[');

writeFileSync(target, src, 'utf8');
console.log(`rewrote ${target}: ${CURATED_LORAS.length} curated, ${NSFW_LORAS.length} nsfw, ${MODELS.length} models`);
