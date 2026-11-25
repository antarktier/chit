import { useEffect, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { digit, isEditing } from "../lib/keyboard";

export interface NavItem<T extends string = string> {
  id: T;
  href: string;
  label: string;
  icon: ReactNode;
}

export interface AppShellProps<T extends string = string> {
  brandName: string;
  brandMark?: ReactNode;
  nav: NavItem<T>[];
  active: T;
  onNavigate: (id: T) => void;
  sidebarFooter?: ReactNode;
  topBar?: ReactNode;
  wide?: boolean;
  skipLabel?: string;
  navLabel?: string;
  children: ReactNode;
}

export function AppShell<T extends string = string>({
  brandName,
  brandMark,
  nav,
  active,
  onNavigate,
  sidebarFooter,
  topBar,
  wide = false,
  skipLabel = "Skip to content",
  navLabel = "Main",
  children,
}: AppShellProps<T>) {
  const mainRef = useRef<HTMLElement>(null);
  const navigated = useRef(false);

  const go = (id: T, event?: MouseEvent<HTMLAnchorElement>) => {
    if (event) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
    }
    navigated.current = true;
    onNavigate(id);
  };

  useLayoutEffect(() => {
    if (!navigated.current) return;
    navigated.current = false;
    const target =
      mainRef.current?.querySelector<HTMLElement>("[data-page-title]") ?? mainRef.current;
    target?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || isEditing(e.target)) return;
      const n = digit(e);
      if (e.altKey && n >= 1 && n <= nav.length) {
        e.preventDefault();
        navigated.current = true;
        onNavigate(nav[n - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, onNavigate]);

  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        {skipLabel}
      </a>
      <aside className="sidebar">
        <a
          href={nav[0]?.href ?? "/"}
          className="brand"
          aria-label={`${brandName} overview`}
          onClick={(e) => nav[0] && go(nav[0].id, e)}
        >
          {brandMark}
          <b>{brandName}</b>
        </a>
        <nav aria-label={navLabel} className={nav.length > 5 ? "nav-scroll" : undefined}>
          {nav.map((item, i) => (
            <a
              key={item.id}
              href={item.href}
              className={active === item.id ? "active" : undefined}
              aria-current={active === item.id ? "page" : undefined}
              aria-keyshortcuts={`Alt+${i + 1}`}
              onClick={(e) => go(item.id, e)}
            >
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        {sidebarFooter && <div className="sidebar-footer">{sidebarFooter}</div>}
      </aside>
      <main id="main" tabIndex={-1} ref={mainRef}>
        <div className={wide ? "workspace wide" : "workspace"}>
          {topBar && <div className="workspace-topbar">{topBar}</div>}
          {children}
        </div>
      </main>
    </div>
  );
}
