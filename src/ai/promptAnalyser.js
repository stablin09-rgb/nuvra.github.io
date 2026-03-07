/**
 * Nuvra Builder — Prompt Analyser (Phase A)
 *
 * Extracts rich, structured intent from a user's natural language prompt.
 * Used by both the marketing page pipeline (SitePlanner) and the app
 * pipeline (AppPlanner) as the first step in generation.
 *
 * Output shape (PromptIntent):
 * {
 *   raw:         string,          // original prompt
 *   pageType:    string,          // 'saas' | 'portfolio' | 'blog' | 'landing' | ...
 *   appType:     string | null,   // 'crud' | 'dashboard' | 'directory' | ... (null for marketing)
 *   isApp:       boolean,         // true if this is an app prompt, not a marketing page
 *   isMultiPage: boolean,         // true if user asked for a full site
 *   industry:    string,          // 'fintech' | 'health' | 'education' | 'general' | ...
 *   tone:        string,          // 'professional' | 'playful' | 'minimal' | 'bold'
 *   brand:       string,          // extracted brand name (empty string if none found)
 *   brandName:   string,          // alias for brand (for backwards compat)
 *   accent:      string,          // CSS hex color
 *   features:    string[],        // ['pricing', 'faq', 'testimonials', ...]
 *   entities:    string[],        // ['task', 'project', 'contact', ...] (for apps)
 *   confidence:  ConfidenceMap,   // per-signal confidence scores (0–1)
 *   rawPrompt:   string,          // alias for raw (for backwards compat)
 * }
 */

'use strict';

import { PAGE_TYPES, SECTION_TYPES } from './pageSchema.js';

// ─── Industry Taxonomy ────────────────────────────────────────────────────────
// Each entry: [regex, industryKey, weight]

const INDUSTRY_SIGNALS = [
  [/\b(fintech|finance|banking|payment|wallet|invoice|accounting|budget|invest|trading|crypto|defi|neobank|payroll|expense)\b/, 'fintech', 3],
  [/\b(money|cash|fund|loan|mortgage|insurance|tax|revenue|profit|loss)\b/, 'fintech', 1],
  [/\b(health|medical|clinic|hospital|doctor|patient|wellness|fitness|nutrition|mental.?health|therapy|telemedicine|pharma)\b/, 'health', 3],
  [/\b(workout|exercise|diet|sleep|meditation|mindfulness|calories|bmi)\b/, 'health', 2],
  [/\b(education|e.?learning|course|learning|school|university|tutor|lesson|curriculum|lms|edtech|quiz|certificate)\b/, 'education', 3],
  [/\b(student|teacher|classroom|homework|study|knowledge|skill|training)\b/, 'education', 2],
  [/\b(saas|software|platform|productivity|workflow|automation|integration|api|dashboard|analytics|crm|erp|project.?management)\b/, 'saas', 3],
  [/\b(tool|app|service|subscription|enterprise|b2b|startup)\b/, 'saas', 1],
  [/\b(ecommerce|e.?commerce|shop|store|retail|product|inventory|cart|checkout|marketplace|dropship)\b/, 'ecommerce', 3],
  [/\b(buy|sell|price|discount|coupon|shipping|order|catalogue)\b/, 'ecommerce', 1],
  [/\b(portfolio|creative|design|agency|studio|art|photography|illustration|branding|freelance|showcase)\b/, 'creative', 3],
  [/\b(work|project|client|visual|gallery|case.?study)\b/, 'creative', 1],
  [/\b(real.?estate|property|housing|rental|mortgage|listing|agent|realty|apartment|home|lease)\b/, 'realestate', 3],
  [/\b(law|legal|attorney|lawyer|firm|consulting|advisory|audit|compliance)\b/, 'legal', 3],
  [/\b(restaurant|food|cafe|menu|delivery|recipe|catering|kitchen|chef|dining|meal)\b/, 'food', 3],
  [/\b(travel|hotel|booking|tourism|flight|vacation|trip|destination|hospitality)\b/, 'travel', 3],
  [/\b(nonprofit|charity|ngo|community|volunteer|donation|cause|social.?impact|foundation)\b/, 'nonprofit', 3],
  [/\b(developer|devtool|open.?source|github|sdk|cli|library|framework|documentation|docs)\b/, 'devtools', 3],
];

// ─── Tone Detection ───────────────────────────────────────────────────────────

const TONE_SIGNALS = [
  [/\b(professional|corporate|enterprise|formal|serious|trusted|established)\b/, 'professional', 2],
  [/\b(playful|fun|friendly|casual|quirky|vibrant|energetic|young)\b/, 'playful', 2],
  [/\b(minimal|clean|simple|elegant|refined|subtle|understated|quiet)\b/, 'minimal', 2],
  [/\b(bold|powerful|striking|dramatic|dark|intense|strong)\b/, 'bold', 2],
  [/\b(modern|fresh|innovative|cutting.?edge|next.?gen|futuristic)\b/, 'professional', 1],
];

