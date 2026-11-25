import {
  deserializeRequest,
  EVM_CHAIN_ID,
  hashDetails,
  requestId,
  verifyRequest,
  type PaymentRequest,
} from "@chit/core";
import { CircleCheck, CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { paths, reportPayment, useApi, type RequestDetail } from "../api";
import { explorerTxUrl, keyStatus, useAsset } from "../chain";
import { Button, EmptyState, SegmentedTabs } from "../components";
import { exactUnits, formatCount, formatUnits, parseAmount, unixDate } from "../format";
import { Link, useApp } from "../state";
import {
  Amount,
  CopyButton,
  ExternalLink,
  HashText,
  KeyValue,
  Notice,
  QrCode,
  StatusBadge,
  TextField,
  When,
} from "../ui";
import { hasQorex, paymentError, payWithContract, payWithMemo } from "../wallet";

type Verification =
  | { state: "checking" }
  | { state: "valid" }
  | { state: "invalid"; reason: string };

/** Verifies the merchant's ML-DSA-87 signature in this browser, against the key registered on chain. */
export function useVerification(detail: RequestDetail | undefined, id: string): Verification {
  const { ep, status } = useApp();
  const contract = status?.chitPay;
  const payload =
    detail &&
    JSON.stringify({
      id: detail.id,
      request: detail.request,
      details: detail.details,
      signature: detail.signature,
    });
  const snapshot = JSON.stringify([id, contract, payload, ep]);
  const [checked, setChecked] = useState<{ snapshot: string; result: Verification }>();
  useEffect(() => {
    if (!payload || !contract) return;
    const detail = JSON.parse(payload) as Pick<
      RequestDetail,
      "id" | "request" | "details" | "signature"
    >;
    let live = true;
    void (async () => {
      let request: PaymentRequest;
      try {
        request = deserializeRequest(detail.request);
      } catch {
        return { state: "invalid", reason: "The request data is malformed." } as const;
      }
      if (
        request.chainId !== EVM_CHAIN_ID ||
        request.payContract.toLowerCase() !== contract.toLowerCase()
      )
        return {
          state: "invalid",
          reason: "The request names a different payment contract.",
        } as const;
      if (
        detail.id !== id ||
        requestId(request) !== id ||
        hashDetails(detail.details) !== request.detailsHash
      )
        return {
          state: "invalid",
          reason: "The link or payment details do not match the signed request.",
        } as const;
      const key = await keyStatus(ep, request.merchant);
      if (!key.registered || !key.possessionProven || !key.publicKey)
        return {
          state: "invalid",
          reason: "The merchant has no registered ML-DSA-87 key on QoreChain.",
        } as const;
      return verifyRequest(request, detail.signature, key.publicKey)
        ? ({ state: "valid" } as const)
        : ({
            state: "invalid",
            reason: "The signature does not match the merchant's registered key.",
          } as const);
    })()
      .catch(
        () =>
          ({
            state: "invalid",
            reason: "The merchant's key could not be read from QoreChain.",
          }) as const,
      )
      .then((result) => live && setChecked({ snapshot, result }));
    return () => {
      live = false;
    };
  }, [payload, contract, id, ep, snapshot]);
  return checked?.snapshot === snapshot ? checked.result : { state: "checking" };
}

export function VerificationLine({ result }: { result: Verification }) {
  if (result.state === "checking")
    return <p className="verify muted">Checking the merchant's signature…</p>;
  if (result.state === "valid")
    return (
      <p className="verify ok">
        <CircleCheck size={18} aria-hidden="true" />
        <span>
          Signed by the merchant. Your browser verified the signature against their registered
          QoreChain key.
        </span>
      </p>
    );
  return (
    <p className="verify bad" role="alert">
      <CircleX size={18} aria-hidden="true" />
      <span>Do not pay this request. {result.reason}</span>
    </p>
  );
}

type Method = "memo" | "contract";

export function Pay({ id }: { id: string }) {
  const { ep, status } = useApp();
  const detail = useApi<RequestDetail>(paths.request(id), 4000);
  const data = detail.data;
  const asset = useAsset(ep, data?.request.asset);
  const verification = useVerification(data, id);
  const request = useMemo(() => {
    try {
      return data ? deserializeRequest(data.request) : undefined;
    } catch {
      return undefined;
    }
  }, [data]);
  const local = ep.environment === "LOCAL DEVNET";
  const native = asset?.native ?? false;
  const [method, setMethod] = useState<Method>("memo");
  const effectiveMethod: Method = !native || local ? "contract" : method;
  const [amountText, setAmountText] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<{ hash: Hex; source: "evm" | "native" }[]>([]);

  if (detail.status === 404)
    return (
      <EmptyState
        title="This payment link is not valid"
        description="Ask the merchant to send the link again."
      />
    );
  if (!data || !asset || !request)
    return detail.error ? (
      <Notice tone="error">{detail.error}</Notice>
    ) : (
      <p className="muted">Loading the request…</p>
    );

  const rec = data.reconciliation;
  const outstanding = BigInt(rec.outstanding);
  const expired =
    rec.status === "expired" || BigInt(Math.floor(Date.now() / 1000)) > request.expiresAt;
  const payable =
    verification.state === "valid" && outstanding > 0n && !expired && !asset.metadataUnavailable;
  const amountInput = amountText ?? exactUnits(outstanding, asset.decimals);
  const parsed = parseAmount(
    amountInput,
    asset.decimals,
    effectiveMethod === "memo" ? 6 : asset.decimals,
  );
  const amountError = !parsed.ok
    ? parsed.error
    : parsed.value > outstanding
      ? "That is more than what is still owed."
      : !request.partialAllowed && parsed.value !== outstanding
        ? "This request needs one payment of the full outstanding amount."
        : undefined;

  async function pay() {
    if (!parsed.ok || amountError || !request) return;
    setError(undefined);
    setBusy("Confirm the payment in your wallet");
    try {
      const hash =
        effectiveMethod === "memo"
          ? await payWithMemo(request, data!.id, parsed.value)
          : await payWithContract({
              ep,
              request,
              id: data!.id,
              signature: data!.signature,
              amount: parsed.value,
              onStep: setBusy,
            });
      const source = effectiveMethod === "memo" ? "native" : "evm";
      setSent((prev) => [...prev, { hash, source }]);
      // Ask the service to index it now; the page keeps polling either way.
      void reportPayment(hash, source).catch(() => undefined);
      setAmountText(undefined);
    } catch (e) {
      setError(paymentError(e));
    } finally {
      setBusy(undefined);
    }
  }

  const unseen = sent.filter(
    (s) => !data.events.some((e) => e.txHash.toLowerCase() === s.hash.toLowerCase()),
  );
  const paidAny = BigInt(rec.paid) > 0n;
  const link = new URL(`/pay/${id}`, window.location.origin).href;

  return (
    <div className="pay section-stack">
      <section className="surface-card card-pad pay-head" aria-labelledby="pay-title">
        <div className="pay-amount-row">
          <h1 id="pay-title" tabIndex={-1} data-page-title>
            <span className="eyebrow">Payment request</span>
            <span className="pay-amount">
              <Amount value={data.request.amount} asset={asset} maxFraction={asset.decimals} />
            </span>
          </h1>
          <StatusBadge status={rec.status} />
        </div>
        <p className="pre-line">{data.details}</p>
        <VerificationLine result={verification} />
        <KeyValue
          items={[
            { label: "Reference", value: <span className="mono">{data.request.reference}</span> },
            { label: "Pay to", value: <span className="mono wrap">{data.request.recipient}</span> },
            ...(!asset.native
              ? [
                  {
                    label: "Token contract",
                    value: <span className="mono wrap">{asset.address}</span>,
                  },
                ]
              : []),
            {
              label: "Merchant key",
              value: <span className="mono wrap">{data.request.merchant}</span>,
            },
            { label: "Expires", value: <When date={unixDate(data.request.expiresAt)} /> },
            ...(paidAny || BigInt(rec.pending) > 0n
              ? [
                  { label: "Paid so far", value: <Amount value={rec.paid} asset={asset} /> },
                  { label: "Still owed", value: <Amount value={rec.outstanding} asset={asset} /> },
                ]
              : []),
            ...(BigInt(rec.pending) > 0n
              ? [
                  {
                    label: "Awaiting confirmations",
                    value: <Amount value={rec.pending} asset={asset} />,
                  },
                ]
              : []),
          ]}
        />
      </section>

      {status &&
        data.events
          .filter((event) => event.class === "pending")
          .map((event) => (
            <Notice
              key={event.key}
              title={`${formatUnits(event.confirmations, 0)} of ${formatCount(status.minConfirmations, "confirmation")}`}
            >
              <Amount value={event.amount} asset={asset} />
            </Notice>
          ))}
      {unseen.length > 0 && (
        <Notice tone="success" title="Payment sent">
          Chit counts it after{" "}
          {status ? formatCount(status.minConfirmations, "confirmation") : "a few confirmations"} on
          QoreChain. This page updates on its own.{" "}
          {unseen.map((s) => {
            const url = explorerTxUrl(ep, s.hash, s.source);
            return url ? (
              <ExternalLink key={s.hash} href={url}>
                View transaction
              </ExternalLink>
            ) : (
              <HashText key={s.hash} value={s.hash} label="Transaction" />
            );
          })}
        </Notice>
      )}

      {(rec.status === "completed" || rec.status === "overpaid") && (
        <Notice
          tone="success"
          title={rec.status === "completed" ? "Paid in full" : "Paid, with an overpayment"}
        >
          {rec.status === "overpaid" &&
            `The merchant received ${formatUnits(rec.overpaidBy, asset.decimals)} ${asset.symbol} more than requested and can refund it. `}
          <Link to={{ name: "receipt", id: data.id }}>View the receipt</Link>
        </Notice>
      )}
      {expired && outstanding > 0n && (
        <Notice tone="warn" title="This request has expired">
          Payments sent now do not count toward it. Ask the merchant for a new request.
        </Notice>
      )}
      {asset.metadataUnavailable && outstanding > 0n && !expired && (
        <Notice tone="warn" title="Token details unavailable">
          Reload the page before paying. Amounts shown here are in the token's smallest unit.
        </Notice>
      )}

      {payable && (
        <section className="surface-card card-pad" aria-labelledby="method-title">
          <h2 id="method-title" className="card-title">
            Pay
          </h2>
          {local ? (
            <p className="muted">
              Local devnet: pays from the test payer account through the ChitPay contract.
            </p>
          ) : native ? (
            <SegmentedTabs<Method>
              label="Payment method"
              value={method}
              onChange={setMethod}
              options={[
                { value: "memo", label: "QoreX transfer" },
                { value: "contract", label: "ChitPay contract" },
              ]}
            />
          ) : null}
          {!local && (
            <p className="field-hint">
              {effectiveMethod === "memo"
                ? "QoreX sends QOR straight to the merchant with a memo that links it to this request. QoreX adds the hybrid ML-DSA-87 signature."
                : "The ChitPay contract checks the merchant's signature on chain, then forwards the funds to the merchant in the same transaction. Needs an open EVM authorization window in QoreX."}
            </p>
          )}
          <TextField
            label={`Amount in ${asset.symbol}`}
            hint={request.partialAllowed ? "You can pay part now and the rest later." : undefined}
            inputMode="decimal"
            value={amountInput}
            onChange={setAmountText}
            error={amountText !== undefined ? amountError : undefined}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="actions">
            <Button
              disabled={
                Boolean(busy) ||
                Boolean(amountError) ||
                unseen.length > 0 ||
                BigInt(rec.pending) > 0n ||
                (!local && effectiveMethod === "memo" && !hasQorex())
              }
              onClick={() => void pay()}
            >
              {busy ??
                `Pay ${parsed.ok ? formatUnits(parsed.value, asset.decimals, asset.decimals) : ""} ${asset.symbol}`}
            </Button>
          </div>
          {!local && !hasQorex() && (
            <p className="field-hint">
              Install the <ExternalLink href="https://www.qorechain.io">QoreX wallet</ExternalLink>{" "}
              to pay from this browser.
            </p>
          )}
        </section>
      )}
      {verification.state === "valid" && payable && (
        <section className="surface-card card-pad" aria-labelledby="pay-share-title">
          <h2 className="card-title" id="pay-share-title">
            Share this request
          </h2>
          <div className="share">
            <QrCode value={link} label="QR code for the payment link" />
            <div className="actions">
              <CopyButton value={link} label="Copy link" />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
