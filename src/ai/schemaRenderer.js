/**
 * Nuvra Builder — Schema Renderer (Phase A)
 *
 * Converts a PageSchema (structured JSON) into clean HTML + CSS
 * suitable for loading into the GrapesJS editor.
 *
 * Phase A improvements:
 * - NAVBAR and FOOTER renderers now handle both string links and
 *   {label, href} link objects (AI providers return objects).
 * - CONTACT_FORM now includes data-nv-* attributes for action engine binding.
 * - renderPageSchema() now wraps each section in a try/catch so a single
 *   broken section never crashes the whole render.
 * - renderPageSchemaWithFallback() exported for use in providers.
 * - getSupportedSectionTypes() returns a richer descriptor array for the
 *   AI system prompt.
 *
 * Architecture:
 *  PageSchema → SchemaRenderer → { html, css }
 *
 * Each section type has a dedicated render function.
 * To add a new section type, add a function to SECTION_RENDERERS.
 */

'use strict';

import { SECTION_TYPES } from './pageSchema.js';

// ─── Link Helper ──────────────────────────────────────────────────────────────
// Handles both string links ("Home") and object links ({label:"Home",href:"#"})

function _renderLink(link, style = '') {
  if (typeof link === 'string') {
    return `<a href="#" style="${style}">${link}</a>`;
  }
  return `<a href="${link.href || '#'}" style="${style}">${link.label || link.text || link}</a>`;
}

function _linkLabel(link) {
  return typeof link === 'string' ? link : (link.label || link.text || '');
}

// ─── Section Renderers ────────────────────────────────────────────────────────

