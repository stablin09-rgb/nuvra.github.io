/**
 * Nuvra Builder — Mock AI Provider
 *
 * An intelligent mock provider that simulates real AI generation
 * using the PromptAnalyser → SitePlanner → SchemaRenderer pipeline.
 *
 * This provider:
 *  - Requires no API key
 *  - Works entirely offline
 *  - Produces realistic, varied output based on the prompt
 *  - Is the default fallback when no real provider is configured
 *
 * It is NOT a stub — it uses the full schema pipeline and produces
 * output that is indistinguishable in structure from real AI output.
 */

'use strict';

import { analysePrompt }                         from './promptAnalyser.js';
import { planSite, planPage }                    from './sitePlanner.js';
import { validatePageSchema, repairPageSchema }  from './pageSchema.js';
import { repairAppPlan }                         from './appSchema.js';
import { analyseAppPrompt, planApp }             from './appPlanner.js';
import { renderPageSchema }                      from './schemaRenderer.js';

// ─── Content Library ──────────────────────────────────────────────────────────
// Industry-aware content for each section type.

const CONTENT_LIBRARY = {
  fintech: {
    hero: {
      headline:     'The future of finance, in your hands',
      subheadline:  'Send, receive, and grow your money with zero fees and bank-grade security.',
      primaryCta:   'Open free account',
      secondaryCta: 'See how it works',
      badge:        'Trusted by 50,000+ users',
    },
    features: {
      headline:    'Built for the modern economy',
      subheadline: 'Everything you need to manage your finances intelligently.',
      items: [
        { icon: '💳', title: 'Instant transfers', description: 'Send money anywhere in seconds with zero transaction fees.' },
        { icon: '📈', title: 'Smart investing', description: 'Automated portfolios that grow your wealth on autopilot.' },
        { icon: '🔐', title: 'Bank-grade security', description: '256-bit encryption and biometric authentication.' },
      ],
    },
  },
  health: {
    hero: {
      headline:     'Your health, simplified',
      subheadline:  'Track, understand, and improve your wellbeing with personalised insights.',
      primaryCta:   'Start your journey',
      secondaryCta: 'See the science',
      badge:        'Recommended by 1,200+ doctors',
    },
    features: {
      headline:    'Wellness that works for you',
      subheadline: 'Science-backed tools for a healthier, happier life.',
      items: [
        { icon: '❤️', title: 'Health tracking', description: 'Monitor vitals, sleep, and activity in one place.' },
        { icon: '🧬', title: 'Personalised plans', description: 'AI-powered recommendations tailored to your body.' },
        { icon: '👨‍⚕️', title: 'Expert guidance', description: 'Access certified health professionals on demand.' },
      ],
    },
  },
  education: {
    hero: {
      headline:     'Learn anything, anywhere',
      subheadline:  'World-class courses from industry experts, at your own pace.',
      primaryCta:   'Browse courses',
      secondaryCta: 'Try for free',
      badge:        '500+ courses available',
    },
    features: {
      headline:    'Everything you need to level up',
      subheadline: 'Tools designed to make learning stick.',
      items: [
        { icon: '🎓', title: 'Expert instructors', description: 'Learn from practitioners with real-world experience.' },
        { icon: '📱', title: 'Learn on any device', description: 'Desktop, tablet, or mobile — your progress syncs everywhere.' },
        { icon: '🏆', title: 'Earn certificates', description: 'Industry-recognised credentials to advance your career.' },
      ],
    },
  },
  general: {
    hero: {
      headline:     'Build something great',
      subheadline:  'The tools you need to bring your ideas to life, faster than ever.',
      primaryCta:   'Get started free',
      secondaryCta: 'See a demo',
      badge:        'Trusted by 10,000+ teams',
    },
    features: {
      headline:    'Everything you need, nothing you don\'t',
      subheadline: 'Powerful features designed for modern teams.',
      items: [
        { icon: '⚡', title: 'Fast', description: 'Optimised for speed and performance at any scale.' },
        { icon: '🔒', title: 'Secure', description: 'Enterprise-grade security built in from day one.' },
        { icon: '🌍', title: 'Scalable', description: 'Grows effortlessly with your needs.' },
      ],
    },
  },
};

// ─── Schema Builder ───────────────────────────────────────────────────────────

