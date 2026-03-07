/**
 * outputTargets.js — Nuvra Phase 4
 *
 * Output Target System.
 *
 * Each target takes the same compiled output (files map from the publish pipeline)
 * and applies a different wrapper. The compiled output itself never changes.
 *
 * Targets:
 *  - StaticSiteTarget:  Produces a downloadable ZIP
 *  - LivePreviewTarget: Produces a Blob URL for instant in-browser preview
 *  - AppReadyTarget:    Produces a ZIP flagged for mobile wrapping
 *
 * Future targets (hooks only, not implemented):
 *  - CloudHostTarget:   Deployment package for Nuvra Cloud
 *  - MobileTarget:      Capacitor/React Native Web wrapper
 *  - MarketplaceTarget: Marketplace package
 *
 * @module output/outputTargets
 */
'use strict';

import { RenderTarget } from '../renderer/renderTarget.js';
import { logger }       from '../diagnostics/logger.js';

// ─── Base Target ──────────────────────────────────────────────────────────────
class BaseOutputTarget {
  constructor(id) {
    this.id = id;
  }

  /**
   * Apply the target wrapper to the compiled output.
   * @param {object} buildResult - The result from PublishPipeline.run()
   * @returns {Promise<TargetOutput>}
   */
  async apply(buildResult) {
    throw new Error(`OutputTarget "${this.id}": apply() not implemented`);
  }
}

// ─── Static Site Target ────────────────────────────────────────────────────────
/**
 * Produces a downloadable ZIP of all output files.
 * In a browser environment, triggers a download.
 * In a Node.js environment (tests), returns the files map.
 */
export class StaticSiteTarget extends BaseOutputTarget {
  constructor() { super(RenderTarget.STATIC_SITE); }

  async apply(buildResult) {
    const { files, appName } = buildResult;
    const fileName = _slugify(appName || 'nuvra-app') + '.zip';

    logger.info('StaticSiteTarget', `Preparing ZIP: ${fileName} (${Object.keys(files).length} files)`);

    // In a browser environment, create a downloadable ZIP using JSZip-compatible approach
    if (typeof window !== 'undefined' && typeof Blob !== 'undefined') {
      const zipContent = await this._buildZipBlob(files);
      return {
        ok:       true,
        type:     'zip_download',
        fileName,
        blob:     zipContent,
        files,
        fileCount: Object.keys(files).length,
        totalSize: Object.values(files).reduce((s, c) => s + (c?.length || 0), 0),
      };
    }

    // Node.js / test environment — return files map directly
    return {
      ok:        true,
      type:      'files',
      fileName,
      files,
      fileCount: Object.keys(files).length,
      totalSize: Object.values(files).reduce((s, c) => s + (c?.length || 0), 0),
    };
  }

  /**
   * Trigger a browser download of the ZIP.
   * @param {object} targetOutput - Result from apply()
   */
  download(targetOutput) {
    if (typeof window === 'undefined') return;
    if (!targetOutput.blob) {
      logger.warn('StaticSiteTarget', 'No blob to download');
      return;
    }
    const url = URL.createObjectURL(targetOutput.blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = targetOutput.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    logger.info('StaticSiteTarget', `Download triggered: ${targetOutput.fileName}`);
  }

  /**
   * Build a ZIP Blob from a files map.
   * Uses a simple ZIP format (stored, no compression) for browser compatibility
   * without requiring an external library.
   *
   * @param {object} files - { [filename]: string content }
   * @returns {Promise<Blob>}
   */
  async _buildZipBlob(files) {
    // Simple ZIP implementation (PKZIP format, stored entries)
    const encoder = new TextEncoder();
    const entries = [];
    const centralDir = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
      const nameBytes    = encoder.encode(name);
      const contentBytes = encoder.encode(content || '');
      const crc32        = _crc32(contentBytes);
      const now          = _dosDateTime();

      // Local file header
      const localHeader = new Uint8Array(30 + nameBytes.length);
      const lhView = new DataView(localHeader.buffer);
      lhView.setUint32(0,  0x04034b50, true); // signature
      lhView.setUint16(4,  20,         true); // version needed
      lhView.setUint16(6,  0,          true); // flags
      lhView.setUint16(8,  0,          true); // compression (stored)
      lhView.setUint16(10, now.time,   true); // mod time
      lhView.setUint16(12, now.date,   true); // mod date
      lhView.setUint32(14, crc32,      true); // CRC-32
      lhView.setUint32(18, contentBytes.length, true); // compressed size
      lhView.setUint32(22, contentBytes.length, true); // uncompressed size
      lhView.setUint16(26, nameBytes.length,    true); // filename length
      lhView.setUint16(28, 0,          true); // extra field length
      localHeader.set(nameBytes, 30);

      // Central directory entry
      const cdEntry = new Uint8Array(46 + nameBytes.length);
      const cdView = new DataView(cdEntry.buffer);
      cdView.setUint32(0,  0x02014b50, true); // signature
      cdView.setUint16(4,  20,         true); // version made by
      cdView.setUint16(6,  20,         true); // version needed
      cdView.setUint16(8,  0,          true); // flags
      cdView.setUint16(10, 0,          true); // compression
      cdView.setUint16(12, now.time,   true);
      cdView.setUint16(14, now.date,   true);
      cdView.setUint32(16, crc32,      true);
      cdView.setUint32(20, contentBytes.length, true);
      cdView.setUint32(24, contentBytes.length, true);
      cdView.setUint16(28, nameBytes.length,    true);
      cdView.setUint16(30, 0, true); // extra length
      cdView.setUint16(32, 0, true); // comment length
      cdView.setUint16(34, 0, true); // disk start
      cdView.setUint16(36, 0, true); // internal attrs
      cdView.setUint32(38, 0, true); // external attrs
      cdView.setUint32(42, offset, true); // local header offset
      cdEntry.set(nameBytes, 46);

      entries.push(localHeader, contentBytes);
      centralDir.push(cdEntry);
      offset += localHeader.length + contentBytes.length;
    }

    // End of central directory
    const cdSize   = centralDir.reduce((s, e) => s + e.length, 0);
    const eocd     = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0,  0x06054b50, true); // signature
    eocdView.setUint16(4,  0,          true); // disk number
    eocdView.setUint16(6,  0,          true); // start disk
    eocdView.setUint16(8,  centralDir.length, true);
    eocdView.setUint16(10, centralDir.length, true);
    eocdView.setUint32(12, cdSize,     true);
    eocdView.setUint32(16, offset,     true);
    eocdView.setUint16(20, 0,          true); // comment length

