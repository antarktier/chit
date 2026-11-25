import type { PaymentStatus } from "@chit/core";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { get, message, paths, useApi, type MerchantSummary, type RequestSummary } from "../api";
import { QOR, useAsset } from "../chain";
import {
  Button,
  DataTable,
  EmptyState,
  FilterChips,
  MetricStrip,
  type TableColumn,
} from "../components";
import { formatUnits, statusLabel, unixDate } from "../format";
import { Link, useApp } from "../state";
import { Amount, Notice, StatusBadge, When } from "../ui";

type Filter = PaymentStatus | "all";
const PAGE = 25;
const order: PaymentStatus[] = ["unpaid", "partially_paid", "completed", "overpaid", "expired"];

/** QOR totals only: amounts of different assets are never added together. */
export function nativeTotals(s: MerchantSummary) {
  if (s.byAsset) return s.byAsset.find((row) => /^0x0{40}$/i.test(row.asset));
  return s;
}

function AssetAmount({ value, asset }: { value: string; asset: string }) {
  const { ep } = useApp();
  const info = useAsset(ep, asset);
  return info ? <Amount value={value} asset={info} /> : <span className="tabular">{value}</span>;
}

export function Requests() {
  const { key, navigate } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<RequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const merchant = key?.address;
  const summary = useApi<MerchantSummary>(merchant ? paths.summary(merchant) : undefined, 10_000);

  useEffect(() => {
    if (!merchant) return;
    let live = true;
    const load = () =>
      get<{ items: RequestSummary[]; total: number }>(
        paths.merchantRequests(merchant, {
          status: filter === "all" ? undefined : filter,
          limit: PAGE,
          offset: 0,
        }),
      )
        .then((page) => {
          if (!live) return;
          setItems(page.items);
          setTotal(page.total);
          setError(undefined);
          setLoaded(true);
        })
        .catch((e: unknown) => live && setError(message(e)));
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [merchant, filter]);

  const s = summary.data;
  const metrics = useMemo(() => {
    if (!s || !s.requests) return [];
    const qor = (v: string) => `${formatUnits(v, QOR.decimals)} QOR`;
    const native = nativeTotals(s);
    const items = [{ label: "Requests", value: formatUnits(BigInt(s.requests), 0) }];
    if (native)
      items.push(
        { label: "Requested in QOR", value: qor(native.requested) },
        { label: "Received in QOR", value: qor(native.received) },
        { label: "Outstanding in QOR", value: qor(native.outstanding) },
      );
    return items;
  }, [s]);

  if (!key)
    return (
      <EmptyState
        title="Set up your signing key"
        description="Chit signs every payment request with a post-quantum ML-DSA-87 key that you hold. Create or restore one to start."
        action={<Link to={{ name: "key" }}>Set up a signing key</Link>}
      />
    );

  const columns: TableColumn<RequestSummary>[] = [
    {
      key: "reference",
      header: "Reference",
      render: (r) => (
        <>
          <Link to={{ name: "request", id: r.id }} className="inline-link mono">
            {r.reference}
          </Link>
          <span className="subline clamp">{r.details}</span>
        </>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (r) => <AssetAmount value={r.amount} asset={r.asset} />,
    },
    {
      key: "paid",
      header: "Paid",
      align: "right",
      render: (r) => <AssetAmount value={r.paid} asset={r.asset} />,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "expires", header: "Expires", render: (r) => <When date={unixDate(r.expiresAt)} /> },
    { key: "created", header: "Created", render: (r) => <When date={new Date(r.createdAt)} /> },
  ];

  const chips = [
    { value: "all" as Filter, label: "All", count: s?.requests },
    ...order.map((status) => ({
      value: status as Filter,
      label: statusLabel[status],
      count: s?.byStatus[status],
    })),
  ];

  return (
    <div className="section-stack">
      {metrics.length > 0 && <MetricStrip items={metrics} />}
      {error && <Notice tone="error">{error}</Notice>}
      {s && s.requests > 0 && (
        <FilterChips<Filter>
          label="Filter by status"
          value={filter}
          options={chips}
          onChange={setFilter}
        />
      )}
      {loaded && items.length === 0 ? (
        filter === "all" ? (
          <EmptyState
            title="No payment requests yet"
            description="Create a request, then share its link or QR code with your customer."
            action={
              <Button onClick={() => navigate({ name: "new" })}>
                <Plus size={16} aria-hidden="true" /> New request
              </Button>
            }
          />
        ) : (
          <p className="surface-card card-pad muted">
            No requests are {statusLabel[filter].toLowerCase()}.
          </p>
        )
      ) : (
        items.length > 0 && (
          <>
            <DataTable
              caption="Payment requests, newest first"
              columns={columns}
              rows={items}
              rowKey={(r) => r.id}
            />
            {total > items.length && (
              <div className="actions">
                <Button
                  variant="secondary"
                  onClick={() =>
                    void get<{ items: RequestSummary[]; total: number }>(
                      paths.merchantRequests(key.address, {
                        status: filter === "all" ? undefined : filter,
                        limit: PAGE,
                        offset: items.length,
                      }),
                    )
                      .then((page) => setItems((prev) => [...prev, ...page.items]))
                      .catch((e: unknown) => setError(message(e)))
                  }
                >
                  Show {Math.min(PAGE, total - items.length)} more of{" "}
                  {formatUnits(BigInt(total - items.length), 0)}
                </Button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