function _buildSectionData(sectionType, industry, brand, pagePlan) {
  const content = CONTENT_LIBRARY[industry] || CONTENT_LIBRARY.general;

  switch (sectionType) {
    case 'hero':
      return {
        ...(content.hero || CONTENT_LIBRARY.general.hero),
        badge: content.hero?.badge || brand.tagline,
      };

    case 'features':
      return content.features || CONTENT_LIBRARY.general.features;

    case 'stats':
      return {
        stats: [
          { value: '10K+', label: 'Active Users' },
          { value: '99.9%', label: 'Uptime' },
          { value: '4.9★', label: 'Rating' },
          { value: '24/7', label: 'Support' },
        ],
      };

    case 'pricing':
      return {
        headline: 'Simple, transparent pricing',
        subheadline: 'No hidden fees. Cancel anytime.',
        plans: [
          { name: 'Free', price: '$0', period: '/month', features: ['5 projects', '1 GB storage', 'Community support'], cta: 'Get started' },
          { name: 'Pro', price: '$29', period: '/month', features: ['Unlimited projects', '50 GB storage', 'Priority support', 'Analytics'], cta: 'Start free trial', featured: true },
          { name: 'Enterprise', price: 'Custom', period: '', features: ['Everything in Pro', 'SSO & SAML', 'SLA guarantee', 'Dedicated support'], cta: 'Contact us' },
        ],
      };

    case 'testimonials':
      return {
        headline: 'Loved by teams worldwide',
        items: [
          { quote: `${brand.name} completely changed how our team works. I can't imagine going back.`, author: 'Sarah K.', role: 'Product Manager, Acme' },
          { quote: 'Incredibly easy to use and the results speak for themselves. Highly recommended.', author: 'James T.', role: 'Founder, Buildco' },
          { quote: 'The best investment we\'ve made for our workflow this year.', author: 'Maria L.', role: 'CTO, Techwave' },
        ],
      };

    case 'faq':
      return {
        headline: 'Frequently asked questions',
        items: [
          { question: `How do I get started with ${brand.name}?`, answer: 'Sign up for a free account and follow the onboarding guide. You\'ll be up and running in minutes.' },
          { question: 'Can I cancel anytime?', answer: 'Yes. There are no long-term contracts. Cancel your subscription at any time with no penalties.' },
          { question: 'Is my data secure?', answer: 'Absolutely. We use industry-standard encryption and follow best practices for data security and privacy.' },
        ],
      };

    case 'cta':
      return {
        headline: `Ready to get started with ${brand.name}?`,
        subheadline: 'Join thousands of teams already building with us.',
        cta: 'Start for free',
      };

    case 'navbar':
      return {
        logo: brand.name,
        links: ['Features', 'Pricing', 'About', 'Blog'],
        cta: 'Get started',
      };

    case 'footer':
      return {
        copyright: `© ${new Date().getFullYear()} ${brand.name}. All rights reserved.`,
        links: ['Privacy Policy', 'Terms of Service', 'Contact'],
      };

    default:
      return {};
  }
}

function _buildPageSchema(pagePlan, brand, industry) {
  const sections = pagePlan.sections.map((sectionType) => ({
    type: sectionType,
    data: _buildSectionData(sectionType, industry, brand, pagePlan),
  }));

  return {
    pageId:   pagePlan.pageId,
    pageName: pagePlan.pageName,
    pageType: pagePlan.pageType,
    brand,
    sections,
  };
}

// ─── Sleep Helper ─────────────────────────────────────────────────────────────

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a single page from a prompt using the intelligent mock pipeline.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<GenerationResult>}
 */
export async function mockGeneratePage(prompt, options = {}) {
  await _sleep(600 + Math.random() * 400);

  const intent   = analysePrompt(prompt);
  const pagePlan = planPage(intent);
  const schema   = _buildPageSchema(pagePlan, pagePlan.brand || { name: 'Nuvra', tagline: '', accent: '#7c6af7' }, intent.industry);

  const validated = validatePageSchema(schema);
  const { html, css } = renderPageSchema(validated);

  return {
    html,
    css,
    name:   validated.pageName,
    schema: validated,
    meta:   { provider: 'mock', model: 'nuvra-intelligent-mock-v2', tokens: null },
  };
}

/**
 * Generate a full AppPlan from a prompt using the intelligent mock pipeline.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<AppPlan>}
 */
export async function mockGenerateApp(prompt, options = {}) {
  await _sleep(700 + Math.random() * 500);

  try {
    const intent  = analyseAppPrompt(prompt);
    const appPlan = planApp(intent);
    return repairAppPlan(appPlan);
  } catch (err) {
    console.error('[MockProvider] mockGenerateApp error:', err);
    // Return a minimal valid AppPlan as fallback
    return repairAppPlan({
      appName:     'My App',
      appType:     'crud',
      brand:       { accent: '#7c6af7' },
      collections: [{ name: 'items', label: 'Items', fields: [{ name: 'name', label: 'Name', type: 'text', required: true }] }],
      pages: [{
        pageId:    'main',
        pageName:  'Main',
        pageType:  'app',
        layout:    'topbar',
        components: [
          { componentType: 'data-table', title: 'Items', collection: 'items' },
          { componentType: 'data-form',  title: 'Add Item', collection: 'items' },
        ],
      }],
    });
  }
}

/**
 * Generate a multi-page site from a prompt using the intelligent mock pipeline.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @returns {Promise<SiteGenerationResult>}
 */
export async function mockGenerateSite(prompt, options = {}) {
  await _sleep(800 + Math.random() * 600);

  const intent    = analysePrompt(prompt);
  const sitePlan  = planSite({ ...intent, isMultiPage: true });

  const pages = sitePlan.pages.map((pagePlan) => {
    const schema    = _buildPageSchema(pagePlan, sitePlan.brand, intent.industry);
    const validated = validatePageSchema(schema);
    const { html, css } = renderPageSchema(validated);
    return {
      id:     validated.pageId,
      name:   validated.pageName,
      html,
      css,
      schema: validated,
    };
  });

  return {
    pages,
    meta: {
      provider:  'mock',
      model:     'nuvra-intelligent-mock-v2',
      tokens:    null,
      pageCount: pages.length,
    },
  };
}
