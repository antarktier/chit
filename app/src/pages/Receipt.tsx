import { verifyReceiptAttestation, type SignedReceipt } from "@chit/core";
import { CircleCheck, CircleX, Download, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiBase, fetchReceipt, message, paths, useApi, type RequestDetail } from "../api";
import { explorerTxUrl, useAsset } from "../chain";
import { Badge, Button, DataTable, EmptyState, type TableColumn } from "../components";
import { dateTime, unixDate } from "../format";
import { verifyReceiptChain } from "../receipt-chain";
import { Link, useApp } from "../state";
import { Amount, ExternalLink, HashText, KeyValue, Notice, StatusBadge, When } from "../ui";
import { useVerification, VerificationLine } from "./Pay";

type Payment = SignedReceipt["receipt"]["payments"][number];

export function Receipt({ id }: { id: string }) {
  const { ep, status } = useApp();
  const [signed, setSigned] = useState<SignedReceipt>();
  const [error, setError] = useState<string>();
  const [chainCheck, setChainCheck] = useState<
    "checking" | "verified" | "mismatch" | "unavailable"
  >("checking");
  const detail = useApi<RequestDetail>(paths.request(id));
  const verification = useVerification(detail.data, id);
  const asset = useAsset(ep, signed?.receipt.request.asset);

  useEffect(() => {
    let live = true;
    fetchReceipt(id)
      .then((r) => live && setSigned(r))
      .catch((e: unknown) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [id]);

  const attested = useMemo(() => {
    if (!signed || !status?.attestationKey) return undefined;
    try {
      return verifyReceiptAttestation(signed, status.attestationKey);
    } catch {
      return false;
    }
  }, [signed, status?.attestationKey]);

  useEffect(() => {
    if (!signed || !status) return;
    let live = true;
    setChainCheck("checking");
    void verifyReceiptChain(signed.receipt, id, ep, status).then(
      (valid) => live && setChainCheck(valid ? "verified" : "mismatch"),
      () => live && setChainCheck("unavailable"),
    );
    return () => {
      live = false;
    };
  }, [signed, id, ep, status]);

  if (error)
    return detail.status === 404 ? (
      <EmptyState
        title="No receipt for this link"
        description="Check the link with the merchant."
      />
    ) : (
      <Notice tone="error">{error}</Notice>
    );
  if (!signed || !asset) return <p className="muted">Loading the receipt…</p>;

  const r = signed.receipt;
  const columns: TableColumn<Payment>[] = [
    {
      key: "tx",
      header: "Transaction",
      render: (p) => {
        const url = explorerTxUrl(ep, p.txHash, p.source);
        const text = <HashText value={p.txHash} label="Transaction" />;
        return url ? <ExternalLink href={url}>{text}</ExternalLink> : text;
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (p) => <Amount value={p.amount} asset={asset} />,
    },
    {
      key: "block",
      header: "Block",
      align: "right",
      render: (p) => <span className="tabular">{BigInt(p.blockHeight).toLocaleString()}</span>,
    },
    { key: "time", header: "Time", render: (p) => dateTime(unixDate(p.blockTime)) },
    { key: "payer", header: "Payer", render: (p) => <HashText value={p.payer} label="Payer" /> },
  ];

  return (
    <div className="pay section-stack receipt">
      <section className="surface-card card-pad" aria-labelledby="receipt-title">
        <div className="pay-amount-row">
          <h1 id="receipt-title" tabIndex={-1} data-page-title>
            <span className="eyebrow">Receipt</span>
            <span className="pay-amount">
              <Amount value={r.paid} asset={asset} maxFraction={asset.decimals} />
            </span>
          </h1>
          <StatusBadge status={r.status} />
        </div>
        {detail.data && verification.state === "valid" && (
          <p className="pre-line">{detail.data.details}</p>
        )}
        <KeyValue
          items={[
            { label: "Reference", value: <span className="mono">{r.request.reference}</span> },
            { label: "Requested", value: <Amount value={r.request.amount} asset={asset} /> },
            ...(BigInt(r.overpaidBy) > 0n
              ? [{ label: "Overpaid by", value: <Amount value={r.overpaidBy} asset={asset} /> }]
              : []),
            { label: "Paid to", value: <span className="mono wrap">{r.request.recipient}</span> },
            ...(!asset.native
              ? [
                  {
                    label: "Token contract",
                    value: <span className="mono wrap">{asset.address}</span>,
                  },
                ]
              : []),
            ...(r.completedAt
              ? [{ label: "Settled", value: <When date={unixDate(r.completedAt.blockTime)} /> }]
              : []),
            { label: "Request ID", value: <span className="mono wrap">{r.requestId}</span> },
            { label: "Issued", value: <When date={new Date(r.issuedAt)} /> },
          ]}
        />
      </section>
      <section className="surface-card card-pad" aria-labelledby="checks-title">
        <h2 id="checks-title" className="card-title">
          Checks done in your browser
        </h2>
        <VerificationLine result={verification} />
        {attested === undefined ? (
          <p className="verify muted">
            The service has no attestation key, so the receipt seal was not checked.
          </p>
        ) : attested ? (
          <p className="verify ok">
            <CircleCheck size={18} aria-hidden="true" />
            <span>
              Sealed by Chit. The ML-DSA-87 attestation matches the service key{" "}
              <HashText value={signed.attestationKey} label="Attestation key" />.
            </span>
          </p>
        ) : (
          <p className="verify bad" role="alert">
            <CircleX size={18} aria-hidden="true" />
            <span>The receipt seal does not verify. Do not rely on this receipt.</span>
          </p>
        )}
        <p className="verify" role="status">
          {chainCheck === "checking" && "Checking the receipt against QoreChain…"}
          {chainCheck === "verified" && "Receipt matches the confirmed QoreChain transactions."}
          {chainCheck === "mismatch" && "The receipt does not match QoreChain. Do not rely on it."}
          {chainCheck === "unavailable" &&
            "Could not check the receipt against QoreChain. Reload to try again."}
        </p>
      </section>
      <section className="section-stack" aria-labelledby="receipt-payments">
        <div className="section-header">
          <h2 id="receipt-payments">Payments</h2>
          <Badge>{r.payments.length}</Badge>
        </div>
        {r.payments.length ? (
          <DataTable
            caption="Payments on this receipt"
            columns={columns}
            rows={r.payments}
            rowKey={(p) => `${p.source}:${p.txHash}:${p.index}`}
          />
        ) : (
          <p className="surface-card card-pad muted">No confirmed payments yet.</p>
        )}
      </section>
      <div className="actions no-print">
        <a
          className="secondary button-link"
          href={`${apiBase}${paths.receipt(id)}?download`}
          download
        >
          <Download size={16} aria-hidden="true" /> Download receipt (JSON)
        </a>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print
        </Button>
        <Link to={{ name: "pay", id }}>Back to the payment page</Link>
      </div>
    </div>
  );
}
