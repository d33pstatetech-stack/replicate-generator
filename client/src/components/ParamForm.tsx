import { useEffect, useId, useMemo, useState } from "react";
import Icon from "../ui/Icon";
import { Badge, Tip } from "../ui/primitives";
import { getParamType, isLoraParam, loraSlotCount, loraTokenIssues, prettyLabel, sortParamEntries, TIER_B_LORA_PARAM, tierBLoraPayload } from "../params";
import type { ModelSchema, ParamSpec } from "../lib/types";
import type { TierBLora } from "../lib/models";

type Values = Record<string, unknown>;

const label = (name: string, spec: ParamSpec) => spec.title || prettyLabel(name, spec);

/* Replicate input schemas are JSON Schema, so bounds arrive as minimum/maximum
   and option lists as enum, not min/max/options. Accept both. */
const minOf = (s: ParamSpec) => (s.min ?? (s as any).minimum) as number | undefined;
const maxOf = (s: ParamSpec) => (s.max ?? (s as any).maximum) as number | undefined;
const optsOf = (s: ParamSpec) => s.options || (s as any).enum || [];

/* ------------------------------------------------------------------
   Image field — this backend has NO /api/upload route, so a local file
   becomes a data URI in the browser, which is what the previous picker did.
   A pasted R2 URL works too. `format: uri` fields accept either.
   ------------------------------------------------------------------ */
