/**
 * Nuvra Builder — Marketplace Advisor (Phase 11)
 *
 * AI-driven asset discovery and capability gap detection.
 * This is a key differentiator: the AI understands what the user is building
 * and proactively recommends the right marketplace assets.
 *
 * Capabilities:
 *  1. Capability gap detection — scans the project and identifies missing capabilities
 *  2. Contextual recommendations — suggests assets based on the current prompt/project
 *  3. Budget-aware filtering — respects the user's plan and purchase history
 *  4. Usage pattern learning — improves recommendations based on what the user installs
 *  5. Generation-time injection — injects recommendations into the AI generation flow
 *
 * Recommendation signals:
 *  - Current project type (landing page, SaaS, e-commerce, etc.)
 *  - Pages and components already in the project
 *  - Data collections defined
 *  - User's AI generation prompt
 *  - Currently installed assets
 *  - User's plan (to filter by affordability)
 *  - Historical install patterns (privacy-safe, local-only)
 *
 * Example recommendations:
 *  "This app has a form — install the Mailchimp Integration to capture leads."
 *  "This app requires authentication. Install the Auth Pack from the Marketplace."
 *  "You're building an e-commerce site. The E-Commerce AI Pack will improve generation quality."
 */
'use strict';

import { marketplaceService } from '../cloud/marketplaceService.js';
import { analyticsService }   from '../cloud/analyticsService.js';

// ─── Capability Signals ───────────────────────────────────────────────────────