// ─── Feature Detection ────────────────────────────────────────────────────────

const FEATURE_SIGNALS = [
  [/\b(pricing|price|plan|tier|subscription|cost)\b/, SECTION_TYPES.PRICING],
  [/\b(faq|question|answer|help|support)\b/, SECTION_TYPES.FAQ],
  [/\b(testimonial|review|feedback|customer.?story|social.?proof)\b/, SECTION_TYPES.TESTIMONIALS],
  [/\b(team|about.?us|our.?story|founder|mission|vision)\b/, SECTION_TYPES.TEAM],
  [/\b(blog|article|news|post|content|publication)\b/, SECTION_TYPES.BLOG_LIST],
  [/\b(contact|get.?in.?touch|reach.?us|email.?us)\b/, SECTION_TYPES.CONTACT_FORM],
  [/\b(gallery|portfolio|showcase|work|case.?study)\b/, SECTION_TYPES.GALLERY],
  [/\b(stats|number|metric|achievement|milestone)\b/, SECTION_TYPES.STATS],
  [/\b(benefit|advantage|why.?us|reason|value.?prop)\b/, SECTION_TYPES.FEATURES],
];

// ─── Page Type Detection ──────────────────────────────────────────────────────

const PAGE_TYPE_SIGNALS = [
  [/\b(portfolio|showcase|my.?work|case.?stud)\b/, PAGE_TYPES.PORTFOLIO, 3],
  [/\b(blog|article|post|publication|newsletter)\b/, PAGE_TYPES.BLOG, 3],
  [/\b(landing.?page|lead.?gen|waitlist|coming.?soon|launch)\b/, PAGE_TYPES.LANDING, 3],
  [/\b(saas|software.?product|platform|tool|app.?homepage)\b/, PAGE_TYPES.SAAS, 2],
  [/\b(agency|studio|creative.?firm|design.?agency)\b/, PAGE_TYPES.SAAS, 2],
  [/\b(restaurant|cafe|menu|food.?delivery)\b/, PAGE_TYPES.LANDING, 2],
  [/\b(about|our.?story|team.?page|company.?page)\b/, PAGE_TYPES.LANDING, 1],
];

// ─── App Type Detection ───────────────────────────────────────────────────────

const APP_TYPE_SIGNALS = [
  [/\b(dashboard|analytics|overview|kpi|metric|report|chart)\b/, 'dashboard', 3],
  [/\b(kanban|board|sprint|column|card|trello)\b/, 'kanban', 3],
  [/\b(directory|team.?list|member|staff|employee|contact.?list)\b/, 'directory', 3],
  [/\b(tracker|habit|goal|progress|streak|check.?in)\b/, 'tracker', 3],
  [/\b(crm|lead|pipeline|sales|deal|funnel)\b/, 'crm', 3],
  [/\b(inventory|stock|product.?list|warehouse|sku)\b/, 'inventory', 3],
  [/\b(internal.?tool|admin|back.?office|ops.?tool)\b/, 'internal-tool', 2],
  [/\b(crud|manage|list|table|record|database|data.?entry)\b/, 'crud', 1],
];

// ─── App Trigger Detection ────────────────────────────────────────────────────

const APP_TRIGGERS = /\b(app|application|tool|dashboard|tracker|manager|crud|admin|internal|directory|crm|kanban|board|inventory|database|data.?entry|form|table|list.?view|record)\b/;

// ─── Multi-page Trigger ───────────────────────────────────────────────────────

const MULTIPAGE_TRIGGERS = /\b(full.?site|full.?website|multi.?page|all.?pages|complete.?site|entire.?site|home.?and|about.?and|contact.?and|with.?pages)\b/;

// ─── Accent Color Palette ─────────────────────────────────────────────────────

const ACCENT_MAP = {
  blue: '#3b82f6', purple: '#7c6af7', green: '#10b981', red: '#ef4444',
  orange: '#f97316', pink: '#ec4899', teal: '#14b8a6', indigo: '#6366f1',
  yellow: '#f59e0b', cyan: '#06b6d4', violet: '#8b5cf6', sky: '#0ea5e9',
};

const INDUSTRY_ACCENT = {
  fintech: '#3b82f6', health: '#10b981', education: '#f59e0b', saas: '#7c6af7',
  ecommerce: '#f97316', creative: '#ec4899', realestate: '#14b8a6', legal: '#6366f1',
  food: '#ef4444', travel: '#0ea5e9', nonprofit: '#10b981', devtools: '#6366f1', general: '#7c6af7',
};

// ─── Brand Name Extraction ────────────────────────────────────────────────────

