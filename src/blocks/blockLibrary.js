/**
 * Nuvra Builder — Block Library
 *
 * Registers all drag-and-drop blocks with the GrapesJS BlockManager.
 * Blocks are grouped by category and defined as pure data objects,
 * making it trivial to add, remove, or override blocks without
 * touching any other module.
 *
 * Block categories:
 *  - Layout    : structural containers
 *  - Content   : text, media, lists
 *  - Navigation: headers, footers, navbars
 *  - Marketing : hero, features, testimonials, pricing, CTA
 *  - Forms     : contact, newsletter, login
 *  - Data      : tables, stat cards (for dashboards/apps)
 */

'use strict';

// ─── Block Definitions ────────────────────────────────────────────────────────

const BLOCKS = [

  // ── Layout ──────────────────────────────────────────────────────────────────
  {
    id:       'section',
    label:    'Section',
    category: 'Layout',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="2"/></svg>`,
    content:  '<section style="padding:60px 40px; max-width:1100px; margin:auto;"></section>',
  },
  {
    id:       'two-col',
    label:    '2 Columns',
    category: 'Layout',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="9" height="18" rx="1"/><rect x="13" y="3" width="9" height="18" rx="1"/></svg>`,
    content:  `<div style="display:flex; gap:24px; padding:40px;">
                 <div style="flex:1; padding:20px; background:#f9f9f9; border-radius:8px;">Column 1</div>
                 <div style="flex:1; padding:20px; background:#f9f9f9; border-radius:8px;">Column 2</div>
               </div>`,
  },
  {
    id:       'three-col',
    label:    '3 Columns',
    category: 'Layout',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="3" width="6" height="18" rx="1"/><rect x="9" y="3" width="6" height="18" rx="1"/><rect x="17" y="3" width="6" height="18" rx="1"/></svg>`,
    content:  `<div style="display:flex; gap:20px; padding:40px;">
                 <div style="flex:1; padding:16px; background:#f9f9f9; border-radius:8px;">Column 1</div>
                 <div style="flex:1; padding:16px; background:#f9f9f9; border-radius:8px;">Column 2</div>
                 <div style="flex:1; padding:16px; background:#f9f9f9; border-radius:8px;">Column 3</div>
               </div>`,
  },
  {
    id:       'divider',
    label:    'Divider',
    category: 'Layout',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    content:  '<hr style="border:none; border-top:1px solid #e5e5e5; margin:32px 0;" />',
  },

  // ── Content ──────────────────────────────────────────────────────────────────
  {
    id:       'heading',
    label:    'Heading',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 12h10M4 18h6"/></svg>`,
    content:  '<h2 style="font-size:32px; font-weight:700; margin:0 0 12px;">Your Heading Here</h2>',
  },
  {
    id:       'text',
    label:    'Paragraph',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h12M4 18h8"/></svg>`,
    content:  '<p style="font-size:16px; line-height:1.7; color:#444;">Edit this paragraph to add your content here.</p>',
  },
  {
    id:       'image',
    label:    'Image',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    content:  { type: 'image' },
  },
  {
    id:       'video',
    label:    'Video Embed',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><polygon points="10,8 16,12 10,16"/></svg>`,
    content:  `<div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; border-radius:8px;">
                 <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" style="position:absolute; top:0; left:0; width:100%; height:100%; border:0;" allowfullscreen></iframe>
               </div>`,
  },
  {
    id:       'list',
    label:    'Bullet List',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor"/><circle cx="4" cy="12" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/></svg>`,
    content:  `<ul style="padding-left:20px; line-height:2;">
                 <li>First item</li>
                 <li>Second item</li>
                 <li>Third item</li>
               </ul>`,
  },
  {
    id:       'button',
    label:    'Button',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="8" width="18" height="8" rx="4"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
    content:  '<button style="padding:12px 28px; background:#7c6af7; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer;">Click Me</button>',
  },
  {
    id:       'badge',
    label:    'Badge / Tag',
    category: 'Content',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="9" width="16" height="6" rx="3"/></svg>`,
    content:  '<span style="display:inline-block; padding:4px 12px; background:#ede9fe; color:#7c6af7; border-radius:20px; font-size:12px; font-weight:600;">New Feature</span>',
  },

  // ── Navigation ───────────────────────────────────────────────────────────────
  {
    id:       'navbar',
    label:    'Navbar',
    category: 'Navigation',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="4" rx="1"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    content:  `<nav style="display:flex; align-items:center; justify-content:space-between; padding:16px 40px; background:#fff; border-bottom:1px solid #eee;">
                 <div style="font-weight:700; font-size:18px;">Brand</div>
                 <div style="display:flex; gap:24px; font-size:14px;">
                   <a href="#" style="color:#333; text-decoration:none;">Home</a>
                   <a href="#" style="color:#333; text-decoration:none;">About</a>
                   <a href="#" style="color:#333; text-decoration:none;">Contact</a>
                 </div>
                 <button style="padding:8px 20px; background:#7c6af7; color:#fff; border:none; border-radius:6px; cursor:pointer;">Sign Up</button>
               </nav>`,
  },
  {
    id:       'footer',
    label:    'Footer',
    category: 'Navigation',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="16" width="20" height="4" rx="1"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    content:  `<footer style="padding:40px; background:#111; color:#aaa; text-align:center;">
                 <p style="margin:0 0 8px; font-size:14px;">© 2025 Your Company. All rights reserved.</p>
                 <div style="display:flex; gap:16px; justify-content:center; font-size:13px;">
                   <a href="#" style="color:#aaa; text-decoration:none;">Privacy</a>
                   <a href="#" style="color:#aaa; text-decoration:none;">Terms</a>
                   <a href="#" style="color:#aaa; text-decoration:none;">Contact</a>
                 </div>
               </footer>`,
  },

  // ── Marketing ────────────────────────────────────────────────────────────────
  {
    id:       'hero',
    label:    'Hero Section',
    category: 'Marketing',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    content:  `<section style="padding:100px 40px; text-align:center; background:linear-gradient(135deg,#0b0b0f,#1a1a2e); color:#fff;">
                 <span style="display:inline-block; padding:4px 14px; background:#7c6af7; border-radius:20px; font-size:12px; font-weight:600; margin-bottom:20px;">New Release</span>
                 <h1 style="font-size:52px; font-weight:800; margin:0 0 20px; line-height:1.15;">Build Anything<br/>With Nuvra</h1>
                 <p style="font-size:18px; color:#aaa; max-width:540px; margin:0 auto 36px;">The AI-powered builder for websites, apps, dashboards, and more.</p>
                 <div style="display:flex; gap:12px; justify-content:center;">
                   <button style="padding:14px 32px; background:#7c6af7; color:#fff; border:none; border-radius:8px; font-size:16px; font-weight:600; cursor:pointer;">Get Started Free</button>
                   <button style="padding:14px 32px; background:transparent; color:#fff; border:1px solid #444; border-radius:8px; font-size:16px; cursor:pointer;">See Demo</button>
                 </div>
               </section>`,
  },
  {
    id:       'features',
    label:    'Features Grid',
    category: 'Marketing',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/><rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/></svg>`,
    content:  `<section style="padding:80px 40px; background:#fff;">
                 <h2 style="text-align:center; font-size:36px; font-weight:700; margin:0 0 48px;">Why Choose Us</h2>
                 <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:32px; max-width:1000px; margin:auto;">
                   <div style="padding:28px; border:1px solid #eee; border-radius:12px;">
                     <div style="font-size:28px; margin-bottom:12px;">⚡</div>
                     <h3 style="margin:0 0 8px; font-size:18px;">Fast</h3>
                     <p style="margin:0; color:#666; font-size:14px;">Blazing fast performance out of the box.</p>
                   </div>
                   <div style="padding:28px; border:1px solid #eee; border-radius:12px;">
                     <div style="font-size:28px; margin-bottom:12px;">🔒</div>
                     <h3 style="margin:0 0 8px; font-size:18px;">Secure</h3>
                     <p style="margin:0; color:#666; font-size:14px;">Enterprise-grade security built in.</p>
                   </div>
                   <div style="padding:28px; border:1px solid #eee; border-radius:12px;">
                     <div style="font-size:28px; margin-bottom:12px;">🌍</div>
                     <h3 style="margin:0 0 8px; font-size:18px;">Scalable</h3>
                     <p style="margin:0; color:#666; font-size:14px;">Grows with your business seamlessly.</p>
                   </div>
                 </div>
               </section>`,
  },
  {
    id:       'testimonial',
    label:    'Testimonial',
    category: 'Marketing',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`,
    content:  `<section style="padding:80px 40px; background:#f9f9f9; text-align:center;">
                 <blockquote style="max-width:640px; margin:0 auto; font-size:22px; font-style:italic; color:#333; line-height:1.6;">
                   "This product completely changed how we build. Absolutely incredible."
                 </blockquote>
                 <div style="margin-top:24px;">
                   <strong style="display:block; font-size:15px;">Jane Doe</strong>
                   <span style="color:#888; font-size:13px;">CEO, Acme Corp</span>
                 </div>
               </section>`,
  },
  {
    id:       'pricing',
    label:    'Pricing Cards',
    category: 'Marketing',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>`,
    content:  `<section style="padding:80px 40px; background:#fff;">
                 <h2 style="text-align:center; font-size:36px; font-weight:700; margin:0 0 48px;">Simple Pricing</h2>
                 <div style="display:flex; gap:24px; max-width:800px; margin:auto; justify-content:center;">
                   <div style="flex:1; padding:32px; border:1px solid #eee; border-radius:12px; text-align:center;">
                     <h3 style="margin:0 0 8px;">Free</h3>
                     <div style="font-size:40px; font-weight:800; margin:12px 0;">$0</div>
                     <p style="color:#888; font-size:13px;">per month</p>
                     <ul style="text-align:left; padding-left:20px; color:#555; font-size:14px; line-height:2;">
                       <li>5 pages</li><li>Basic blocks</li><li>Export HTML</li>
                     </ul>
                     <button style="width:100%; padding:12px; border:1px solid #ddd; border-radius:8px; cursor:pointer; margin-top:16px;">Get Started</button>
                   </div>
                   <div style="flex:1; padding:32px; border:2px solid #7c6af7; border-radius:12px; text-align:center; background:#faf9ff;">
                     <h3 style="margin:0 0 8px; color:#7c6af7;">Pro</h3>
                     <div style="font-size:40px; font-weight:800; margin:12px 0;">$19</div>
                     <p style="color:#888; font-size:13px;">per month</p>
                     <ul style="text-align:left; padding-left:20px; color:#555; font-size:14px; line-height:2;">
                       <li>Unlimited pages</li><li>AI generation</li><li>Custom domain</li>
                     </ul>
                     <button style="width:100%; padding:12px; background:#7c6af7; color:#fff; border:none; border-radius:8px; cursor:pointer; margin-top:16px;">Upgrade</button>
                   </div>
                 </div>
               </section>`,
  },
  {
    id:       'cta',
    label:    'Call to Action',
    category: 'Marketing',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`,
    content:  `<section style="padding:80px 40px; text-align:center; background:#7c6af7; color:#fff;">
                 <h2 style="font-size:40px; font-weight:800; margin:0 0 16px;">Ready to build something great?</h2>
                 <p style="font-size:18px; opacity:0.85; margin:0 0 32px;">Join thousands of builders using Nuvra today.</p>
                 <button style="padding:16px 40px; background:#fff; color:#7c6af7; border:none; border-radius:8px; font-size:16px; font-weight:700; cursor:pointer;">Start for Free</button>
               </section>`,
  },

  // ── Forms ────────────────────────────────────────────────────────────────────
  {
    id:       'contact-form',
    label:    'Contact Form',
    category: 'Forms',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8l10 7 10-7"/></svg>`,
    content:  `<section style="padding:60px 40px; max-width:560px; margin:auto;">
                 <h2 style="font-size:28px; font-weight:700; margin:0 0 24px;">Get in Touch</h2>
                 <form>
                   <input type="text" placeholder="Your Name" style="width:100%; padding:12px; margin-bottom:12px; border:1px solid #ddd; border-radius:8px; font-size:14px;" />
                   <input type="email" placeholder="Email Address" style="width:100%; padding:12px; margin-bottom:12px; border:1px solid #ddd; border-radius:8px; font-size:14px;" />
                   <textarea placeholder="Your message…" rows="5" style="width:100%; padding:12px; margin-bottom:16px; border:1px solid #ddd; border-radius:8px; font-size:14px; resize:vertical;"></textarea>
                   <button type="submit" style="padding:12px 28px; background:#7c6af7; color:#fff; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer;">Send Message</button>
                 </form>
               </section>`,
  },
  {
    id:       'newsletter',
    label:    'Newsletter Signup',
    category: 'Forms',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
    content:  `<section style="padding:60px 40px; text-align:center; background:#f9f9f9;">
                 <h2 style="font-size:28px; font-weight:700; margin:0 0 8px;">Stay in the loop</h2>
                 <p style="color:#666; margin:0 0 24px;">Get the latest updates delivered to your inbox.</p>
                 <div style="display:flex; gap:8px; max-width:420px; margin:auto;">
                   <input type="email" placeholder="Enter your email" style="flex:1; padding:12px 16px; border:1px solid #ddd; border-radius:8px; font-size:14px;" />
                   <button style="padding:12px 20px; background:#7c6af7; color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer;">Subscribe</button>
                 </div>
               </section>`,
  },

  // ── Data / Dashboard ─────────────────────────────────────────────────────────
  {
    id:       'stat-cards',
    label:    'Stat Cards',
    category: 'Data',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
    content:  `<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:20px; padding:32px;">
                 <div style="padding:24px; background:#fff; border:1px solid #eee; border-radius:12px;">
                   <div style="font-size:12px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Total Users</div>
                   <div style="font-size:32px; font-weight:800;">12,480</div>
                   <div style="font-size:12px; color:#34d399; margin-top:4px;">+8.2% this month</div>
                 </div>
                 <div style="padding:24px; background:#fff; border:1px solid #eee; border-radius:12px;">
                   <div style="font-size:12px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Revenue</div>
                   <div style="font-size:32px; font-weight:800;">$48,200</div>
                   <div style="font-size:12px; color:#34d399; margin-top:4px;">+12.5% this month</div>
                 </div>
                 <div style="padding:24px; background:#fff; border:1px solid #eee; border-radius:12px;">
                   <div style="font-size:12px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Active Sessions</div>
                   <div style="font-size:32px; font-weight:800;">3,241</div>
                   <div style="font-size:12px; color:#f87171; margin-top:4px;">-2.1% today</div>
                 </div>
                 <div style="padding:24px; background:#fff; border:1px solid #eee; border-radius:12px;">
                   <div style="font-size:12px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">Conversion</div>
                   <div style="font-size:32px; font-weight:800;">4.7%</div>
                   <div style="font-size:12px; color:#34d399; margin-top:4px;">+0.3% this week</div>
                 </div>
               </div>`,
  },
  {
    id:       'data-table',
    label:    'Data Table',
    category: 'Data',
    media:    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="18" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/><line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/></svg>`,
    content:  `<div style="padding:24px; overflow-x:auto;">
                 <table style="width:100%; border-collapse:collapse; font-size:14px;">
                   <thead>
                     <tr style="background:#f5f5f5;">
                       <th style="padding:12px 16px; text-align:left; border-bottom:2px solid #eee; font-weight:600;">Name</th>
                       <th style="padding:12px 16px; text-align:left; border-bottom:2px solid #eee; font-weight:600;">Status</th>
                       <th style="padding:12px 16px; text-align:left; border-bottom:2px solid #eee; font-weight:600;">Date</th>
                       <th style="padding:12px 16px; text-align:left; border-bottom:2px solid #eee; font-weight:600;">Amount</th>
                     </tr>
                   </thead>
                   <tbody>
                     <tr><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0;">Alice Johnson</td><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0;"><span style="padding:3px 10px; background:#dcfce7; color:#16a34a; border-radius:20px; font-size:12px;">Active</span></td><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0; color:#888;">Jan 12, 2025</td><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0; font-weight:600;">$240.00</td></tr>
                     <tr><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0;">Bob Smith</td><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0;"><span style="padding:3px 10px; background:#fef9c3; color:#ca8a04; border-radius:20px; font-size:12px;">Pending</span></td><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0; color:#888;">Jan 14, 2025</td><td style="padding:12px 16px; border-bottom:1px solid #f0f0f0; font-weight:600;">$180.00</td></tr>
                     <tr><td style="padding:12px 16px;">Carol White</td><td style="padding:12px 16px;"><span style="padding:3px 10px; background:#fee2e2; color:#dc2626; border-radius:20px; font-size:12px;">Inactive</span></td><td style="padding:12px 16px; color:#888;">Jan 16, 2025</td><td style="padding:12px 16px; font-weight:600;">$95.00</td></tr>
                   </tbody>
                 </table>
               </div>`,
  },
];

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register all blocks with the GrapesJS BlockManager.
 *
 * @param {object} editor - GrapesJS editor instance
 */
export function registerBlocks(editor) {
  BLOCKS.forEach(({ id, label, category, media, content }) => {
    editor.BlockManager.add(id, {
      label,
      category,
      media,
      content,
      attributes: { class: 'nuvra-block' },
    });
  });
}