const CAPABILITY_SIGNALS = [
  {
    id:          'auth',
    name:        'User Authentication',
    description: 'Your app appears to need user login/signup.',
    triggers:    [/login|sign.?in|sign.?up|register|auth|account|profile|user/i],
    assetTypes:  ['plugin', 'integration'],
    assetTags:   ['auth', 'authentication', 'login'],
    message:     'This app requires authentication. Install an Auth Pack from the Marketplace.',
    priority:    'high',
  },
  {
    id:          'payments',
    name:        'Payment Processing',
    description: 'Your app appears to need payment functionality.',
    triggers:    [/payment|checkout|cart|purchase|buy|price|stripe|paypal|shop|store|ecommerce/i],
    assetTypes:  ['integration', 'plugin'],
    assetTags:   ['payments', 'stripe', 'checkout', 'ecommerce'],
    message:     'This app needs payment processing. Install the Stripe Payments integration.',
    priority:    'high',
  },
  {
    id:          'email',
    name:        'Email / Newsletter',
    description: 'Your app has a form or newsletter signup.',
    triggers:    [/newsletter|subscribe|email.?list|mailchimp|sendgrid|form|contact/i],
    assetTypes:  ['integration'],
    assetTags:   ['email', 'mailchimp', 'newsletter', 'forms'],
    message:     'Add email capture to your forms. Install the Mailchimp Integration.',
    priority:    'medium',
  },
  {
    id:          'analytics',
    name:        'Analytics',
    description: 'Your app would benefit from usage analytics.',
    triggers:    [/analytics|tracking|metrics|dashboard|stats|visitors|pageview/i],
    assetTypes:  ['integration'],
    assetTags:   ['analytics', 'tracking', 'google-analytics'],
    message:     'Track your site visitors. Install the Google Analytics integration.',
    priority:    'medium',
  },
  {
    id:          'charts',
    name:        'Data Visualisation',
    description: 'Your app has data that would benefit from charts.',
    triggers:    [/chart|graph|dashboard|analytics|report|data.?vis|metrics/i],
    assetTypes:  ['plugin', 'component'],
    assetTags:   ['charts', 'data', 'dashboard', 'visualization'],
    message:     'Add beautiful charts to your dashboard. Install the Chart & Data Blocks pack.',
    priority:    'medium',
  },
  {
    id:          'ecommerce-ai',
    name:        'E-Commerce AI Pack',
    description: 'You\'re building an e-commerce site.',
    triggers:    [/shop|store|product|cart|inventory|catalog|ecommerce|e.?commerce/i],
    assetTypes:  ['ai-pack'],
    assetTags:   ['ecommerce', 'shop', 'products'],
    message:     'Improve AI generation for your store. Install the E-Commerce AI Pack.',
    priority:    'high',
  },
  {
    id:          'saas-ai',
    name:        'SaaS AI Pack',
    description: 'You\'re building a SaaS application.',
    triggers:    [/saas|subscription|dashboard|app|software|platform|tool/i],
    assetTypes:  ['ai-pack'],
    assetTags:   ['saas', 'dashboard', 'app'],
    message:     'Improve AI generation for your SaaS. Install the SaaS AI Pack.',
    priority:    'high',
  },
  {
    id:          'real-estate-ai',
    name:        'Real Estate AI Pack',
    description: 'You\'re building a real estate site.',
    triggers:    [/real.?estate|property|listing|house|apartment|rent|buy|mortgage/i],
    assetTypes:  ['ai-pack'],
    assetTags:   ['real-estate', 'property', 'listings'],
    message:     'Improve AI generation for real estate. Install the Real Estate AI Pack.',
    priority:    'high',
  },
  {
    id:          'maps',
    name:        'Maps & Location',
    description: 'Your app uses location or mapping.',
    triggers:    [/map|location|address|geolocation|nearby|directions|gps/i],
    assetTypes:  ['integration', 'plugin'],
    assetTags:   ['maps', 'location', 'google-maps'],
    message:     'Add interactive maps to your app. Install a Maps integration.',
    priority:    'medium',
  },
  {
    id:          'chat',
    name:        'Live Chat / Support',
    description: 'Your app would benefit from live chat.',
    triggers:    [/chat|support|help|intercom|crisp|zendesk|customer.?service/i],
    assetTypes:  ['integration'],
    assetTags:   ['chat', 'support', 'live-chat'],
    message:     'Add live chat to your site. Install a Chat integration.',
    priority:    'low',
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export const marketplaceAdvisor = {

  /**
   * Analyse a user's generation prompt and project context to recommend assets.
   * Called during AI generation (before the LLM call).
   *
   * @param {{ prompt: string, projectContext: object, installedAssets: string[], userPlan: string }} opts
   * @returns {Promise<Recommendation[]>}
   */
  async getRecommendationsForPrompt({ prompt = '', projectContext = {}, installedAssets = [], userPlan = 'free' } = {}) {
    const catalog = await marketplaceService.getCatalog().catch(() => []);
    const recommendations = [];

    for (const signal of CAPABILITY_SIGNALS) {
      // Check if any trigger matches the prompt or project context
      const promptText = [
        prompt,
        projectContext.name || '',
        (projectContext.pages || []).map(p => p.name || '').join(' '),
      ].join(' ');

      const triggered = signal.triggers.some(pattern => pattern.test(promptText));
      if (!triggered) continue;

      // Find matching assets in the catalog
      const matches = catalog.filter(asset => {
        if (!signal.assetTypes.includes(asset.type)) return false;
        if (installedAssets.includes(asset.assetId)) return false;
        const assetTags = asset.tags || [];
        return signal.assetTags.some(t => assetTags.includes(t));
      });

      if (!matches.length) continue;

      // Filter by affordability
      const affordable = matches.filter(a => _isAffordable(a, userPlan));

      recommendations.push({
        signalId:    signal.id,
        name:        signal.name,
        description: signal.description,
        message:     signal.message,
        priority:    signal.priority,
        assets:      (affordable.length ? affordable : matches).slice(0, 3),
        triggered:   true,
      });
    }

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

    // Track recommendation events (privacy-safe)
    if (recommendations.length) {
      analyticsService.track('advisor.recommendations', {
        count:   recommendations.length,
        signals: recommendations.map(r => r.signalId),
      });
    }

    return recommendations;
  },

  /**
   * Detect capability gaps in an existing project.
   * Called when a project is opened or when the user opens the marketplace.
   *
   * @param {{ pages: object[], collections: object[], installedAssets: string[], userPlan: string }} projectContext
   * @returns {Promise<CapabilityGap[]>}
   */
  async detectCapabilityGaps({ pages = [], collections = [], installedAssets = [], userPlan = 'free' } = {}) {
    const catalog = await marketplaceService.getCatalog().catch(() => []);
    const gaps    = [];

    // Build a text corpus from the project
    const corpus = [
      ...pages.map(p => `${p.name || ''} ${p.html || ''}`),
      ...collections.map(c => c.name || ''),
    ].join(' ').toLowerCase();

    for (const signal of CAPABILITY_SIGNALS) {
      if (installedAssets.some(id => {
        const asset = catalog.find(a => a.assetId === id);
        return asset && signal.assetTags.some(t => (asset.tags || []).includes(t));
      })) continue; // Already covered

      const triggered = signal.triggers.some(p => p.test(corpus));
      if (!triggered) continue;

      const matches = catalog.filter(asset => {
        if (!signal.assetTypes.includes(asset.type)) return false;
        if (installedAssets.includes(asset.assetId)) return false;
        return signal.assetTags.some(t => (asset.tags || []).includes(t));
      });

      if (!matches.length) continue;

      gaps.push({
        signalId:    signal.id,
        name:        signal.name,
        message:     signal.message,
        priority:    signal.priority,
        assets:      matches.filter(a => _isAffordable(a, userPlan)).slice(0, 2),
      });
    }

    return gaps;
  },

  /**
   * Get personalised "Recommended for You" assets based on install history.
   * Privacy-safe: uses only local install counts.
   *
   * @param {{ installedAssets: string[], userPlan: string }} opts
   * @returns {Promise<CloudAsset[]>}
   */
  async getPersonalisedRecommendations({ installedAssets = [], userPlan = 'free' } = {}) {
    const catalog = await marketplaceService.getCatalog().catch(() => []);
    const installCounts = analyticsService.getInstallCounts();

    // Find categories the user installs most
    const installedTypes = installedAssets
      .map(id => catalog.find(a => a.assetId === id)?.type)
      .filter(Boolean);

    const typeCounts = {};
    for (const t of installedTypes) typeCounts[t] = (typeCounts[t] || 0) + 1;

    const preferredTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    // Score each uninstalled asset
    const scored = catalog
      .filter(a => !installedAssets.includes(a.assetId))
      .filter(a => _isAffordable(a, userPlan))
      .map(asset => {
        let score = asset.stats?.installs || 0;
        if (preferredTypes.includes(asset.type)) score += 1000;
        if (asset.trust?.verified) score += 500;
        if (asset.stats?.rating >= 4.5) score += 300;
        return { asset, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ asset }) => asset);

    return scored;
  },

  /**
   * Generate a natural-language explanation for why an asset is recommended.
   * @param {CloudAsset} asset
   * @param {string} context - the user's prompt or project description
   * @returns {string}
   */
  explainRecommendation(asset, context = '') {
    const type = asset.type;
    const name = asset.name;

    if (type === 'ai-pack') {
      return `The ${name} will make the AI generate more accurate and domain-specific content for your project.`;
    }
    if (type === 'integration') {
      return `The ${name} connects your app to an external service, adding functionality without custom code.`;
    }
    if (type === 'plugin') {
      return `The ${name} adds new capabilities to the editor that match what you're building.`;
    }
    if (type === 'template') {
      return `The ${name} gives you a complete starting point that matches your project goals.`;
    }
    if (type === 'blueprint') {
      return `The ${name} is a complete business template — pages, data models, and integrations included.`;
    }
    return `${name} is recommended based on your current project.`;
  },

  /**
   * Format recommendations as a concise string for injection into AI prompts.
   * @param {Recommendation[]} recommendations
   * @returns {string}
   */
  formatForPromptInjection(recommendations) {
    if (!recommendations.length) return '';
    const lines = recommendations
      .filter(r => r.priority === 'high')
      .slice(0, 3)
      .map(r => `- ${r.message}`);
    if (!lines.length) return '';
    return `\n\nMARKETPLACE RECOMMENDATIONS:\n${lines.join('\n')}\n`;
  },
};

// ─── Private Helpers ──────────────────────────────────────────────────────────

function _isAffordable(asset, userPlan) {
  const pricing = asset.pricing || { model: 'free' };
  if (pricing.model === 'free') return true;
  if (pricing.model === 'revenue-share') return true;
  if (pricing.model === 'subscription') {
    const planHierarchy = ['free', 'pro', 'team', 'enterprise'];
    const userIdx = planHierarchy.indexOf((userPlan || 'free').toLowerCase());
    const reqIdx  = planHierarchy.indexOf((pricing.requiredPlan || 'pro').toLowerCase());
    return userIdx >= reqIdx;
  }
  if (pricing.model === 'one-time') {
    return (pricing.price || 0) <= 50; // Show assets under $50 as "affordable"
  }
  return true;
}
