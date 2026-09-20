import ImageParam from './ImageParam';
import LoraSlots from './LoraSlots';
import Tip from './Tip';
import { getParamType, isLoraParam, loraHintText, loraTokenIssues, prettyLabel, sizeHintText, sortParamEntries } from '../params';

// Schema-driven parameter form over Replicate-style JSON Schema:
//   schema = { properties: { name: spec }, required: [] }, defaults via spec.default.
// Controlled: values + onChange (functional updates, like useState setter).
// Image params delegate to ImageParam (data-URI / R2 / URL — no /api/upload);
// LoRA text fields get format hints + soft validation, never image zones.
export default function ParamForm({ schema, values, onChange, notify }) {
  const required = schema?.required || [];
  const entries = sortParamEntries(Object.entries(schema?.properties || {}).filter(([n]) => n !== 'prompt'), required);

  const set = (name, v) => {
    onChange((prev) => {
      const next = { ...prev };
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[name];
      else next[name] = v;
      return next;
    });
  };

  if (entries.length === 0) return <p className="text-xs text-gray-600">No parameters for this model.</p>;

  return (
    <div className="space-y-4">
      {entries.map(([name, spec]) => {
        const pType = getParamType(name, spec);
        const val = values[name];
        const def = spec.default;
        const req = required.includes(name);
        const n = String(name).toLowerCase();
        const showSizeTip = (n === 'size' || n === 'resolution') && !(spec.enum?.length) && (spec.type === 'string' || spec.type === undefined);
        const showLoraTip = pType === 'lora_url';
        const isNsfwToggle = pType === 'boolean' && name === 'disable_safety_checker';
        return (
          <div key={name}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <label htmlFor={`p-${name}`} className="text-xs font-medium text-gray-300">
                {isNsfwToggle ? 'NSFW Enabled' : prettyLabel(name, spec)}
              </label>
              {req && <span className="text-[9px] uppercase tracking-wide bg-red-900/60 text-red-300 px-1.5 py-px rounded">required</span>}
              {spec.description && <Tip text={spec.description} />}
              {showSizeTip && <Tip text={sizeHintText()} />}
              {showLoraTip && <Tip text={loraHintText()} />}
            </div>
            <ParamControl
              name={name}
              spec={spec}
              pType={pType}
              value={val}
              fallback={def}
              required={req}
              onSet={(v) => set(name, v)}
              notify={notify}
            />
            {isNsfwToggle && (
              <div className="text-[11px] font-semibold mt-1">
                {(val ?? def) ? (
                  <span className="text-emerald-300">NSFW content is ENABLED</span>
                ) : (
                  <span className="text-red-400">NSFW content is DISABLED</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ParamControl({ name, spec, pType, value, fallback, required, onSet, notify }) {
  if (pType === 'image' || pType === 'image_array') {
    return <ImageParam name={name} multi={pType === 'image_array'} value={value} onChange={onSet} notify={notify} />;
  }
  if (pType === 'lora_url') {
    const isArr = spec.type === 'array';
    const curVal = Array.isArray(value) ? value.join('\n') : (value ?? fallback ?? '');
    const warn = loraTokenIssues(Array.isArray(value) ? value[0] : value);
    return (
      <div>
        {isArr ? (
          <textarea id={`p-${name}`} rows={2} value={Array.isArray(value) ? value.join('\n') : (value ?? '')}
            placeholder="One LoRA URL per line" onChange={(e) => onSet(e.target.value || undefined)}
            className="input !text-xs font-mono" />
        ) : (
          <input id={`p-${name}`} type="text" value={curVal} placeholder="huggingface.co/owner/repo or .safetensors URL"
            onChange={(e) => onSet(e.target.value || undefined)} className="input !text-xs font-mono" />
        )}
        {value && warn && <p className="text-[11px] text-amber-400 mt-1">{warn}</p>}
      </div>
    );
  }
  if (pType === 'select') {
    return (
      <select id={`p-${name}`} value={value ?? fallback ?? (required ? spec.enum[0] : '')} onChange={(e) => onSet(e.target.value || undefined)} className="input !text-xs">
        {!required && <option value="">—</option>}
        {spec.enum.map((o) => (
          <option key={String(o)} value={o}>{String(o)}</option>
        ))}
      </select>
    );
  }
  if (pType === 'range') {
    const min = spec.minimum;
    const max = spec.maximum;
    const step = spec.type === 'integer' ? 1 : 0.05;
    const v = value ?? fallback ?? min ?? 0;
    return (
      <div>
        <div className="flex items-center gap-2">
          <input id={`p-${name}`} type="range" min={min} max={max} step={step} value={v} onChange={(e) => onSet(spec.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value))} className="flex-1 accent-purple-500" />
          <input type="number" value={v} min={min} max={max} step={step} onChange={(e) => onSet(e.target.value === '' ? undefined : (spec.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)))}
            aria-label={`${prettyLabel(name, spec)} value`} className="input !text-xs !w-20 flex-none font-mono" />
        </div>
        {spec.type === 'number' && <div className="text-[10px] text-gray-600 mt-1">min {min} · max {max} · step {step}</div>}
      </div>
    );
  }
  if (pType === 'number') {
    return (
      <input id={`p-${name}`} type="number" value={value ?? fallback ?? ''} min={spec.minimum} max={spec.maximum}
        placeholder={prettyLabel(name, spec)} onChange={(e) => onSet(e.target.value ? (spec.type === 'integer' ? parseInt(e.target.value, 10) : parseFloat(e.target.value)) : undefined)} className="input !text-xs" />
    );
  }
  if (pType === 'boolean') {
    const v = value ?? fallback ?? false;
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input id={`p-${name}`} type="checkbox" checked={!!v} onChange={(e) => onSet(e.target.checked)} className="accent-purple-500 w-4 h-4" />
        <span className="text-xs text-gray-400">{v ? 'Enabled' : 'Disabled'}</span>
      </label>
    );
  }
  if (spec.type === 'array' && isLoraParam(name, spec)) {
    return <LoraSlots name={name} spec={spec} value={Array.isArray(value) ? value : undefined} onChange={onSet} />;
  }
  // Plain text (incl. free-text LoRA fields with soft validation)
  const warn = isLoraParam(name, spec) ? loraTokenIssues(value) : null;
  return (
    <div>
      <input id={`p-${name}`} type="text" value={value ?? fallback ?? ''} placeholder={prettyLabel(name, spec)}
        onChange={(e) => onSet(e.target.value || undefined)} className="input !text-xs font-mono" />
      {value && warn && <p className="text-[11px] text-amber-400 mt-1">{warn}</p>}
    </div>
  );
}
