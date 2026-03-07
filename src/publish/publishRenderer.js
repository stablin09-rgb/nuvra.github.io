/**
 * Nuvra Builder — Publish Renderer
 *
 * Generates production-ready, editor-free HTML documents.
 *
 * This is a sibling to the PreviewRenderer. It uses the same
 * rendering logic but strips all editor-facing artifacts:
 *  - No GrapesJS data attributes
 *  - No preview-mode comments
 *  - No editor-only styles
 *  - Clean, minimal output suitable for deployment
 *
 * The published output is guaranteed to behave identically to
 * the Preview Mode output (preview = production parity).
 *
 * Two rendering paths:
 *  - Marketing pages: Pure static HTML + CSS
 *  - App pages:       HTML + CSS + embedded data snapshot + production runtime
 */

'use strict';

import { PAGE_TYPES } from '../core/pageSemantics.js';

// ─── Publish Renderer ─────────────────────────────────────────────────────────

/**
 * Build a production-ready HTML document for a page.
 *
 * @param {object} page         - Page object { name, html, css, pageType }
 * @param {object} dataSnapshot - Serialized DataStore snapshot
 * @param {object} projectMeta  - { name, accent, version }
 * @returns {string}            - Full, production-ready HTML document
 */
export function buildPublishDocument(page, dataSnapshot = {}, projectMeta = {}) {
  const isApp = page.pageType === PAGE_TYPES.APP ||
                page.pageType === PAGE_TYPES.DASHBOARD ||
                page.pageType === PAGE_TYPES.CRUD;

  const html   = page.html   || '';
  const css    = page.css    || '';
  const title  = page.name   || projectMeta.name || 'Page';
  const accent = projectMeta.accent || '#7c6af7';

  // Strip GrapesJS editor data attributes from the HTML
  const cleanHtml = _stripEditorAttributes(html);

  const baseStyles = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
img  { max-width: 100%; height: auto; display: block; }
a    { color: ${accent}; }
`;

  if (!isApp) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_esc(title)}</title>
  <style>
${baseStyles}
${css}
  </style>
</head>
<body>
${cleanHtml}
</body>
</html>`;
  }

  // App page — include data snapshot and production runtime
  const dataJson = JSON.stringify(dataSnapshot);
  const runtime  = _getProductionRuntime();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_esc(title)}</title>
  <style>
${baseStyles}
${css}
  </style>
