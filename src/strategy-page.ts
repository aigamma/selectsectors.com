// Shared helper for /strategies/{name}/ pages.
//
// Each strategy page imports its own Rust source via Vite's `?raw`
// import and calls `mountStrategySource(elementId, source)` to inline
// the code under the "The Rust" section. The function is trivial but
// centralizing it keeps the import style consistent and gives us one
// place to change if we ever swap textContent for a syntax-highlighted
// renderer.

export function mountStrategySource(elementId: string, source: string): void {
  const el = document.getElementById(elementId);
  if (el) el.textContent = source;
}
