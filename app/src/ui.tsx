import type { PaymentStatus } from "@chit/core";
import { Check, Copy } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useId, useState, type ReactNode } from "react";
import { Badge, Button } from "./components";
import type { AssetInfo } from "./chain";
import {
  dateTime,
  exactUnits,
  formatUnits,
  relative,
  shortHex,
  statusLabel,
  statusTone,
} from "./format";

export function Amount({
  value,
  asset,
  maxFraction = 6,
}: {
  value: string | bigint;
  asset: Pick<AssetInfo, "symbol" | "decimals">;
  maxFraction?: number;
}) {
  const shown = formatUnits(value, asset.decimals, maxFraction);
  const exact = exactUnits(value, asset.decimals);
  const rounded = (exact.split(".")[1]?.length ?? 0) > maxFraction;
  return (
    <span className="tabular amount" title={`${exact} ${asset.symbol}`}>
      {shown} {asset.symbol}
      {rounded && <span className="sr-only"> (exactly {exact})</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>;
}

export function When({ date, now }: { date: Date; now?: Date }) {
  return (
    <time dateTime={date.toISOString()} title={date.toISOString()}>
      {dateTime(date)}
      <span className="subline">{relative(date, now)}</span>
    </time>
  );
}

export function HashText({ value, label }: { value: string; label?: string }) {
  return (
    <span className="hash" title={value}>
      <span aria-hidden="true">{shortHex(value, 10, 6)}</span>
      <span className="sr-only">
        {label ? `${label} ` : ""}
        {value}
      </span>
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="secondary"
      size="compact"
      shape="control"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span>{copied ? "Copied" : label}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? `${label}: copied to the clipboard` : ""}
      </span>
    </Button>
  );
}

/** QR code rendered locally as SVG (no third-party service sees the payment link). */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [svg, setSvg] = useState<string>();
  useEffect(() => {
    let live = true;
    void QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(
      (out) => live && setSvg(out),
    );
    return () => {
      live = false;
    };
  }, [value]);
  if (!svg) return null;
  return (
    <div
      className="qr"
      role="img"
      aria-label={label}
      // The SVG comes from the qrcode library for a URL we built; it contains no user HTML.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  multiline = false,
  inputMode,
  placeholder,
  autoComplete = "off",
  maxLength,
  required,
  mono,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  inputMode?: "decimal" | "text";
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  required?: boolean;
  mono?: boolean;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  const common = {
    id,
    value,
    placeholder,
    autoComplete,
    maxLength,
    required,
    spellCheck: false,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  return (
    <div className={error ? "form-field invalid" : "form-field"}>
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
      {multiline ? (
        <textarea className={mono ? "textarea-control mono" : "textarea-control"} {...common} />
      ) : (
        <input
          className={mono ? "input-control mono" : "input-control"}
          inputMode={inputMode}
          {...common}
        />
      )}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warn" | "error";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`} role={tone === "error" ? "alert" : "status"}>
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="inline-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
