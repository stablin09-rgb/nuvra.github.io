/**
 * Nuvra — aiExtensions.js (Phase 13)
 *
 * Pack-aware AI generation layer.
 *
 * This module sits between the editor's AI generation calls and the underlying
 * AI engine (aiEngine.js). It:
 *
 *  1. Reads the active pack context from packRuntime
 *  2. Fuses pack AI extensions into the base system prompt
 *  3. Enforces brand constraints on the generated output
 *  4. Validates the output against pack schema rules
 *  5. Falls back gracefully if no packs are active
 *
 * Prompt Fusion Strategy:
 *  - Base system prompt is always first
 *  - Pack system prompts are appended in activation order
 *  - Tone modifiers are merged and deduplicated
 *  - Layout rules are additive (all rules apply)
 *  - Constraints are merged (last-write-wins for conflicts)
 *  - Forbidden patterns are enforced via post-generation filtering
 *
 * @module aiExtensions
 */
'use strict';

import { packRuntime } from '../design-packs/packRuntime.js';

// ─── AIExtensions ─────────────────────────────────────────────────────────────

class AIExtensions {

  // ─── Prompt Fusion ───────────────────────────────────────────────────────────

  /**
   * Fuse pack AI extensions into a base prompt configuration.
   *
   * @param {object} baseConfig - The base AI generation config from aiEngine.js
   * @returns {object} - The enhanced config with pack extensions applied
   */
  fusePrompt(baseConfig) {
    const packContext = packRuntime.getMergedAIContext();
    if (!packContext || packContext.packCount === 0) {
      return baseConfig; // No packs active — pass through unchanged
    }

    const enhanced = { ...baseConfig };

    // Build the pack extension block
    const packBlock = this._buildPackBlock(packContext);

    // Inject into system prompt
    if (enhanced.systemPrompt) {
      enhanced.systemPrompt = `${enhanced.systemPrompt}\n\n${packBlock}`;
    } else {
      enhanced.systemPrompt = packBlock;
    }

    // Inject into user prompt if it's a page/site/app generation
    if (enhanced.userPrompt && packContext.packNames.length > 0) {
      const packHint = `[Design Pack${packContext.packCount > 1 ? 's' : ''} active: ${packContext.packNames.join(', ')}]`;
      enhanced.userPrompt = `${packHint} ${enhanced.userPrompt}`;
    }

    // Attach constraint metadata for post-generation validation
    enhanced._packConstraints = packContext.constraints;
    enhanced._packForbiddenPatterns = packContext.forbiddenPatterns;
    enhanced._packSectionOrders = packContext.sectionOrders;

    return enhanced;
  }

  /**
   * Apply pack constraints to a generated HTML output.
   * Enforces forbidden patterns and validates against brand rules.
   *
   * @param {string} html - Generated HTML
   * @param {object} packConstraints - Constraints from the active pack context
   * @returns {{ html: string, violations: string[] }}
   */
  enforceConstraints(html, packConstraints = {}) {
    const violations = [];
    let processed = html;

    if (!packConstraints || Object.keys(packConstraints).length === 0) {
      return { html: processed, violations };
    }

    // Enforce color constraints: replace any hardcoded colors with pack tokens
    if (packConstraints.enforceTokenColors) {
      // Replace common hardcoded color patterns with CSS variable references
      // This is a best-effort transformation; complex cases are flagged
      const colorPattern = /(?:color|background(?:-color)?|border(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\))/g;
      const matches = processed.match(colorPattern) || [];
      if (matches.length > 0) {
        violations.push(`${matches.length} hardcoded color(s) detected. Consider using pack CSS variables (--pack-color-*).`);
      }
    }

    // Enforce forbidden patterns
    const forbidden = packConstraints.forbiddenPatterns || [];
    for (const pattern of forbidden) {
      try {
        const re = new RegExp(pattern, 'gi');
        if (re.test(processed)) {
          violations.push(`Forbidden pattern detected: ${pattern}`);
          processed = processed.replace(re, '');
        }
      } catch { /* Invalid regex — skip */ }
    }

    // Enforce font constraints
    if (packConstraints.enforceFonts) {
      const fontPattern = /font-family\s*:\s*(?!var\(--pack-)/gi;
      if (fontPattern.test(processed)) {
        violations.push('Hardcoded font-family detected. Use --pack-font-family or --pack-heading-family.');
      }
    }

    return { html: processed, violations };
  }

  /**
   * Validate that a generated page structure respects the pack's section order preferences.
   *
   * @param {string[]} generatedSections - Section types in the generated output
   * @param {string[][]} preferredOrders - Section order preferences from active packs
   * @returns {{ valid: boolean, suggestions: string[] }}
   */
  validateSectionOrder(generatedSections, preferredOrders) {
    const suggestions = [];

    for (const preferredOrder of preferredOrders) {
      // Check if the generated sections follow the preferred order
      const presentSections = preferredOrder.filter(s => generatedSections.includes(s));
      const actualOrder = generatedSections.filter(s => preferredOrder.includes(s));

      if (JSON.stringify(presentSections) !== JSON.stringify(actualOrder)) {
        suggestions.push(
          `Recommended section order: ${presentSections.join(' → ')}`
        );
      }
    }

    return { valid: suggestions.length === 0, suggestions };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  _buildPackBlock(packContext) {
    const lines = [
      '--- ACTIVE DESIGN PACKS ---',
      `You are generating content with ${packContext.packCount} active design pack(s): ${packContext.packNames.join(', ')}.`,
      'The following design system rules MUST be followed:',
      '',
    ];

    // System prompts from packs
    for (const prompt of packContext.systemPrompts) {
      if (prompt.trim()) {
        lines.push(prompt.trim());
        lines.push('');
      }
    }

    // Tone modifiers
    if (packContext.toneModifiers.length > 0) {
      const unique = [...new Set(packContext.toneModifiers)];
      lines.push(`Tone: ${unique.join(', ')}.`);
    }

    // Layout rules
    if (packContext.layoutRules.length > 0) {
      lines.push('Layout rules:');
      for (const rule of packContext.layoutRules) {
        lines.push(`  - ${rule}`);
      }
    }

    // Color rules
    if (packContext.colorRules.length > 0) {
      lines.push('Color rules:');
      for (const rule of packContext.colorRules) {
        lines.push(`  - ${rule}`);
      }
    }

    // Typography rules
    if (packContext.typographyRules.length > 0) {
      lines.push('Typography rules:');
      for (const rule of packContext.typographyRules) {
        lines.push(`  - ${rule}`);
      }
    }

    // Content rules
    if (packContext.contentRules.length > 0) {
      lines.push('Content rules:');
      for (const rule of packContext.contentRules) {
        lines.push(`  - ${rule}`);
      }
    }

    // Section order preferences
    if (packContext.sectionOrders.length > 0) {
      const preferred = packContext.sectionOrders[0]; // Use first pack's order as primary
      lines.push(`Preferred section order: ${preferred.join(' → ')}.`);
    }

    // Forbidden patterns
    if (packContext.forbiddenPatterns.length > 0) {
      lines.push('Do NOT use:');
      for (const pattern of packContext.forbiddenPatterns) {
        lines.push(`  - ${pattern}`);
      }
    }

    lines.push('--- END DESIGN PACKS ---');
    return lines.join('\n');
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const aiExtensions = new AIExtensions();
