/**
 * schemaAssembler.js — Nuvra Phase 5
 *
 * Pipeline Step 3: Schema Assembly.
 *
 * Converts a SystemPlan into a complete, valid AppSchema.
 * This is the FINAL step before rendering may occur.
 *
 * The assembler does NOT call the AI for this step.
 * It is a deterministic transformation: SystemPlan → AppSchema.
 * This guarantees that schema assembly is fast, free, and predictable.
 *
 * The assembler:
 *  1. Converts SystemPlan pages → AppPageSchema[]
 *  2. Converts SystemPlan collections → CollectionSchema[]
 *  3. Converts SystemPlan actions → ActionSchema[]
 *  4. Converts SystemPlan stateFlows → StateDefinition[]
 *  5. Generates seed data for collections
 *  6. Wires component layouts for each page
 *
 * @module ai/pipeline/schemaAssembler
 */
'use strict';

// ─── SchemaAssembler ──────────────────────────────────────────────────────────
class SchemaAssembler {
  /**
   * Assemble an AppSchema from a SystemPlan.
   *
   * @param {object} params
   * @param {object}   params.plan   - SystemPlan from Step 2
   * @param {object}   params.intent - IntentSchema from Step 1
   * @returns {{ ok: boolean, schema?: AppSchema, error?: string }}
   */
  assemble({ plan, intent }) {
    if (!plan || plan._type !== 'SystemPlan') {
      return { ok: false, error: 'Valid SystemPlan is required' };
    }
    if (!intent || intent._type !== 'IntentSchema') {
      return { ok: false, error: 'Valid IntentSchema is required' };
    }

    try {
      const schema = this._buildSchema(plan, intent);
      return { ok: true, schema };
    } catch (err) {
      return { ok: false, error: `Schema assembly failed: ${err.message}` };
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _buildSchema(plan, intent) {
    const appId = _generateId('app');

    return {
      _type:          'AppSchema',
      _schemaVersion: 1,
      _assembledAt:   Date.now(),
      _intentGoal:    intent.goal,
      _planDecisions: plan.decisions,

      id:          appId,
      name:        _deriveAppName(intent),
      description: intent.goal,
      version:     '1.0.0',
      outputType:  intent.outputType,
      industry:    intent.industry,
      brandTone:   intent.brandTone,

      pages:       plan.pages.map(p => this._buildPage(p, plan, intent)),
      collections: plan.collections.map(c => this._buildCollection(c)),
      actions:     plan.actions.map(a => this._buildAction(a, plan)),
      state:       this._buildState(plan.stateFlows),
      permissions: plan.permissions,
    };
  }

  _buildPage(planPage, plan, intent) {
    const components = this._buildPageComponents(planPage, plan, intent);

    return {
      _type:    'AppPageSchema',
      id:       planPage.id,
      name:     planPage.name,
      slug:     planPage.slug,
      mode:     planPage.mode,
      isHome:   planPage.isHome,
      purpose:  planPage.purpose,
      reason:   planPage.reason,
      layout:   components,
    };
  }

  _buildPageComponents(planPage, plan, intent) {
    const components = [];
    const mode = planPage.mode;

    if (mode === 'marketing' || mode === 'hybrid') {
      // Marketing sections from the plan
      for (const sectionType of (planPage.sections || [])) {
        components.push(_buildMarketingSection(sectionType, planPage, intent));
      }
    }

    if (mode === 'app' || mode === 'hybrid') {
      // App components — wire to collections
      const relevantCollections = _findRelevantCollections(planPage, plan.collections);

      for (const coll of relevantCollections) {
        // Dashboard-style pages get stat cards
        if (planPage.slug.includes('dashboard') || planPage.slug.includes('home')) {
          components.push(_buildStatCard(coll));
        }

        // List/table for data pages
        if (planPage.slug.includes(coll.id) || planPage.slug.includes('list') || planPage.slug.includes('manage')) {
          components.push(_buildTable(coll));
          components.push(_buildForm(coll, 'create'));
        }
      }

      // If no specific components were added, add a generic table for the first collection
      if (components.length === 0 && plan.collections.length > 0) {
        const firstColl = plan.collections[0];
        components.push(_buildTable(firstColl));
      }
    }

    return components;
  }

  _buildCollection(planCollection) {
    return {
      _type:    'CollectionSchema',
      id:       planCollection.id,
      name:     planCollection.name,
      purpose:  planCollection.purpose,
      reason:   planCollection.reason,
      fields:   planCollection.fields.map(f => ({
        id:        f.id,
        label:     f.label,
        type:      f.type,
        rules:     {
          required: f.required || false,
          options:  f.options  || undefined,
        },
        relatesTo: f.relatesTo || undefined,
      })),
      seedData: _generateSeedData(planCollection),
    };
  }

  _buildAction(planAction, plan) {
    const steps = _buildActionSteps(planAction, plan);
    return {
      _type:   'ActionSchema',
      id:      planAction.id,
      name:    planAction.name,
      trigger: planAction.trigger,
      reason:  planAction.reason,
      steps,
    };
  }

  _buildState(stateFlows) {
    return {
      global: stateFlows
        .filter(s => s.scope === 'global')
        .map(s => ({
          id:           s.id,
          label:        s.name,
          type:         s.type,
          defaultValue: _defaultValueForType(s.type),
          purpose:      s.purpose,
        })),
      page: stateFlows
        .filter(s => s.scope === 'page')
        .map(s => ({
          id:           s.id,
          label:        s.name,
          type:         s.type,
          defaultValue: _defaultValueForType(s.type),
          purpose:      s.purpose,
        })),
      derived: [],
    };
  }
}

// ─── Component Builders ───────────────────────────────────────────────────────
function _buildMarketingSection(sectionType, page, intent) {
  const id = _generateId('section');
  const baseProps = { tone: intent.brandTone, industry: intent.industry };

  switch (sectionType) {
    case 'hero':
      return {
        id, componentType: 'hero',
        props: {
          ...baseProps,
          headline:    `${_toTitleCase(intent.goal)}`,
          subheadline: `Built for ${intent.targetAudience}`,
          ctaLabel:    'Get Started',
          ctaAction:   null,
        },
      };
    case 'features':
      return {
        id, componentType: 'features',
        props: {
          ...baseProps,
          headline: 'Everything you need',
          items: [
            { icon: '⚡', title: 'Fast', description: 'Built for performance' },
            { icon: '🔒', title: 'Secure', description: 'Enterprise-grade security' },
            { icon: '📊', title: 'Analytics', description: 'Real-time insights' },
          ],
        },
      };
    case 'pricing':
      return {
        id, componentType: 'pricing',
        props: {
          ...baseProps,
          headline: 'Simple, transparent pricing',
          plans: [
            { name: 'Starter', price: '$0', features: ['5 projects', 'Basic analytics'] },
            { name: 'Pro', price: '$29/mo', features: ['Unlimited projects', 'Advanced analytics', 'Priority support'] },
          ],
        },
      };
    case 'cta':
      return {
        id, componentType: 'cta-section',
        props: {
          ...baseProps,
          headline: 'Ready to get started?',
          ctaLabel: 'Start for free',
          ctaAction: null,
        },
      };
    case 'testimonials':
      return {
        id, componentType: 'testimonials',
        props: {
          ...baseProps,
          items: [
            { quote: 'This changed how we work.', author: 'Alex M.', role: 'CEO' },
            { quote: 'Incredibly powerful and easy to use.', author: 'Sam K.', role: 'CTO' },
          ],
        },
      };
    default:
      return {
        id, componentType: 'text',
        props: { content: `${_toTitleCase(sectionType)} section` },
      };
  }
}

function _buildStatCard(coll) {
  return {
    id:            _generateId('stat'),
    componentType: 'stat-card',
    props: {
      label:      `Total ${_toTitleCase(coll.name)}`,
      value:      `{ data:${coll.id}.length }`,
      binding:    { type: 'data', source: coll.id, expression: 'count' },
    },
  };
}

function _buildTable(coll) {
  return {
    id:            _generateId('table'),
    componentType: 'table',
    props: {
      collectionId: coll.id,
      columns:      coll.fields.slice(0, 5).map(f => ({
        field: f.id,
        label: f.label,
        type:  f.type,
      })),
      actions: ['edit', 'delete'],
      binding: { type: 'data', source: coll.id },
    },
  };
}

function _buildForm(coll, mode = 'create') {
  return {
    id:            _generateId('form'),
    componentType: 'form',
    props: {
      collectionId: coll.id,
      mode,
      fields:       coll.fields.filter(f => f.type !== 'relation').map(f => ({
        field:       f.id,
        label:       f.label,
        type:        f.type,
        required:    f.required || false,
        options:     f.options || undefined,
      })),
      submitLabel:  mode === 'create' ? `Add ${_toTitleCase(coll.name.replace(/s$/, ''))}` : 'Save Changes',
      submitAction: mode === 'create' ? `${coll.id}_create` : `${coll.id}_update`,
    },
  };
}

// ─── Action Step Builder ──────────────────────────────────────────────────────
function _buildActionSteps(planAction, plan) {
  const steps = [];
  const name = planAction.name.toLowerCase();

  // Infer steps from action name and trigger
  if (name.includes('create') || name.includes('add')) {
    const collId = _inferCollectionId(planAction, plan.collections);
    if (collId) {
      steps.push({ type: 'data.insert', collectionId: collId, data: '{ form }' });
      steps.push({ type: 'state.set', key: 'showForm', value: false });
      steps.push({ type: 'ui.toast', message: 'Created successfully', variant: 'success' });
    }
  } else if (name.includes('delete') || name.includes('remove')) {
    const collId = _inferCollectionId(planAction, plan.collections);
    if (collId) {
      steps.push({ type: 'data.delete', collectionId: collId, id: '{ record._id }' });
      steps.push({ type: 'ui.toast', message: 'Deleted', variant: 'success' });
    }
  } else if (name.includes('update') || name.includes('edit')) {
    const collId = _inferCollectionId(planAction, plan.collections);
    if (collId) {
      steps.push({ type: 'data.update', collectionId: collId, id: '{ record._id }', data: '{ form }' });
      steps.push({ type: 'ui.toast', message: 'Updated successfully', variant: 'success' });
    }
  } else if (name.includes('navigate') || name.includes('go to')) {
    steps.push({ type: 'navigate', target: '{ page }' });
  } else {
    // Generic step from the plan description
    for (const stepDesc of planAction.steps) {
      steps.push({ type: 'custom', description: stepDesc });
    }
  }

  return steps;
}

// ─── Seed Data Generator ──────────────────────────────────────────────────────
function _generateSeedData(coll) {
  const seeds = [];
  const count = 3;

  for (let i = 0; i < count; i++) {
    const record = {
      _id:        `seed_${coll.id}_${i + 1}`,
      _createdAt: Date.now() - (count - i) * 86_400_000,
      _updatedAt: Date.now() - (count - i) * 86_400_000,
    };

    for (const field of coll.fields) {
      record[field.id] = _seedValueForField(field, i);
    }

    seeds.push(record);
  }

  return seeds;
}

function _seedValueForField(field, index) {
  switch (field.type) {
    case 'text':     return `${_toTitleCase(field.label)} ${index + 1}`;
    case 'number':   return (index + 1) * 10;
    case 'boolean':  return index % 2 === 0;
    case 'date':     return new Date(Date.now() - index * 86_400_000).toISOString().split('T')[0];
    case 'select':   return field.options?.[index % (field.options?.length || 1)] || 'option_1';
    case 'email':    return `user${index + 1}@example.com`;
    case 'url':      return `https://example.com/${index + 1}`;
    case 'richtext': return `<p>${_toTitleCase(field.label)} content for item ${index + 1}.</p>`;
    case 'relation': return null;
    default:         return `${field.label} ${index + 1}`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _deriveAppName(intent) {
  // Extract a clean app name from the goal
  const goal = intent.goal || '';
  // Remove common filler words
  const cleaned = goal
    .replace(/^(build|create|make|design|develop)\s+/i, '')
    .replace(/\s+(app|application|website|site|platform|tool|system)$/i, '')
    .trim();
  return _toTitleCase(cleaned) || 'My App';
}

function _findRelevantCollections(page, collections) {
  if (!collections.length) return [];
  // Match collections whose ID appears in the page slug or name
  const relevant = collections.filter(c =>
    page.slug.includes(c.id) ||
    page.name.toLowerCase().includes(c.name.toLowerCase()) ||
    page.name.toLowerCase().includes(c.id.toLowerCase())
  );
  return relevant.length > 0 ? relevant : [collections[0]];
}

function _inferCollectionId(action, collections) {
  if (!collections.length) return null;
  const name = action.name.toLowerCase();
  for (const coll of collections) {
    if (name.includes(coll.id) || name.includes(coll.name.toLowerCase())) {
      return coll.id;
    }
  }
  return collections[0]?.id || null;
}

function _defaultValueForType(type) {
  switch (type) {
    case 'number':  return 0;
    case 'boolean': return false;
    case 'select':  return null;
    default:        return '';
  }
}

function _toTitleCase(str) {
  return (str || '')
    .split(/[\s_-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function _generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Singleton ────────────────────────────────────────────────────────────────
export const schemaAssembler = new SchemaAssembler();
export default schemaAssembler;
