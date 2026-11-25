import { deserializeRequest, verifyRequest, type PaymentRequest } from "@chit/core";
import { CircleCheck, CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { paths, useApi, type RequestDetail } from "../api";
import { explorerTxUrl, keyStatus, useAsset } from "../chain";
import { Button, EmptyState, SegmentedTabs } from "../components";
import { exactUnits, formatUnits, parseAmount, unixDate } from "../format";
import { Link, useApp } from "../state";
import {
  Amount,
  ExternalLink,
  HashText,
  KeyValue,
  Notice,
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
export function useVerification(detail: RequestDetail | undefined) {
  const { ep, status } = useApp();
  const [result, setResult] = useState<Verification>({ state: "checking" });
  useEffect(() => {
    if (!detail || !status) return;
    let live = true;
    setResult({ state: "checking" });
    void (async () => {
      let request: PaymentRequest;
      try {
        request = deserializeRequest(detail.request);
      } catch {
        return { state: "invalid", reason: "The request data is malformed." } as const;
      }
      if (request.payContract.toLowerCase() !== status.chitPay.toLowerCase())
        return {
          state: "invalid",
          reason: "The request names a different payment contract.",
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
      .then((next) => live && setResult(next));
    return () => {
      live = false;
    };
  }, [detail?.id, status?.chitPay, ep]); // eslint-disable-line react-hooks/exhaustive-deps
  return result;
}

export function VerificationLine({ result }: { result: Verification }) {
  if (result.state === "checking")
    return <p className="verify muted">Checking the merchant's signature…</p>;
  if (result.state === "valid")
    return (
      <p className="verify ok">
        <CircleCheck size={18} aria-hidden="true" />
        <span>
          Signed by the merchant. Your browser checked the ML-DSA-87 signature against the key
          registered on QoreChain, so the amount, recipient and reference cannot have been changed.
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
  const verification = useVerification(data);
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
  const expired = rec.status === "expired" || Date.now() / 1000 > Number(data.request.expiresAt);
  const payable = verification.state === "valid" && outstanding > 0n && !expired;
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
      setSent((prev) => [...prev, { hash, source: effectiveMethod === "memo" ? "native" : "evm" }]);
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

      {unseen.length > 0 && (
        <Notice tone="success" title="Payment sent">
          Chit counts it after {status ? formatUnits(status.minConfirmations, 0) : "a few"}{" "}
          confirmations on QoreChain. This page updates on its own.{" "}
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
    </div>
  );
}
