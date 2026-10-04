/**
 * Central LoRA repository adapter (Phase A read-only).
 *
 * Maps a `GET /api/loras/library` row to the exact seed-entry shape
 * `seedLibrary()` in App.tsx builds from loras-data.js, so the rest of the
 * UI (toLora, grouping, compat, insertFormat) treats central rows exactly
 * like baked entries:
 *
 *   id, name, source, repo, repo_url, file, file_url,
 *   base_model, base_family (+baseFamily camelCase for toLora),
 *   pipeline, triggers (JSON.parse triggers_json || []),
 *   isNsfw (!!nsfw), isAznten (group_name === 'aznten'),
 *   note, suggested_target, muapi_model, replicate_model, wavespeed_model,
 *   custom:false
 *
 * No format/compat logic lives here — only shaping + key building.
 */

/** Triggers for one library row. The Worker already parses triggers_json into
 *  `triggers`, but local/old payloads may carry only the raw JSON string. */
export function centralTriggers(row: any): string[] {
  if (Array.isArray(row?.triggers)) return row.triggers.map((t: any) => String(t));
  try {
    const t = JSON.parse(row?.triggers_json ?? '[]');
    if (Array.isArray(t)) return t.map((x: any) => String(x));
  } catch {
    /* keep [] */
  }
  return [];
}

/** Map one central library row to the seed-entry shape. */
export function mapCentralRow(row: any): any {
  return {
    id: String(row?.id ?? row?.repo ?? ''),
    name: String(row?.name ?? row?.id ?? ''),
    source: row?.source ?? '',
    repo: String(row?.repo ?? ''),
    repo_url: String(row?.repo_url ?? ''),
    file: String(row?.file ?? ''),
    file_url: String(row?.file_url ?? (row as any)?.file_url_replicate ?? ''),
    file_url_muapi: (row as any)?.file_url_muapi ?? '',
    file_url_replicate: (row as any)?.file_url_replicate ?? '',
    file_url_wavespeed: (row as any)?.file_url_wavespeed ?? '',
    base_model: String(row?.base_model ?? ''),
    base_family: String(row?.base_family ?? (row as any)?.baseFamily ?? ''),
    // toLora() reads the camelCase key; the seed entries carry neither, so
    // both are set to keep central rows identical through that path.
    baseFamily: String((row as any)?.baseFamily ?? row?.base_family ?? ''),
    pipeline: String(row?.pipeline ?? 'text-to-image'),
    triggers: centralTriggers(row),
    triggers_json: row?.triggers_json ?? '',
    nsfw: row?.nsfw ?? 0,
    isNsfw: !!row?.nsfw,
    group_name: row?.group_name ?? '',
    // Central grouping is authoritative via group_name; customs keep the
    // regex path in App.tsx (tagCustomEntry → isAzntenLora).
    isAznten: String(row?.group_name ?? '').toLowerCase() === 'aznten',
    note: row?.note ?? '',
    suggested_target: row?.suggested_target ?? '',
    muapi_model: row?.muapi_model ?? '',
    replicate_model: row?.replicate_model ?? '',
    wavespeed_model: row?.wavespeed_model ?? '',
    custom: false,
  };
}

/** Key for one verification row in the loraFormats confirmed lookup. */
export function centralConfirmKey(v: any): string {
  return `${String(v?.app ?? '')}|${String(v?.model_id ?? '')}|${String(v?.lora_id ?? '')}`;
}

/** Confirmed keys for this app from central verifications. Only
 *  app==='replicate' rows count here. */
export function centralConfirmedKeys(rows: any[], app = 'replicate'): string[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((v) => v && v.app === app && v.lora_id && v.model_id)
    .map(centralConfirmKey);
}

/** { lora, model } pairs for the lora-compat verified lookup. Only
 *  app==='replicate' rows count here (this console is the replicate app). */
export function centralVerifiedPairs(rows: any[], app = 'replicate'): { lora: string; model: string }[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((v) => v && v.app === app && v.lora_id && v.model_id)
    .map((v) => ({ lora: String(v.lora_id), model: String(v.model_id) }));
}
