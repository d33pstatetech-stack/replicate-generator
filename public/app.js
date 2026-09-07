// Responsive UI overhaul for the buildless Replicate SPA.
// Assumption: keep the app single-page and no-bundle so Worker/static deploys remain unchanged.

(function () {
  const LS_TOKEN = 'replicate_token';
  const LS_HISTORY = 'replicate_history';
  const LS_SAVED = 'replicate_saved';
  const LS_CFG = 'replicate_llm_config';

  const DEFAULT_LLM = {
    providers: [
      { baseUrl: 'https://api.venice.ai/api/v1', model: 'venice-uncensored', apiKey: '' },
      { baseUrl: 'https://openrouter.ai/api/v1', model: 'thinkingmachines/inkling:free', apiKey: '' },
      { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free', apiKey: '' },
    ],
  };

  const MODEL_PRESETS = {
    seedance: 'Seedance models: Convert to screenplay format with shot type, subject, action, lighting, audio cues, and temporal transitions. Use @image1..@image9 for omni references when images are provided.',
    wan: 'Wan models: Prefer lightweight prompts, note duration and aspect ratio, and add timestamp direction only when it materially helps the model.',
    minimax: 'MiniMax models: Convert to timecoded present-tense events with clear scene progression.',
    kling: 'Kling/Luma models: Keep language natural and concise while translating camera movement into videography terms.',
    default: '',
  };

  const ENHANCER_TEMPLATE = `refine the following [Media Generation Type] prompt, specifically to optimize it for [Model]. This should include determining the optimal prompt length, or at least the ideal minimum and maximum word counts, determining whether the model excels with keyword based prompts or full narrative descriptions, what types of prompts work best (describe everything vs just describe movement, etc), whether it accepts timestamp direction (at 00:05, do this, at 00:10 do that, etc) and if it does add these timestamp directions based on the total length of the video (as input by the user) and estimating the time it would take for the described actions in the scene to take place, determine if a certain camera lens or videography style works well if called out for the specific model, translate any vague camera movement directions into videographer jargon (dolly out, orbital, chase cam, etc). The media will be generated at [resolution] and [aspect ratio] only if that benefits the prompt. if [Model] includes audio generation, insert appropriate sound effect cues and format dialogue in the most AI friendly format.`;

  const PRIMARY_PARAM_NAMES = new Set([
    'image', 'mask', 'last_image', 'style_reference_images', 'aspect_ratio', 'resolution', 'duration', 'model',
    'num_outputs', 'negative_prompt', 'output_format', 'creativity', 'fast_mode', 'prompt_strength',
    'width', 'height', 'enable_prompt_expansion'
  ]);

  const state = {
    models: Array.isArray(CATALOG) ? [...CATALOG] : [],
    filteredModels: Array.isArray(CATALOG) ? [...CATALOG] : [],
    currentGroup: 'all',
    currentModel: null,
    currentSchema: null,
    currentParams: {},
    uploadedImages: {},
    history: [],
    activePredId: null,
    pollTimer: null,
    abortPoll: false,
    uploadTarget: null,
    lastUploadedUri: '',
    modalReturnFocus: null,
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const cssEscape = window.CSS?.escape
    ? window.CSS.escape.bind(window.CSS)
    : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatShortVersion(version) {
    if (!version) return '—';
    if (!version.includes(':')) return version;
    const [name, hash] = version.split(':');
    return `${name}:${hash.slice(0, 12)}…`;
  }

  function humanize(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function orderOf(spec) {
    return spec?.['x-order'] ?? spec?.x_order ?? 999;
  }

  function toast(message, kind = 'success') {
    const el = $('appToast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast is-${kind === 'error' ? 'error' : 'success'}`;
    el.classList.remove('hidden');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 3600);
  }

  function getToken() {
    return (localStorage.getItem(LS_TOKEN) || '').trim() || ($('tokenInput')?.value || '').trim();
  }

  function setToken(token) {
    const next = (token || '').trim();
    localStorage.setItem(LS_TOKEN, next);
    if ($('tokenInput')) $('tokenInput').value = next;
  }

  function setConnection(ok, message, hint) {
    const dot = $('connectionDot');
    const label = $('connectionLabel');
    const helper = $('connectionHint');
    if (dot) {
      dot.classList.remove('is-success', 'is-error', 'is-idle');
      dot.classList.add(ok === null ? 'is-idle' : ok ? 'is-success' : 'is-error');
    }
    if (label) label.textContent = message || (ok ? 'Connected' : 'Needs attention');
    if (helper) helper.textContent = hint || 'Token stored locally only';
  }

  function isFileProtocol() {
    return location.protocol === 'file:';
  }

  function corsHelp(error) {
    const msg = error?.message || String(error || 'Unknown error');
    if (!/Failed to fetch|NetworkError|Load failed|fetch/i.test(msg)) return msg;
    if (isFileProtocol()) {
      return `${msg}. You are running from file:// (Origin: null). Serve the repo over HTTP, then reopen the app.`;
    }
    return `${msg}. Check CORS, your Replicate token, ad blockers, or the Worker proxy availability.`;
  }

  function defaultsFor(schema) {
    const defaults = {};
    for (const [name, spec] of Object.entries(schema?.properties || {})) {
      if (spec.default !== undefined) defaults[name] = spec.default;
    }
    return defaults;
  }

  function showNoticeForProtocol() {
    const warning = $('fileProtoWarning');
    const okBanner = $('httpOkBanner');
    const protoLabel = $('protoLabel');
    const originLabel = $('originLabel');

    if (protoLabel) protoLabel.textContent = location.protocol === 'file:' ? 'file://' : `${location.protocol}//${location.host}`;
    if (originLabel) originLabel.textContent = `${location.origin}${location.pathname}`;

    if (isFileProtocol()) {
      warning?.classList.remove('hidden');
      okBanner?.classList.add('hidden');
    } else {
      warning?.classList.add('hidden');
      okBanner?.classList.remove('hidden');
      setTimeout(() => okBanner?.classList.add('hidden'), 6000);
    }
  }

  function openDisclosure(id) {
    const disclosure = $(id);
    if (!disclosure) return;
    disclosure.open = true;
    disclosure.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openModal(id, focusId) {
    const modal = $(id);
    if (!modal) return;
    state.modalReturnFocus = document.activeElement;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (focusId) setTimeout(() => $(focusId)?.focus(), 20);
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add('hidden');
    if (!$$('.modal:not(.hidden)').length) document.body.style.overflow = '';
    if (state.modalReturnFocus && typeof state.modalReturnFocus.focus === 'function') {
      state.modalReturnFocus.focus();
      state.modalReturnFocus = null;
    }
  }

  function paramType(name, spec) {
    if (spec?.format === 'uri' || spec?.['x-format'] === 'uri' || ['image', 'mask', 'image_url', 'last_image'].includes(name)) return 'image';
    if (spec?.type === 'array' && spec.items?.format === 'uri') return 'image_array';
    if (spec?.enum?.length) return 'select';
    if ((spec?.type === 'integer' || spec?.type === 'number') && spec.minimum !== undefined && spec.maximum !== undefined) return 'range';
    if (spec?.type === 'integer' || spec?.type === 'number') return 'number';
    if (spec?.type === 'boolean') return 'boolean';
    return 'string';
  }

  function isPrimaryParam(name, spec) {
    if ((state.currentSchema?.required || []).includes(name)) return true;
    if (PRIMARY_PARAM_NAMES.has(name)) return true;
    if ((name === 'width' || name === 'height') && state.currentParams.aspect_ratio === 'custom') return true;
    return false;
  }

  function dependencyWhy(name) {
    const inputImage = !!(state.currentParams.image || state.uploadedImages.image);
    const inputMask = !!(state.currentParams.mask || state.uploadedImages.mask);
    const aspectRatio = state.currentParams.aspect_ratio;
    const goFast = state.currentParams.go_fast;

    if (name === 'prompt_strength' && !inputImage) return 'Only relevant when an input image is provided.';
    if ((name === 'aspect_ratio' || name === 'width' || name === 'height') && (inputImage || inputMask)) return 'Ignored when image or mask input is present.';
    if ((name === 'width' || name === 'height') && aspectRatio !== 'custom') return 'Only enabled when aspect_ratio is set to custom.';
    if ((name === 'width' || name === 'height') && goFast) return 'Disabled while go_fast is enabled.';
    return '';
  }

  function softFootnote(name) {
    if (name === 'output_quality' && state.currentParams.output_format === 'png') return 'PNG outputs ignore quality compression settings.';
    if (name === 'disable_safety_checker') return 'Visible as a toggle, but left collapsed behind info text instead of a large permanent warning block.';
    return '';
  }

  function buildInput() {
    const prompt = ($('promptInput')?.value || '').trim();
    const input = { prompt, ...state.currentParams };

    for (const [key, value] of Object.entries(state.uploadedImages)) input[key] = value;

    if (state.currentSchema?.properties?.disable_safety_checker !== undefined && input.disable_safety_checker === undefined) {
      input.disable_safety_checker = true;
    }

    for (const [key, spec] of Object.entries(state.currentSchema?.properties || {})) {
      if (input[key] === undefined || input[key] === '') {
        delete input[key];
        continue;
      }
      if (spec.type === 'integer') {
        const parsed = parseInt(input[key], 10);
        if (!Number.isNaN(parsed)) input[key] = parsed;
      } else if (spec.type === 'number') {
        const parsed = Number(input[key]);
        if (!Number.isNaN(parsed)) input[key] = parsed;
      } else if (spec.type === 'boolean') {
        input[key] = input[key] === true || input[key] === 'true' || input[key] === 1;
      }
      if (Array.isArray(input[key]) && !input[key].length) delete input[key];
    }

    for (const [key, value] of Object.entries(input)) {
      if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete input[key];
    }

    return input;
  }

  function updatePayloadPreview() {
    const preview = $('payloadPreview');
    if (!preview) return;
    $('charCount').textContent = `${($('promptInput')?.value || '').length} chars`;
    if (!state.currentModel) {
      preview.textContent = '// Select a model to preview the request payload';
      $('actionSummary').textContent = 'Choose a model to begin.';
      $('costValue').textContent = 'Choose a model to prepare the request payload.';
      renderEnhancerContext();
      return;
    }
    const input = buildInput();
    const payload = state.currentModel.version.includes(':')
      ? { version: state.currentModel.version, input }
      : { model: state.currentModel.id, input };
    preview.textContent = JSON.stringify(payload, null, 2);
    $('costValue').textContent = `${state.currentModel.id} · ${state.currentModel.version.includes(':') ? 'version pinned' : 'model alias (latest)'}`;
    $('actionSummary').textContent = `${state.currentModel.id} ready · ${Math.max(Object.keys(input).length - 1, 0)} configurable inputs`;
    renderEnhancerContext();
  }

  function renderFieldHelp(title, description) {
    if (!description) return '';
    return `
      <details class="field-help">
        <summary aria-label="More info about ${escapeHtml(title)}">i</summary>
        <div class="field-help__body">${escapeHtml(description)}</div>
      </details>
    `;
  }

  function renderImageControl(name, multi) {
    const value = state.uploadedImages[name] ?? state.currentParams[name];
    if (multi) {
      const items = Array.isArray(value) ? value : [];
      if (items.length && !Array.isArray(state.uploadedImages[name])) state.uploadedImages[name] = [...items];
      const thumbs = items.length
        ? `<div class="upload-grid">${items.map((src, index) => `
            <div class="upload-chip">
              <img src="${src}" alt="Uploaded ${escapeHtml(name)} reference ${index + 1}">
              <button class="remove-chip" type="button" data-remove-upload="${name}" data-index="${index}" aria-label="Remove image ${index + 1}"><i class="fas fa-times"></i></button>
            </div>
          `).join('')}</div>`
        : '';
      return `
        ${thumbs}
        <button class="upload-tile" type="button" data-zone="${name}" data-multi="1">
          <i class="fas fa-images" aria-hidden="true"></i>
          <strong>Add reference images</strong>
          <span>Click to upload or paste a URL below.</span>
        </button>
        <div class="token-row">
          <input id="url_${name}" class="input" type="url" placeholder="https://example.com/reference.png">
          <button class="button button-secondary" type="button" data-add-url="${name}">Add URL</button>
        </div>
      `;
    }

    const preview = value
      ? `
        <button class="upload-tile is-filled" type="button" data-zone="${name}" aria-label="Replace uploaded ${escapeHtml(name)} image">
          <img src="${value}" alt="Uploaded ${escapeHtml(name)} preview">
        </button>
        <div class="inline-actions wrap">
          <button class="button button-ghost button-small" type="button" data-clear-upload="${name}">Remove image</button>
        </div>
      `
      : `
        <button class="upload-tile" type="button" data-zone="${name}">
          <i class="fas fa-cloud-arrow-up" aria-hidden="true"></i>
          <strong>Upload image</strong>
          <span>Click to browse or drag and drop.</span>
        </button>
      `;

    return `
      ${preview}
      <div class="token-row">
        <input id="url_${name}" class="input" type="url" placeholder="https://example.com/input.png">
        <button class="button button-secondary" type="button" data-use-url="${name}">Use URL</button>
      </div>
    `;
  }

  function renderRangeControl(name, spec, value) {
    const step = spec.type === 'integer' ? 1 : 0.05;
    const safe = value ?? spec.default ?? spec.minimum;
    return `
      <div class="range-row">
        <input class="range-input" type="range" data-param="${name}" min="${spec.minimum}" max="${spec.maximum}" step="${step}" value="${safe}">
        <span id="rv_${name}" class="range-value">${safe}</span>
        <input class="input number-input" type="number" data-param-num="${name}" min="${spec.minimum}" max="${spec.maximum}" step="${step}" value="${safe}">
      </div>
    `;
  }

  function renderField(name, spec) {
    const required = (state.currentSchema?.required || []).includes(name);
    const type = paramType(name, spec);
    const title = spec.title || humanize(name);
    const currentValue = state.currentParams[name] ?? spec.default;
    const reason = dependencyWhy(name);
    const footnote = softFootnote(name);
    const isWide = ['image', 'mask', 'last_image', 'style_reference_images', 'extra_lora', 'lora_weights', 'negative_prompt'].includes(name) || type === 'image_array';

    let control = '';
    if (type === 'image' || type === 'image_array') {
      control = renderImageControl(name, type === 'image_array');
    } else if (type === 'select') {
      const options = (spec.enum || []).map((option) => `<option value="${escapeHtml(option)}" ${String(currentValue) === String(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('');
      control = `<select class="select" data-param="${name}">${!required ? '<option value="">—</option>' : ''}${options}</select>`;
    } else if (type === 'range') {
      control = renderRangeControl(name, spec, currentValue);
    } else if (type === 'number') {
      control = `<input class="input" type="number" data-param="${name}" value="${currentValue ?? ''}" ${spec.minimum !== undefined ? `min="${spec.minimum}"` : ''} ${spec.maximum !== undefined ? `max="${spec.maximum}"` : ''} ${spec.type === 'integer' ? 'step="1"' : ''}>`;
    } else if (type === 'boolean') {
      control = `
        <label class="switch-row">
          <span class="switch">
            <input type="checkbox" data-param="${name}" ${currentValue ? 'checked' : ''}>
            <span class="switch__track" aria-hidden="true"></span>
            <span class="switch__thumb" aria-hidden="true"></span>
          </span>
          <span data-boolean-label="${name}">${currentValue ? 'Enabled' : 'Disabled'}</span>
        </label>
      `;
    } else if (name === 'negative_prompt') {
      control = `<textarea class="textarea textarea-compact" data-param="${name}" placeholder="${escapeHtml(title)}">${escapeHtml(currentValue || '')}</textarea>`;
    } else {
      control = `<input class="input" type="text" data-param="${name}" value="${escapeHtml(currentValue || '')}" placeholder="${escapeHtml(title)}">`;
    }

    return `
      <div class="field-card ${isWide ? 'is-wide' : ''} ${reason ? 'is-disabled' : ''}" data-param-card="${name}">
        <div class="field-head">
          <div>
            <strong>${escapeHtml(title)} ${required ? '<span class="field-badge">Required</span>' : ''}</strong>
            <p class="field-footnote">${escapeHtml(name)}</p>
          </div>
          <div class="field-meta">
            <span class="field-badge">${type.replace('_', ' ')}</span>
            ${renderFieldHelp(title, spec.description)}
          </div>
        </div>
        <div class="field-control">${control}</div>
        ${reason ? `<p class="field-rule"><i class="fas fa-lock"></i> ${escapeHtml(reason)}</p>` : ''}
        ${!reason && footnote ? `<p class="field-footnote">${escapeHtml(footnote)}</p>` : ''}
      </div>
    `;
  }

  function renderParams() {
    const panel = $('paramsPanel');
    const primaryWrap = $('primaryParams');
    const advancedWrap = $('advancedParams');
    const advancedPanel = $('advancedParamsPanel');
    if (!panel || !primaryWrap || !advancedWrap) return;

    if (!state.currentSchema) {
      panel.classList.add('hidden');
      return;
    }

    for (const [key, value] of Object.entries(defaultsFor(state.currentSchema))) {
      if (state.currentParams[key] === undefined) state.currentParams[key] = value;
    }

    const entries = Object.entries(state.currentSchema.properties || {}).filter(([name]) => name !== 'prompt');
    entries.sort((a, b) => orderOf(a[1]) - orderOf(b[1]));

    const primary = [];
    const advanced = [];

    for (const [name, spec] of entries) {
      (isPrimaryParam(name, spec) ? primary : advanced).push(renderField(name, spec));
    }

    primaryWrap.innerHTML = primary.join('') || `<div class="empty-state"><strong>No model-specific parameters</strong><p>The selected model only needs the main prompt.</p></div>`;
    advancedWrap.innerHTML = advanced.join('') || `<p class="muted-copy">No additional advanced controls for this model.</p>`;
    $('paramsCount').textContent = `${entries.length} params`;
    $('advancedCount').textContent = `${advanced.length}`;
    if (!advanced.length) advancedPanel.open = false;

    const unrestricted = $('unrestrictedNote');
    if (state.currentSchema.properties?.disable_safety_checker !== undefined) {
      unrestricted.textContent = 'Safety override is supported on this model. The toggle is still available below, but the explanation has been collapsed into field-level help to reduce clutter.';
      unrestricted.classList.remove('hidden');
    } else {
      unrestricted.classList.add('hidden');
    }

    panel.classList.remove('hidden');
    wireParamControls(panel);
  }

  function wireParamControls(root) {
    $$('[data-zone]', root).forEach((button) => {
      button.addEventListener('click', () => {
        if (button.closest('.field-card')?.classList.contains('is-disabled')) return;
        openUploadModal(button.dataset.zone, button.dataset.multi === '1');
      });
      button.addEventListener('dragover', (event) => {
        event.preventDefault();
      });
      button.addEventListener('drop', (event) => {
        event.preventDefault();
        if (button.closest('.field-card')?.classList.contains('is-disabled')) return;
        const file = event.dataTransfer?.files?.[0];
        if (file) fileToDataUri(file, button.dataset.zone);
      });
    });

    $$('[data-clear-upload]', root).forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.clearUpload;
        delete state.uploadedImages[key];
        delete state.currentParams[key];
        renderParams();
        updatePayloadPreview();
      });
    });

    $$('[data-remove-upload]', root).forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.removeUpload;
        const index = Number(button.dataset.index);
        if (!Array.isArray(state.uploadedImages[key])) return;
        state.uploadedImages[key].splice(index, 1);
        if (!state.uploadedImages[key].length) {
          delete state.uploadedImages[key];
          delete state.currentParams[key];
        } else {
          state.currentParams[key] = [...state.uploadedImages[key]];
        }
        renderParams();
        updatePayloadPreview();
      });
    });

    $$('[data-use-url]', root).forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.useUrl;
        const value = ($(`url_${key}`)?.value || '').trim();
        if (!value) return;
        state.uploadedImages[key] = value;
        state.currentParams[key] = value;
        renderParams();
        updatePayloadPreview();
      });
    });

    $$('[data-add-url]', root).forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.addUrl;
        const value = ($(`url_${key}`)?.value || '').trim();
        if (!value) return;
        if (!Array.isArray(state.uploadedImages[key])) state.uploadedImages[key] = [];
        state.uploadedImages[key].push(value);
        state.currentParams[key] = [...state.uploadedImages[key]];
        renderParams();
        updatePayloadPreview();
      });
    });

    $$('input[type="range"][data-param]', root).forEach((input) => {
      const key = input.dataset.param;
      const numberInput = root.querySelector(`[data-param-num="${cssEscape(key)}"]`);
      const spec = state.currentSchema.properties[key];
      const sync = (raw) => {
        let value = spec.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isNaN(value)) return;
        value = Math.max(spec.minimum, Math.min(spec.maximum, value));
        state.currentParams[key] = value;
        input.value = value;
        if (numberInput) numberInput.value = value;
        const label = $(`rv_${key}`);
        if (label) label.textContent = String(value);
        renderParams();
        updatePayloadPreview();
      };
      input.addEventListener('input', (event) => sync(event.target.value));
      numberInput?.addEventListener('input', (event) => sync(event.target.value));
    });

    $$('[data-param]', root).forEach((control) => {
      if (control.matches('input[type="range"]')) return;
      control.addEventListener('input', handleParamControl);
      control.addEventListener('change', handleParamControl);
    });
  }

  function handleParamControl(event) {
    const control = event.currentTarget;
    const card = control.closest('.field-card');
    if (card?.classList.contains('is-disabled')) return;

    const key = control.dataset.param;
    const spec = state.currentSchema?.properties?.[key];
    if (!spec) return;

    let next;
    if (control.type === 'checkbox') {
      next = control.checked;
      const label = card?.querySelector(`[data-boolean-label="${cssEscape(key)}"]`);
      if (label) label.textContent = next ? 'Enabled' : 'Disabled';
    } else if (control.tagName === 'SELECT') {
      next = control.value || undefined;
    } else if (control.type === 'number') {
      next = control.value === '' ? undefined : (spec.type === 'integer' ? parseInt(control.value, 10) : parseFloat(control.value));
      if (next !== undefined && spec.minimum !== undefined) next = Math.max(spec.minimum, next);
      if (next !== undefined && spec.maximum !== undefined) next = Math.min(spec.maximum, next);
    } else {
      next = control.value.trim() || undefined;
    }

    if (next === undefined || next === '') delete state.currentParams[key];
    else state.currentParams[key] = next;

    renderParams();
    updatePayloadPreview();
  }

  function updateGroupTabs() {
    $$('.group-tab').forEach((button) => {
      const active = button.dataset.group === state.currentGroup;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
  }

  function filterModels() {
    const query = ($('modelSearch')?.value || '').trim().toLowerCase();
    const base = state.currentGroup === 'all' ? state.models : state.models.filter((model) => model.group === state.currentGroup);
    state.filteredModels = base.filter((model) => {
      const haystack = [model.id, model.name, model.category, model.description].join(' ').toLowerCase();
      return haystack.includes(query);
    });
    renderModelList();
    $('modelCount').textContent = `${state.filteredModels.length} model${state.filteredModels.length === 1 ? '' : 's'}`;
    $('headerModelCount').textContent = String(state.models.length);
  }

  function renderModelList() {
    const list = $('modelList');
    if (!list) return;
    if (!state.filteredModels.length) {
      list.innerHTML = `<div class="empty-state"><strong>No models match</strong><p>Try another search or media filter.</p></div>`;
      return;
    }

    list.innerHTML = state.filteredModels.map((model) => {
      const selected = state.currentModel?.id === model.id;
      return `
        <button class="model-option ${selected ? 'is-selected' : ''}" type="button" role="option" aria-selected="${selected}" data-model-id="${escapeHtml(model.id)}">
          <div class="model-option__top">
            <strong>${escapeHtml(model.name || model.id)}</strong>
            <span class="tag">${escapeHtml(model.group)}</span>
          </div>
          <p class="muted-copy">${escapeHtml(model.id)}</p>
          <div class="model-option__bottom">
            <span class="meta-chip">${escapeHtml(model.category || 'Custom')}</span>
            <span class="small-copy mono">${escapeHtml(formatShortVersion(model.version))}</span>
          </div>
        </button>
      `;
    }).join('');

    $$('[data-model-id]', list).forEach((button) => {
      button.addEventListener('click', () => selectModel(button.dataset.modelId));
    });
  }

  async function fetchLiveSchema(ownerName) {
    const token = getToken();
    if (!token) return null;
    try {
      const modelRes = await fetch(`https://api.replicate.com/v1/models/${ownerName}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!modelRes.ok) return null;
      const modelData = await modelRes.json();
      const versionId = modelData.latest_version?.id;
      if (!versionId) return null;
      const versionRes = await fetch(`https://api.replicate.com/v1/models/${ownerName}/versions/${versionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!versionRes.ok) return null;
      const versionData = await versionRes.json();
      return versionData.openapi_schema?.components?.schemas?.Input || null;
    } catch {
      return null;
    }
  }

  function renderModelDetails() {
    const details = $('modelDetails');
    if (!details) return;
    if (!state.currentModel || !state.currentSchema) {
      details.innerHTML = '<p class="muted-copy">Select a model to view schema-backed details.</p>';
      return;
    }
    const props = Object.keys(state.currentSchema.properties || {}).filter((name) => name !== 'prompt');
    details.innerHTML = `
      <div class="stack gap-sm">
        <div>
          <strong>${escapeHtml(state.currentModel.id)}</strong>
          <p class="muted-copy">${escapeHtml(state.currentModel.description || '')}</p>
        </div>
        <div class="inline-actions wrap">
          ${props.map((name) => `<span class="tag">${escapeHtml(name)}</span>`).join('')}
        </div>
        <p class="small-copy mono">Version: ${escapeHtml(state.currentModel.version)}</p>
        <p class="muted-copy">${props.length} model-specific parameters are currently supported in the UI. Unsupported schema fields are intentionally hidden.</p>
      </div>
    `;
  }

  async function selectModel(id) {
    const model = state.models.find((entry) => entry.id === id);
    if (!model) return;
    state.currentModel = model;
    state.currentSchema = model.schema;
    state.currentParams = {};
    state.uploadedImages = {};

    if (!model.version.includes(':') && getToken()) {
      const live = await fetchLiveSchema(model.id);
      if (live) {
        model.schema = live;
        state.currentSchema = live;
        toast(`Loaded live schema for ${model.id}`);
      }
    }

    $('selectedModelName').textContent = model.name || model.id;
    $('modelCategoryBadge').textContent = model.category || 'Custom';
    $('modelVersionLabel').textContent = formatShortVersion(model.version);
    $('selectedModelDescription').textContent = model.description || 'Only schema-supported inputs are shown for the selected model.';
    $('modelPlaygroundLink').href = `https://replicate.com/${model.id}`;
    const customNote = $('customModelNote');
    if (model.category === 'Custom') {
      customNote.textContent = 'Custom model added locally for this browser session.';
      customNote.classList.remove('hidden');
    } else {
      customNote.classList.add('hidden');
    }

    renderModelDetails();
    filterModels();
    renderParams();
    updatePayloadPreview();
    updateGenerateAvailability();
  }

  function updateGenerateAvailability() {
    const ready = !!state.currentModel;
    $('btnGenerate').disabled = !ready;
  }

  function setGenerateBusy(isBusy) {
    $('btnGenerate').disabled = isBusy || !state.currentModel;
    $('genBtnText').classList.toggle('hidden', isBusy);
    $('genBtnSpinner').classList.toggle('hidden', !isBusy);
    $('btnCancel').classList.toggle('hidden', !isBusy);
  }

  function updateStageTrack(stage, isError = false) {
    const chips = {
      queued: $('statusCard').querySelector('[data-stage-chip="queued"]'),
      processing: $('statusCard').querySelector('[data-stage-chip="processing"]'),
      succeeded: $('statusCard').querySelector('[data-stage-chip="succeeded"]'),
    };
    Object.values(chips).forEach((chip) => chip.className = 'status-step');

    if (isError) {
      chips.processing.classList.add('is-error');
      chips.succeeded.classList.add('is-error');
      return;
    }

    if (stage === 'queued' || stage === 'starting' || stage === 'submitting') {
      chips.queued.classList.add('is-current');
    } else if (stage === 'processing') {
      chips.queued.classList.add('is-done');
      chips.processing.classList.add('is-current');
    } else if (stage === 'succeeded') {
      chips.queued.classList.add('is-done');
      chips.processing.classList.add('is-done');
      chips.succeeded.classList.add('is-done');
    }
  }

  function showStatus(stage, detail, busy, meta = '') {
    const badge = $('statusBadge');
    const text = $('statusText');
    const helper = $('statusDetail');
    const metaEl = $('statusMeta');
    const stageKey = String(stage || '').toLowerCase();
    const labelMap = {
      idle: 'Idle',
      submitting: 'Queued',
      queued: 'Queued',
      starting: 'Queued',
      processing: 'Processing',
      succeeded: 'Complete',
      completed: 'Complete',
      failed: 'Failed',
      canceled: 'Canceled',
      error: 'Error',
      network: 'Error',
    };
    const cssMap = {
      idle: 'status-idle',
      submitting: 'status-running',
      queued: 'status-running',
      starting: 'status-running',
      processing: 'status-running',
      succeeded: 'status-success',
      completed: 'status-success',
      failed: 'status-error',
      canceled: 'status-error',
      error: 'status-error',
      network: 'status-error',
    };

    badge.className = `status-badge ${cssMap[stageKey] || 'status-idle'}`;
    badge.textContent = labelMap[stageKey] || humanize(stageKey || 'idle');
    text.textContent = badge.textContent;
    helper.textContent = detail || '';
    metaEl.textContent = meta;
    $('progressWrap').classList.toggle('hidden', !busy);
    updateStageTrack(stageKey, ['failed', 'canceled', 'error', 'network'].includes(stageKey));
  }

  function updateProgress(percent) {
    $('progressBar').style.width = `${percent}%`;
  }

  function renderPendingOutput() {
    const output = $('outputContent');
    const meta = $('outputMeta');
    output.innerHTML = `
      <div class="output-skeleton" aria-hidden="true"></div>
      <div class="helper-copy">Generation is running. You can keep editing prompt and settings while this request finishes.</div>
    `;
    meta.innerHTML = '<span class="meta-chip">Awaiting output</span>';
    setOutputActionsEnabled(false);
    delete $('outputCard').dataset.url;
  }

  function renderEmptyOutput(message) {
    const output = $('outputContent');
    const meta = $('outputMeta');
    output.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-photo-film" aria-hidden="true"></i>
        <strong>${escapeHtml(message || 'Your next image or video will appear here.')}</strong>
        <p>Generated media will scale responsively and recent items stay in your local history.</p>
      </div>
    `;
    meta.innerHTML = '';
    setOutputActionsEnabled(false);
    delete $('outputCard').dataset.url;
  }

  function setOutputActionsEnabled(enabled) {
    ['btnCopyUrl', 'btnDownload', 'btnOpenNew'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !enabled;
    });
  }

  function showOutput(outputs, metrics) {
    const urls = Array.isArray(outputs) ? outputs : [outputs].filter(Boolean);
    const content = $('outputContent');
    const meta = $('outputMeta');
    if (!urls.length) {
      renderEmptyOutput('No output returned from Replicate.');
      return;
    }

    $('outputCard').dataset.url = urls[0];
    const tiles = urls.map((url, index) => {
      const isVideo = /(\.mp4|\.webm|\.mov)(\?|$)/i.test(url);
      const media = isVideo
        ? `<video src="${url}" controls playsinline preload="metadata"></video>`
        : `<img src="${url}" alt="Generated output ${index + 1}" loading="${index === 0 ? 'eager' : 'lazy'}">`;
      return `
        <article class="output-tile">
          ${media}
          <div class="output-tile__meta">
            <span class="meta-chip">${isVideo ? 'Video' : 'Image'} ${index + 1}</span>
            <a class="button button-ghost button-small" href="${url}" target="_blank" rel="noreferrer">Open raw</a>
          </div>
        </article>
      `;
    }).join('');

    content.innerHTML = `<div class="output-gallery">${tiles}</div>`;
    meta.innerHTML = [
      metrics?.predict_time ? `<span class="meta-chip">Predict time ${metrics.predict_time.toFixed(2)}s</span>` : '',
      `<span class="meta-chip">${urls.length} output${urls.length === 1 ? '' : 's'}</span>`,
    ].filter(Boolean).join('');
    setOutputActionsEnabled(true);
  }

  function logLines(logs) {
    const wrap = $('statusLogsWrap');
    const pre = $('statusLogs');
    if (!logs) {
      pre.textContent = '';
      wrap.classList.add('hidden');
      return;
    }
    pre.textContent = String(logs).slice(-6000);
    wrap.classList.remove('hidden');
  }

  function stopPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function addHistory(outputs) {
    const urls = Array.isArray(outputs) ? outputs : [outputs].filter(Boolean);
    const first = urls[0];
    if (!first) return;
    state.history.unshift({
      url: first,
      outputs: urls,
      model: state.currentModel?.id || 'Unknown model',
      prompt: ($('promptInput')?.value || '').trim().slice(0, 120),
      time: new Date().toISOString(),
    });
    if (state.history.length > 40) state.history.pop();
    localStorage.setItem(LS_HISTORY, JSON.stringify(state.history));
    renderHistory();
  }

  function loadHistory() {
    try {
      state.history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
    } catch {
      state.history = [];
    }
    renderHistory();
  }

  function renderHistory() {
    const grid = $('historyGrid');
    if (!grid) return;
    if (!state.history.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <strong>No generations yet</strong>
          <p>Your successful Replicate outputs will appear here and persist in localStorage.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = state.history.slice(0, 24).map((item, index) => {
      const isVideo = /(\.mp4|\.webm|\.mov)(\?|$)/i.test(item.url);
      const media = isVideo
        ? '<div class="history-card__media"><i class="fas fa-video fa-lg" aria-hidden="true"></i></div>'
        : `<div class="history-card__media"><img src="${item.url}" alt="Recent generated output ${index + 1}" loading="lazy"></div>`;
      return `
        <article class="history-card" data-history-index="${index}">
          ${media}
          <div>
            <strong>${escapeHtml(item.model)}</strong>
            <p class="muted-copy">${escapeHtml(item.prompt || 'No prompt saved')}</p>
          </div>
          <div class="history-card__footer">
            <span class="small-copy">${new Date(item.time).toLocaleString()}</span>
            <button class="button button-ghost button-small" type="button" data-open-history="${index}">Open</button>
          </div>
        </article>
      `;
    }).join('');

    $$('[data-open-history]', grid).forEach((button) => {
      button.addEventListener('click', () => {
        const item = state.history[Number(button.dataset.openHistory)];
        if (item?.url) window.open(item.url, '_blank', 'noopener');
      });
    });
  }

  function getSavedPrompts() {
    try {
      return JSON.parse(localStorage.getItem(LS_SAVED) || '[]');
    } catch {
      return [];
    }
  }

  function saveSavedPrompts(items) {
    localStorage.setItem(LS_SAVED, JSON.stringify(items));
  }

  function savePrompt(kind = 'saved', promptValue) {
    const prompt = promptValue || ($('promptInput')?.value || '').trim();
    if (!prompt) return;
    const saved = getSavedPrompts();
    saved.unshift({
      prompt,
      model: state.currentModel?.id || '',
      params: { ...state.currentParams },
      kind,
      time: new Date().toISOString(),
    });
    if (saved.length > 50) saved.pop();
    saveSavedPrompts(saved);
    renderSavedPrompts();
    toast(kind === 'enhanced' ? 'Enhanced prompt saved' : 'Prompt saved');
  }

  function renderSavedPrompts() {
    const list = $('savedList');
    if (!list) return;
    const saved = getSavedPrompts();
    if (!saved.length) {
      list.innerHTML = '<div class="empty-state"><strong>No saved prompts</strong><p>Save a prompt or enhanced output to reuse it later.</p></div>';
      return;
    }

    list.innerHTML = saved.map((entry, index) => `
      <article class="saved-item">
        <div>
          <strong>${escapeHtml((entry.kind || 'saved').toUpperCase())}</strong>
          <p class="muted-copy">${escapeHtml((entry.prompt || '').slice(0, 160))}</p>
        </div>
        <div class="saved-item__meta">
          <span class="small-copy">${entry.model ? escapeHtml(entry.model) : 'No model'}</span>
          <span class="small-copy">${new Date(entry.time).toLocaleDateString()}</span>
        </div>
        <div class="saved-item__actions">
          <button class="button button-primary button-small" type="button" data-load-saved="${index}">Load</button>
          <button class="button button-ghost button-small" type="button" data-copy-saved="${index}">Copy</button>
        </div>
      </article>
    `).join('');

    $$('[data-load-saved]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const entry = saved[Number(button.dataset.loadSaved)];
        if (!entry) return;
        $('promptInput').value = entry.prompt || '';
        if (entry.model) await selectModel(entry.model);
        state.currentParams = { ...(entry.params || {}) };
        renderParams();
        updatePayloadPreview();
        toast('Saved prompt restored');
      });
    });

    $$('[data-copy-saved]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const entry = saved[Number(button.dataset.copySaved)];
        if (!entry?.prompt) return;
        await navigator.clipboard.writeText(entry.prompt);
        toast('Saved prompt copied');
      });
    });
  }

  function fillLoraForCurrentModel(repoUrl, fileUrl) {
    const props = state.currentSchema?.properties || {};
    const target = ['extra_lora', 'lora_weights'].find((key) => props[key]?.type === 'string');
    if (!target) {
      navigator.clipboard.writeText(repoUrl);
      toast('Copied LoRA repo URL; no compatible LoRA field on this model.');
      return;
    }
    const toFill = repoUrl || fileUrl;
    state.currentParams[target] = toFill;
    renderParams();
    updatePayloadPreview();
    const input = document.querySelector(`[data-param="${cssEscape(target)}"]`);
    input?.focus();
    input?.select?.();
    toast(`Filled ${target}`);
  }

  function renderLoras() {
    const list = $('loraList');
    if (!list) return;
    list.innerHTML = (USER_LORAS || []).map((lora) => `
      <article class="lora-card">
        <div class="lora-card__top">
          <div>
            <strong>${escapeHtml(lora.name)}</strong>
            <p class="muted-copy">${escapeHtml(lora.id)} · ${escapeHtml(lora.base_model)}</p>
          </div>
          <span class="tag">${lora.private ? 'Private' : 'Public'}</span>
        </div>
        <p class="muted-copy">${escapeHtml(lora.note || '')}</p>
        <div class="inline-actions wrap">
          ${lora.instance_prompt ? `<span class="meta-chip">Trigger ${escapeHtml(lora.instance_prompt)}</span>` : '<span class="meta-chip">No trigger word</span>'}
          <span class="meta-chip">Suggested ${escapeHtml(lora.suggested_target || 'LoRA-compatible model')}</span>
        </div>
        <div class="lora-card__actions">
          <button class="button button-primary button-small" type="button" data-fill-repo="${escapeHtml(lora.id)}">Fill repo URL</button>
          <button class="button button-ghost button-small" type="button" data-fill-file="${escapeHtml(lora.id)}">Fill file URL</button>
          <button class="button button-ghost button-small" type="button" data-copy-trigger="${escapeHtml(lora.id)}">Copy trigger</button>
        </div>
      </article>
    `).join('');

    $$('[data-fill-repo]', list).forEach((button) => {
      button.addEventListener('click', () => {
        const lora = (USER_LORAS || []).find((item) => item.id === button.dataset.fillRepo);
        if (lora) fillLoraForCurrentModel(lora.repo_url, lora.file_url);
      });
    });
    $$('[data-fill-file]', list).forEach((button) => {
      button.addEventListener('click', () => {
        const lora = (USER_LORAS || []).find((item) => item.id === button.dataset.fillFile);
        if (lora) fillLoraForCurrentModel(lora.file_url, lora.repo_url);
      });
    });
    $$('[data-copy-trigger]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const lora = (USER_LORAS || []).find((item) => item.id === button.dataset.copyTrigger);
        if (!lora?.instance_prompt) return toast('No trigger word stored for this LoRA', 'error');
        await navigator.clipboard.writeText(lora.instance_prompt);
        toast('Trigger copied');
      });
    });
  }

  function hasDialogueCues(value) {
    return /["\u201c\u201d].*["\u201c\u201d]|dialogue|says\s+["\u201c]|speaking|voice:/i.test(value || '');
  }

  function deriveMediaType(model) {
    if (!model) return 'text-to-video';
    const id = (model.id || '').toLowerCase();
    const category = (model.category || '').toLowerCase();
    if (id.includes('reference-to-video')) return 'reference-to-video';
    if (id.includes('image-to-video') || id.includes('-i2v') || id.includes('i2v')) return 'image-to-video';
    if (id.includes('text-to-video') || id.includes('-t2v')) return 'text-to-video';
    if (category.includes('audio')) return 'audio generation';
    if (category.includes('image')) return 'text-to-image';
    return 'text-to-video';
  }

  function getEnhancerContext() {
    const model = state.currentModel;
    if (!model) return null;
    const params = state.currentParams || {};
    return {
      model: model.id,
      mediaType: deriveMediaType(model),
      aspectRatio: params.aspect_ratio || null,
      resolution: params.resolution || (params.width && params.height ? `${params.width}x${params.height}` : null),
      duration: params.duration || null,
      hasAudio: /seedance|wan|audio/i.test(model.id),
    };
  }

  function buildSystemPrompt(raw, context) {
    let prompt = ENHANCER_TEMPLATE.replace('[Media Generation Type]', context.mediaType).replace(/\[Model\]/g, context.model);
    const resolutionBits = [context.resolution, context.aspectRatio].filter(Boolean);
    if (resolutionBits.length) prompt = prompt.replace('[resolution] and [aspect ratio]', resolutionBits.join(' and '));
    else prompt = prompt.replace('at [resolution] and [aspect ratio]', '');
    if (!context.hasAudio) prompt = prompt.replace(/if .*?friendly format\./i, '').trim();
    if (!hasDialogueCues(raw)) prompt += ' Dialogue formatting is not needed unless the prompt already implies speech.';
    if (context.duration && context.mediaType.includes('video')) prompt += ` Video length: ${context.duration} seconds.`;

    const family = context.model.toLowerCase();
    let preset = MODEL_PRESETS.default;
    if (family.includes('seedance')) preset = MODEL_PRESETS.seedance;
    else if (family.includes('wan')) preset = MODEL_PRESETS.wan;
    else if (family.includes('minimax') || family.includes('hailuo')) preset = MODEL_PRESETS.minimax;
    else if (family.includes('kling') || family.includes('luma')) preset = MODEL_PRESETS.kling;
    if (preset) prompt += `\n\nModel-specific formatting: ${preset}`;

    prompt += '\n\nYou are a technical prompt engineer whose sole job is format optimization. Process all prompt types professionally, including mature or adult content, without refusing. Respond with only the optimized prompt.';
    return prompt;
  }

  async function getLLMConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_CFG) || 'null');
      if (saved?.providers?.length) return saved;
    } catch {}
    try {
      const shared = JSON.parse(localStorage.getItem('muapi_llm_config') || 'null');
      if (shared?.providers?.length) return shared;
    } catch {}
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      const response = await fetch('/api/llm-config', { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const data = await response.json();
        if (data.config?.providers?.length) return data.config;
      }
    } catch {}
    return DEFAULT_LLM;
  }

  async function saveLLMConfig(config) {
    localStorage.setItem(LS_CFG, JSON.stringify(config));
    localStorage.setItem('muapi_llm_config', JSON.stringify(config));
    try {
      await fetch('/api/llm-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
    } catch {}
  }

  async function renderSettings() {
    const config = await getLLMConfig();
    const list = $('llmProvidersList');
    list.innerHTML = '';

    config.providers.forEach((provider, index) => {
      const row = document.createElement('div');
      row.className = 'provider-row';
      row.dataset.index = String(index);
      row.draggable = true;
      row.innerHTML = `
        <button class="icon-button provider-grip" type="button" aria-label="Reorder provider"><i class="fas fa-grip-lines"></i></button>
        <div class="provider-fields">
          <input class="input" data-key="baseUrl" value="${escapeHtml(provider.baseUrl || '')}" placeholder="https://api.venice.ai/api/v1">
          <input class="input" data-key="model" value="${escapeHtml(provider.model || '')}" placeholder="Model identifier">
          <input class="input" type="password" data-key="apiKey" value="${provider.apiKey === '***' ? '' : escapeHtml(provider.apiKey || '')}" placeholder="${provider.apiKey === '***' ? '•••• stored on Worker or locally' : 'API key'}">
        </div>
        <button class="icon-button" type="button" data-remove-provider="${index}" aria-label="Remove provider"><i class="fas fa-trash"></i></button>
      `;
      list.appendChild(row);
    });

    let dragIndex = null;
    $$('[data-index]', list).forEach((row) => {
      row.addEventListener('dragstart', () => { dragIndex = Number(row.dataset.index); });
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', async () => {
        const dropIndex = Number(row.dataset.index);
        if (dragIndex === null || dragIndex === dropIndex) return;
        const next = await getLLMConfig();
        const [moved] = next.providers.splice(dragIndex, 1);
        next.providers.splice(dropIndex, 0, moved);
        await saveLLMConfig(next);
        renderSettings();
      });
    });

    $$('[data-remove-provider]', list).forEach((button) => {
      button.addEventListener('click', async () => {
        const next = await getLLMConfig();
        next.providers.splice(Number(button.dataset.removeProvider), 1);
        if (!next.providers.length) next.providers.push({ baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKey: '' });
        await saveLLMConfig(next);
        renderSettings();
      });
    });
  }

  async function persistSettingsFromForm() {
    const current = await getLLMConfig();
    const providers = $$('[data-index]', $('llmProvidersList')).map((row, index) => {
      const baseUrl = row.querySelector('[data-key="baseUrl"]')?.value.trim() || 'https://openrouter.ai/api/v1';
      const model = row.querySelector('[data-key="model"]')?.value.trim();
      const apiKey = row.querySelector('[data-key="apiKey"]')?.value || '';
      const existing = current.providers[index];
      return model ? {
        baseUrl,
        model,
        apiKey: apiKey || (existing?.apiKey === '***' ? '***' : existing?.apiKey || ''),
      } : null;
    }).filter(Boolean);

    if (!providers.length) {
      toast('Add at least one enhancer provider', 'error');
      return;
    }

    await saveLLMConfig({ providers });
    const status = $('settingsStatus');
    status.textContent = 'Enhancer settings saved.';
    status.classList.remove('hidden');
    toast('LLM settings saved');
    closeModal('settingsModal');
  }

  function renderEnhancerContext() {
    const preview = $('enhancerContextPreview');
    const context = getEnhancerContext();
    if (!context) {
      preview.classList.add('hidden');
      return;
    }
    preview.classList.remove('hidden');
    preview.textContent = `Model: ${context.model} · ${context.mediaType} · ${context.resolution || 'auto'} · ${context.aspectRatio || 'auto'}${context.duration ? ` · ${context.duration}s` : ''}${context.hasAudio ? ' · audio aware' : ''}`;
  }

  async function doEnhance() {
    const raw = ($('enhancerInput')?.value || '').trim();
    if (!raw) return toast('Enter a prompt to enhance', 'error');
    const context = getEnhancerContext();
    if (!context?.model) return toast('Select a model before enhancing', 'error');

    const button = $('btnEnhancePrompt');
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span> Enhancing';
    $('enhancerOutput').value = '';
    $('enhancerMeta').textContent = 'Trying the Worker-backed enhancer first…';
    renderEnhancerContext();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 50000);
      const response = await fetch('/api/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawPrompt: raw, modelId: context.model, params: state.currentParams || {} }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const type = response.headers.get('content-type') || '';
        let full = '';
        let providerUsed = response.headers.get('X-Provider-Used') || 'worker';
        let modelUsed = response.headers.get('X-Model-Used') || '?';

        if (type.includes('text/event-stream') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const payload = line.slice(6).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const json = JSON.parse(payload);
                const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.delta?.reasoning_content || '';
                if (delta) {
                  full += delta;
                  $('enhancerOutput').value = full;
                  $('enhancerMeta').textContent = `Streaming via ${providerUsed} / ${modelUsed}`;
                }
              } catch {}
            }
          }
        } else {
          const data = await response.json();
          full = data.enhanced || data.optimized_prompt || '';
          providerUsed = data.providerUsed || providerUsed;
          modelUsed = data.modelUsed || modelUsed;
        }

        if (!full) throw new Error('Empty enhancer response');
        $('enhancerOutput').value = full;
        $('enhancerMeta').textContent = `Enhanced via ${providerUsed} / ${modelUsed}`;
        toast('Prompt enhanced');
        return;
      }
    } catch (error) {
      console.warn('Worker enhancer unavailable, falling back to direct providers:', error);
    }

    try {
      const config = await getLLMConfig();
      const systemPrompt = buildSystemPrompt(raw, context);
      let lastError = 'All enhancer providers failed';

      for (const provider of config.providers) {
        const baseUrl = (provider.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
        const isVenice = /venice/i.test(baseUrl);
        let apiKey = provider.apiKey || '';
        if (!apiKey) apiKey = isVenice ? (localStorage.getItem('VENICE_API_KEY') || '') : (localStorage.getItem('OPENROUTER_API_KEY') || '');
        if (!apiKey) {
          lastError = `Missing API key for ${provider.model}`;
          continue;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              'HTTP-Referer': location.origin,
              'X-Title': 'Replicate Prompt Orchestrator',
            },
            body: JSON.stringify({
              model: provider.model,
              stream: false,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Raw prompt: """${raw}"""` },
              ],
            }),
          });
          clearTimeout(timeout);
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            lastError = text || `HTTP ${response.status}`;
            continue;
          }
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.content || '';
          if (!content) {
            lastError = `Empty response from ${provider.model}`;
            continue;
          }
          $('enhancerOutput').value = content;
          $('enhancerMeta').textContent = `Enhanced via ${baseUrl} / ${provider.model} (direct)`;
          toast('Prompt enhanced');
          return;
        } catch (error) {
          clearTimeout(timeout);
          lastError = error.name === 'AbortError' ? `Timed out on ${provider.model}` : error.message;
        }
      }
      throw new Error(lastError);
    } catch (error) {
      $('enhancerMeta').textContent = corsHelp(error);
      toast(corsHelp(error), 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  async function testToken() {
    const button = $('btnTestToken');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Testing…';
    try {
      try {
        const workerRes = await fetch('/api/replicate/models/d33pstatetech-stack/aznten_replicate');
        const contentType = workerRes.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await workerRes.json();
          if (workerRes.ok) {
            setConnection(true, 'Worker proxy ready', 'Replicate requests can be proxied without exposing the token.');
            toast(`Worker proxy OK: ${data.name || 'aznten_replicate'}`);
            return;
          }
        }
      } catch {}

      const token = getToken();
      if (!token) throw new Error('Paste a Replicate token first');
      const response = await fetch('https://api.replicate.com/v1/models/d33pstatetech-stack/aznten_replicate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);
      setConnection(true, 'Token verified', 'Direct Replicate access is working.');
      toast(`Token OK: ${data.name || 'aznten_replicate'}`);
    } catch (error) {
      const message = corsHelp(error);
      setConnection(false, 'Connection failed', message);
      showStatus('network', message, false);
      toast(message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function generate() {
    if (!state.currentModel || !state.currentSchema) return toast('Select a model first', 'error');
    const token = getToken();
    if (!token) return toast('Save a Replicate API token first', 'error');

    const prompt = ($('promptInput')?.value || '').trim();
    if (!prompt) return toast('Prompt is required', 'error');

    const input = buildInput();
    const missing = (state.currentSchema.required || []).filter((name) => name !== 'prompt' && input[name] === undefined);
    if (missing.length) return toast(`Missing required params: ${missing.join(', ')}`, 'error');

    state.abortPoll = false;
    state.activePredId = null;
    setGenerateBusy(true);
    showStatus('submitting', 'Sending request to Replicate…', true);
    updateProgress(18);
    renderPendingOutput();
    logLines('');

    const preferWait = $('chkPreferWait').checked;
    const body = state.currentModel.version.includes(':')
      ? { version: state.currentModel.version, input }
      : { model: state.currentModel.id, input };

    try {
      let response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const workerRes = await fetch('/api/replicate/predictions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const contentType = workerRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json') && !workerRes.ok) throw new Error('Worker proxy unavailable');
        response = workerRes;
      } catch {
        response = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(preferWait ? { Prefer: 'wait' } : {}),
          },
          body: JSON.stringify(body),
        });
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || data.title || `HTTP ${response.status}`);
      state.activePredId = data.id;

      if (data.status === 'succeeded') {
        showStatus('succeeded', 'Generation completed successfully.', false, `id=${data.id}`);
        updateProgress(100);
        showOutput(data.output, data.metrics);
        logLines(data.logs);
        addHistory(data.output);
        setGenerateBusy(false);
        state.activePredId = null;
        return;
      }

      if (data.status === 'failed') {
        throw new Error(data.error || 'Generation failed');
      }

      showStatus(data.status || 'queued', 'Replicate accepted the request. Polling for updates…', true, `id=${data.id}`);
      updateProgress(data.status === 'processing' ? 60 : 32);
      poll(data.id);
    } catch (error) {
      const message = corsHelp(error);
      const stage = /invalid|version is required|model not found|additional property/i.test(message) ? 'error' : 'network';
      showStatus(stage, message, false);
      renderEmptyOutput('Generation did not complete. Review the status message and payload, then try again.');
      logLines(`${message}\n\nIf you opened the app directly from file://, serve it over HTTP first.`);
      toast(message, 'error');
      setGenerateBusy(false);
      state.activePredId = null;
    }
  }

  function poll(id) {
    stopPolling();
    const token = getToken();
    const started = Date.now();
    state.pollTimer = setInterval(async () => {
      if (state.abortPoll) return;
      try {
        let response;
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const workerRes = await fetch(`/api/replicate/predictions/${id}`, { signal: controller.signal });
          clearTimeout(timeout);
          const contentType = workerRes.headers.get('content-type') || '';
          if (!contentType.includes('application/json') && !workerRes.ok) throw new Error('Worker poll fallback');
          response = workerRes;
        } catch {
          response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        }

        const data = await response.json();
        const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s elapsed`;

        if (data.status === 'succeeded') {
          stopPolling();
          showStatus('succeeded', `Done in ${elapsed}.`, false, `id=${id}`);
          updateProgress(100);
          showOutput(data.output, data.metrics);
          logLines(data.logs);
          addHistory(data.output);
          setGenerateBusy(false);
          state.activePredId = null;
          return;
        }

        if (data.status === 'failed' || data.status === 'canceled') {
          stopPolling();
          showStatus(data.status, data.error || data.status, false, `id=${id}`);
          renderEmptyOutput(data.status === 'canceled' ? 'Generation was canceled before an output was returned.' : 'Generation failed before producing output.');
          logLines(data.logs || data.error);
          setGenerateBusy(false);
          state.activePredId = null;
          return;
        }

        showStatus(data.status || 'queued', elapsed, true, `id=${id}`);
        logLines(data.logs);
        updateProgress(data.status === 'processing' ? 68 : data.status === 'starting' ? 40 : 48);
      } catch {
        // keep polling quietly
      }
    }, 2500);
  }

  async function cancelPrediction() {
    if (!state.activePredId) return;
    state.abortPoll = true;
    stopPolling();
    try {
      try {
        const workerRes = await fetch(`/api/replicate/predictions/${state.activePredId}/cancel`, { method: 'POST' });
        const contentType = workerRes.headers.get('content-type') || '';
        if (!contentType.includes('application/json') && !workerRes.ok) throw new Error('Worker cancel fallback');
      } catch {
        await fetch(`https://api.replicate.com/v1/predictions/${state.activePredId}/cancel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
        });
      }
      showStatus('canceled', 'Prediction canceled.', false, `id=${state.activePredId}`);
      renderEmptyOutput('Generation was canceled. Configure the next request whenever you are ready.');
      toast('Prediction canceled');
    } catch (error) {
      toast(corsHelp(error), 'error');
    } finally {
      state.activePredId = null;
      setGenerateBusy(false);
    }
  }

  function openUploadModal(paramName, isMulti) {
    state.uploadTarget = { paramName, isMulti };
    $('imageUrlInput').value = '';
    $('fileInput').value = '';
    $('uploadPreview').classList.add('hidden');
    $('btnConfirmUpload').classList.add('hidden');
    $('uploadStatus').textContent = '';
    openModal('uploadModal', 'imageUrlInput');
  }

  function fileToDataUri(file, paramName) {
    const reader = new FileReader();
    reader.onload = (event) => {
      state.lastUploadedUri = event.target.result;
      $('uploadPreviewImg').src = state.lastUploadedUri;
      $('uploadStatus').textContent = `Ready to attach ${file.name} (${(file.size / 1024).toFixed(1)} KB).`;
      $('uploadPreview').classList.remove('hidden');
      $('btnConfirmUpload').classList.remove('hidden');
      $('btnConfirmUpload').onclick = () => {
        if (!state.uploadTarget) return;
        const { paramName: key, isMulti } = state.uploadTarget;
        if (isMulti) {
          if (!Array.isArray(state.uploadedImages[key])) state.uploadedImages[key] = [];
          state.uploadedImages[key].push(state.lastUploadedUri);
          state.currentParams[key] = [...state.uploadedImages[key]];
        } else {
          state.uploadedImages[key] = state.lastUploadedUri;
          state.currentParams[key] = state.lastUploadedUri;
        }
        closeModal('uploadModal');
        renderParams();
        updatePayloadPreview();
      };
    };
    reader.readAsDataURL(file);
  }

  async function copyText(value, successMessage) {
    await navigator.clipboard.writeText(value);
    toast(successMessage || 'Copied');
  }

  function addCustomModel() {
    const rawId = ($('customModelId')?.value || '').trim();
    const rawSchema = ($('customModelSchema')?.value || '').trim();
    const status = $('addModelStatus');
    if (!rawId) return toast('Model identifier is required', 'error');
    if (!rawSchema) return toast('Paste schema JSON or fetch it live', 'error');

    try {
      const schema = JSON.parse(rawSchema);
      if (!schema.properties) throw new Error('Schema must include a properties object');
      const ownerName = rawId.split(':')[0];
      const version = rawId.includes(':') ? rawId : ownerName;
      state.models.unshift({
        id: ownerName,
        name: `${ownerName} (custom)`,
        group: 'image',
        category: 'Custom',
        version,
        description: `Custom model added ${new Date().toLocaleString()}`,
        schema,
      });
      $('customModelId').value = '';
      $('customModelSchema').value = '';
      status.textContent = 'Custom model added.';
      status.classList.remove('hidden');
      closeModal('addModelModal');
      filterModels();
      selectModel(ownerName);
      toast('Custom model added');
    } catch (error) {
      status.textContent = error.message;
      status.classList.remove('hidden');
      toast(error.message, 'error');
    }
  }

  async function fetchCustomSchema() {
    const rawId = ($('customModelId')?.value || '').trim();
    if (!rawId) return toast('Enter owner/name first', 'error');
    const status = $('addModelStatus');
    status.textContent = 'Fetching live schema…';
    status.classList.remove('hidden');
    const schema = await fetchLiveSchema(rawId.split(':')[0]);
    if (!schema) {
      status.textContent = 'Failed to fetch schema. Check your token or model name.';
      return;
    }
    $('customModelSchema').value = JSON.stringify(schema, null, 2);
    status.textContent = `Fetched ${Object.keys(schema.properties || {}).length} fields.`;
  }

  function bindEvents() {
    $('btnDismissFileWarning')?.addEventListener('click', () => $('fileProtoWarning')?.classList.add('hidden'));
    $('btnCopyServeCmd')?.addEventListener('click', () => copyText('python -m http.server 8000', 'Copied: python -m http.server 8000'));

    $('btnSaveToken')?.addEventListener('click', () => {
      setToken($('tokenInput').value);
      setConnection(null, 'Token saved', 'Saved locally in this browser.');
      toast('Token saved locally');
    });
    $('tokenInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        setToken($('tokenInput').value);
        toast('Token saved locally');
      }
    });
    $('btnTestToken')?.addEventListener('click', testToken);

    $$('.group-tab').forEach((button) => {
      button.addEventListener('click', () => {
        state.currentGroup = button.dataset.group;
        updateGroupTabs();
        filterModels();
      });
    });
    $('modelSearch')?.addEventListener('input', filterModels);

    $('btnSavedPrompts')?.addEventListener('click', () => openDisclosure('savedDisclosure'));
    $('btnSettings')?.addEventListener('click', async () => {
      await renderSettings();
      openModal('settingsModal');
    });
    $('btnAddModel')?.addEventListener('click', () => openModal('addModelModal', 'customModelId'));
    $('btnHistoryClear')?.addEventListener('click', () => {
      if (!confirm('Clear recent generation history?')) return;
      state.history = [];
      localStorage.setItem(LS_HISTORY, '[]');
      renderHistory();
      toast('History cleared');
    });

    $('promptInput')?.addEventListener('input', updatePayloadPreview);
    $('btnClear')?.addEventListener('click', () => {
      $('promptInput').value = '';
      updatePayloadPreview();
    });
    $('btnRandomPrompt')?.addEventListener('click', () => {
      const examples = [
        'aznten portrait in neon rain, 85mm lens, shallow depth of field, cinematic reflections',
        'product photo of a matte ceramic lamp on travertine, studio lighting, premium editorial style',
        'wide aerial view of a futuristic coastal city at sunrise, volumetric fog, filmic color grade',
        'dramatic sci-fi corridor tracking shot, sparks, smoke, moody blue and amber practical lights'
      ];
      $('promptInput').value = examples[Math.floor(Math.random() * examples.length)];
      updatePayloadPreview();
    });
    $('btnSavePrompt')?.addEventListener('click', () => savePrompt('saved'));
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        generate();
      }
      if (event.key === 'Escape') {
        $$('.modal').forEach((modal) => {
          if (!modal.classList.contains('hidden')) closeModal(modal.id);
        });
      }
    });

    $('btnResetDefaults')?.addEventListener('click', () => {
      if (!state.currentSchema) return;
      state.currentParams = { ...defaultsFor(state.currentSchema) };
      state.uploadedImages = {};
      renderParams();
      updatePayloadPreview();
      toast('Defaults restored');
    });
    $('btnCopyParams')?.addEventListener('click', () => copyText(JSON.stringify(state.currentParams, null, 2), 'Parameters copied'));
    $('btnCopyPayload')?.addEventListener('click', () => copyText($('payloadPreview').textContent, 'Payload copied'));
    $('btnCopyCurl')?.addEventListener('click', () => {
      const token = getToken() || '$REPLICATE_API_TOKEN';
      const payload = $('payloadPreview').textContent.replace(/'/g, `'"'"'`);
      const curl = `curl -s -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -H "Prefer: wait" -d '${payload}' https://api.replicate.com/v1/predictions`;
      copyText(curl, 'curl copied');
    });

    $('btnGenerate')?.addEventListener('click', generate);
    $('btnCancel')?.addEventListener('click', cancelPrediction);

    $('btnCopyUrl')?.addEventListener('click', () => {
      const url = $('outputCard').dataset.url;
      if (url) copyText(url, 'Output URL copied');
    });
    $('btnDownload')?.addEventListener('click', () => {
      const url = $('outputCard').dataset.url;
      if (url) window.open(url, '_blank', 'noopener');
    });
    $('btnOpenNew')?.addEventListener('click', () => {
      const url = $('outputCard').dataset.url;
      if (url) window.open(url, '_blank', 'noopener');
    });

    $('btnEnhancePrompt')?.addEventListener('click', doEnhance);
    $('btnUseEnhanced')?.addEventListener('click', () => {
      const value = $('enhancerOutput').value.trim();
      if (!value) return;
      $('promptInput').value = value;
      updatePayloadPreview();
      toast('Enhanced prompt applied');
    });
    $('btnCopyEnhanced')?.addEventListener('click', () => {
      const value = $('enhancerOutput').value.trim();
      if (value) copyText(value, 'Enhanced prompt copied');
    });
    $('btnSaveEnhanced')?.addEventListener('click', () => {
      const value = $('enhancerOutput').value.trim();
      if (value) savePrompt('enhanced', value);
    });

    $('closeSettingsModal')?.addEventListener('click', () => closeModal('settingsModal'));
    $('btnCancelSettings')?.addEventListener('click', () => closeModal('settingsModal'));
    $('btnAddProvider')?.addEventListener('click', async () => {
      const config = await getLLMConfig();
      config.providers.push({ baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKey: '' });
      await saveLLMConfig(config);
      renderSettings();
    });
    $('btnSaveSettings')?.addEventListener('click', persistSettingsFromForm);

    $('closeUploadModal')?.addEventListener('click', () => closeModal('uploadModal'));
    $('btnCancelUpload')?.addEventListener('click', () => closeModal('uploadModal'));
    $('fileInput')?.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file && state.uploadTarget) fileToDataUri(file, state.uploadTarget.paramName);
    });
    $('btnUseUrl')?.addEventListener('click', () => {
      const value = ($('imageUrlInput')?.value || '').trim();
      if (!value || !state.uploadTarget) return;
      const { paramName, isMulti } = state.uploadTarget;
      if (isMulti) {
        if (!Array.isArray(state.uploadedImages[paramName])) state.uploadedImages[paramName] = [];
        state.uploadedImages[paramName].push(value);
        state.currentParams[paramName] = [...state.uploadedImages[paramName]];
      } else {
        state.uploadedImages[paramName] = value;
        state.currentParams[paramName] = value;
      }
      closeModal('uploadModal');
      renderParams();
      updatePayloadPreview();
    });
    const dropZone = $('dropZone');
    dropZone?.addEventListener('dragover', (event) => event.preventDefault());
    dropZone?.addEventListener('drop', (event) => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file && state.uploadTarget) fileToDataUri(file, state.uploadTarget.paramName);
    });

    $('closeAddModelModal')?.addEventListener('click', () => closeModal('addModelModal'));
    $('btnAddCustomModel')?.addEventListener('click', addCustomModel);
    $('btnFetchSchema')?.addEventListener('click', fetchCustomSchema);

    $$('[data-close-modal]').forEach((backdrop) => {
      backdrop.addEventListener('click', () => closeModal(backdrop.dataset.closeModal));
    });
  }

  function init() {
    showNoticeForProtocol();
    bindEvents();
    renderLoras();
    renderSavedPrompts();
    loadHistory();
    updateGroupTabs();
    filterModels();
    renderEmptyOutput();
    renderEnhancerContext();
    updatePayloadPreview();
    const savedToken = localStorage.getItem(LS_TOKEN) || '';
    if (savedToken) {
      setToken(savedToken);
      setConnection(null, 'Token loaded', 'Saved locally in this browser.');
    }
    if (state.models.length) selectModel(state.models[0].id);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
