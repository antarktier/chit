import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { paths, useApi, type PaymentEventView, type RequestDetail as Detail } from "../api";
import { explorerTxUrl, useAsset, type AssetInfo } from "../chain";
import {
  Badge,
  DataTable,
  Disclosure,
  EmptyState,
  MetricStrip,
  type TableColumn,
} from "../components";
import { eventHelp, eventLabel, eventTone, formatUnits, unixDate } from "../format";
import { Link, payLink, useApp } from "../state";
import {
  Amount,
  CopyButton,
  ExternalLink,
  HashText,
  KeyValue,
  Notice,
  QrCode,
  StatusBadge,
  When,
} from "../ui";

export function PaymentsTable({
  events,
  asset,
  minConfirmations,
}: {
  events: PaymentEventView[];
  asset: AssetInfo;
  minConfirmations?: string;
}) {
  const { ep } = useApp();
  const columns: TableColumn<PaymentEventView>[] = [
    {
      key: "tx",
      header: "Transaction",
      render: (e) => {
        const url = explorerTxUrl(ep, e.txHash, e.source);
        const text = <HashText value={e.txHash} label="Transaction" />;
        return (
          <>
            {url ? <ExternalLink href={url}>{text}</ExternalLink> : text}
            <span className="subline">
              {e.source === "native" ? "QoreX transfer with memo" : "ChitPay contract"}
            </span>
          </>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (e) => <Amount value={e.amount} asset={asset} />,
    },
    {
      key: "class",
      header: "Counted as",
      render: (e) => (
        <>
          <Badge tone={eventTone[e.class]}>{eventLabel[e.class]}</Badge>
          <span className="subline">{eventHelp[e.class]}</span>
        </>
      ),
    },
    {
      key: "confirmations",
      header: "Confirmations",
      align: "right",
      render: (e) => (
        <span className="tabular">
          {formatUnits(e.confirmations, 0)}
          {minConfirmations && BigInt(e.confirmations) < BigInt(minConfirmations)
            ? ` of ${minConfirmations}`
            : ""}
        </span>
      ),
    },
    {
      key: "block",
      header: "Block",
      render: (e) => (
        <>
          <span className="tabular">{formatUnits(e.blockHeight, 0)}</span>
          <span className="subline">
            <When date={unixDate(e.blockTime)} />
          </span>
        </>
      ),
    },
    { key: "payer", header: "Payer", render: (e) => <HashText value={e.payer} label="Payer" /> },
  ];
  return (
    <DataTable
      caption="Payments for this request"
      columns={columns}
      rows={events}
      rowKey={(e) => e.key}
    />
  );
}

export function RequestDetail({ id }: { id: string }) {
  const { ep, status } = useApp();
  const detail = useApi<Detail>(paths.request(id), 5000);
  const asset = useAsset(ep, detail.data?.request.asset);
  const link = payLink(id);
  const data = detail.data;
  const rec = data?.reconciliation;
  const metrics = useMemo(() => {
    if (!rec || !asset) return [];
    const fmt = (v: string) => `${formatUnits(v, asset.decimals)} ${asset.symbol}`;
    const items = [
      { label: "Requested", value: fmt(rec.requested) },
      { label: "Paid", value: fmt(rec.paid) },
      { label: "Outstanding", value: fmt(rec.outstanding) },
    ];
    if (BigInt(rec.pending) > 0n)
      items.push({ label: "Awaiting confirmations", value: fmt(rec.pending) });
    if (BigInt(rec.overpaidBy) > 0n) items.push({ label: "Overpaid", value: fmt(rec.overpaidBy) });
    if (BigInt(rec.unattributed) > 0n)
      items.push({ label: "Not counted", value: fmt(rec.unattributed) });
    return items;
  }, [rec, asset]);

  if (detail.status === 404)
    return (
      <EmptyState
        title="No request with this ID"
        description="Check the link, or find the request in your list."
        action={<Link to={{ name: "requests" }}>Go to payment requests</Link>}
      />
    );

  return (
    <div className="section-stack">
      <Link to={{ name: "requests" }} className="inline-link back-link">
        <ArrowLeft size={15} aria-hidden="true" /> All requests
      </Link>
      <header className="page-head">
        <div className="page-head-copy">
          <h1 tabIndex={-1} data-page-title>
            {data ? <span className="mono">{data.request.reference}</span> : "Payment request"}
          </h1>
          {data && <p className="pre-line">{data.details}</p>}
        </div>
        {rec && <StatusBadge status={rec.status} />}
      </header>
      {detail.error && !data && <Notice tone="error">{detail.error}</Notice>}
      {data && rec && asset && (
        <>
          <MetricStrip items={metrics} />
          <div className="terminal-grid">
            <section className="surface-card card-pad col-8" aria-labelledby="share-title">
              <h2 id="share-title" className="card-title">
                Share with the customer
              </h2>
              <div className="share">
                <QrCode value={link} label={`QR code for the payment link ${link}`} />
                <div className="share-copy">
                  <p className="mono wrap">{link}</p>
                  <div className="actions">
                    <CopyButton value={link} label="Copy link" />
                    <ExternalLink href={link}>Open payment page</ExternalLink>
                  </div>
                  <p className="field-hint">
                    The customer's page checks your ML-DSA-87 signature against the key registered
                    on QoreChain before they pay.
                  </p>
                </div>
              </div>
            </section>
            <section className="surface-card card-pad col-4" aria-labelledby="terms-title">
              <h2 id="terms-title" className="card-title">
                Signed terms
              </h2>
              <KeyValue
                items={[
                  { label: "Amount", value: <Amount value={data.request.amount} asset={asset} /> },
                  {
                    label: "Pay to",
                    value: <span className="mono wrap">{data.request.recipient}</span>,
                  },
                  { label: "Expires", value: <When date={unixDate(data.request.expiresAt)} /> },
                  {
                    label: "Partial payments",
                    value: data.request.partialAllowed ? "Accepted" : "Not accepted",
                  },
                  { label: "Created", value: <When date={new Date(data.createdAt)} /> },
                ]}
              />
            </section>
          </div>
          <section className="section-stack" aria-labelledby="payments-title">
            <div className="section-header">
              <h2 id="payments-title">Payments</h2>
              {(rec.status === "completed" ||
                rec.status === "overpaid" ||
                BigInt(rec.paid) > 0n) && <Link to={{ name: "receipt", id }}>View receipt</Link>}
            </div>
            {data.events.length ? (
              <PaymentsTable
                events={data.events}
                asset={asset}
                minConfirmations={status?.minConfirmations}
              />
            ) : (
              <p className="muted card-pad surface-card">
                No payments yet. This page updates on its own when one arrives.
              </p>
            )}
          </section>
          <Disclosure summary="Signed request data">
            <p className="muted">
              Anyone can re-check this: the request ID is keccak256 of the encoded request, and the
              signature verifies against the merchant's ML-DSA-87 key on QoreChain.
            </p>
            <pre className="pre-json">
              {JSON.stringify(
                { id: data.id, request: data.request, signature: data.signature },
                null,
                2,
              )}
            </pre>
          </Disclosure>
        </>
      )}
    </div>
  );
}
