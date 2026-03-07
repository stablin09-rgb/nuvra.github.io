/**
 * planningHeuristics.js — Nuvra Phase 2–2.5
 *
 * The UX heuristics library used by the Planning Graph.
 *
 * This module encodes proven UX and conversion principles as
 * deterministic, inspectable rules. These rules drive the planner's
 * decisions about page structure and section ordering.
 *
 * Every decision made by the planner can be traced back to a rule here.
 * This is what makes the AI "explainable" — the reasoning is not hidden
 * inside a model's weights; it is encoded in this module.
 *
 * @module ai/planning/planningHeuristics
 */
'use strict';

// ─── Section Types ────────────────────────────────────────────────────────────
export const SectionType = Object.freeze({
  HERO:          'hero',
  VALUE_PROP:    'value_prop',
  FEATURES:      'features',
  HOW_IT_WORKS:  'how_it_works',
  SOCIAL_PROOF:  'social_proof',
  TESTIMONIALS:  'testimonials',
  PRICING:       'pricing',
  FAQ:           'faq',
  CTA:           'cta',
  ABOUT:         'about',
  TEAM:          'team',
  CONTACT:       'contact',
  BLOG_LIST:     'blog_list',
  BLOG_POST:     'blog_post',
  PORTFOLIO_GRID:'portfolio_grid',
  CASE_STUDIES:  'case_studies',
  INTEGRATIONS:  'integrations',
  STATS:         'stats',
  COMPARISON:    'comparison',
  FOOTER:        'footer',
  NAVIGATION:    'navigation',
});

// ─── Page Templates ───────────────────────────────────────────────────────────
/**
 * Returns the recommended section order for a given page type,
 * based on conversion and UX heuristics.
 * Each entry includes the section type and the reasoning for its placement.
 */
