import { FileText, KeyRound, ListChecks, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AppShell, ErrorBanner, Select, type NavItem } from "./components";
import { NewRequest } from "./pages/NewRequest";
import { Pay } from "./pages/Pay";
import { Receipt } from "./pages/Receipt";
import { Reports } from "./pages/Reports";
import { RequestDetail } from "./pages/RequestDetail";
import { Requests } from "./pages/Requests";
import { SigningKeyPage } from "./pages/SigningKey";
import { Link, useApp, type Route } from "./state";

type NavId = "requests" | "new" | "reports" | "key";
type ThemeMode = "system" | "light" | "dark";

const nav: (NavItem<NavId> & { title: string; description: string })[] = [
  {
    id: "requests",
    href: "/",
    label: "Requests",
    title: "Payment requests",
    description: "Track what each customer owes and what has arrived on QoreChain.",
    icon: <ListChecks size={18} aria-hidden="true" />,
  },
  {
    id: "new",
    href: "/new",
    label: "New request",
    title: "New payment request",
    description: "Sign a request with your ML-DSA-87 key and share its payment link.",
    icon: <Plus size={18} aria-hidden="true" />,
  },
  {
    id: "reports",
    href: "/reports",
    label: "Reports",
    title: "Reconciliation report",
    description: "Totals by status and an export of every request and payment.",
    icon: <FileText size={18} aria-hidden="true" />,
  },
  {
    id: "key",
    href: "/key",
    label: "Signing key",
    title: "Signing key",
    description: "The post-quantum key that signs your payment requests.",
    icon: <KeyRound size={18} aria-hidden="true" />,
  },
];

export function BrandMark() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <path
        d="M7 5h18v22l-3-2-3 2-3-2-3 2-3-2-3 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m11.5 15.5 3 3 6-6.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem("chit-theme");
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage can be unavailable.
  }
  return "system";
}

function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem("chit-theme", theme);
    } catch {
      // Storage can be unavailable.
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

function ThemeSelect({ theme, onChange }: { theme: ThemeMode; onChange: (t: ThemeMode) => void }) {
  return (
    <Select<ThemeMode>
      label="Theme"
      hideLabel
      appearance="pill"
      value={theme}
      onChange={onChange}
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}

export function NetworkBadge() {
  const { status } = useApp();
  if (!status) return null;
  return (
    <span className="network-badge">
      <span className="network-dot" aria-hidden="true" />
      {status.environment === "LOCAL DEVNET" ? "LOCAL DEVNET · ANVIL 9800" : "DIANA TESTNET"}
    </span>
  );
}

const serviceDown = [
  { message: "Chit cannot reach its service right now. Reload the page to try again." },
];
const none: { message: string }[] = [];

function ServiceError() {
  const { statusError } = useApp();
  return <ErrorBanner errors={statusError ? serviceDown : none} />;
}

/** Customer-facing pages: no merchant navigation, one narrow column. */
function CustomerLayout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useTheme();
  return (
    <div className="customer">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="customer-bar">
        <span className="brand">
          <BrandMark />
          <b>Chit</b>
        </span>
        <div className="topbar-controls">
          <NetworkBadge />
          <ThemeSelect theme={theme} onChange={setTheme} />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="customer-main">
        <ServiceError />
        {children}
      </main>
      <footer className="customer-footer">
        Chit never holds funds. Payments go straight from your wallet to the merchant on QoreChain.
      </footer>
    </div>
  );
}

const navFor: Partial<Record<Route["name"], NavId>> = {
  requests: "requests",
  request: "requests",
  new: "new",
  reports: "reports",
  key: "key",
};

export function App() {
  const { route, navigate } = useApp();
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    const titles: Record<Route["name"], string> = {
      requests: "Payment requests",
      new: "New payment request",
      request: "Payment request",
      reports: "Reconciliation report",
      key: "Signing key",
      pay: "Pay a request",
      receipt: "Payment receipt",
      missing: "Page not found",
    };
    document.title = `${titles[route.name]} · Chit`;
  }, [route]);

  if (route.name === "pay" || route.name === "receipt")
    return (
      <CustomerLayout>
        {route.name === "pay" ? (
          <Pay key={route.id} id={route.id} />
        ) : (
          <Receipt key={route.id} id={route.id} />
        )}
      </CustomerLayout>
    );

  const activeId = navFor[route.name] ?? "requests";
  const view = nav.find((item) => item.id === activeId)!;
  const content: Record<string, ReactNode> = {
    requests: <Requests />,
    new: <NewRequest />,
    request: route.name === "request" ? <RequestDetail id={route.id} /> : null,
    reports: <Reports />,
    key: <SigningKeyPage />,
    missing: (
      <div className="surface-card card-pad">
        <p>This page does not exist.</p>
        <Link to={{ name: "requests" }}>Go to your payment requests</Link>
      </div>
    ),
  };

  return (
    <AppShell<NavId>
      brandName="Chit"
      brandMark={<BrandMark />}
      navLabel="Merchant"
      nav={nav}
      active={activeId}
      onNavigate={(id) => navigate({ name: id } as Route)}
      wide={route.name === "requests" || route.name === "request" || route.name === "reports"}
      topBar={
        <>
          <div className="topbar-meta">
            <NetworkBadge />
          </div>
          <div className="topbar-controls">
            <ThemeSelect theme={theme} onChange={setTheme} />
          </div>
        </>
      }
    >
      {route.name !== "request" && (
        <header className="page-head">
          <div className="page-head-copy">
            <h1 tabIndex={-1} data-page-title>
              {route.name === "missing" ? "Page not found" : view.title}
            </h1>
            {route.name !== "missing" && <p>{view.description}</p>}
          </div>
        </header>
      )}
      <ServiceError />
      {content[route.name]}
    </AppShell>
  );
}