function ImageField({
  id,
  value,
  onSet,
  multiple,
  describedBy,
}: {
  id: string;
  value: unknown;
  onSet: (v: unknown) => void;
  multiple?: boolean;
  describedBy?: string;
}) {
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = (Array.isArray(value) ? value : value ? [value] : []) as string[];

  function read(files: FileList | File[] | undefined) {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setErr(null);
    try {
      const uris = arr.map((f) => {
        if (!/^image\//.test(f.type)) throw new Error(`${f.name} is not an image`);
        const r = new FileReader();
        r.readAsDataURL(f);
        return f;
      });
      // FileReader is async; read them all then commit together.
      Promise.all(
        uris.map(
          (f) =>
            new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.onerror = () => reject(new Error(`Could not read ${f.name}`));
              r.readAsDataURL(f);
            }),
        ),
      )
        .then((out) => onSet(multiple ? [...list, ...out] : out[0]))
        .catch((e) => setErr((e as Error).message));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (list.length) {
    return (
      <div className="grid gap-2">
        <ul className="grid grid-cols-2 gap-2">
          {list.map((u, i) => (
            <li key={`${u}-${i}`} className="flex items-center gap-2 rounded-lg bg-s0 p-1.5 ring-1 ring-line">
              <img src={u} alt="" className="size-10 shrink-0 rounded object-cover" />
              <button
                type="button"
                onClick={() => onSet(list.filter((_, j) => j !== i))}
                className="btn btn-sm btn-quiet ml-auto"
                aria-label={`Remove image ${i + 1}`}
              >
                <Icon name="trash" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onSet(multiple ? [] : undefined)} className="btn btn-sm btn-quiet gap-1.5">
          <Icon name="trash" className="size-3.5" />
          Clear
        </button>
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          read(e.dataTransfer.files ?? undefined);
        }}
        className={`rounded-xl border border-dashed p-3 transition ${over ? "border-accent bg-accent/10" : "border-line2 bg-s0"}`}
      >
        <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 text-fine text-t2">
          <Icon name="upload" className="size-4" />
          <span>
            {multiple ? "Drop images or browse" : "Drop an image or "}
            {!multiple && <span className="font-medium text-accent-soft underline">browse</span>}
          </span>
        </label>
        <input id={id} type="file" accept="image/*" multiple={multiple} aria-describedby={describedBy} onChange={(e) => read(e.target.files ?? undefined)} className="sr-only" />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-micro text-t3">or URL</span>
        <input
          type="url"
          value={String(value ?? "")}
          onChange={(e) => onSet(e.target.value || undefined)}
          placeholder="https://…"
          aria-label="Image URL"
          className="field font-mono"
        />
      </div>
      {err && <p className="mt-1.5 rounded-lg bg-crit/10 px-2.5 py-1.5 text-micro text-crit ring-1 ring-crit/25">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------
   LoRA field — one input per slot. Slot count and validation come from
   params.js, which already knows Replicate's accepted forms
   (owner/name, owner/name:version, HF URL, CivitAI URL, .safetensors URL).
   ------------------------------------------------------------------ */
function LoraField({
  id,
  name,
  spec,
  value,
  onSet,
}: {
  id: string;
  name: string;
  spec: ParamSpec;
  value: unknown;
  onSet: (v: unknown) => void;
}) {
  const slots = loraSlotCount(spec as any);
  const arr = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
  const [drafts, setDrafts] = useState<string[]>(() => Array.from({ length: slots }, (_, i) => arr[i] || ""));

  useEffect(() => {
    setDrafts((d) => Array.from({ length: slots }, (_, i) => d[i] || arr[i] || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, JSON.stringify(arr)]);

  const commit = (next: string[]) => {
    setDrafts(next);
    const kept = next.map((t) => t.trim()).filter(Boolean);
    onSet(kept.length ? kept : undefined);
  };

  return (
    <div className="grid gap-1.5" id={id}>
      {drafts.map((tok, i) => {
        const issue = loraTokenIssues(tok);
        return (
          <div key={i}>
            <input
              type="text"
              value={tok}
              onChange={(e) => commit(drafts.map((d, j) => (j === i ? e.target.value : d)))}
              placeholder={i === 0 ? "owner/name or https://…safetensors" : "empty"}
              aria-label={`${label(name, spec)} ${i + 1}`}
              aria-invalid={issue ? true : undefined}
              className={`field font-mono ${issue ? "ring-crit/50" : ""}`}
            />
            {issue && <p className="mt-1 text-micro text-crit">{issue}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Field({ name, spec, value, onSet }: { name: string; spec: ParamSpec; value: unknown; onSet: (v: unknown) => void }) {
  const id = useId();
  const descId = `${id}-d`;
  const text = label(name, spec);
  const kind = getParamType(name, spec as any);
  const describedBy = spec.description ? descId : undefined;

  const control = () => {
    if (isLoraParam(name, spec as any)) return <LoraField id={id} name={name} spec={spec} value={value} onSet={onSet} />;
    // getParamType routes anything lora/weight-shaped that is not a numeric
    // scale here. isLoraParam is the gate, but this catches anything that
    // reaches the kind without being an adapter — a .safetensors URL must
    // never fall through to the generic text box.
    if (kind === "lora_url") return <LoraField id={id} name={name} spec={spec} value={value} onSet={onSet} />;
    if (kind === "image") return <ImageField id={id} value={value} onSet={onSet} describedBy={describedBy} />;
    if (kind === "image_array") return <ImageField id={id} value={value} onSet={onSet} multiple describedBy={describedBy} />;
    if (kind === "select") {
      const opts = optsOf(spec);
      return (
        <select id={id} aria-describedby={describedBy} value={String(value ?? spec.default ?? "")} onChange={(e) => onSet(e.target.value || undefined)} className="field">
          {!spec.required && <option value="">Not set</option>}
          {opts.map((o: any) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      );
    }
    if (kind === "boolean") {
      const on = Boolean(value ?? spec.default);
      return (
        <button type="button" id={id} role="switch" aria-checked={on} aria-describedby={describedBy} onClick={() => onSet(!on)} className={`btn w-full justify-between ${on ? "bg-accent/15 text-accent-soft ring-1 ring-accent/35" : "btn-ghost"}`}>
          {on ? "Enabled" : "Disabled"}
          <span className={`relative h-5 w-9 rounded-full transition ${on ? "bg-accent" : "bg-s3"}`} aria-hidden="true">
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? "left-[1.1rem]" : "left-0.5"}`} />
          </span>
        </button>
      );
    }
    if (kind === "range") {
      const lo = minOf(spec);
      const hi = maxOf(spec);
      const v = Number(value ?? spec.default ?? lo);
      return (
        <div className="flex items-center gap-3">
          <input id={id} type="range" min={lo} max={hi} step={spec.step ?? 1} value={v} aria-describedby={describedBy} onChange={(e) => onSet(Number(e.target.value))} className="h-11 min-w-0 flex-1 accent-[var(--color-accent)]" />
          <output htmlFor={id} className="tnum w-14 shrink-0 rounded-md bg-s0 py-1.5 text-center text-fine font-medium text-t1 ring-1 ring-line">
            {v}
          </output>
        </div>
      );
    }
    if (kind === "number") {
      return (
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={minOf(spec)}
          max={maxOf(spec)}
          placeholder="Random"
          aria-describedby={describedBy}
          value={value == null ? "" : String(value)}
          onChange={(e) => onSet(e.target.value === "" ? undefined : Number(e.target.value))}
          className="field tnum"
        />
      );
    }
    return (
      <input
        id={id}
        type="text"
        placeholder={`Optional ${text.toLowerCase()}`}
        aria-describedby={describedBy}
        value={String(value ?? "")}
        onChange={(e) => onSet(e.target.value || undefined)}
        className="field"
      />
    );
  };

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={id} className="text-fine font-medium capitalize text-t1">
          {text}
        </label>
        {spec.required && <Badge tone="crit">Required</Badge>}
        {spec.description && (
          <span className="@min-[30rem]/form:hidden">
            <Tip text={spec.description} label={`About ${text}`} />
          </span>
        )}
      </div>
      {control()}
      {spec.description && <p id={descId} className="mt-1.5 hidden text-micro leading-relaxed text-t3 @min-[30rem]/form:block">{spec.description}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------
   Tier B — the UNVERIFIED adapter slot.

   Rendered only for a model whose architecture is a candidate but whose own
   schema declares no adapter param (see lib/models.ts). Off by default, and
   the value only enters `values` while the box is ticked, so the request
   payload can never carry an `extra_lora` the user did not explicitly ask for.
   ------------------------------------------------------------------ */
function TierBLoraField({
  tierB,
  optIn,
  token,
  onChange,
}: {
  tierB: TierBLora;
  optIn: boolean;
  token: string;
  onChange: (next: { optIn: boolean; token: string }) => void;
}) {
  const id = useId();
  const issue = optIn ? loraTokenIssues(token) : null;
  return (
    <div className="@container/form col-span-full rounded-xl bg-warn/5 p-3 ring-1 ring-warn/25" id={id}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warn">
          <Icon name="warn" className="size-3" />
          Unverified
        </Badge>
        <label htmlFor={`${id}-opt`} className="text-fine font-medium text-t1">
          Send <span className="font-mono">{TIER_B_LORA_PARAM}</span> to this model anyway
        </label>
        <button
          type="button"
          id={`${id}-opt`}
          role="switch"
          aria-checked={optIn}
          onClick={() => onChange({ optIn: !optIn, token })}
          className={`btn btn-sm ml-auto gap-1.5 ${optIn ? "bg-warn/15 text-warn ring-1 ring-warn/35" : "btn-ghost"}`}
        >
          {optIn ? "Will be sent" : "Not sent"}
          <span className="relative h-5 w-9 rounded-full transition" aria-hidden="true">
            <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${optIn ? "left-[1.1rem]" : "left-0.5"}`} />
          </span>
        </button>
      </div>
      <p className="mt-1.5 text-micro leading-relaxed text-t3">
        {tierB.reason} This model&apos;s schema does not declare the field, so Replicate will reject the prediction.
        Nothing is sent until you switch this on.
      </p>
      {optIn && (
        <div className="mt-2.5">
          <input
            type="text"
            value={token}
            onChange={(e) => onChange({ optIn: true, token: e.target.value })}
            placeholder="owner/name or https://…safetensors"
            aria-label={`${TIER_B_LORA_PARAM} value`}
            aria-invalid={issue ? true : undefined}
            className={`field font-mono ${issue ? "ring-crit/50" : ""}`}
          />
          {issue && <p className="mt-1 text-micro text-crit">{issue}</p>}
        </div>
      )}
    </div>
  );
}

export default function ParamForm({
  schema,
  values,
  onChange,
  tierB = null,
}: {
  schema: ModelSchema | null;
  values: Values;
  onChange: (fn: (v: Values) => Values) => void;
  tierB?: TierBLora | null;
}) {
  const set = (name: string, v: unknown) =>
    onChange((prev) => {
      const next = { ...prev };
      if (v === undefined || v === "" || (Array.isArray(v) && !v.length)) delete next[name];
      else next[name] = v;
      return next;
    });

  /* The opt-in is component state, not schema state, so it resets whenever the
     schema changes — i.e. whenever the user picks a different model. */
  const [tierBState, setTierBState] = useState({ optIn: false, token: "" });
  useEffect(() => setTierBState({ optIn: false, token: "" }), [schema]);

  /* tierBLoraPayload is the gate: an unticked box yields `{}`, so `set` is
     called with undefined and the key is removed from `values`. */
  const commitTierB = (next: { optIn: boolean; token: string }) => {
    setTierBState(next);
    set(TIER_B_LORA_PARAM, tierBLoraPayload(next)[TIER_B_LORA_PARAM]);
  };

  /* Replicate schemas carry their own field order via x-order, and
     sortParamEntries honours it. `prompt` is excluded — it has its own surface. */
  const entries = useMemo(() => {
    const all = Object.entries(schema?.params ?? {}).filter(([n]) => n !== "prompt");
    const required = (schema as any)?.required || [];
    return sortParamEntries(all, required) as [string, ParamSpec][];
  }, [schema]);

  if (!schema) return null;
  if (!entries.length && !tierB) return <p className="text-fine text-t3">This model takes a prompt and nothing else.</p>;

  return (
    <div className="@container/form">
      <div className="grid grid-cols-1 gap-x-5 gap-y-4 @min-[30rem]/form:grid-cols-2 @min-[56rem]/form:grid-cols-3">
        {entries.map(([name, spec]) => (
          <Field key={name} name={name} spec={spec} value={values[name]} onSet={(v) => set(name, v)} />
        ))}
        {tierB && (
          <TierBLoraField tierB={tierB} optIn={tierBState.optIn} token={tierBState.token} onChange={commitTierB} />
        )}
      </div>
    </div>
  );
}