export const PAGE_TEMPLATES = Object.freeze({

  landing: [
    { type: SectionType.NAVIGATION,   reason: 'Navigation anchors the user and provides escape routes, reducing bounce anxiety.' },
    { type: SectionType.HERO,         reason: 'Hero appears first to establish value clarity within 3 seconds — the critical window before a user decides to leave.' },
    { type: SectionType.SOCIAL_PROOF, reason: 'Immediate social proof after the hero reduces skepticism before the user reads further.' },
    { type: SectionType.VALUE_PROP,   reason: 'Value proposition expands on the hero promise with concrete benefits, not features.' },
    { type: SectionType.FEATURES,     reason: 'Features are shown after value is established — features without context are noise.' },
    { type: SectionType.HOW_IT_WORKS, reason: 'Process clarity reduces the perceived effort of getting started.' },
    { type: SectionType.TESTIMONIALS, reason: 'Testimonials at the decision point reinforce trust when the user is evaluating commitment.' },
    { type: SectionType.PRICING,      reason: 'Pricing appears after trust is built — showing price before value is a conversion killer.' },
    { type: SectionType.FAQ,          reason: 'FAQ addresses final objections before the closing CTA.' },
    { type: SectionType.CTA,          reason: 'Closing CTA captures users who have read through the full page.' },
    { type: SectionType.FOOTER,       reason: 'Footer provides navigation fallback and legal/trust signals.' },
  ],

  saas: [
    { type: SectionType.NAVIGATION,   reason: 'Navigation with clear product name and primary CTA is essential for SaaS credibility.' },
    { type: SectionType.HERO,         reason: 'Hero must communicate the core job-to-be-done in one sentence.' },
    { type: SectionType.STATS,        reason: 'Quantified results immediately after the hero establish credibility for a SaaS product.' },
    { type: SectionType.FEATURES,     reason: 'Feature overview gives technical evaluators the information they need.' },
    { type: SectionType.HOW_IT_WORKS, reason: 'SaaS products require onboarding clarity — users need to understand the workflow.' },
    { type: SectionType.INTEGRATIONS, reason: 'Integration ecosystem signals maturity and reduces switching cost concerns.' },
    { type: SectionType.TESTIMONIALS, reason: 'Customer stories from recognizable companies provide social proof for B2B buyers.' },
    { type: SectionType.PRICING,      reason: 'Transparent pricing is a trust signal for SaaS — hiding it creates friction.' },
    { type: SectionType.FAQ,          reason: 'FAQ addresses technical and contractual questions that block B2B decisions.' },
    { type: SectionType.CTA,          reason: 'Free trial or demo CTA at the bottom captures high-intent users.' },
    { type: SectionType.FOOTER,       reason: 'Footer with security badges and compliance links is critical for B2B trust.' },
  ],

  portfolio: [
    { type: SectionType.NAVIGATION,   reason: 'Minimal navigation keeps focus on the work.' },
    { type: SectionType.HERO,         reason: 'Personal hero establishes identity and specialty immediately.' },
    { type: SectionType.PORTFOLIO_GRID, reason: 'Work is the primary evidence — it must appear early and prominently.' },
    { type: SectionType.CASE_STUDIES, reason: 'Case studies provide depth for clients who want to understand the process.' },
    { type: SectionType.ABOUT,        reason: 'About section builds personal connection after the work has established credibility.' },
    { type: SectionType.TESTIMONIALS, reason: 'Client testimonials validate the quality of work shown.' },
    { type: SectionType.CONTACT,      reason: 'Contact section is the conversion goal — it must be prominent and frictionless.' },
    { type: SectionType.FOOTER,       reason: 'Footer with social links and copyright.' },
  ],

  ecommerce: [
    { type: SectionType.NAVIGATION,   reason: 'Navigation with search and cart is the primary interaction surface for e-commerce.' },
    { type: SectionType.HERO,         reason: 'Hero showcases the primary product or promotion.' },
    { type: SectionType.SOCIAL_PROOF, reason: 'Trust signals early reduce purchase anxiety.' },
    { type: SectionType.FEATURES,     reason: 'Product benefits drive purchase intent.' },
    { type: SectionType.TESTIMONIALS, reason: 'Reviews are the #1 conversion driver in e-commerce.' },
    { type: SectionType.CTA,          reason: 'Shop CTA captures users ready to browse.' },
    { type: SectionType.FOOTER,       reason: 'Footer with returns policy and security badges reduces purchase risk.' },
  ],

  blog: [
    { type: SectionType.NAVIGATION,   reason: 'Navigation with categories helps readers find relevant content.' },
    { type: SectionType.HERO,         reason: 'Featured post hero drives engagement with the best content.' },
    { type: SectionType.BLOG_LIST,    reason: 'Recent posts grid is the primary content surface.' },
    { type: SectionType.CTA,          reason: 'Newsletter CTA converts readers into subscribers.' },
    { type: SectionType.FOOTER,       reason: 'Footer with archive links and social channels.' },
  ],

  about: [
    { type: SectionType.NAVIGATION,   reason: 'Navigation provides context within the broader site.' },
    { type: SectionType.HERO,         reason: 'About hero establishes the company mission.' },
    { type: SectionType.STATS,        reason: 'Company metrics establish scale and credibility.' },
    { type: SectionType.ABOUT,        reason: 'Story and values build emotional connection.' },
    { type: SectionType.TEAM,         reason: 'Team section humanizes the company.' },
    { type: SectionType.FOOTER,       reason: 'Footer with contact and social links.' },
  ],

  contact: [
    { type: SectionType.NAVIGATION,   reason: 'Navigation provides escape route if the user is lost.' },
    { type: SectionType.HERO,         reason: 'Contact hero sets expectations for response time.' },
    { type: SectionType.CONTACT,      reason: 'Contact form is the sole purpose of this page — it must be prominent.' },
    { type: SectionType.FOOTER,       reason: 'Footer with alternative contact methods.' },
  ],
});

// ─── Section Metadata ─────────────────────────────────────────────────────────
/**
 * Metadata for each section type — purpose, required content, and constraints.
 */