function _extractBrand(prompt) {
  const quoted = prompt.match(/["']([A-Za-z][A-Za-z0-9\s]{1,30})["']/);
  if (quoted) return quoted[1].trim();

  const named = prompt.match(/\b(?:called|named|for|brand(?:ed)?\s+as?)\s+([A-Z][a-zA-Z0-9]{1,20})/);
  if (named) return named[1];

  const camel = prompt.match(/\b([A-Z][a-z]{2,}[A-Z][a-zA-Z]{1,15})\b/);
  if (camel) return camel[1];

  const startWord = prompt.match(/^([A-Z][a-zA-Z0-9]{2,15})(?:\s|,|\.)/);
  if (startWord) return startWord[1];

  return '';
}

// ─── Scoring Helpers ──────────────────────────────────────────────────────────

function _scoreSignals(lower, signals) {
  const scores = {};
  for (const [regex, key, weight = 1] of signals) {
    const matches = (lower.match(new RegExp(regex.source, 'gi')) || []).length;
    if (matches > 0) {
      scores[key] = (scores[key] || 0) + matches * weight;
    }
  }
  return scores;
}

function _topKey(scores, fallback) {
  let best = fallback, bestScore = 0;
  for (const [key, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best;
}

function _normaliseScores(scores) {
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  const out = {};
  for (const [k, v] of Object.entries(scores)) out[k] = parseFloat((v / total).toFixed(3));
  return out;
}

// ─── Entity Detection (for app prompts) ──────────────────────────────────────

const ENTITY_PATTERNS = [
  [/\b(task|todo|ticket|issue|bug)\b/, 'task'],
  [/\b(project|campaign|initiative|sprint)\b/, 'project'],
  [/\b(user|member|employee|staff|person|contact)\b/, 'contact'],
  [/\b(product|item|sku|inventory|stock)\b/, 'product'],
  [/\b(order|sale|invoice|transaction|payment)\b/, 'order'],
  [/\b(event|meeting|appointment|booking|session)\b/, 'event'],
  [/\b(note|document|article|post|content)\b/, 'note'],
  [/\b(lead|customer|client|account|prospect)\b/, 'lead'],
  [/\b(goal|habit|milestone|objective|okr)\b/, 'goal'],
  [/\b(expense|budget|cost|spend)\b/, 'expense'],
];

function _detectEntities(lower) {
  const found = [];
  for (const [regex, entity] of ENTITY_PATTERNS) {
    if (regex.test(lower) && !found.includes(entity)) {
      found.push(entity);
    }
  }
  return found.length > 0 ? found : ['item'];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse a raw user prompt and return a structured PromptIntent.
 * Backwards-compatible with the original API (brand, rawPrompt aliases).
 *
 * @param {string} prompt
 * @returns {PromptIntent}
 */
export function analysePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return _defaultIntent('');
  }

  const lower = prompt.toLowerCase().trim();

  const isApp        = APP_TRIGGERS.test(lower);
  const isMultiPage  = MULTIPAGE_TRIGGERS.test(lower);

  const industryScores  = _scoreSignals(lower, INDUSTRY_SIGNALS);
  const toneScores      = _scoreSignals(lower, TONE_SIGNALS);
  const featureScores   = _scoreSignals(lower, FEATURE_SIGNALS);
  const pageTypeScores  = _scoreSignals(lower, PAGE_TYPE_SIGNALS);
  const appTypeScores   = isApp ? _scoreSignals(lower, APP_TYPE_SIGNALS) : {};

  const industry  = _topKey(industryScores, 'general');
  const tone      = _topKey(toneScores, 'professional');
  const pageType  = _topKey(pageTypeScores, PAGE_TYPES.LANDING);
  const appType   = isApp ? _topKey(appTypeScores, 'crud') : null;
  const features  = Object.keys(featureScores);
  const brand     = _extractBrand(prompt);
  const entities  = isApp ? _detectEntities(lower) : [];

  let accent = INDUSTRY_ACCENT[industry] || '#7c6af7';
  for (const [colorName, hex] of Object.entries(ACCENT_MAP)) {
    if (lower.includes(colorName)) { accent = hex; break; }
  }

  const confidence = {
    industry:    _normaliseScores(industryScores),
    tone:        _normaliseScores(toneScores),
    pageType:    _normaliseScores(pageTypeScores),
    appType:     _normaliseScores(appTypeScores),
    isApp:       isApp ? 1 : 0,
    isMultiPage: isMultiPage ? 1 : 0,
  };

  return {
    raw:         prompt,
    rawPrompt:   prompt,   // backwards compat
    pageType,
    appType,
    isApp,
    isMultiPage,
    industry,
    tone,
    brand,
    brandName:   brand,    // backwards compat alias
    accent,
    features,
    entities,
    confidence,
  };
}

function _defaultIntent(raw) {
  return {
    raw, rawPrompt: raw,
    pageType: PAGE_TYPES.LANDING, appType: null,
    isApp: false, isMultiPage: false,
    industry: 'general', tone: 'professional',
    brand: '', brandName: '',
    accent: '#7c6af7',
    features: [], entities: [],
    confidence: { industry: {}, tone: {}, pageType: {}, appType: {}, isApp: 0, isMultiPage: 0 },
  };
}
