import {
  EVM_CHAIN_ID,
  fromBech32,
  generateReference,
  hashDetails,
  NATIVE_ASSET,
  serializeRequest,
  signRequest,
  type PaymentRequest,
} from "@chit/core";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { createRequest, message, ApiError } from "../api";
import { assetInfo, keyStatus, QOR, type AssetInfo } from "../chain";
import {
  Button,
  ErrorBanner,
  GroupedList,
  Select,
  ToggleSwitch,
  type ErrorItem,
} from "../components";
import { formatCount, parseAmount } from "../format";
import { Link, useApp } from "../state";
import { Notice, TextField } from "../ui";
import { connectQorex, hasQorex } from "../wallet";

const expiryOptions = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "1 day" },
  { value: "604800", label: "7 days" },
  { value: "2592000", label: "30 days" },
];

export function parseRecipient(text: string): Address | undefined {
  const value = text.trim();
  try {
    if (/^qor1[0-9a-z]+$/.test(value)) return fromBech32(value);
    if (isAddress(value, { strict: false })) return getAddress(value);
  } catch {
    return undefined;
  }
  return undefined;
}

type Field = "amount" | "token" | "recipient" | "details";

export function NewRequest() {
  const { key, status, ep, navigate } = useApp();
  const [assetKind, setAssetKind] = useState<"native" | "token">("native");
  const [tokenText, setTokenText] = useState("");
  const [token, setToken] = useState<AssetInfo>();
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [details, setDetails] = useState("");
  const [expiry, setExpiry] = useState("604800");
  const [partial, setPartial] = useState(false);
  const [reference, setReference] = useState(() => generateReference());
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState<boolean>();

  useEffect(() => {
    if (!key || !status) return;
    let live = true;
    keyStatus(ep, key.address)
      .then((s) => live && setRegistered(s.registered && s.possessionProven))
      .catch(() => live && setRegistered(undefined));
    return () => {
      live = false;
    };
  }, [key, ep, status]);

  useEffect(() => {
    setToken(undefined);
    if (assetKind !== "token" || !isAddress(tokenText.trim(), { strict: false })) return;
    let live = true;
    assetInfo(ep, tokenText.trim())
      .then((info) => live && setToken(info))
      .catch(
        () =>
          live &&
          setErrors((e) => ({ ...e, token: "No ERC-20 token at this address on QoreChain." })),
      );
    return () => {
      live = false;
    };
  }, [assetKind, tokenText, ep]);

  const summary = useMemo<ErrorItem[]>(
    () =>
      (Object.entries(errors) as [Field, string | undefined][])
        .filter((entry): entry is [Field, string] => Boolean(entry[1]))
        .map(([field, text]) => ({ message: text, target: `field-${field}` })),
    [errors],
  );

  if (!key)
    return (
      <Notice title="Add a signing key first">
        Requests are signed with your ML-DSA-87 key.{" "}
        <Link to={{ name: "key" }}>Set up a signing key</Link>
      </Notice>
    );

  const asset = assetKind === "native" ? QOR : token;

  function validate() {
    const next: Partial<Record<Field, string>> = {};
    if (assetKind === "token" && !token)
      next.token = "Enter the contract address of an ERC-20 token on QoreChain.";
    const decimals = asset?.decimals ?? 18;
    const parsed = parseAmount(amount, decimals, asset?.native ? 6 : Math.min(decimals, 18));
    if (!parsed.ok) next.amount = parsed.error;
    if (!parseRecipient(recipient))
      next.recipient = "Enter a QoreChain address (qor1…) or an EVM address (0x…).";
    if (!details.trim())
      next.details = "Describe what the payment is for, for example an invoice number.";
    setErrors(next);
    return { ok: Object.keys(next).length === 0, value: parsed.ok ? parsed.value : 0n };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(undefined);
    const { ok, value } = validate();
    if (!ok || !key || !status || !asset) return;
    setBusy(true);
    try {
      const request: PaymentRequest = {
        merchant: key.address,
        recipient: parseRecipient(recipient)!,
        asset: asset.native ? NATIVE_ASSET : asset.address,
        amount: value,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + Number(expiry)),
        reference,
        detailsHash: hashDetails(details.trim()),
        partialAllowed: partial,
        payContract: getAddress(status.chitPay),
        chainId: EVM_CHAIN_ID,
      };
      const signature = signRequest(request, key.classical, key.pq);
      const created = await createRequest({
        request: serializeRequest(request),
        signature,
        details: details.trim(),
      });
      navigate({ name: "request", id: created.id.toLowerCase() });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setReference(generateReference());
        setSubmitError(
          "That reference was already used. A new reference was generated; submit again.",
        );
      } else setSubmitError(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="section-stack narrow" onSubmit={(e) => void submit(e)} noValidate>
      {registered === false && (
        <Notice tone="warn" title="Your signing key is not registered on QoreChain">
          Customers cannot verify requests until it is.{" "}
          <Link to={{ name: "key" }}>Register the key</Link>
        </Notice>
      )}
      <ErrorBanner errors={summary} />
      {submitError && <Notice tone="error">{submitError}</Notice>}
      <div className="surface-card card-pad">
        <div className="form-row">
          <div className="form-field">
            <span className="field-label" aria-hidden="true">
              Asset
            </span>
            <Select<"native" | "token">
              label="Asset"
              hideLabel
              value={assetKind}
              onChange={setAssetKind}
              options={[
                { value: "native", label: "QOR (native)" },
                { value: "token", label: "ERC-20 token" },
              ]}
            />
          </div>
          <div id="field-amount">
            <TextField
              label={`Amount${asset ? ` in ${asset.symbol}` : ""}`}
              hint={asset?.native ? "Up to 6 decimal places." : undefined}
              inputMode="decimal"
              value={amount}
              onChange={setAmount}
              error={errors.amount}
              required
            />
          </div>
        </div>
        {assetKind === "token" && (
          <div id="field-token">
            <TextField
              label="Token contract address"
              hint={
                token
                  ? `${token.symbol}, ${formatCount(token.decimals, "decimal place")}`
                  : "The ERC-20 contract on QoreChain EVM (0x…)."
              }
              value={tokenText}
              onChange={(next) => {
                setTokenText(next);
                setErrors((e) => ({ ...e, token: undefined }));
              }}
              error={errors.token}
              mono
            />
          </div>
        )}
        <div id="field-recipient">
          <TextField
            label="Pay to"
            hint="The address that receives the funds. Chit never holds them."
            value={recipient}
            onChange={setRecipient}
            error={errors.recipient}
            mono
            required
          />
        </div>
        {hasQorex() && (
          <div className="actions">
            <Button
              variant="text"
              onClick={() =>
                void connectQorex()
                  .then((account) => setRecipient(account.bech32))
                  .catch((error: unknown) => setSubmitError(message(error)))
              }
            >
              Use my QoreX address
            </Button>
          </div>
        )}
        <div id="field-details">
          <TextField
            label="What is it for?"
            hint="Shown to the customer and bound to the signature. Up to 2,000 characters."
            multiline
            maxLength={2000}
            value={details}
            onChange={setDetails}
            error={errors.details}
            required
          />
        </div>
        <div className="form-row">
          <div className="form-field">
            <span className="field-label" aria-hidden="true">
              Expires after
            </span>
            <Select
              label="Expires after"
              hideLabel
              value={expiry}
              onChange={setExpiry}
              options={expiryOptions}
            />
          </div>
          <div className="form-field">
            <span className="field-label">Reference</span>
            <div className="reference-row">
              <output className="mono reference" aria-label="Payment reference">
                {reference}
              </output>
              <Button
                variant="secondary"
                size="compact"
                shape="control"
                onClick={() => setReference(generateReference())}
                aria-label="Generate a new reference"
              >
                <RefreshCw size={15} aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
        <GroupedList>
          <ToggleSwitch label="Accept partial payments" checked={partial} onChange={setPartial} />
        </GroupedList>
      </div>
      <div className="actions">
        <Button type="submit" disabled={busy || !status}>
          {busy ? "Signing and saving…" : "Sign and create request"}
        </Button>
      </div>
    </form>
  );
}
