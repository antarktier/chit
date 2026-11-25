export function installKeyboardHandling(): () => void {
  const viewport = window.visualViewport;
  const root = document.documentElement;
  const keyboardInset = () => (viewport ? Math.max(0, window.innerHeight - viewport.height) : 0);
  const isAndroid = /Android/i.test(navigator.userAgent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settlingUntil = 0;

  const reveal = () => {
    const element = document.activeElement;
    if (
      !(element instanceof HTMLElement) ||
      !element.matches('input:not([type="hidden"]):not([type="file"]),textarea')
    )
      return;
    const group = element.closest("form");
    const availableHeight = viewport?.height ?? window.innerHeight;
    const target =
      group && group.getBoundingClientRect().height < availableHeight / 2 ? group : element;
    if (!viewport) {
      target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      return;
    }
    const { bottom } = target.getBoundingClientRect();
    let visibleBottom = viewport.offsetTop + viewport.height - (keyboardInset() > 0 ? 56 : 8);
    const bottomNav = document.querySelector(".sidebar");
    if (bottomNav && getComputedStyle(bottomNav).position === "fixed") {
      visibleBottom = Math.min(visibleBottom, bottomNav.getBoundingClientRect().top - 8);
    }
    if (bottom > visibleBottom) {
      window.scrollBy({
        top: isAndroid ? Math.ceil(bottom - visibleBottom) : bottom - visibleBottom,
        behavior: "instant",
      });
    }
  };

  const schedule = () => {
    settlingUntil = Date.now() + 1000;
    clearTimeout(timer);
    timer = setTimeout(reveal, 150);
  };

  const recheckScroll = () => {
    if (Date.now() >= settlingUntil) return;
    clearTimeout(timer);
    timer = setTimeout(reveal, 150);
  };

  const syncViewportTop = () => {
    const top = viewport && keyboardInset() > 0 ? Math.max(0, viewport.offsetTop) : 0;
    root.style.setProperty("--visual-viewport-top", `${top}px`);
  };

  const resize = () => {
    root.style.setProperty("--keyboard-inset", `${keyboardInset()}px`);
    syncViewportTop();
    schedule();
  };

  document.addEventListener("focusin", schedule);
  viewport?.addEventListener("resize", resize);
  viewport?.addEventListener("scroll", syncViewportTop);
  window.addEventListener("scroll", recheckScroll);
  if (isAndroid) viewport?.addEventListener("scroll", recheckScroll);
  window.addEventListener("resize", resize);
  resize();

  return () => {
    clearTimeout(timer);
    document.removeEventListener("focusin", schedule);
    viewport?.removeEventListener("resize", resize);
    viewport?.removeEventListener("scroll", syncViewportTop);
    window.removeEventListener("scroll", recheckScroll);
    viewport?.removeEventListener("scroll", recheckScroll);
    window.removeEventListener("resize", resize);
    root.style.removeProperty("--keyboard-inset");
    root.style.removeProperty("--visual-viewport-top");
  };
}
