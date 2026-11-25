import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useApi, type ServiceStatus } from "./api";
import { endpoints, type Endpoints } from "./chain";
import { forgetKey, loadKey, saveKey, type SigningKey } from "./signer";

export type Route =
  | { name: "requests" }
  | { name: "new" }
  | { name: "request"; id: string }
  | { name: "reports" }
  | { name: "key" }
  | { name: "pay"; id: string }
  | { name: "receipt"; id: string }
  | { name: "missing" };

const ID = "(0x[0-9a-fA-F]{64})";

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "requests" };
  if (path === "/new") return { name: "new" };
  if (path === "/reports") return { name: "reports" };
  if (path === "/key") return { name: "key" };
  for (const [name, prefix] of [
    ["request", "/requests/"],
    ["pay", "/pay/"],
    ["receipt", "/receipts/"],
  ] as const) {
    const match = new RegExp(`^${prefix}${ID}$`).exec(path);
    if (match) return { name, id: match[1]!.toLowerCase() };
  }
  return { name: "missing" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "requests":
      return "/";
    case "request":
      return `/requests/${route.id}`;
    case "pay":
      return `/pay/${route.id}`;
    case "receipt":
      return `/receipts/${route.id}`;
    case "missing":
      return "/";
    default:
      return `/${route.name}`;
  }
}

export function payLink(id: string) {
  return `${location.origin}/pay/${id}`;
}

interface AppState {
  route: Route;
  navigate: (route: Route) => void;
  status?: ServiceStatus;
  statusError?: string;
  ep: Endpoints;
  key?: SigningKey;
  remembered: boolean;
  setKey: (key: SigningKey | undefined, remember?: boolean) => void;
}

const Context = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  const [stored, setStored] = useState(() => loadKey());
  const status = useApi<ServiceStatus>("/v1/status", 15_000);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    const target = href(next);
    if (target !== location.pathname) window.history.pushState(null, "", target);
    setRoute(next);
  }, []);

  const setKey = useCallback((key: SigningKey | undefined, remember = false) => {
    if (key) {
      saveKey(key, remember);
      setStored({ key, remembered: remember });
    } else {
      forgetKey();
      setStored(undefined);
    }
  }, []);

  const value = useMemo<AppState>(
    () => ({
      route,
      navigate,
      status: status.data,
      statusError: status.error,
      ep: endpoints(status.data),
      key: stored?.key,
      remembered: stored?.remembered ?? false,
      setKey,
    }),
    [route, navigate, status.data, status.error, stored, setKey],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider");
  return value;
}

/** In-app link that keeps client-side routing and still works as a normal link. */
export function Link({
  to,
  className = "inline-link",
  children,
}: {
  to: Route;
  className?: string;
  children: ReactNode;
}) {
  const { navigate } = useApp();
  return (
    <a
      className={className}
      href={href(to)}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
