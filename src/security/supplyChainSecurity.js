/**
 * Nuvra — supplyChainSecurity.js (Phase 15)
 *
 * Supply chain security for the Nuvra marketplace.
 * Handles asset signing, integrity verification, revocation checks,
 * and SBOM (Software Bill of Materials) generation.
 *
 * All marketplace assets must pass integrity checks before installation.
 * Revoked assets are blocked even if already installed.
 *
 * @module security/supplyChainSecurity
 */
'use strict';

// ─── Revocation List (CRL) ────────────────────────────────────────────────────
// In production this would be fetched from the Nuvra security endpoint.
// Locally cached with a 1-hour TTL.
let _revocationList    = new Set();
let _revocationFetched = 0;
const REVOCATION_TTL   = 3_600_000; // 1 hour

async function _fetchRevocationList() {
  const now = Date.now();
  if (now - _revocationFetched < REVOCATION_TTL) return;
  try {
    const resp = await fetch('https://security.nuvra.app/revocation-list.json', { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json();
      _revocationList    = new Set(data.revokedAssets || []);
      _revocationFetched = now;
    }
  } catch (_) {
    // Fail open — if revocation list is unavailable, log a warning but don't block
    console.warn('[SupplyChainSecurity] Could not fetch revocation list — proceeding without CRL check.');
  }
}

// ─── Integrity Verification ───────────────────────────────────────────────────
/**
 * Compute a SHA-256 hash of a string using the Web Crypto API.
 * @param {string} content
 * @returns {Promise<string>} Hex-encoded hash
 */
async function _sha256(content) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data    = encoder.encode(content);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: simple FNV-1a hash (not cryptographically secure, for dev only)
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

// ─── SBOM Generation ──────────────────────────────────────────────────────────
function _generateSBOM(manifest, scriptContent) {
  return {
    bomFormat:    'CycloneDX',
    specVersion:  '1.4',
    version:      1,
    metadata: {
      timestamp:  new Date().toISOString(),
      component: {
        type:    'library',
        name:    manifest.name,
        version: manifest.version,
        purl:    `pkg:nuvra/${manifest.id}@${manifest.version}`,
      },
    },
    components: (manifest.dependencies || []).map(dep => ({
      type:    'library',
      name:    dep.id,
      version: dep.version,
      purl:    `pkg:nuvra/${dep.id}@${dep.version}`,
    })),
    properties: [
      { name: 'nuvra:capabilities',  value: (manifest.capabilities || []).join(',') },
      { name: 'nuvra:maxDataClass',  value: manifest.maxDataClass || 'public' },
      { name: 'nuvra:scriptLength',  value: String(scriptContent?.length || 0) },
    ],
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const supplyChainSecurity = {
  /**
   * Verify the integrity of a marketplace asset before installation.
   * @param {object} manifest - The asset manifest (from marketplace)
   * @param {string} scriptContent - The asset's JS code
   * @returns {Promise<{ verified: boolean, hash: string, reason: string|null }>}
   */
  async verifyAsset(manifest, scriptContent) {
    // 1. Compute hash of the script content
    const computedHash = await _sha256(scriptContent);

    // 2. Compare with the manifest's declared hash
    if (manifest.contentHash && manifest.contentHash !== computedHash) {
      return {
        verified: false,
        hash:     computedHash,
        reason:   `Integrity check failed: computed hash "${computedHash}" does not match declared hash "${manifest.contentHash}". The asset may have been tampered with.`,
      };
    }

    // 3. Check revocation list
    await _fetchRevocationList();
    const assetKey = `${manifest.id}@${manifest.version}`;
    if (_revocationList.has(manifest.id) || _revocationList.has(assetKey)) {
      return {
        verified: false,
        hash:     computedHash,
        reason:   `Asset "${manifest.id}" (v${manifest.version}) has been revoked by the Nuvra security team. Please check the marketplace for an updated version.`,
      };
    }

    // 4. Check manifest signature (if present)
    if (manifest.signature) {
      // In a real implementation this would verify a cryptographic signature
      // against the Nuvra public key. For now, we check the signature format.
      if (typeof manifest.signature !== 'string' || manifest.signature.length < 32) {
        return {
          verified: false,
          hash:     computedHash,
          reason:   'Asset has an invalid signature format.',
        };
      }
    }

    return { verified: true, hash: computedHash, reason: null };
  },

  /**
   * Sign an asset manifest (for marketplace publishers).
   * In production this would use a private key held by the Nuvra signing service.
   * @param {object} manifest
   * @param {string} scriptContent
   * @returns {Promise<object>} Signed manifest
   */
  async signAsset(manifest, scriptContent) {
    const contentHash = await _sha256(scriptContent);
    const sbom        = _generateSBOM(manifest, scriptContent);
    const signedAt    = new Date().toISOString();
    // Simulated signature (in production: RSA-PSS or Ed25519 over contentHash + signedAt)
    const signature   = await _sha256(`${manifest.id}:${manifest.version}:${contentHash}:${signedAt}`);
    return {
      ...manifest,
      contentHash,
      signature,
      signedAt,
      sbom,
    };
  },

  /**
   * Generate a Software Bill of Materials for an asset.
   * @param {object} manifest
   * @param {string} scriptContent
   * @returns {object} CycloneDX SBOM
   */
  generateSBOM(manifest, scriptContent) {
    return _generateSBOM(manifest, scriptContent);
  },

  /**
   * Check if an asset ID is on the revocation list.
   * @param {string} assetId
   * @param {string} version
   * @returns {Promise<boolean>}
   */
  async isRevoked(assetId, version) {
    await _fetchRevocationList();
    return _revocationList.has(assetId) || _revocationList.has(`${assetId}@${version}`);
  },

  /**
   * Compute the SHA-256 hash of a string.
   * @param {string} content
   * @returns {Promise<string>}
   */
  hash: _sha256,
};
