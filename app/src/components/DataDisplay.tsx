import { ChevronRight } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";

export interface MetricItem {
  label: string;
  value: string | number;
  detail?: string;
}

/** Recall/Hyge horizontal metric strip with internal 1px dividers; collapses to 2x2 on mobile. */
export function MetricStrip({ items }: { items: MetricItem[] }) {
  return (
    <div className="metrics" style={{ "--metric-cols": items.length } as CSSProperties}>
      {items.map((item) => (
        <div className="metric" key={item.label}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
          {item.detail && <small>{item.detail}</small>}
        </div>
      ))}
    </div>
  );
}

export function GroupedList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="list" role={label ? "region" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export function SettingRow({
  label,
  value,
  onClick,
  trailing,
}: {
  label: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  if (onClick) {
    return (
      <button type="button" className="setting" onClick={onClick}>
        <span>{label}</span>
        {value !== undefined && <span className="value">{value}</span>}
        {trailing ?? <ChevronRight size={16} aria-hidden="true" className="chevron" />}
      </button>
    );
  }
  return (
    <div className="setting">
      <span>{label}</span>
      {value !== undefined && <span className="value">{value}</span>}
      {trailing}
    </div>
  );
}

export function ProgressRow({
  label,
  valueText,
  primaryPercent,
  secondaryPercent = 0,
  onClick,
}: {
  label: ReactNode;
  valueText: string;
  primaryPercent: number;
  secondaryPercent?: number;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="progress-row">
        <span>{label}</span>
        <span className="progress-bar" aria-hidden="true">
          <span
            className="primary-fill"
            style={{ width: `${Math.max(0, Math.min(100, primaryPercent))}%` }}
          />
          {secondaryPercent > 0 && (
            <span
              className="secondary-fill"
              style={{ width: `${Math.max(0, Math.min(100 - primaryPercent, secondaryPercent))}%` }}
            />
          )}
        </span>
      </span>
      <span className="value">{valueText}</span>
      {onClick && <ChevronRight size={16} aria-hidden="true" className="chevron" />}
    </>
  );
  return onClick ? (
    <button type="button" className="setting" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="setting">{content}</div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  displayValue?: string;
}

/**
 * Vertical bar chart for meaningful binned distributions or multi-category comparisons.
 * Never use for raw per-block counts; omit the chart and render a concise text summary
 * whenever fewer than `minPoints` non-zero observations are present.
 */
export function BarChart({
  title,
  unit,
  data,
  heightPx = 110,
  minPoints = 2,
  emptySummary,
}: {
  title?: string;
  unit?: string;
  data: BarDatum[];
  heightPx?: number;
  minPoints?: number;
  emptySummary?: string;
}) {
  const active = data.filter((d) => d.value > 0);
  if (active.length < minPoints) {
    const fallback =
      emptySummary ??
      (active.length === 1
        ? `Single bucket (${active[0].label}): ${active[0].displayValue ?? active[0].value}${unit ? ` ${unit}` : ""}.`
        : "Insufficient data points to plot a meaningful distribution.");
    return (
      <section className="section-group" aria-label={title}>
        {title && <h2 className="group-label">{title}</h2>}
        <div className="surface-card chart-summary">
          <p className="muted">{fallback}</p>
        </div>
      </section>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <section className="section-group" aria-label={title}>
      {title && <h2 className="group-label">{title}</h2>}
      <div className="bars" style={{ "--bar-count": data.length } as CSSProperties}>
        {data.map((d) => (
          <div className="bar-slot" key={d.label}>
            <span>{d.value > 0 ? (d.displayValue ?? d.value) : ""}</span>
            <div
              className="bar"
              style={{ height: `${Math.max(2, (d.value / max) * heightPx)}px` }}
            />
            <small>{d.label}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface PercentilePoint {
  label: string;
  p50: number;
  p90?: number;
  p99?: number;
  samples?: number;
}

/**
 * Analyst time-series chart with Y-axis unit ticks, X-axis time labels, p50 solid median line,
 * and optional p90/p99 percentile band. Renders a concise text summary instead of a chart
 * when fewer than 2 time buckets are available.
 */
export function PercentileBandChart({
  title,
  unit,
  points,
  formatTick = (v: number) => `${Math.round(v).toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`,
  emptySummary,
}: {
  title: string;
  unit: string;
  points: PercentilePoint[];
  formatTick?: (value: number) => string;
  emptySummary?: string;
}) {
  const gradId = useId();
  if (points.length < 2) {
    const single = points[0];
    const fallback =
      emptySummary ??
      (single
        ? `${single.label}: median ${formatTick(single.p50)}${single.p90 !== undefined ? `, p90 ${formatTick(single.p90)}` : ""}${single.samples ? ` (n = ${single.samples})` : ""}. Widen the time window for a multi-bucket trend.`
        : "No observations in the selected time window.");
    return (
      <section className="section-group" aria-label={title}>
        <h2 className="group-label">{title}</h2>
        <div className="surface-card chart-summary">
          <p className="muted">{fallback}</p>
        </div>
      </section>
    );
  }

  const width = 640;
  const height = 210;
  const left = 92;
  const right = 622;
  const top = 16;
  const bottom = 176;
  const allVals = points.flatMap((p) => [p.p50, p.p90 ?? p.p50, p.p99 ?? p.p50]);
  const minVal = Math.min(0, ...allVals);
  const maxVal = Math.max(1, ...allVals);
  const span = maxVal - minVal || 1;
  const xAt = (i: number) => left + (i / (points.length - 1)) * (right - left);
  const yAt = (v: number) => bottom - ((v - minVal) / span) * (bottom - top);
  const hasBand = points.some((p) => p.p99 !== undefined || p.p90 !== undefined);
  const p50Path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.p50).toFixed(1)}`)
    .join(" ");
  const p90Path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(p.p90 ?? p.p50).toFixed(1)}`)
    .join(" ");
  const p99Upper = points.map(
    (p, i) => `${xAt(i).toFixed(1)},${yAt(p.p99 ?? p.p90 ?? p.p50).toFixed(1)}`,
  );
  const p50Lower = [...points]
    .reverse()
    .map((p, i) => `${xAt(points.length - 1 - i).toFixed(1)},${yAt(p.p50).toFixed(1)}`);
  const bandPoly = [...p99Upper, ...p50Lower].join(" ");
  const latest = points[points.length - 1];

  return (
    <section className="section-group" aria-label={title}>
      <div className="chart-head">
        <h2 className="group-label">{title}</h2>
        <div className="chart-legend">
          <span>
            <i className="swatch solid" aria-hidden="true" /> p50 {formatTick(latest.p50)}
          </span>
          {latest.p90 !== undefined && (
            <span>
              <i className="swatch dashed" aria-hidden="true" /> p90 {formatTick(latest.p90)}
            </span>
          )}
          {latest.p99 !== undefined && (
            <span>
              <i className="swatch band" aria-hidden="true" /> p99 {formatTick(latest.p99)}
            </span>
          )}
        </div>
      </div>
      <div className="surface-card chart-card">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="chart-svg"
          role="img"
          aria-label={`${title} (${unit})`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((frac) => {
            const val = minVal + frac * span;
            const y = yAt(val);
            return (
              <g key={frac}>
                <line x1={left} x2={right} y1={y} y2={y} className="chart-grid" />
                <text x={left - 8} y={y + 4} textAnchor="end" className="chart-tick">
                  {formatTick(val)}
                </text>
              </g>
            );
          })}
          {hasBand && <polygon points={bandPoly} fill={`url(#${gradId})`} />}
          {hasBand && (
            <path
              d={p90Path}
              fill="none"
              stroke="var(--accent)"
              strokeOpacity="0.55"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          )}
          <path
            d={p50Path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map((p, i) => (
            <circle key={p.label} cx={xAt(i)} cy={yAt(p.p50)} r="3" fill="var(--accent)" />
          ))}
          <text x={left} y={height - 8} textAnchor="start" className="chart-tick">
            {points[0].label}
          </text>
          {points.length > 2 && (
            <text
              x={xAt(Math.floor(points.length / 2))}
              y={height - 8}
              textAnchor="middle"
              className="chart-tick"
            >
              {points[Math.floor(points.length / 2)].label}
            </text>
          )}
          <text x={right} y={height - 8} textAnchor="end" className="chart-tick">
            {latest.label}
          </text>
        </svg>
      </div>
    </section>
  );
}

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  caption: string;
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  return (
    <div className="data-panel table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.align === "right" ? "num" : undefined}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.align === "right" ? "num" : undefined}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
