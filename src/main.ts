// Frontend entry. On first paint the page is fully populated except
// for the universe lists (sectors + anchors), which arrive over a
// single fetch to /api/universe so the roster lives server-side and
// can rotate over time without a frontend redeploy.

interface UniverseResponse {
  sectors: string[];
  anchors: string[];
}

async function loadUniverse(): Promise<void> {
  try {
    const res = await fetch('/api/universe');
    if (!res.ok) {
      throw new Error(`universe fetch returned ${res.status}`);
    }
    const data = (await res.json()) as UniverseResponse;
    renderList('sector-list', data.sectors);
    renderList('anchor-list', data.anchors);
  } catch (err) {
    console.warn('failed to load universe', err);
    // Leave the placeholder "loading..." in place so the failure
    // mode is honest rather than misleading. The page is still
    // readable; only the universe lists are blank.
  }
}

function renderList(id: string, items: string[]): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.map((s) => `<li>${escape(s)}</li>`).join('');
}

function escape(s: string): string {
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

loadUniverse();