const SECTION_RENDERERS = {

  [SECTION_TYPES.NAVBAR]: (data, brand) => {
    const links = data.links || ['Home', 'Features', 'Pricing', 'About'];
    return `
<nav style="display:flex; align-items:center; justify-content:space-between; padding:16px 48px; background:#fff; border-bottom:1px solid #f0f0f0; position:sticky; top:0; z-index:100;">
  <span style="font-size:20px; font-weight:800; color:${brand.accent};">${data.logo || data.brand || brand.name}</span>
  <div style="display:flex; gap:28px; align-items:center;">
    ${links.map((l) => _renderLink(l, `color:#444; text-decoration:none; font-size:14px; font-weight:500;`)).join('')}
    <a href="${data.ctaHref || '#'}" style="padding:8px 20px; background:${brand.accent}; color:#fff; border-radius:6px; font-size:14px; font-weight:600; text-decoration:none;">${data.cta || 'Get Started'}</a>
  </div>
</nav>`;
  },

  [SECTION_TYPES.HERO]: (data, brand) => `
<section style="padding:100px 48px; text-align:center; background:linear-gradient(135deg,#0b0b0f,#1a1a2e); color:#fff;">
  <span style="display:inline-block; padding:4px 14px; background:${brand.accent}; border-radius:20px; font-size:12px; font-weight:600; margin-bottom:20px; letter-spacing:0.5px;">${data.badge || brand.tagline || 'New'}</span>
  <h1 style="font-size:56px; font-weight:800; margin:0 0 20px; line-height:1.1; max-width:800px; margin-left:auto; margin-right:auto;">${data.headline || `Welcome to ${brand.name}`}</h1>
  <p style="font-size:18px; color:#aaa; max-width:560px; margin:0 auto 40px; line-height:1.7;">${data.subheadline || brand.tagline || ''}</p>
  <div style="display:flex; gap:14px; justify-content:center; flex-wrap:wrap;">
    <a href="${data.primaryCtaHref || '#'}" style="padding:14px 36px; background:${brand.accent}; color:#fff; border-radius:8px; font-size:16px; font-weight:700; text-decoration:none;">${data.primaryCta || data.cta || 'Get Started'}</a>
    ${data.secondaryCta ? `<a href="${data.secondaryCtaHref || '#'}" style="padding:14px 36px; background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.2); border-radius:8px; font-size:16px; text-decoration:none;">${data.secondaryCta}</a>` : ''}
  </div>
</section>`,

  [SECTION_TYPES.FEATURES]: (data, brand) => {
    const items = data.items || [
      { icon: '⚡', title: 'Fast', description: 'Optimised for speed and performance at scale.' },
      { icon: '🔒', title: 'Secure', description: 'Enterprise-grade security built in from day one.' },
      { icon: '🌍', title: 'Scalable', description: 'Grows effortlessly with your needs.' },
    ];
    return `
<section style="padding:80px 48px; background:#fff;">
  <div style="max-width:1100px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 12px;">${data.headline || 'Everything you need'}</h2>
    <p style="text-align:center; color:#666; font-size:16px; margin:0 0 56px;">${data.subheadline || 'Powerful features designed for modern teams.'}</p>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:32px;">
      ${items.map((f) => `
      <div style="padding:32px; border:1px solid #f0f0f0; border-radius:12px;">
        <div style="font-size:32px; margin-bottom:16px;">${f.icon || '✦'}</div>
        <h3 style="margin:0 0 10px; font-size:18px; font-weight:700;">${f.title}</h3>
        <p style="margin:0; color:#666; font-size:14px; line-height:1.6;">${f.description}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`;
  },

  [SECTION_TYPES.BENEFITS]: (data, brand) => {
    const items = data.items || [
      { title: 'Save time', description: 'Automate repetitive tasks and focus on what matters.' },
      { title: 'Reduce costs', description: 'Cut operational overhead with smart tooling.' },
      { title: 'Scale faster', description: 'Infrastructure that grows with your business.' },
    ];
    return `
<section style="padding:80px 48px; background:#fafafa;">
  <div style="max-width:1100px; margin:auto; display:grid; grid-template-columns:1fr 1fr; gap:64px; align-items:center;">
    <div>
      <h2 style="font-size:38px; font-weight:700; margin:0 0 16px;">${data.headline || 'Why choose us?'}</h2>
      <p style="color:#666; font-size:16px; line-height:1.7; margin:0 0 32px;">${data.subheadline || "We've built the tools that let your team move faster."}</p>
      ${items.map((b) => `
      <div style="display:flex; gap:16px; margin-bottom:24px;">
        <div style="width:32px; height:32px; background:${brand.accent}; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:14px; font-weight:700;">✓</div>
        <div>
          <h4 style="margin:0 0 4px; font-size:16px; font-weight:600;">${b.title}</h4>
          <p style="margin:0; color:#666; font-size:14px;">${b.description}</p>
        </div>
      </div>`).join('')}
    </div>
    <div style="background:linear-gradient(135deg,${brand.accent}22,${brand.accent}44); border-radius:16px; height:360px; display:flex; align-items:center; justify-content:center; font-size:64px;">📊</div>
  </div>
</section>`;
  },

  [SECTION_TYPES.STATS]: (data, brand) => {
    const stats = data.stats || [
      { value: '10K+', label: 'Active Users' },
      { value: '99.9%', label: 'Uptime' },
      { value: '4.9★', label: 'Average Rating' },
      { value: '24/7', label: 'Support' },
    ];
    return `
<section style="padding:64px 48px; background:${brand.accent}; color:#fff;">
  <div style="max-width:1100px; margin:auto; display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:32px; text-align:center;">
    ${stats.map((s) => `
    <div>
      <div style="font-size:42px; font-weight:800; margin-bottom:8px;">${s.value}</div>
      <div style="font-size:14px; opacity:0.85; font-weight:500;">${s.label}</div>
    </div>`).join('')}
  </div>
</section>`;
  },

  [SECTION_TYPES.TESTIMONIALS]: (data, brand) => {
    const items = data.items || [
      { quote: 'This product completely changed how our team works. Highly recommended.', author: 'Sarah K.', role: 'Product Manager' },
      { quote: 'Incredibly easy to use and the results speak for themselves.', author: 'James T.', role: 'Founder, Acme Co.' },
      { quote: "The best investment we've made for our workflow this year.", author: 'Maria L.', role: 'CTO' },
    ];
    return `
<section style="padding:80px 48px; background:#f9f9f9;">
  <div style="max-width:1100px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 12px;">${data.headline || 'Loved by teams worldwide'}</h2>
    <p style="text-align:center; color:#666; margin:0 0 56px;">${data.subheadline || "Don't just take our word for it."}</p>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:28px;">
      ${items.map((t) => `
      <div style="background:#fff; padding:32px; border-radius:12px; box-shadow:0 2px 12px rgba(0,0,0,0.06);">
        <p style="font-size:15px; line-height:1.7; color:#333; margin:0 0 20px;">"${t.quote}"</p>
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="width:40px; height:40px; background:${brand.accent}; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; font-size:16px;">${(t.author || 'A').charAt(0)}</div>
          <div>
            <div style="font-weight:600; font-size:14px;">${t.author}</div>
            <div style="color:#888; font-size:12px;">${t.role}</div>
          </div>
        </div>
      </div>`).join('')}
    </div>
  </div>
</section>`;
  },

  [SECTION_TYPES.PRICING]: (data, brand) => {
    const plans = data.plans || [
      { name: 'Starter', price: '$0', period: '/month', features: ['5 projects', '1 GB storage', 'Email support'], cta: 'Get started' },
      { name: 'Pro', price: '$29', period: '/month', features: ['Unlimited projects', '50 GB storage', 'Priority support', 'Analytics'], cta: 'Start free trial', featured: true },
      { name: 'Enterprise', price: 'Custom', period: '', features: ['Everything in Pro', 'SSO & SAML', 'SLA guarantee', 'Dedicated support'], cta: 'Contact sales' },
    ];
    return `
<section style="padding:80px 48px; background:#fff;">
  <div style="max-width:1100px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 12px;">${data.headline || 'Simple, transparent pricing'}</h2>
    <p style="text-align:center; color:#666; margin:0 0 56px;">${data.subheadline || 'No hidden fees. Cancel anytime.'}</p>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:28px;">
      ${plans.map((p) => `
      <div style="padding:36px; border:${p.featured ? `2px solid ${brand.accent}` : '1px solid #eee'}; border-radius:16px; ${p.featured ? `background:${brand.accent}08;` : ''}">
        ${p.featured ? `<span style="display:inline-block; padding:3px 12px; background:${brand.accent}; color:#fff; border-radius:20px; font-size:11px; font-weight:700; margin-bottom:12px;">POPULAR</span>` : ''}
        <h3 style="margin:0 0 8px; font-size:20px; font-weight:700;">${p.name}</h3>
        <div style="font-size:40px; font-weight:800; margin-bottom:4px;">${p.price}<span style="font-size:16px; font-weight:400; color:#888;">${p.period}</span></div>
        <ul style="list-style:none; padding:0; margin:24px 0 28px;">
          ${(p.features || []).map((f) => `<li style="padding:6px 0; font-size:14px; color:#555; display:flex; gap:8px;"><span style="color:${brand.accent};">✓</span>${f}</li>`).join('')}
        </ul>
        <a href="#" style="display:block; text-align:center; padding:12px; background:${p.featured ? brand.accent : 'transparent'}; color:${p.featured ? '#fff' : brand.accent}; border:${p.featured ? 'none' : `2px solid ${brand.accent}`}; border-radius:8px; font-weight:600; text-decoration:none;">${p.cta}</a>
      </div>`).join('')}
    </div>
  </div>
</section>`;
  },

  [SECTION_TYPES.FAQ]: (data, brand) => {
    const items = data.items || [
      { question: 'How do I get started?', answer: "Sign up for a free account and follow the onboarding guide. You'll be up and running in minutes." },
      { question: 'Can I cancel anytime?', answer: 'Yes. There are no long-term contracts. You can cancel your subscription at any time.' },
      { question: 'Is my data secure?', answer: 'Absolutely. We use industry-standard encryption and follow best practices for data security.' },
    ];
    return `
<section style="padding:80px 48px; background:#f9f9f9;">
  <div style="max-width:760px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 12px;">${data.headline || 'Frequently asked questions'}</h2>
    <p style="text-align:center; color:#666; margin:0 0 48px;">${data.subheadline || 'Everything you need to know.'}</p>
    ${items.map((q) => `
    <div style="background:#fff; border-radius:10px; padding:24px 28px; margin-bottom:12px; box-shadow:0 1px 4px rgba(0,0,0,0.05);">
      <h4 style="margin:0 0 10px; font-size:16px; font-weight:600;">${q.question}</h4>
      <p style="margin:0; color:#666; font-size:14px; line-height:1.6;">${q.answer}</p>
    </div>`).join('')}
  </div>
</section>`;
  },

  [SECTION_TYPES.CTA]: (data, brand) => `
<section style="padding:100px 48px; text-align:center; background:linear-gradient(135deg,#0b0b0f,#1a1a2e); color:#fff;">
  <h2 style="font-size:44px; font-weight:800; margin:0 0 16px;">${data.headline || 'Ready to get started?'}</h2>
  <p style="color:#aaa; font-size:18px; margin:0 0 40px; max-width:480px; margin-left:auto; margin-right:auto;">${data.subheadline || 'Join thousands of teams building with us.'}</p>
  <a href="${data.ctaHref || '#'}" style="padding:16px 48px; background:${brand.accent}; color:#fff; border-radius:8px; font-size:16px; font-weight:700; text-decoration:none; display:inline-block;">${data.cta || 'Start for free'}</a>
</section>`,

  [SECTION_TYPES.FOOTER]: (data, brand) => {
    const links = data.links || ['Privacy', 'Terms', 'Contact'];
    return `
<footer style="padding:48px; background:#0b0b0f; color:#888;">
  <div style="max-width:1100px; margin:auto; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:20px;">
    <span style="font-size:18px; font-weight:800; color:${brand.accent};">${data.brand || brand.name}</span>
    <p style="margin:0; font-size:13px;">${data.copyright || `© ${new Date().getFullYear()} ${brand.name}. All rights reserved.`}</p>
    <div style="display:flex; gap:20px;">
      ${links.map((l) => _renderLink(l, `color:#666; text-decoration:none; font-size:13px;`)).join('')}
    </div>
  </div>
</footer>`;
  },

  [SECTION_TYPES.ABOUT]: (data, brand) => `
<section style="padding:80px 48px; background:#fff;">
  <div style="max-width:1100px; margin:auto; display:grid; grid-template-columns:1fr 1fr; gap:64px; align-items:center;">
    <div style="background:linear-gradient(135deg,${brand.accent}22,${brand.accent}44); border-radius:16px; height:360px; display:flex; align-items:center; justify-content:center; font-size:64px;">🏢</div>
    <div>
      <h2 style="font-size:38px; font-weight:700; margin:0 0 16px;">${data.headline || `About ${brand.name}`}</h2>
      <p style="color:#666; font-size:16px; line-height:1.8; margin:0 0 24px;">${data.body || 'We are a passionate team dedicated to building tools that make a real difference. Our mission is to empower people with technology that is simple, powerful, and accessible.'}</p>
      <a href="#" style="padding:12px 28px; background:${brand.accent}; color:#fff; border-radius:8px; font-weight:600; text-decoration:none; font-size:14px;">${data.cta || 'Learn more'}</a>
    </div>
  </div>
</section>`,

  [SECTION_TYPES.TEAM]: (data, brand) => {
    const members = data.members || [
      { name: 'Alex Johnson', role: 'CEO & Co-founder', emoji: '👤' },
      { name: 'Sam Rivera', role: 'CTO', emoji: '👤' },
      { name: 'Jordan Lee', role: 'Head of Design', emoji: '👤' },
    ];
    return `
<section style="padding:80px 48px; background:#f9f9f9;">
  <div style="max-width:1100px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 12px;">${data.headline || 'Meet the team'}</h2>
    <p style="text-align:center; color:#666; margin:0 0 56px;">${data.subheadline || 'The people behind the product.'}</p>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:28px;">
      ${members.map((m) => `
      <div style="text-align:center; background:#fff; padding:32px 24px; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <div style="width:80px; height:80px; background:${brand.accent}; border-radius:50%; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; font-size:32px;">${m.emoji || '👤'}</div>
        <h4 style="margin:0 0 6px; font-size:16px; font-weight:700;">${m.name}</h4>
        <p style="margin:0; color:#888; font-size:13px;">${m.role}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`;
  },

  [SECTION_TYPES.GALLERY]: (data, brand) => {
    const items = data.items || [
      { title: 'Project Alpha', category: 'Web Design' },
      { title: 'Project Beta', category: 'Branding' },
      { title: 'Project Gamma', category: 'Development' },
      { title: 'Project Delta', category: 'Mobile App' },
    ];
    return `
<section style="padding:80px 48px; background:#fff;">
  <div style="max-width:1100px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 56px;">${data.headline || 'Our Work'}</h2>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:20px;">
      ${items.map((item, i) => `
      <div style="border-radius:12px; overflow:hidden; background:linear-gradient(135deg,${brand.accent}${20 + i * 10},${brand.accent}${40 + i * 10}); height:200px; display:flex; flex-direction:column; justify-content:flex-end; padding:20px; color:#fff;">
        <div style="font-size:11px; opacity:0.8; margin-bottom:4px;">${item.category}</div>
        <div style="font-weight:700; font-size:16px;">${item.title}</div>
      </div>`).join('')}
    </div>
  </div>
</section>`;
  },

  // CONTACT_FORM now includes data-nv-* attributes for action engine binding
  [SECTION_TYPES.CONTACT_FORM]: (data, brand) => `
<section style="padding:80px 48px; background:#f9f9f9;">
  <div style="max-width:600px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 12px;">${data.headline || 'Get in touch'}</h2>
    <p style="text-align:center; color:#666; margin:0 0 40px;">${data.subheadline || "We'd love to hear from you."}</p>
    <form data-nv-action="submit" data-nv-collection="contacts" style="background:#fff; padding:40px; border-radius:16px; box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <div style="margin-bottom:20px;">
        <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:#333;">Name</label>
        <input type="text" name="name" placeholder="Your name" data-nv-field="name" style="width:100%; padding:12px 16px; border:1px solid #e0e0e0; border-radius:8px; font-size:14px; box-sizing:border-box;" />
      </div>
      <div style="margin-bottom:20px;">
        <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:#333;">Email</label>
        <input type="email" name="email" placeholder="you@example.com" data-nv-field="email" style="width:100%; padding:12px 16px; border:1px solid #e0e0e0; border-radius:8px; font-size:14px; box-sizing:border-box;" />
      </div>
      <div style="margin-bottom:28px;">
        <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:#333;">Message</label>
        <textarea name="message" placeholder="How can we help?" rows="4" data-nv-field="message" style="width:100%; padding:12px 16px; border:1px solid #e0e0e0; border-radius:8px; font-size:14px; box-sizing:border-box; resize:vertical;"></textarea>
      </div>
      <button type="submit" style="width:100%; padding:14px; background:${brand.accent}; color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:700; cursor:pointer;">${data.cta || 'Send message'}</button>
    </form>
  </div>
</section>`,

  [SECTION_TYPES.BLOG_LIST]: (data, brand) => {
    const posts = data.posts || [
      { title: 'Getting started with our platform', excerpt: 'A step-by-step guide to setting up your first project.', date: 'Jan 15, 2025', tag: 'Tutorial' },
      { title: 'Best practices for modern teams', excerpt: 'How leading teams are using our tools to move faster.', date: 'Jan 8, 2025', tag: 'Guide' },
      { title: "What's new in 2025", excerpt: 'A roundup of the latest features and improvements.', date: 'Jan 1, 2025', tag: 'News' },
    ];
    return `
<section style="padding:80px 48px; background:#fff;">
  <div style="max-width:1100px; margin:auto;">
    <h2 style="text-align:center; font-size:38px; font-weight:700; margin:0 0 56px;">${data.headline || 'Latest articles'}</h2>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:28px;">
      ${posts.map((p) => `
      <article style="border:1px solid #f0f0f0; border-radius:12px; overflow:hidden;">
        <div style="height:160px; background:linear-gradient(135deg,${brand.accent}22,${brand.accent}44); display:flex; align-items:center; justify-content:center; font-size:40px;">📝</div>
        <div style="padding:24px;">
          <span style="display:inline-block; padding:2px 10px; background:${brand.accent}15; color:${brand.accent}; border-radius:20px; font-size:11px; font-weight:600; margin-bottom:10px;">${p.tag}</span>
          <h3 style="margin:0 0 10px; font-size:17px; font-weight:700; line-height:1.4;">${p.title}</h3>
          <p style="margin:0 0 16px; color:#666; font-size:13px; line-height:1.6;">${p.excerpt}</p>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:#999;">${p.date}</span>
            <a href="#" style="font-size:13px; color:${brand.accent}; font-weight:600; text-decoration:none;">Read more →</a>
          </div>
        </div>
      </article>`).join('')}
    </div>
  </div>
</section>`;
  },
};

// ─── Base CSS ─────────────────────────────────────────────────────────────────

const BASE_CSS = `
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; line-height: 1.5; color: #1a1a1a; }
h1, h2, h3, h4 { line-height: 1.2; }
a { cursor: pointer; }
input, textarea, button, select { font-family: inherit; }
@media (max-width: 768px) {
  section, nav, footer { padding-left: 24px !important; padding-right: 24px !important; }
  h1 { font-size: 36px !important; }
  h2 { font-size: 28px !important; }
  div[style*="grid-template-columns:1fr 1fr"] { grid-template-columns: 1fr !important; }
  nav div[style*="display:flex"] { display: none !important; }
}
`.trim();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a validated PageSchema into HTML + CSS.
 * Each section is rendered in a try/catch so a single broken section
 * never crashes the whole render.
 *
 * @param {PageSchema} schema
 * @returns {{ html: string, css: string }}
 */
export function renderPageSchema(schema) {
  const { brand, sections } = schema;

  const htmlParts = sections.map((section) => {
    const renderer = SECTION_RENDERERS[section.type];
    if (!renderer) {
      console.warn(`[Nuvra SchemaRenderer] Unknown section type: "${section.type}" — skipping.`);
      return '';
    }
    try {
      return renderer(section.data || {}, brand).trim();
    } catch (err) {
      console.error(`[Nuvra SchemaRenderer] Error rendering section "${section.type}":`, err);
      return `<!-- Section "${section.type}" failed to render -->`;
    }
  });

  const html = htmlParts.filter(Boolean).join('\n\n');
  const css  = `${BASE_CSS}\n\n/* Accent: ${brand.accent} */`;

  return { html, css };
}

/**
 * Render a PageSchema with a guaranteed fallback.
 * If the schema itself is invalid, a minimal fallback page is returned.
 *
 * @param {PageSchema|any} schema
 * @returns {{ html: string, css: string }}
 */
export function renderPageSchemaWithFallback(schema) {
  try {
    if (!schema || !Array.isArray(schema.sections) || schema.sections.length === 0) {
      throw new Error('Invalid schema passed to renderPageSchemaWithFallback');
    }
    return renderPageSchema(schema);
  } catch (err) {
    console.error('[Nuvra SchemaRenderer] renderPageSchemaWithFallback caught error:', err);
    return {
      html: `<section style="padding:80px 48px; text-align:center; font-family:system-ui,sans-serif;">
  <h2 style="font-size:32px; font-weight:700; margin:0 0 12px;">Page Generated</h2>
  <p style="color:#666;">Your page was generated but could not be fully rendered. Please try again.</p>
</section>`,
      css: BASE_CSS,
    };
  }
}

/**
 * Get the list of all supported section types with descriptors.
 * Used by the AI system prompt to inform the model what sections are available.
 *
 * @returns {Array<{type: string, description: string}>}
 */
export function getSupportedSectionTypes() {
  return [
    { type: 'navbar',       description: 'Navigation bar with logo, links, and CTA button' },
    { type: 'hero',         description: 'Full-width hero with headline, subheadline, and CTA buttons' },
    { type: 'features',     description: 'Feature grid with icons, titles, and descriptions' },
    { type: 'benefits',     description: 'Two-column benefits section with checklist items' },
    { type: 'stats',        description: 'Accent-colored stats bar with key metrics' },
    { type: 'testimonials', description: 'Testimonial cards with quotes and author info' },
    { type: 'pricing',      description: 'Pricing table with plan tiers and feature lists' },
    { type: 'faq',          description: 'FAQ accordion with questions and answers' },
    { type: 'cta',          description: 'Dark full-width CTA section with headline and button' },
    { type: 'about',        description: 'Two-column about section with text and visual placeholder' },
    { type: 'team',         description: 'Team member cards with name, role, and avatar' },
    { type: 'gallery',      description: 'Portfolio/gallery grid with category labels' },
    { type: 'blog-list',    description: 'Blog post card grid with title, excerpt, and tag' },
    { type: 'contact-form', description: 'Contact form with name, email, message fields (action-engine connected)' },
    { type: 'footer',       description: 'Dark footer with brand name, copyright, and links' },
  ];
}
