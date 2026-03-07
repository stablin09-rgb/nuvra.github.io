/**
 * Nuvra Builder — AI Settings Panel
 *
 * Renders a modal UI for configuring the AI provider, API key, and model.
 * Settings are persisted to localStorage under 'nuvra-ai-config'.
 * The API key is stored client-side only and never sent to any Nuvra server.
 */

'use strict';

import { configureAI } from './aiEngine.js';
import { showToast } from '../utils/helpers.js';

const SETTINGS_KEY = 'nuvra-ai-config';

// ─── Load / Save Settings ─────────────────────────────────────────────────────

export function loadAISettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { provider: 'mock', apiKey: '', model: '' };
  } catch {
    return { provider: 'mock', apiKey: '', model: '' };
  }
}

function saveAISettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Load saved AI settings and configure the engine on startup.
 */
export function initAI() {
  const settings = loadAISettings();
  configureAI(settings);
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

/**
 * Open the AI settings modal.
 * User can select provider, enter API key, and choose a model.
 */
export function openAISettings() {
  const current = loadAISettings();

  const overlay = document.createElement('div');
  overlay.className = 'nuvra-modal-overlay';

  overlay.innerHTML = `
    <div class="nuvra-modal" style="width:480px;">
      <h3>AI Engine Settings</h3>

      <label style="display:block; font-size:12px; color:#888; margin-bottom:6px;">Provider</label>
      <select id="ai-provider-select">
        <option value="mock"      ${current.provider === 'mock'      ? 'selected' : ''}>Mock (offline, no API key)</option>
        <option value="openai"    ${current.provider === 'openai'    ? 'selected' : ''}>OpenAI (GPT-4o, GPT-4o-mini)</option>
        <option value="anthropic" ${current.provider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude 3)</option>
      </select>

      <div id="ai-key-section" style="${current.provider === 'mock' ? 'display:none' : ''}">
        <label style="display:block; font-size:12px; color:#888; margin-bottom:6px;">API Key</label>
        <input type="password" id="ai-api-key" placeholder="sk-…" value="${current.apiKey || ''}" />
        <p style="font-size:11px; color:#555; margin:-4px 0 12px;">
          Your key is stored locally in your browser only. Nuvra never receives it.
        </p>
      </div>

      <div id="ai-model-section">
        <label style="display:block; font-size:12px; color:#888; margin-bottom:6px;">Model (optional override)</label>
        <input type="text" id="ai-model" placeholder="e.g. gpt-4o-mini" value="${current.model || ''}" />
      </div>

      <div class="nuvra-modal-actions">
        <button class="nuvra-btn" id="ai-settings-cancel">Cancel</button>
        <button class="nuvra-btn primary" id="ai-settings-save">Save & Apply</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const providerSelect = overlay.querySelector('#ai-provider-select');
  const keySection     = overlay.querySelector('#ai-key-section');

  providerSelect.addEventListener('change', () => {
    keySection.style.display = providerSelect.value === 'mock' ? 'none' : '';
  });

  overlay.querySelector('#ai-settings-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ai-settings-save').addEventListener('click', () => {
    const settings = {
      provider: overlay.querySelector('#ai-provider-select').value,
      apiKey:   overlay.querySelector('#ai-api-key').value.trim(),
      model:    overlay.querySelector('#ai-model').value.trim(),
    };

    saveAISettings(settings);
    configureAI(settings);
    overlay.remove();
    showToast(`AI provider set to ${settings.provider}.`, 'success');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
