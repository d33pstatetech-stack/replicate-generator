import { useEffect } from 'react';

function isVideoUrl(u) {
  if (!u || typeof u !== 'string') return false;
  return /\.(mp4|webm|mov)$/i.test(u) || u.includes('video');
}

function fmtValue(v) {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// Media viewer modal: main pane (img/video) + sidebar with whatever fields
// exist on the item object. Never crashes on missing fields — each sidebar
// row renders only when its field is present.
export default function MediaViewer({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;

  const url = item.url || (Array.isArray(item.urls) && item.urls[0]) || item.src || '';
  const video = isVideoUrl(url);
  const prompt = item.prompt ?? item.raw_prompt ?? item.enhanced ?? null;
  const model = item.model ?? item.modelId ?? item.target_model ?? null;
  const params = item.params ?? item.parameters ?? item.input ?? null;
  const loras = item.loras ?? item.lora_weights ?? item.extra_lora ?? null;
  const rating = item.rating ?? null;
  const cost = item.cost ?? item.cost_hint ?? item.amount_usd ?? null;
  const timestamp = item.timestamp ?? item.time ?? item.created_at ?? item.updated_at ?? null;

  const hasParams = params != null && (typeof params === 'object' ? Object.keys(params).length > 0 : String(params).trim() !== '');
  const hasLoras = loras != null && (typeof loras === 'object' ? Object.keys(loras).length > 0 : String(loras).trim() !== '');
  const hasRating = rating != null && rating !== '' && !(typeof rating === 'number' && Number.isNaN(rating));
  const hasCost = cost != null && (typeof cost === 'object' ? Object.keys(cost).length > 0 : String(cost).trim() !== '');
  const hasPrompt = prompt != null && String(prompt).trim() !== '';
  const hasModel = model != null && String(model).trim() !== '';
  const hasTimestamp = timestamp != null && String(timestamp).trim() !== '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
    >
      <div className="panel !p-0 max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row">
        <div className="flex-1 min-w-0 bg-black flex items-center justify-center">
          {url ? (
            video ? (
              <video src={url} controls autoPlay loop className="w-full max-h-[70vh] md:max-h-[90vh] object-contain" />
            ) : (
              <img src={url} alt="" className="w-full max-h-[70vh] md:max-h-[90vh] object-contain" />
            )
          ) : (
            <p className="text-xs text-gray-500 p-8">No media URL</p>
          )}
        </div>
        <div className="w-full md:w-72 flex-none border-t md:border-t-0 md:border-l border-gray-800 p-4 overflow-y-auto space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Details</span>
            <div className="flex items-center gap-1.5">
              {url ? (
                <>
                  <a href={url} target="_blank" rel="noreferrer" title="Open full size" aria-label="Open full size"
                    className="w-7 h-7 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white inline-flex items-center justify-center">
                    <i className="fas fa-expand text-[11px]"></i>
                  </a>
                  <a href={url} download title="Download" aria-label="Download"
                    className="w-7 h-7 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white inline-flex items-center justify-center">
                    <i className="fas fa-download text-[11px]"></i>
                  </a>
                </>
              ) : null}
              <button type="button" onClick={onClose} title="Close" aria-label="Close"
                className="w-7 h-7 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-white">
                <i className="fas fa-times text-[11px]"></i>
              </button>
            </div>
          </div>
          {hasPrompt ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Prompt</div>
              <p className="text-gray-300 break-words whitespace-pre-wrap">{fmtValue(prompt)}</p>
            </div>
          ) : null}
          {hasModel ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Model</div>
              <p className="font-mono text-gray-300 break-all">{fmtValue(model)}</p>
            </div>
          ) : null}
          {hasParams ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Params</div>
              <pre className="text-[11px] font-mono text-gray-400 bg-black/40 rounded-lg p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">{fmtValue(params)}</pre>
            </div>
          ) : null}
          {hasLoras ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">LoRAs</div>
              <pre className="text-[11px] font-mono text-gray-400 bg-black/40 rounded-lg p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">{fmtValue(loras)}</pre>
            </div>
          ) : null}
          {hasRating ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Rating</div>
              <p className="text-gray-300">{fmtValue(rating)}</p>
            </div>
          ) : null}
          {hasCost ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Cost</div>
              <p className="text-gray-300 break-words">{typeof cost === 'object' ? fmtValue(cost) : fmtValue(cost)}</p>
            </div>
          ) : null}
          {hasTimestamp ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">Timestamp</div>
              <p className="text-gray-300">{fmtValue(timestamp)}</p>
            </div>
          ) : null}
          {!hasPrompt && !hasModel && !hasParams && !hasLoras && !hasRating && !hasCost && !hasTimestamp ? (
            <p className="text-gray-600">No metadata available.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
