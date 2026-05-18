// Site-wide layout primitives.
//
// Every page on selectsectors.com shares three pieces of chrome:
// the header (brand + top nav), the footer (disclaimer + version),
// and the floating SelectBot chat panel (visible across every page
// so the conversation persists alongside whatever the user is
// reading). This module exposes one mount function per piece so
// every page entry can call the same set of functions instead of
// duplicating the HTML in each index.html.
//
// ## Why HTML strings here and not <template> elements?
//
// The pages need the chrome to be in the DOM before any other
// per-page JS runs (so chat keyboard handlers, status fetches, and
// nav-active highlighting all work). The most direct way to do
// that is to write the HTML at runtime into a known mount point.
// <template> elements would work too but require either a build-
// time string-to-template conversion or runtime template cloning,
// both of which add complexity that buys nothing at this size.
//
// ## Active nav highlighting
//
// `mountSiteHeader(activePage)` takes the canonical name of the
// current page ('home', 'learn', 'quiz', 'strategies') and adds an
// .active class to the matching <a>. The active class lives in
// style.css alongside the rest of the nav styling so the visual
// treatment stays close to the layout it modifies.

import { initChat } from './chat.ts';

type ActivePage =
  | 'home'
  | 'learn'
  | 'quiz'
  | 'strategies'
  | 'compare'
  | 'scan'
  | 'philosophy'
  | 'none';

interface NavLink {
  href: string;
  label: string;
  page: ActivePage;
}

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Backtest', page: 'home' },
  { href: '/compare/', label: 'Compare', page: 'compare' },
  { href: '/scan/', label: 'Scan', page: 'scan' },
  { href: '/strategies/', label: 'Strategies', page: 'strategies' },
  { href: '/learn/', label: 'Learn Rust', page: 'learn' },
  { href: '/quiz/', label: 'Quiz', page: 'quiz' },
  { href: '/philosophy/', label: 'Philosophy', page: 'philosophy' },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });
}

function headerHtml(active: ActivePage): string {
  const navHtml = NAV_LINKS.map((link) => {
    const cls = link.page === active ? 'active' : '';
    return `<a class="${cls}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`;
  }).join('');
  return `
    <a class="skip-to-main" href="#main-content">Skip to main content</a>
    <header class="page-header">
      <a class="brand" href="/">Select Sectors</a>
      <nav class="top-nav" aria-label="Primary">
        ${navHtml}
        <a href="https://aigamma.com" class="external-nav">AI Gamma</a>
      </nav>
    </header>
  `;
}

function footerHtml(): string {
  return `
    <footer class="page-footer">
      <div class="page-footer-links">
        <a href="/disclaimer/" class="disclaimer-link">Disclaimer</a>
        <a href="/changelog/" class="footer-link">Changelog</a>
        <a href="https://github.com/aigamma/selectsectors.com" class="footer-link">Source</a>
      </div>
      <span class="footer-meta">AI Gamma &middot; Select Sectors &middot; v0.1.0</span>
    </footer>
  `;
}

function chatPanelHtml(): string {
  // The chat panel is fixed-positioned so it floats over every page.
  // Keeping the HTML here (vs in each page's index.html) means a
  // future chat-UI change is a one-line edit in this module rather
  // than a find-and-replace across every page in the repo.
  return `
    <div id="chat-root" class="chat-root">
      <button
        id="chat-toggle"
        class="chat-toggle"
        type="button"
        aria-label="Open SelectBot chat"
        aria-controls="chat-panel"
        aria-expanded="false"
      >
        <span class="chat-toggle-dot" aria-hidden="true"></span>
        SelectBot
      </button>
      <section
        id="chat-panel"
        class="chat-panel"
        hidden
        aria-labelledby="chat-title"
      >
        <header class="chat-header">
          <div class="chat-header-titles">
            <h2 id="chat-title">SelectBot</h2>
            <div id="chat-rate-hint" class="chat-rate-hint"></div>
          </div>
          <button
            id="chat-close"
            class="chat-close"
            type="button"
            aria-label="Close SelectBot"
          >
            &times;
          </button>
        </header>
        <div
          id="chat-conversation"
          class="chat-conversation"
          role="log"
          aria-live="polite"
        ></div>
        <div id="chat-status" class="chat-status" aria-live="polite"></div>
        <form id="chat-form" class="chat-form">
          <label for="chat-input" class="visually-hidden">Your message</label>
          <textarea
            id="chat-input"
            class="chat-input"
            rows="2"
            placeholder="Ask about Rust, this site, or quant finance..."
            required
          ></textarea>
          <div class="chat-form-actions">
            <button type="button" id="chat-clear" class="chat-clear">
              Clear chat
            </button>
            <button type="submit" id="chat-send" class="chat-send">Send</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function replaceMount(id: string, html: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  // Replace the placeholder element with the rendered HTML. Using
  // outerHTML preserves any subsequent siblings and avoids leaving an
  // empty wrapper div in the DOM.
  el.outerHTML = html;
}

/**
 * Mount the entire shared shell: header, footer, and floating chat
 * panel. Each page's entry calls this once on init and then runs its
 * own page-specific code. The header gets `activePage` to highlight
 * the right nav link.
 */
export function mountSiteShell(activePage: ActivePage = 'none'): void {
  replaceMount('site-header-mount', headerHtml(activePage));
  replaceMount('site-footer-mount', footerHtml());
  replaceMount('chat-mount', chatPanelHtml());
  initChat();
}
