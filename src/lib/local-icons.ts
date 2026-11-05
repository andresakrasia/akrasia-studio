/** Inline SVG masks replace the remote Google icon font without changing React text children. */
const paths: Record<string, string> = {
  circle: '<circle cx="12" cy="12" r="7"/>',
  forum: '<path d="M3 3h18v13H8l-5 5z"/>',
  smart_toy: '<rect x="4" y="6" width="16" height="13" rx="3"/><path d="M12 2v4M8 11h1m6 0h1M8 15h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-11v1"/>',
  grid_view: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  videocam: '<path d="M3 6h12v12H3zM15 10l6-4v12l-6-4"/>',
  play_circle: '<circle cx="12" cy="12" r="9"/><path d="m10 7 7 5-7 5z"/>',
  check_circle: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  arrow_right: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  movie: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M6 5l4 4m3-4 4 4"/>',
  auto_awesome: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  graphic_eq: '<path d="M4 9v6m4-9v12m4-16v20m4-16v12m4-9v6"/>',
  palette: '<circle cx="12" cy="12" r="9"/><path d="M7 8h1m5-2h1m3 4h1M7 14h1"/>',
};
const fallback = '<path d="m12 3 9 9-9 9-9-9z"/>';
export function initializeLocalIcons(): () => void {
  const update = (root: Element | Document) => {
    const nodes = root instanceof HTMLElement && root.matches('.material-symbols-outlined')
      ? [root] : Array.from(root.querySelectorAll<HTMLElement>('.material-symbols-outlined'));
    nodes.forEach(node => {
      const name = node.textContent?.trim() || '';
      if (node.dataset.localIcon === name) return;
      node.dataset.localIcon = name;
      node.setAttribute('aria-hidden', 'true');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || fallback}</svg>`;
      node.style.setProperty('--local-icon', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    });
  };
  update(document);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') {
        const icon = record.target.parentElement?.closest('.material-symbols-outlined');
        if (icon) update(icon);
      } else {
        const icon = record.target instanceof Element ? record.target.closest('.material-symbols-outlined') : null;
        if (icon) update(icon);
        for (const node of record.addedNodes) if (node instanceof Element) update(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}
