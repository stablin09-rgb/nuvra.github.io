/**
 * Nuvra Builder — Utility Helpers
 * Pure utility functions with no side effects or external dependencies.
 */

'use strict';

/**
 * Debounce: delays invoking `fn` until after `delay` ms have elapsed
 * since the last invocation. Used to rate-limit autosave calls.
 *
 * @param {Function} fn    - Function to debounce
 * @param {number}   delay - Milliseconds to wait (default 600)
 * @returns {Function}
 */
export function debounce(fn, delay = 600) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Slugify: converts a human-readable string to a URL-safe slug.
 * e.g. "About Us" → "about-us"
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Download a text/binary blob as a file in the browser.
 *
 * @param {string} filename - Suggested file name
 * @param {string} content  - File content string
 * @param {string} mimeType - MIME type (default: text/html)
 */
export function downloadFile(filename, content, mimeType = 'text/html') {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Show a non-blocking toast notification.
 *
 * @param {string} message          - Text to display
 * @param {'success'|'error'|'info'} type - Visual variant
 * @param {number} duration         - Auto-dismiss after ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `nuvra-toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Open a simple modal dialog with a text input and return a Promise
 * that resolves with the entered value or null if cancelled.
 *
 * @param {string} title       - Modal heading
 * @param {string} placeholder - Input placeholder text
 * @param {string} defaultVal  - Pre-filled value
 * @returns {Promise<string|null>}
 */
export function promptModal(title, placeholder = '', defaultVal = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'nuvra-modal-overlay';

    overlay.innerHTML = `
      <div class="nuvra-modal">
        <h3>${title}</h3>
        <input type="text" id="modal-input" placeholder="${placeholder}" value="${defaultVal}" />
        <div class="nuvra-modal-actions">
          <button class="nuvra-btn" id="modal-cancel">Cancel</button>
          <button class="nuvra-btn primary" id="modal-confirm">Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input   = overlay.querySelector('#modal-input');
    const confirm = overlay.querySelector('#modal-confirm');
    const cancel  = overlay.querySelector('#modal-cancel');

    input.focus();
    input.select();

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    confirm.addEventListener('click', () => close(input.value.trim() || null));
    cancel.addEventListener('click',  () => close(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
  });
}

/**
 * Confirm modal — returns a Promise resolving to true/false.
 *
 * @param {string} title   - Modal heading
 * @param {string} message - Body text
 * @returns {Promise<boolean>}
 */
export function confirmModal(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'nuvra-modal-overlay';

    overlay.innerHTML = `
      <div class="nuvra-modal">
        <h3>${title}</h3>
        <p style="color:#999; font-size:13px; margin:0 0 16px">${message}</p>
        <div class="nuvra-modal-actions">
          <button class="nuvra-btn" id="modal-cancel">Cancel</button>
          <button class="nuvra-btn danger" id="modal-confirm">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const confirm = overlay.querySelector('#modal-confirm');
    const cancel  = overlay.querySelector('#modal-cancel');

    const close = (val) => { overlay.remove(); resolve(val); };

    confirm.addEventListener('click', () => close(true));
    cancel.addEventListener('click',  () => close(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}
