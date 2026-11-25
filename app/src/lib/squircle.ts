/**
 * Continuous ("squircle") corners for borderless surface containers, ported from Recall / Hyge.
 * Drawn identically across all engines using a sized CSS `clip-path` superellipse.
 * Containers are borderless (like iOS grouped lists), so clipping never cuts a border.
 * Capsule controls are untouched: a capsule's ends are true semicircles.
 */
export const DEFAULT_SQUIRCLE_SELECTOR = ".surface-card,.list,.metrics,.bars,.data-panel,dialog";

const EXPONENT = 4;
const REACH = 1.6;
const STEPS = 12;

export function squirclePath(width: number, height: number, radius: number): string {
  const r = Math.min(radius * REACH, width / 2, height / 2);
  const corner = (cx: number, cy: number, sx: number, sy: number) =>
    Array.from({ length: STEPS + 1 }, (_, i) => {
      const t = ((i / STEPS) * Math.PI) / 2;
      const x = Math.cos(t) ** (2 / EXPONENT);
      const y = Math.sin(t) ** (2 / EXPONENT);
      return `${(cx + sx * x * r).toFixed(2)} ${(cy + sy * y * r).toFixed(2)}`;
    });
  const points = [
    ...corner(width - r, r, 1, -1).reverse(),
    ...corner(width - r, height - r, 1, 1),
    ...corner(r, height - r, -1, 1).reverse(),
    ...corner(r, r, -1, -1),
  ];
  return `path('M ${points.join(" L ")} Z')`;
}

export function installSquircles(
  root: HTMLElement = document.body,
  selector: string = DEFAULT_SQUIRCLE_SELECTOR,
): () => void {
  if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const apply = (element: HTMLElement) => {
    element.style.clipPath = "";
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    const { width, height } = element.getBoundingClientRect();
    if (width && height && radius) {
      element.style.clipPath = squirclePath(width, height, radius);
    }
  };
  const resize = new ResizeObserver((entries) => {
    for (const entry of entries) apply(entry.target as HTMLElement);
  });
  const watched = new WeakSet<Element>();
  const scan = () => {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (!watched.has(element)) {
        watched.add(element);
        resize.observe(element);
        apply(element);
      }
    });
  };
  const mutations = new MutationObserver(scan);
  mutations.observe(root, { subtree: true, childList: true });
  const relayout = () => root.querySelectorAll<HTMLElement>(selector).forEach(apply);
  window.addEventListener("resize", relayout);
  scan();
  return () => {
    mutations.disconnect();
    resize.disconnect();
    window.removeEventListener("resize", relayout);
  };
}