    const parts = [...entries, ...centralDir, eocd];
    return new Blob(parts, { type: 'application/zip' });
  }
}

// ─── Live Preview Target ───────────────────────────────────────────────────────
/**
 * Produces a Blob URL for instant in-browser preview.
 * The URL is valid until revoked.
 */
export class LivePreviewTarget extends BaseOutputTarget {
  constructor() {
    super(RenderTarget.LIVE_PREVIEW);
    this._currentUrl = null;
  }

  async apply(buildResult) {
    const { files } = buildResult;
    const html = files['index.html'];

    if (!html) {
      return { ok: false, error: 'No index.html in build result' };
    }

    // Revoke previous URL
    if (this._currentUrl) {
      URL.revokeObjectURL(this._currentUrl);
      this._currentUrl = null;
    }

    if (typeof Blob !== 'undefined') {
      const blob = new Blob([html], { type: 'text/html' });
      this._currentUrl = URL.createObjectURL(blob);
      logger.info('LivePreviewTarget', `Blob URL created: ${this._currentUrl}`);
      return { ok: true, type: 'blob_url', url: this._currentUrl };
    }

    // Fallback for non-browser environments
    return { ok: true, type: 'html', html };
  }

  /**
   * Open the live preview in a new tab.
   * @param {object} targetOutput
   */
  openInNewTab(targetOutput) {
    if (typeof window === 'undefined' || !targetOutput.url) return;
    window.open(targetOutput.url, '_blank', 'noopener,noreferrer');
  }

  /**
   * Revoke the current Blob URL.
   */
  revoke() {
    if (this._currentUrl) {
      URL.revokeObjectURL(this._currentUrl);
      this._currentUrl = null;
    }
  }
}

// ─── App-Ready Target ──────────────────────────────────────────────────────────
/**
 * Produces a ZIP flagged for mobile wrapping.
 * Same as StaticSiteTarget but includes mobile metadata in the manifest.
 */
export class AppReadyTarget extends BaseOutputTarget {
  constructor() {
    super(RenderTarget.APP_READY);
    this._staticTarget = new StaticSiteTarget();
  }

  async apply(buildResult) {
    // Inject mobile metadata into the manifest
    if (buildResult.manifest) {
      buildResult.manifest.mobileReady = true;
      buildResult.manifest.mobileWrapper = {
        capacitor: {
          appId:   'io.nuvra.' + _slugify(buildResult.appId || 'app'),
          appName: buildResult.appName || 'Nuvra App',
          webDir:  './',
        },
        reactNativeWeb: {
          entryPoint: 'index.html',
        },
      };
      // Update the manifest file in the files map
      if (buildResult.files?.['nuvra.manifest.json']) {
        buildResult.files['nuvra.manifest.json'] = JSON.stringify(buildResult.manifest, null, 2);
      }
    }

    const result = await this._staticTarget.apply(buildResult);
    result.mobileReady = true;
    logger.info('AppReadyTarget', 'App-ready output prepared');
    return result;
  }
}

// ─── Future Target Hooks ───────────────────────────────────────────────────────
export class CloudHostTarget extends BaseOutputTarget {
  constructor() { super(RenderTarget.CLOUD_HOST); }
  async apply(_buildResult) {
    // Future: Upload to Nuvra Cloud
    return { ok: false, error: 'CloudHostTarget: not yet implemented. Coming in Phase 7.' };
  }
}

// ─── Target Registry ──────────────────────────────────────────────────────────
export const outputTargets = {
  [RenderTarget.STATIC_SITE]:  new StaticSiteTarget(),
  [RenderTarget.LIVE_PREVIEW]: new LivePreviewTarget(),
  [RenderTarget.APP_READY]:    new AppReadyTarget(),
  [RenderTarget.CLOUD_HOST]:   new CloudHostTarget(),
};

/**
 * Get an output target by ID.
 * @param {string} targetId
 * @returns {BaseOutputTarget|null}
 */
export function getOutputTarget(targetId) {
  return outputTargets[targetId] || null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function _dosDateTime() {
  const d = new Date();
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)),
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()),
  };
}

function _crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export default outputTargets;