export const SECTION_METADATA = Object.freeze({
  [SectionType.HERO]: {
    purpose:        'Establish value clarity and capture attention within 3 seconds.',
    required:       ['headline', 'subheadline', 'primaryCta'],
    optional:       ['secondaryCta', 'heroMedia', 'socialProofBadge'],
    maxComponents:  6,
  },
  [SectionType.VALUE_PROP]: {
    purpose:        'Communicate concrete benefits (not features) that matter to the audience.',
    required:       ['headline', 'benefits'],
    optional:       ['icon', 'illustration'],
    maxComponents:  8,
  },
  [SectionType.FEATURES]: {
    purpose:        'Detail the specific capabilities that deliver the value proposition.',
    required:       ['headline', 'featureList'],
    optional:       ['screenshot', 'demo'],
    maxComponents:  12,
  },
  [SectionType.HOW_IT_WORKS]: {
    purpose:        'Reduce perceived effort by showing the path from signup to value.',
    required:       ['headline', 'steps'],
    optional:       ['illustration', 'cta'],
    maxComponents:  6,
  },
  [SectionType.SOCIAL_PROOF]: {
    purpose:        'Reduce skepticism with logos, numbers, or brief quotes from credible sources.',
    required:       ['proofItems'],
    optional:       ['headline'],
    maxComponents:  10,
  },
  [SectionType.TESTIMONIALS]: {
    purpose:        'Build trust through specific, credible customer stories.',
    required:       ['testimonials'],
    optional:       ['headline', 'cta'],
    maxComponents:  6,
  },
  [SectionType.PRICING]: {
    purpose:        'Present pricing transparently to remove the #1 objection.',
    required:       ['headline', 'plans'],
    optional:       ['faq', 'guarantee', 'cta'],
    maxComponents:  8,
  },
  [SectionType.FAQ]: {
    purpose:        'Address the most common objections and questions before they block conversion.',
    required:       ['headline', 'questions'],
    optional:       ['cta'],
    maxComponents:  12,
  },
  [SectionType.CTA]: {
    purpose:        'Create a clear, low-friction path to the primary conversion action.',
    required:       ['headline', 'primaryCta'],
    optional:       ['subheadline', 'secondaryCta', 'guarantee'],
    maxComponents:  4,
  },
  [SectionType.CONTACT]: {
    purpose:        'Provide a frictionless path to get in touch.',
    required:       ['form'],
    optional:       ['headline', 'address', 'phone', 'email', 'map'],
    maxComponents:  6,
  },
  [SectionType.NAVIGATION]: {
    purpose:        'Provide orientation and primary navigation within the site.',
    required:       ['logo', 'navLinks'],
    optional:       ['cta', 'search'],
    maxComponents:  4,
  },
  [SectionType.FOOTER]: {
    purpose:        'Provide navigation fallback, legal information, and trust signals.',
    required:       ['copyright'],
    optional:       ['links', 'social', 'newsletter', 'address'],
    maxComponents:  6,
  },
});

// ─── Page Selector ────────────────────────────────────────────────────────────
/**
 * Determine which pages a site should have based on intent.
 * Returns an array of page descriptors with rationale.
 */
export function selectPagesForIntent(intent) {
  const pages = [];
  const { product, goals, features } = intent;

  // Home/Landing page is always present
  const homeTemplate = product.type === 'saas'      ? 'saas'
                     : product.type === 'portfolio'  ? 'portfolio'
                     : product.type === 'ecommerce'  ? 'ecommerce'
                     : product.type === 'blog'       ? 'blog'
                     : 'landing';

  pages.push({
    name:     'Home',
    slug:     'home',
    template: homeTemplate,
    purpose:  'Primary entry point — establishes value and drives the main conversion goal.',
    reason:   'Every site requires a home page as the primary entry point and conversion surface.',
    required: true,
  });

  // About page — implied for most non-landing sites
  if (['saas', 'portfolio', 'ecommerce', 'site', 'hybrid'].includes(product.type)) {
    pages.push({
      name:     'About',
      slug:     'about',
      template: 'about',
      purpose:  'Build trust and emotional connection through company story and values.',
      reason:   'An About page is expected for credibility; its absence raises trust concerns.',
      required: false,
    });
  }

  // Contact page — implied if lead capture or contact is a goal/feature
  const wantsContact = goals.primary?.includes('lead') ||
    features.required.some(f => f.toLowerCase().includes('contact')) ||
    features.implied.some(f => f.toLowerCase().includes('contact'));

  if (wantsContact || ['saas', 'portfolio', 'site'].includes(product.type)) {
    pages.push({
      name:     'Contact',
      slug:     'contact',
      template: 'contact',
      purpose:  'Provide a direct channel for leads, inquiries, and support requests.',
      reason:   'Contact page is required when lead capture or direct communication is a stated goal.',
      required: wantsContact,
    });
  }

  // Blog page — if content marketing is implied or requested
  const wantsBlog = features.required.some(f => f.toLowerCase().includes('blog')) ||
    features.implied.some(f => f.toLowerCase().includes('blog')) ||
    product.type === 'blog';

  if (wantsBlog) {
    pages.push({
      name:     'Blog',
      slug:     'blog',
      template: 'blog',
      purpose:  'Content marketing hub for SEO, thought leadership, and audience retention.',
      reason:   'Blog was explicitly requested or strongly implied by the product type.',
      required: product.type === 'blog',
    });
  }

  return pages;
}
