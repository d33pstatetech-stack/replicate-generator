import { useCallback, useEffect, useState } from 'react';
import { fetchHealth, fetchModel, fetchModels } from './api';
import { schemaDefaults, submitRoute } from './models';
import { buildSubmitParams } from './params';
import Enhancer from './components/Enhancer';
import HistoryGrid from './components/HistoryGrid';
import LibraryModal from './components/LibraryModal';
import LoraPicker from './components/LoraPicker';
import ModelPicker from './components/ModelPicker';
import OutputCard from './components/OutputCard';
import ParamForm from './components/ParamForm';
import PromptBox from './components/PromptBox';
import Section from './components/Section';
import SettingsModal from './components/SettingsModal';
import useGeneration from './hooks/useGeneration';

const HIST_KEY = 'replicate_history';
const SAVED_KEY = 'replicate_saved';

function useToast() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return { toasts, push };
}

export default function App() {
  const { toasts, push: toast } = useToast();
  const [models, setModels] = useState([]);
  const [health, setHealth] = useState(null);
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [schema, setSchema] = useState(null);
  const [params, setParams] = useState({});
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [enhancementId, setEnhancementId] = useState(null);
  const [library, setLibrary] = useState(null); // null | 'templates' | 'saved'
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleDone = useCallback((r) => {
    setHistory((h) => {
      const next = [{
        requestId: r.requestId,
        url: r.outputs[0],
        elapsed: r.elapsed,
        model: r.model || selectedId,
        time: new Date().toLocaleTimeString(),
      }, ...h].slice(0, 30);
      try {
        localStorage.setItem(HIST_KEY, JSON.stringify(next));
      } catch {
        /* storage full/blocked */
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const gen = useGeneration({ notify: toast, onDone: handleDone });

  useEffect(() => {
    (async () => {
      try {
        const ms = await fetchModels();
        setModels(ms);
        setConnected(true);
      } catch (e) {
        setConnected(false);
        toast(`Failed to load catalog: ${e.message}`, 'error');
      }
      try {
        setHealth(await fetchHealth());
      } catch {
        /* health is best-effort; catalog is static */
      }
    })();
  }, [toast]);

  const handleSelect = useCallback(async (id) => {
    setSelectedId(id);
    setSchema(null);
    setParams({});
    setLoadingSchema(true);
    try {
      const entry = await fetchModel(id);
      const sch = entry.schema;
      if (!sch?.properties) throw new Error('Model has no parameter schema');
      setSchema(sch);
      setParams({ ...schemaDefaults(sch) });
    } catch (e) {
      toast(`Failed to load model: ${e.message}`, 'error');
    } finally {
      setLoadingSchema(false);
    }
  }, [toast]);

  const savePrompt = useCallback(() => {
    const p = prompt.trim();
    if (!p) return;
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
      saved.unshift({ prompt: p, model: selectedId, params: { ...params }, time: new Date().toISOString() });
      localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, 50)));
      toast('Prompt saved', 'success');
    } catch {
      toast('Save failed', 'error');
    }
  }, [prompt, selectedId, params, toast]);

  const applyLibraryItem = useCallback(async ({ prompt: p, model, params: ps }) => {
    if (p) setPrompt(p);
    if (model && model !== selectedId) {
      await handleSelect(model);
    }
    if (ps) setParams((prev) => ({ ...prev, ...ps }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, handleSelect]);

  const mergeParams = useCallback((obj) => {
    setParams((prev) => ({ ...prev, ...obj }));
  }, []);

  const selected = models.find((m) => m.id === selectedId);
  const payloadPreview = (() => {
    if (!selected) return '// select a model';
    const input = buildSubmitParams(prompt || '(prompt)', params, schema);
    const route = submitRoute(selected);
    const body = selected.official
      ? { endpoint: `POST /v1/models/${selected.id}/predictions (official, latest, unpinned)`, ...route.body(input) }
      : route.body(input);
    return JSON.stringify(body, null, 2);
  })();

  const canGenerate = selectedId && prompt.trim() && !gen.busy;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 sticky top-0 z-30 bg-gray-950/90 backdrop-blur">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-none">
              <i className="fas fa-bolt text-white text-sm"></i>
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold gradient-text truncate">Replicate Prompt Orchestrator</h1>
              <p className="text-[11px] text-gray-500 truncate">
                {models.length || '—'} models · Image · Video · static catalog
                {health?.history_runs != null ? ` · ${health.history_runs} runs logged` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-none">
            <button onClick={() => setLibrary('saved')} title="Saved prompts" aria-label="Saved prompts" className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white">
              <i className="fas fa-bookmark text-xs"></i>
            </button>
            <button onClick={() => setLibrary('templates')} title="Templates" aria-label="Templates" className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white">
              <i className="fas fa-layer-group text-xs"></i>
            </button>
            <button onClick={() => setSettingsOpen(true)} title="LLM settings" aria-label="LLM settings" className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white">
              <i className="fas fa-cog text-xs"></i>
            </button>
            <span title={connected ? 'Catalog loaded' : 'Catalog failed'} className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-600'}`}></span>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4 grid grid-cols-1 lg:grid-cols-[340px_1fr] xl:grid-cols-[340px_1fr_360px] gap-4">
        <div className="space-y-4">
          <Section icon="fa-brain" title="Model" step={1} summary={selectedId} defaultOpen={!selectedId}>
            <ModelPicker models={models} value={selectedId} onSelect={handleSelect} />
            {loadingSchema && <p className="text-xs text-gray-500 mt-2">Loading parameters…</p>}
          </Section>
          <Section icon="fa-sliders-h" title="Parameters" step={3} defaultOpen={!!selectedId} summary={selectedId && !schema ? 'loading…' : undefined}>
            {loadingSchema && <p className="text-xs text-gray-500">Loading parameters…</p>}
            {!loadingSchema && !schema && <p className="text-xs text-gray-600">Select a model to configure parameters.</p>}
            {!loadingSchema && schema && <ParamForm schema={schema} values={params} onChange={setParams} notify={toast} />}
          </Section>
          <Section icon="fa-palette" title="My HuggingFace LoRAs" defaultOpen={false}
            summary="HF quick-fill">
            <p className="text-[11px] text-gray-500 mb-1">Quick-fill a LoRA into the current model's LoRA field. Private repos auto-proxy via the Worker.</p>
            <LoraPicker variant="user" schema={schema} modelId={selectedId} params={params} onParams={mergeParams} notify={toast} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section icon="fa-pen" title="Prompt" step={2} defaultOpen={true}>
            <PromptBox value={prompt} onChange={setPrompt} onSave={savePrompt}
              onEnhance={() => document.getElementById('enhancer')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              disabled={gen.busy} />
          </Section>

          <button id="genBtn" type="button" onClick={() => { gen.submit({ modelId: selectedId, prompt, params, enhancementId }); setEnhancementId(null); }}
            disabled={!canGenerate} className="generate-btn sticky bottom-3 z-20 shadow-2xl lg:static">
            {gen.busy ? (<span><span className="spinner mr-2"></span>Generating…</span>) : (<span><i className="fas fa-play mr-2"></i>Generate</span>)}
          </button>
          {gen.busy && (
            <button type="button" onClick={gen.cancel} className="btn-secondary w-full text-xs">
              <i className="fas fa-stop mr-1"></i>Cancel prediction
            </button>
          )}

          {selected && (
            <div className="flex items-center gap-2 text-xs text-gray-500 px-1">
              <span className="font-mono truncate">{selected.official ? 'official model (latest, unpinned)' : selected.version}</span>
            </div>
          )}

          {gen.status && (
            <div className="panel">
              <div className="flex items-center gap-3">
                {gen.status.spinner && <span className="spinner !border-gray-600"></span>}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{gen.status.text}</div>
                  {gen.status.detail && <div className="text-xs text-gray-500 mt-0.5 break-words">{gen.status.detail}</div>}
                </div>
              </div>
              {gen.progress != null && (
                <div className="h-1.5 rounded-full bg-gray-800 mt-3 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all" style={{ width: `${gen.progress}%` }}></div>
                </div>
              )}
            </div>
          )}

          {gen.result && (
            <div className="panel">
              <OutputCard result={gen.result} modelId={selectedId} notify={toast} />
            </div>
          )}

          <Section icon="fa-code" title="API Payload" defaultOpen={false}>
            <div className="flex justify-end mb-1.5">
              <button type="button" title="Copy JSON" aria-label="Copy JSON"
                onClick={() => navigator.clipboard?.writeText(payloadPreview).then(() => toast('Payload copied', 'success')).catch(() => toast('Copy failed', 'error'))}
                className="w-8 h-8 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white">
                <i className="fas fa-copy text-xs"></i>
              </button>
            </div>
            <pre className="text-[11px] font-mono text-gray-400 bg-black/40 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap break-all">{payloadPreview}</pre>
          </Section>

          <Section icon="fa-history" title="Recent" defaultOpen={false}>
            <HistoryGrid items={history} />
          </Section>
        </div>

        <div className="space-y-4 hidden xl:block">
          <Section icon="fa-info-circle" title="Model Details" defaultOpen={true}>
            {selected ? (
              <div className="text-xs text-gray-400 space-y-1">
                <p className="font-mono text-gray-300 break-all">{selected.id}</p>
                <p>{selected.description || 'No description.'}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-600">Select a model to see details.</p>
            )}
          </Section>
          <Section icon="fa-wand-magic-sparkles" title="AI Prompt Enhancer" defaultOpen={false}>
            <div id="enhancer">
              <Enhancer model={selected} params={params} schema={schema} onUse={setPrompt} notify={toast} onEnhancement={setEnhancementId} />
            </div>
          </Section>
        </div>
      </main>

      <div className="max-w-[1600px] mx-auto px-4 pb-6">
        <Section icon="fa-fire" title="NSFW LoRAs — Replicate-runnable" defaultOpen={false} summary="18+ only">
          <p className="text-[11px] text-gray-500 mb-1">Fill a LoRA into the current model's LoRA field (extra_lora / lora_weights / lora_url). 18+ only.</p>
          <LoraPicker variant="nsfw" schema={schema} modelId={selectedId} params={params} onParams={mergeParams} notify={toast} />
        </Section>
      </div>

      <div className="fixed bottom-4 right-4 space-y-2 z-50 max-w-[90vw]">
        {toasts.map((t) => (
          <div key={t.id} className={`text-xs px-3 py-2 rounded-lg border shadow-xl ${t.kind === 'error' ? 'bg-red-950/90 border-red-800 text-red-200' : t.kind === 'success' ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200' : 'bg-gray-900/95 border-gray-700 text-gray-200'}`}>
            {t.message}
          </div>
        ))}
      </div>

      <LibraryModal open={library != null} tab={library || 'templates'} onTab={setLibrary} onApply={applyLibraryItem} onClose={() => setLibrary(null)} notify={toast} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} notify={toast} />
    </div>
  );
}
