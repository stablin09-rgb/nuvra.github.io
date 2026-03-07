/**
 * Nuvra — packSDK.js (Phase 13)
 *
 * The formal Design AI Pack SDK.
 *
 * A Design AI Pack is NOT a template. It is a compound artifact that defines:
 *  - Design tokens (colors, typography, spacing, shadows, radii)
 *  - Section blueprints (reusable, AI-generatable section schemas)
 *  - AI prompt extensions (modifiers that influence AI generation)
 *  - Schema validators (constraints on generated content)
 *  - Style generators (dynamic CSS from design tokens)
 *  - Responsive rules (breakpoint-aware layout rules)
 *  - Brand constraints (enforced design decisions)
 *  - Interaction patterns (hover, transition, animation presets)
 *
 * Pack Schema Version: 1.0
 *
 * @module packSDK
 */
'use strict';

// ─── Pack Schema ──────────────────────────────────────────────────────────────

/**
 * The canonical schema for a Design AI Pack manifest.
 * All fields marked [required] must be present for the pack to be valid.
 *
 * @typedef {object} PackManifest
 * @property {string}   id             [required] Unique pack ID (reverse-domain, e.g. "com.nuvra.fintech-pro")
 * @property {string}   name           [required] Human-readable name
 * @property {string}   version        [required] Semver version string
 * @property {string}   description    [required] One-sentence description
 * @property {string}   author         [required] Author name or org
 * @property {string}   [license]      SPDX license identifier
 * @property {string[]} [tags]         Searchable tags
 * @property {string}   [category]     Pack category: 'business' | 'creative' | 'ecommerce' | 'saas' | 'portfolio' | 'other'
 * @property {object}   [tokens]       Design tokens
 * @property {object[]} [sections]     Section blueprints
 * @property {object}   [ai]           AI prompt extensions
 * @property {object}   [styles]       CSS generation rules
 * @property {object}   [responsive]   Responsive layout rules
 * @property {object}   [constraints]  Brand constraints
 * @property {object}   [interactions] Interaction patterns
 * @property {object}   [permissions]  Required permissions
 * @property {object}   [metadata]     Additional metadata
 */

// ─── PackSDK ─────────────────────────────────────────────────────────────────

class PackSDK {

  // ─── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validate a pack manifest against the SDK schema.
   * Returns { valid: boolean, errors: string[] }
   */
  validate(manifest) {
    const errors = [];

    // Required fields
    if (!manifest.id)          errors.push('Missing required field: id');
    if (!manifest.name)        errors.push('Missing required field: name');
    if (!manifest.version)     errors.push('Missing required field: version');
    if (!manifest.description) errors.push('Missing required field: description');
    if (!manifest.author)      errors.push('Missing required field: author');

    // ID format: reverse-domain notation
    if (manifest.id && !/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(manifest.id)) {
      errors.push('id must use reverse-domain notation (e.g. "com.acme.my-pack")');
    }

    // Version: semver
    if (manifest.version && !/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(manifest.version)) {
      errors.push('version must be a valid semver string (e.g. "1.0.0")');
    }

    // Tokens validation
    if (manifest.tokens) {
      const tokenErrors = this._validateTokens(manifest.tokens);
      errors.push(...tokenErrors);
    }

    // Sections validation
    if (manifest.sections) {
      if (!Array.isArray(manifest.sections)) {
        errors.push('sections must be an array');
      } else {
        manifest.sections.forEach((section, i) => {
          if (!section.id)   errors.push(`sections[${i}]: missing id`);
          if (!section.name) errors.push(`sections[${i}]: missing name`);
          if (!section.type) errors.push(`sections[${i}]: missing type`);
        });
      }
    }

    // AI extensions validation
    if (manifest.ai) {
      const aiErrors = this._validateAI(manifest.ai);
      errors.push(...aiErrors);
    }

    return { valid: errors.length === 0, errors };
  }

  // ─── CSS Generation ──────────────────────────────────────────────────────────

