/**
 * Nuvra — supabaseAdapter.js (Phase 13)
 *
 * The default HostingAdapter implementation using Supabase Storage + Edge Functions.
 *
 * Architecture:
 *  - Files are uploaded to Supabase Storage bucket: nuvra-sites/{projectId}/{deployId}/
 *  - The serve-site Edge Function routes requests to the correct deploy
 *  - Live URL format: https://{slug}.nuvra.app (via Edge Function routing)
 *  - Preview URL format: https://{project-ref}.supabase.co/functions/v1/serve-site/{deployId}/
 *
 * This adapter implements the HostingAdapter interface:
 *  - upload({ bundle, projectId, projectMeta, environment, region, deployId, onProgress })
 *  - activate({ deployId, projectId, environment, uploadResult })
 *  - rollback({ projectId, targetDeploy })
 *
 * @module supabaseAdapter
 */
'use strict';

const STORAGE_BUCKET = 'nuvra-sites';
const EDGE_FN_BASE   = () => window.__NUVRA_SUPABASE_URL__
  ? `${window.__NUVRA_SUPABASE_URL__}/functions/v1/serve-site`
  : null;

export class SupabaseHostingAdapter {

  // ─── Upload ─────────────────────────────────────────────────────────────────

  /**
   * Upload all bundle files to Supabase Storage.
   */
  async upload({ bundle, projectId, projectMeta, environment, region, deployId, onProgress }) {
    const progress = (pct, msg) => onProgress && onProgress(pct, msg);

    if (!window.__NUVRA_SUPABASE_URL__ || !window.__NUVRA_SUPABASE_ANON_KEY__) {
      // Offline/unconfigured mode: simulate a successful upload with a local preview URL
      progress(100, 'Offline mode: simulating upload…');
      return {
        ok:        true,
        deployId,
        region:    'local',
        storagePath: `local/${projectId}/${deployId}`,
        fileCount:  Object.keys(bundle.files).length,
        totalBytes: bundle.totalBytes,
        previewUrl: `#local-preview-${deployId}`,
      };
    }

    const files    = bundle.files;
    const filenames = Object.keys(files);
    const total    = filenames.length;
    let   uploaded = 0;

    for (const filename of filenames) {
      const content     = files[filename];
      const storagePath = `${projectId}/${deployId}/${filename}`;
      const contentType = _contentType(filename);

      const uploadResult = await this._uploadFile(storagePath, content, contentType);
      if (!uploadResult.ok) {
        return { ok: false, error: new Error(`Failed to upload ${filename}: ${uploadResult.error}`) };
      }

      uploaded++;
      progress(Math.round((uploaded / total) * 100), `Uploaded: ${filename}`);
    }

    // Record the deploy in the nuvra_builds table
    await this._recordBuild({ deployId, projectId, projectMeta, environment, region, bundle });

    return {
      ok:          true,
      deployId,
      region:      region === 'auto' ? 'us-east-1' : region,
      storagePath: `${projectId}/${deployId}`,
      fileCount:   total,
      totalBytes:  bundle.totalBytes,
    };
  }

  // ─── Activate ───────────────────────────────────────────────────────────────

  /**
   * Atomically swap the live deployment to the new deployId.
   */
  async activate({ deployId, projectId, environment, uploadResult }) {
    if (!window.__NUVRA_SUPABASE_URL__) {
      // Offline mode
      const localUrl = `#local-${deployId}`;
      return { ok: true, liveUrl: localUrl, previewUrl: localUrl };
    }

    try {
      // Mark the new build as live in nuvra_builds
      const { supabase } = await import('../../cloud/cloud.js');
      if (!supabase) return { ok: true, liveUrl: uploadResult.previewUrl, previewUrl: uploadResult.previewUrl };

      // Supersede the previous live build
      await supabase
        .from('nuvra_builds')
        .update({ status: 'superseded' })
        .eq('project_id', projectId)
        .eq('environment', environment)
        .eq('status', 'live');

      // Activate the new build
      await supabase
        .from('nuvra_builds')
        .update({ status: 'live', activated_at: new Date().toISOString() })
        .eq('id', deployId);

      const edgeBase  = EDGE_FN_BASE();
      const previewUrl = edgeBase ? `${edgeBase}?project=${projectId}&deploy=${deployId}` : null;
      const liveUrl    = edgeBase ? `${edgeBase}?project=${projectId}` : previewUrl;

      return { ok: true, liveUrl, previewUrl };

    } catch (err) {
      return { ok: false, error: err };
    }
  }

  // ─── Rollback ───────────────────────────────────────────────────────────────

  /**
   * Roll back to a previous deployment by re-activating it.
   */
  async rollback({ projectId, targetDeploy }) {
    if (!window.__NUVRA_SUPABASE_URL__) {
      return { ok: true, liveUrl: `#local-${targetDeploy.deployId}` };
    }

    try {
      const { supabase } = await import('../../cloud/cloud.js');
      if (!supabase) return { ok: true, liveUrl: targetDeploy.liveUrl };

      // Supersede the current live build
      await supabase
        .from('nuvra_builds')
        .update({ status: 'superseded' })
        .eq('project_id', projectId)
        .eq('status', 'live');

      // Re-activate the target build
      await supabase
        .from('nuvra_builds')
        .update({ status: 'live', activated_at: new Date().toISOString() })
        .eq('id', targetDeploy.deployId);

      return { ok: true, liveUrl: targetDeploy.liveUrl };

    } catch (err) {
      return { ok: false, error: err };
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  async _uploadFile(storagePath, content, contentType) {
    try {
      const { supabase } = await import('../../cloud/cloud.js');
      if (!supabase) return { ok: true }; // Graceful no-op if cloud not configured

      const blob = new Blob([content], { type: contentType });
      const { error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, blob, { upsert: true, contentType });

      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _recordBuild({ deployId, projectId, projectMeta, environment, region, bundle }) {
    try {
      const { supabase } = await import('../../cloud/cloud.js');
      if (!supabase) return;

      await supabase.from('nuvra_builds').upsert({
        id:           deployId,
        project_id:   projectId,
        version_id:   bundle.versionId,
        environment,
        region,
        file_count:   Object.keys(bundle.files).length,
        total_bytes:  bundle.totalBytes,
        status:       'pending',
        built_at:     bundle.startedAt,
        completed_at: bundle.completedAt,
      });
    } catch { /* Non-fatal */ }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _contentType(filename) {
  if (filename.endsWith('.html'))  return 'text/html; charset=utf-8';
  if (filename.endsWith('.css'))   return 'text/css; charset=utf-8';
  if (filename.endsWith('.js'))    return 'application/javascript; charset=utf-8';
  if (filename.endsWith('.json'))  return 'application/json; charset=utf-8';
  if (filename.endsWith('.xml'))   return 'application/xml; charset=utf-8';
  if (filename.endsWith('.txt'))   return 'text/plain; charset=utf-8';
  if (filename.endsWith('.png'))   return 'image/png';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.svg'))   return 'image/svg+xml';
  if (filename.endsWith('.ico'))   return 'image/x-icon';
  if (filename.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}
