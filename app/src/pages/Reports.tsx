import { NATIVE_ASSET, type PaymentStatus } from "@chit/core";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { paths, useApi, type MerchantSummary, type RequestSummary } from "../api";
import { QOR } from "../chain";
import {
  DataTable,
  EmptyState,
  GroupedList,
  MetricStrip,
  ProgressRow,
  SegmentedTabs,
} from "../components";
import { formatUnits, statusLabel } from "../format";
import { Link, useApp } from "../state";
import { HashText, Notice } from "../ui";
import { AssetAmount, nativeTotals } from "./Requests";

type Period = "7" | "30" | "90" | "all";
const order: PaymentStatus[] = ["unpaid", "partially_paid", "completed", "overpaid", "expired"];

function since(period: Period) {
  if (period === "all") return undefined;
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Number(period) + 1);
  return start.toISOString();
}

export function Reports() {
  const { key } = useApp();
  const [period, setPeriod] = useState<Period>("30");
  const from = useMemo(() => since(period), [period]);
  const merchant = key?.address;
  const summary = useApi<MerchantSummary>(
    merchant ? paths.summary(merchant, { from }) : undefined,
    15_000,
  );
  const overpaid = useApi<{ items: RequestSummary[]; total: number }>(
    merchant
      ? paths.merchantRequests(merchant, { status: "overpaid", from, limit: 10 })
      : undefined,
  );

  if (!key)
    return (
      <EmptyState
        title="Set up your signing key"
        description="Reports cover the requests signed with your key."
        action={<Link to={{ name: "key" }}>Set up a signing key</Link>}
      />
    );

  const s = summary.data;
  const native = s && nativeTotals(s);
  const tokens = s?.byAsset?.filter((row) => row.asset.toLowerCase() !== NATIVE_ASSET) ?? [];
  const qor = (v: string) => `${formatUnits(v, QOR.decimals)} QOR`;
  const collected =
    native && BigInt(native.requested) > 0n
      ? Number((BigInt(native.received) * 10_000n) / BigInt(native.requested)) / 100
      : undefined;

  return (
    <div className="section-stack">
      <SegmentedTabs<Period>
        label="Requests created in"
        value={period}
        onChange={setPeriod}
        options={[
          { value: "7", label: "Last 7 days" },
          { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" },
          { value: "all", label: "All time" },
        ]}
      />
      {summary.error && <Notice tone="error">{summary.error}</Notice>}
      {s && s.requests === 0 && (
        <p className="surface-card card-pad muted">No requests were created in this period.</p>
      )}
      {s && s.requests > 0 && (
        <>
          {native && (
            <MetricStrip
              items={[
                { label: "Requested in QOR", value: qor(native.requested) },
                { label: "Received in QOR", value: qor(native.received) },
                { label: "Outstanding in QOR", value: qor(native.outstanding) },
                ...(collected !== undefined
                  ? [
                      {
                        label: "Collected",
                        value: new Intl.NumberFormat(undefined, {
                          style: "percent",
                          maximumFractionDigits: 1,
                        }).format(collected / 100),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {tokens.length > 0 && (
            <section className="section-stack" aria-labelledby="token-balances">
              <div className="section-header">
                <h2 id="token-balances">Token balances by asset</h2>
              </div>
              <DataTable
                caption="Token balances by asset"
                rows={tokens}
                rowKey={(row) => row.asset}
                columns={[
                  {
                    key: "asset",
                    header: "Token contract",
                    render: (row) => <HashText value={row.asset} label="Token contract" />,
                  },
                  {
                    key: "requested",
                    header: "Requested",
                    render: (row) => <AssetAmount asset={row.asset} value={row.requested} />,
                  },
                  {
                    key: "received",
                    header: "Received",
                    render: (row) => <AssetAmount asset={row.asset} value={row.received} />,
                  },
                  {
                    key: "outstanding",
                    header: "Outstanding",
                    render: (row) => <AssetAmount asset={row.asset} value={row.outstanding} />,
                  },
                ]}
              />
            </section>
          )}
          <section className="section-stack" aria-labelledby="status-title">
            <div className="section-header">
              <h2 id="status-title">Requests by status</h2>
              <span className="muted tabular">
                {formatUnits(BigInt(s.requests), 0)} {s.requests === 1 ? "request" : "requests"}
              </span>
            </div>
            <GroupedList>
              {order.map((status) => {
                const n = s.byStatus[status] ?? 0;
                return (
                  <ProgressRow
                    key={status}
                    label={statusLabel[status]}
                    valueText={`${formatUnits(BigInt(n), 0)} (${Math.round((n / s.requests) * 100)}%)`}
                    primaryPercent={(n / s.requests) * 100}
                  />
                );
              })}
            </GroupedList>
          </section>
          {overpaid.data && overpaid.data.items.length > 0 && (
            <section className="section-stack" aria-labelledby="attention-title">
              <div className="section-header">
                <h2 id="attention-title">Overpaid requests to refund or credit</h2>
              </div>
              <GroupedList>
                {overpaid.data.items.map((r) => (
                  <div className="row" key={r.id}>
                    <div className="row-main">
                      <Link to={{ name: "request", id: r.id }} className="inline-link mono">
                        {r.reference}
                      </Link>
                      <small className="clamp">{r.details}</small>
                    </div>
                  </div>
                ))}
              </GroupedList>
            </section>
          )}
        </>
      )}
      <section className="surface-card card-pad" aria-labelledby="export-title">
        <h2 id="export-title" className="card-title">
          Export records
        </h2>
        <p className="muted">
          One row per request and one per payment, with transaction hash, block, payer and how the
          payment was counted. Amounts are in the asset's smallest unit (wei for QOR).
        </p>
        <div className="actions">
          <a
            className="primary button-link"
            href={paths.exportUrl(key.address, "csv", { from })}
            download
          >
            <Download size={16} aria-hidden="true" /> Download CSV
          </a>
          <a
            className="secondary button-link"
            href={paths.exportUrl(key.address, "json", { from })}
            download
          >
            <Download size={16} aria-hidden="true" /> Download JSON
          </a>
        </div>
      </section>
    </div>
  );
}