</head>
<body>
${cleanHtml}
<script type="application/json" id="nv-data">${dataJson}</script>
<script>
${runtime}
</script>
</body>
</html>`;
}

// ─── Production Runtime ───────────────────────────────────────────────────────
// A minimal, self-contained IIFE that hydrates app components in production.
// This is identical in behaviour to the preview runtime but has no
// editor-facing comments or debug output.

function _getProductionRuntime() {
  return `(function(){
'use strict';
var snap=JSON.parse(document.getElementById('nv-data').textContent||'{}');
var schemas=snap.schemas||{};
var _rec={};
var _id=snap.idCounter||1;
var _sub={};
Object.keys(snap.records||{}).forEach(function(c){_rec[c]={};(snap.records[c]||[]).forEach(function(r){_rec[c][r._id]=r;});});
function getRec(c){if(!_rec[c])_rec[c]={};return _rec[c];}
function emit(c,t,r){(_sub[c]||[]).forEach(function(f){try{f({collectionId:c,type:t,record:r});}catch(e){}});}
var store={
  getSchema:function(c){return schemas[c];},
  findAll:function(c){return Object.values(getRec(c));},
  count:function(c){return Object.keys(getRec(c)).length;},
  insert:function(c,d){var r=Object.assign({},d,{_id:c+'-'+(_id++),_createdAt:new Date().toISOString(),_updatedAt:new Date().toISOString()});getRec(c)[r._id]=r;emit(c,'insert',r);return r;},
  delete:function(c,id){delete getRec(c)[id];emit(c,'delete',{_id:id});},
  subscribe:function(c,f){if(!_sub[c])_sub[c]=[];_sub[c].push(f);}
};
function hydrateTable(el){
  var c=el.dataset.nvCollection,s=store.getSchema(c),recs=store.findAll(c);
  var hdr=el.querySelector('[data-nv-table-header]'),body=el.querySelector('[data-nv-table-body]'),cnt=el.querySelector('[data-nv-bind]');
  if(!s){if(body)body.innerHTML='<tr><td style="padding:12px;color:#9ca3af;text-align:center;" colspan="99">Collection not found.</td></tr>';return;}
  var fields=(s.fields||[]).filter(function(f){return !f.system;});
  if(hdr)hdr.innerHTML=fields.map(function(f){return '<th style="padding:10px 16px;text-align:left;font-weight:600;color:#374151;border-bottom:1px solid #e5e7eb;">'+f.name+'</th>';}).join('')+'<th style="padding:10px 16px;border-bottom:1px solid #e5e7eb;"></th>';
  if(body){
    if(!recs.length){body.innerHTML='<tr><td style="padding:16px;color:#9ca3af;text-align:center;" colspan="'+(fields.length+1)+'">No records yet.</td></tr>';}
    else{body.innerHTML=recs.map(function(r){return '<tr style="border-bottom:1px solid #f5f5f5;">'+fields.map(function(f){return '<td style="padding:10px 16px;color:#374151;font-size:13px;">'+(r[f.id]!==undefined?r[f.id]:'—')+'</td>';}).join('')+'<td style="padding:10px 16px;text-align:right;"><button data-nv-action-type="delete" data-nv-collection="'+c+'" data-nv-record-id="'+r._id+'" style="padding:4px 10px;background:#fee2e2;color:#dc2626;border:none;border-radius:4px;font-size:11px;cursor:pointer;">Delete</button></td></tr>';}).join('');}
  }
  if(cnt)cnt.textContent=recs.length+' record'+(recs.length!==1?'s':'');
  store.subscribe(c,function(){hydrateTable(el);});
}
function hydrateForm(el){
  var c=el.dataset.nvCollection,s=store.getSchema(c),fd=el.querySelector('[data-nv-form-fields]'),form=el.querySelector('form');
  if(!s||!fd)return;
  var fields=(s.fields||[]).filter(function(f){return !f.system;});
  fd.innerHTML=fields.map(function(f){return '<div><label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">'+f.name+(f.required?' *':'')+'</label><input type="'+(f.type==='number'?'number':f.type==='email'?'email':'text')+'" name="'+f.id+'" placeholder="'+f.name+'" '+(f.required?'required':'')+' style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;box-sizing:border-box;"/></div>';}).join('');
  if(form){form.addEventListener('submit',function(e){e.preventDefault();var d={};new FormData(form).forEach(function(v,k){d[k]=v;});store.insert(c,d);form.reset();document.querySelectorAll('[data-nv-component="data-table"][data-nv-collection="'+c+'"]').forEach(hydrateTable);document.querySelectorAll('[data-nv-component="stat-card"][data-nv-collection="'+c+'"]').forEach(hydrateStatCard);});}
}
function hydrateStatCard(el){
  var c=el.dataset.nvCollection,agg=el.dataset.nvAggregation||'count',field=el.dataset.nvField,ve=el.querySelector('[data-nv-stat-value]');
  if(!ve)return;
  var recs=store.findAll(c),val;
  if(agg==='count')val=recs.length;
  else if(agg==='sum')val=recs.reduce(function(a,r){return a+(Number(r[field])||0);},0);
  else if(agg==='avg')val=recs.length?(recs.reduce(function(a,r){return a+(Number(r[field])||0);},0)/recs.length).toFixed(1):0;
  else val=recs.length;
  ve.textContent=val;
  store.subscribe(c,function(){hydrateStatCard(el);});
}
document.addEventListener('click',function(e){
  var btn=e.target.closest('[data-nv-action-type="delete"]');
  if(!btn)return;
  var c=btn.dataset.nvCollection,id=btn.dataset.nvRecordId;
  if(c&&id){store.delete(c,id);document.querySelectorAll('[data-nv-component="data-table"][data-nv-collection="'+c+'"]').forEach(hydrateTable);document.querySelectorAll('[data-nv-component="stat-card"][data-nv-collection="'+c+'"]').forEach(hydrateStatCard);}
});
document.querySelectorAll('[data-nv-component="data-table"]').forEach(hydrateTable);
document.querySelectorAll('[data-nv-component="data-form"]').forEach(hydrateForm);
document.querySelectorAll('[data-nv-component="stat-card"]').forEach(hydrateStatCard);
})();`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Strip GrapesJS editor-only data attributes from HTML.
 * @param {string} html
 * @returns {string}
 */
function _stripEditorAttributes(html) {
  return html
    .replace(/\s+data-gjs-[a-z-]+="[^"]*"/g, '')
    .replace(/\s+data-gjs-[a-z-]+='[^']*'/g, '')
    .replace(/\s+data-gjs-[a-z-]+=\S+/g, '');
}
