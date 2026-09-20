import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelPrediction, linkEnhancement, pollPrediction, predictionOutputs, submitGenerate } from '../api';
import { buildSubmitParams } from '../params';
import { getSchema } from '../models';

// Generation lifecycle: idle → submitting → polling → done | failed | canceled.
// Replicate statuses: starting | processing | succeeded | failed | canceled.
// onDone({ requestId, outputs, elapsed, model }) for history + archive.
export default function useGeneration({ notify, onDone }) {
  const [phase, setPhase] = useState('idle'); // idle|submitting|polling|done|error|canceled
  const [status, setStatus] = useState(null); // { text, detail, spinner }
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null); // { requestId, outputs, elapsed, model }
  const timer = useRef(null);
  const activeId = useRef(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const cancel = useCallback(async () => {
    const id = activeId.current;
    stop();
    if (id) {
      try {
        await cancelPrediction(id);
      } catch {
        /* best-effort; polling already stopped */
      }
      activeId.current = null;
    }
    setPhase('canceled');
    setStatus({ text: 'Canceled', detail: id ? `Polling stopped, cancel requested [id: ${id}]` : 'Polling stopped', spinner: false });
    setProgress(null);
  }, [stop]);

  const submit = useCallback(async ({ modelId, prompt, params, enhancementId }) => {
    const p = (prompt || '').trim();
    if (!modelId || !p) return;
    stop();
    setResult(null);
    setProgress(null);
    setPhase('submitting');
    setStatus({ text: 'Submitting…', detail: 'Sending to Replicate', spinner: true });
    const started = Date.now();
    const submitParams = buildSubmitParams(p, params, getSchema(modelId));
    try {
      const data = await submitGenerate({ modelId, params: submitParams, enhancementId });
      // submitGenerate already linked the enhancement (fire-and-forget).
      void linkEnhancement;
      activeId.current = data.id;
      if (data.status === 'succeeded') {
        const outputs = predictionOutputs(data);
        const r = { requestId: data.id, outputs, elapsed: ((Date.now() - started) / 1000).toFixed(1), model: modelId };
        setResult(r);
        setPhase('done');
        setStatus({ text: 'Completed', detail: 'Succeeded without polling', spinner: false });
        activeId.current = null;
        onDoneRef.current && onDoneRef.current(r);
        return;
      }
      if (data.status === 'failed' || data.status === 'canceled') {
        activeId.current = null;
        setPhase(data.status === 'canceled' ? 'canceled' : 'error');
        setStatus({ text: data.status === 'canceled' ? 'Canceled' : 'Failed', detail: errOf(data), spinner: false });
        return;
      }
      setPhase('polling');
      setStatus({ text: 'Processing…', detail: `ID: ${data.id}`, spinner: true });
      const MAX_POLL_MS = 15 * 60 * 1000;
      timer.current = setInterval(async () => {
        try {
          const d = await pollPrediction(data.id);
          const elapsed = ((Date.now() - started) / 1000).toFixed(1);
          if (Date.now() - started > MAX_POLL_MS) {
            stop();
            activeId.current = null;
            setPhase('error');
            setStatus({ text: 'Still running', detail: `No result after 15m — job may be queued server-side. ID: ${data.id}. Browser stopped polling.`, spinner: false });
            return;
          }
          if (d.status === 'succeeded') {
            stop();
            activeId.current = null;
            const outputs = predictionOutputs(d);
            const r = { requestId: data.id, outputs, elapsed, model: modelId };
            setResult(r);
            setPhase('done');
            setStatus({ text: 'Completed', detail: `Done in ${elapsed}s`, spinner: false });
            setProgress(null);
            onDoneRef.current && onDoneRef.current(r);
          } else if (d.status === 'failed' || d.status === 'canceled') {
            stop();
            activeId.current = null;
            const canceled = d.status === 'canceled';
            setPhase(canceled ? 'canceled' : 'error');
            setStatus({ text: canceled ? 'Canceled' : 'Failed', detail: `${errOf(d)} [id: ${data.id}]`, spinner: false });
          } else {
            const pct = d.status === 'processing' ? 60 : d.status === 'starting' ? 20 : 40;
            setProgress(pct);
            setStatus({ text: statusText(d.status) || 'Working', detail: `${elapsed}s elapsed`, spinner: true });
          }
        } catch {
          /* keep polling */
        }
      }, 2500);
    } catch (e) {
      activeId.current = null;
      setPhase('error');
      setStatus({ text: 'Error', detail: `${e.message} [model: ${modelId}]`, spinner: false });
      notify && notify(e.message, 'error');
    }
  }, [notify, stop]);

  return { phase, status, progress, result, submit, cancel, busy: phase === 'submitting' || phase === 'polling' };
}

function statusText(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function errOf(d) {
  const e = d?.error;
  const msg = typeof e === 'string' ? e : e ? JSON.stringify(e) : d?.message || 'Generation failed';
  if (/NSFW|safety/i.test(msg)) return `${msg} — try enable disable_safety_checker`;
  return msg;
}
