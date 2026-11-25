import { useEffect, useRef, type ReactNode } from "react";

/** Screen-reader-only H1 for route focus & heading hierarchy (as in Recall & Hyge). */
export function Hero({ title }: { title: string }) {
  return (
    <header className="sr-only">
      <h1 tabIndex={-1} data-page-title>
        {title}
      </h1>
    </header>
  );
}

export interface ErrorItem {
  message: string;
  target?: string;
}

/** Auto-focusing error banner, shown only when something failed. */
export function ErrorBanner({ errors, action }: { errors: ErrorItem[]; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) ref.current?.focus();
  }, [errors]);
  if (!errors.length) return null;
  return (
    <div ref={ref} tabIndex={-1} role="alert" className="banner error">
      {errors.length === 1 ? (
        errors[0].target ? (
          <a href={`#${errors[0].target}`}>{errors[0].message}</a>
        ) : (
          <span>{errors[0].message}</span>
        )
      ) : (
        <ul>
          {errors.map((e, i) => (
            <li key={i}>
              {e.target ? <a href={`#${e.target}`}>{e.message}</a> : <span>{e.message}</span>}
            </li>
          ))}
        </ul>
      )}
      {action}
    </div>
  );
}

/** Native modal <dialog> with focus trap, Escape handling, and focus return. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2>{title}</h2>
      {description && <p className="muted">{description}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary compact" onClick={onCancel} autoFocus>
          {cancelLabel}
        </button>
        <button type="button" className="primary compact" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export type BadgeTone = "neutral" | "accent" | "success" | "warn" | "danger" | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={tone === "neutral" ? "badge" : `badge ${tone}`}>{children}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-card empty-state">
      {icon}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Disclosure({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