  /**
   * Generate a CSS custom properties block from a pack's design tokens.
   * The generated CSS is injected into the editor and all published pages.
   *
   * @param {object} manifest - A validated pack manifest
   * @returns {string} CSS string with :root custom properties
   */
  generateCSS(manifest) {
    const tokens = manifest.tokens || {};
    const lines  = [':root {'];

    // Colors
    if (tokens.colors) {
      lines.push('  /* Colors */');
      for (const [key, value] of Object.entries(tokens.colors)) {
        lines.push(`  --pack-color-${_kebab(key)}: ${value};`);
      }
    }

    // Typography
    if (tokens.typography) {
      lines.push('  /* Typography */');
      const t = tokens.typography;
      if (t.fontFamily)    lines.push(`  --pack-font-family: ${t.fontFamily};`);
      if (t.headingFamily) lines.push(`  --pack-heading-family: ${t.headingFamily};`);
      if (t.baseSize)      lines.push(`  --pack-font-size-base: ${t.baseSize};`);
      if (t.scale) {
        const base = parseFloat(t.baseSize) || 16;
        const ratio = t.scale || 1.25;
        lines.push(`  --pack-font-size-xs:   ${Math.round(base / ratio / ratio)}px;`);
        lines.push(`  --pack-font-size-sm:   ${Math.round(base / ratio)}px;`);
        lines.push(`  --pack-font-size-md:   ${base}px;`);
        lines.push(`  --pack-font-size-lg:   ${Math.round(base * ratio)}px;`);
        lines.push(`  --pack-font-size-xl:   ${Math.round(base * ratio * ratio)}px;`);
        lines.push(`  --pack-font-size-2xl:  ${Math.round(base * ratio * ratio * ratio)}px;`);
        lines.push(`  --pack-font-size-3xl:  ${Math.round(base * ratio * ratio * ratio * ratio)}px;`);
      }
    }

    // Spacing
    if (tokens.spacing) {
      lines.push('  /* Spacing */');
      const s = tokens.spacing;
      if (s.unit) {
        const unit = parseFloat(s.unit) || 8;
        for (let i = 1; i <= 12; i++) {
          lines.push(`  --pack-space-${i}: ${unit * i}px;`);
        }
      }
      for (const [key, value] of Object.entries(s)) {
        if (key !== 'unit') lines.push(`  --pack-spacing-${_kebab(key)}: ${value};`);
      }
    }

    // Border radius
    if (tokens.radii) {
      lines.push('  /* Border Radius */');
      for (const [key, value] of Object.entries(tokens.radii)) {
        lines.push(`  --pack-radius-${_kebab(key)}: ${value};`);
      }
    }

    // Shadows
    if (tokens.shadows) {
      lines.push('  /* Shadows */');
      for (const [key, value] of Object.entries(tokens.shadows)) {
        lines.push(`  --pack-shadow-${_kebab(key)}: ${value};`);
      }
    }

    lines.push('}');

    // Responsive overrides
    if (manifest.responsive) {
      for (const [breakpoint, overrides] of Object.entries(manifest.responsive)) {
        const bp = _breakpointQuery(breakpoint);
        if (!bp) continue;
        lines.push(`\n@media ${bp} {`);
        lines.push('  :root {');
        for (const [key, value] of Object.entries(overrides)) {
          lines.push(`    ${key}: ${value};`);
        }
        lines.push('  }');
        lines.push('}');
      }
    }

    // Interaction patterns
    if (manifest.interactions) {
      const ia = manifest.interactions;
      if (ia.transitions) {
        lines.push('\n/* Pack Interaction Patterns */');
        lines.push(':root {');
        lines.push(`  --pack-transition-fast:   ${ia.transitions.fast   || '150ms ease'};`);
        lines.push(`  --pack-transition-normal: ${ia.transitions.normal || '250ms ease'};`);
        lines.push(`  --pack-transition-slow:   ${ia.transitions.slow   || '400ms ease'};`);
        lines.push('}');
      }
    }

    return lines.join('\n');
  }

  // ─── Section Blueprints ──────────────────────────────────────────────────────

  /**
   * Get all section blueprints from a pack, ready for use in the block library.
   */
  getSectionBlueprints(manifest) {
    return (manifest.sections || []).map(section => ({
      id:          `pack-${manifest.id}-${section.id}`,
      packId:      manifest.id,
      name:        section.name,
      type:        section.type,
      description: section.description || '',
      html:        section.html || '',
      css:         section.css  || '',
      schema:      section.schema || {},
      aiHints:     section.aiHints || [],
      thumbnail:   section.thumbnail || null,
    }));
  }

  // ─── AI Prompt Extensions ────────────────────────────────────────────────────

  /**
   * Get the AI prompt extension for a pack.
   * This is injected into the AI generation system prompt.
   */
  getAIExtension(manifest) {
    const ai = manifest.ai || {};
    return {
      packId:         manifest.id,
      packName:       manifest.name,
      systemPrompt:   ai.systemPrompt   || '',
      toneModifiers:  ai.toneModifiers  || [],
      layoutRules:    ai.layoutRules    || [],
      colorRules:     ai.colorRules     || [],
      typographyRules: ai.typographyRules || [],
      contentRules:   ai.contentRules   || [],
      sectionOrder:   ai.sectionOrder   || [],
      constraints:    manifest.constraints || {},
      forbiddenPatterns: ai.forbiddenPatterns || [],
    };
  }

  // ─── Pack Metadata ───────────────────────────────────────────────────────────

  /**
   * Get a summary of a pack for display in the UI.
   */
  getSummary(manifest) {
    return {
      id:          manifest.id,
      name:        manifest.name,
      version:     manifest.version,
      description: manifest.description,
      author:      manifest.author,
      category:    manifest.category || 'other',
      tags:        manifest.tags || [],
      sectionCount: (manifest.sections || []).length,
      hasAI:        !!manifest.ai,
      hasTokens:    !!manifest.tokens,
      license:      manifest.license || 'proprietary',
    };
  }

  // ─── Private Validators ──────────────────────────────────────────────────────

  _validateTokens(tokens) {
    const errors = [];
    if (tokens.colors) {
      for (const [key, value] of Object.entries(tokens.colors)) {
        if (typeof value !== 'string') errors.push(`tokens.colors.${key}: value must be a string`);
      }
    }
    return errors;
  }

  _validateAI(ai) {
    const errors = [];
    if (ai.systemPrompt && typeof ai.systemPrompt !== 'string') {
      errors.push('ai.systemPrompt must be a string');
    }
    if (ai.toneModifiers && !Array.isArray(ai.toneModifiers)) {
      errors.push('ai.toneModifiers must be an array');
    }
    return errors;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _kebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
}

function _breakpointQuery(name) {
  const map = {
    mobile:  '(max-width: 767px)',
    tablet:  '(min-width: 768px) and (max-width: 1023px)',
    desktop: '(min-width: 1024px)',
    wide:    '(min-width: 1440px)',
  };
  return map[name] || null;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const packSDK = new PackSDK();
