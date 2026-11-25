import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { keyStatus, nativeBalanceUqor, type KeyStatus } from "../chain";
import {
  Badge,
  Button,
  ConfirmDialog,
  Disclosure,
  FieldGroup,
  GroupedList,
  SegmentedTabs,
  SettingRow,
  ToggleSwitch,
} from "../components";
import { formatUnits } from "../format";
import {
  devKey,
  isValidPhrase,
  keyFromPhrase,
  newPhrase,
  registerKey,
  registrationFeeUqor,
} from "../signer";
import { useApp } from "../state";
import { CopyButton, ExternalLink, Notice, TextField } from "../ui";
import { hasQorex, sendFromQorex } from "../wallet";

/** Enough for the registration fee plus a margin; the rest stays on the key. */
const FUNDING_UQOR = 100_000n;

function SetupKey() {
  const { status, setKey } = useApp();
  const local = status?.environment === "LOCAL DEVNET";
  const [mode, setMode] = useState<"create" | "import">("create");
  const [phrase, setPhrase] = useState(() => newPhrase());
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string>();

  const words = phrase.split(" ");
  return (
    <div className="section-stack narrow">
      {local && (
        <Notice title="Local devnet">
          The devnet script registers a test merchant key in the test-only PQC mock.{" "}
          <Button variant="text" onClick={() => setKey(devKey(), false)}>
            Use the devnet merchant key
          </Button>
        </Notice>
      )}
      <SegmentedTabs
        label="How to add a signing key"
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(undefined);
        }}
        options={[
          { value: "create", label: "Create a new key" },
          { value: "import", label: "Use a recovery phrase" },
        ]}
      />
      {mode === "create" ? (
        <div className="surface-card card-pad">
          <h2 className="card-title">Your recovery phrase</h2>
          <p className="muted">
            These 24 words are the only way to restore this key. Write them down and keep them
            offline. Anyone with them can sign requests in your name.
          </p>
          <ol className="phrase" aria-label="Recovery phrase">
            {words.map((word, i) => (
              <li key={i}>
                <span className="phrase-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="mono">{word}</span>
              </li>
            ))}
          </ol>
          <div className="actions">
            <CopyButton value={phrase} label="Copy phrase" />
            <Button variant="text" onClick={() => setPhrase(newPhrase())}>
              Generate different words
            </Button>
          </div>
          <GroupedList>
            <ToggleSwitch
              label="I have written down my recovery phrase"
              checked={saved}
              onChange={setSaved}
            />
            <ToggleSwitch
              label="Keep the key on this device"
              checked={remember}
              onChange={setRemember}
            />
          </GroupedList>
          <p className="field-hint">
            Off: the key is forgotten when you close this tab. On: it stays in this browser's
            storage until you remove it.
          </p>
          <div className="actions">
            <Button disabled={!saved} onClick={() => setKey(keyFromPhrase(phrase), remember)}>
              Use this key
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="surface-card card-pad"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValidPhrase(typed)) {
              setError("Enter all 12 or 24 words in order, separated by spaces.");
              return;
            }
            setKey(keyFromPhrase(typed), remember);
          }}
        >
          <TextField
            label="Recovery phrase"
            hint="12 or 24 words. They stay in this browser."
            multiline
            mono
            value={typed}
            onChange={(next) => {
              setTyped(next);
              setError(undefined);
            }}
            error={error}
          />
          <GroupedList>
            <ToggleSwitch
              label="Keep the key on this device"
              checked={remember}
              onChange={setRemember}
            />
          </GroupedList>
          <div className="actions">
            <Button type="submit">Use this key</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function SigningKeyPage() {
  const { key, ep, status, setKey, remembered } = useApp();
  const [chain, setChain] = useState<{ status?: KeyStatus; balance?: bigint; error?: string }>({});
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; tx?: string }>();
  const [confirmForget, setConfirmForget] = useState(false);
  const local = ep.environment === "LOCAL DEVNET";

  const refresh = useCallback(async () => {
    if (!key || !status) return;
    try {
      const [s, balance] = await Promise.all([
        keyStatus(ep, key.address),
        nativeBalanceUqor(ep, key.address).catch(() => undefined),
      ]);
      setChain({ status: s, balance });
    } catch {
      setChain({ error: "Could not read this key's status from QoreChain. Try again shortly." });
    }
  }, [key, ep, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!key) return <SetupKey />;

  const registered = chain.status?.registered && chain.status.possessionProven;
  const needsFunds =
    !local && !registered && chain.balance !== undefined && chain.balance < registrationFeeUqor;

  async function run(label: string, action: () => Promise<string>, done: string) {
    setBusy(label);
    setNotice(undefined);
    try {
      const tx = await action();
      setNotice({ tone: "success", text: done, tx });
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        await refresh();
      }
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The transaction failed.",
      });
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="section-stack narrow">
      {notice && (
        <Notice tone={notice.tone}>
          {notice.text}
          {notice.tx && !local && (
            <>
              {" "}
              <ExternalLink
                href={`${ep.explorer}/tx/${notice.tx.slice(2).toUpperCase()}?network=testnet`}
              >
                View transaction
              </ExternalLink>
            </>
          )}
        </Notice>
      )}
      {chain.error && <Notice tone="error">{chain.error}</Notice>}
      <FieldGroup label="Key">
        <GroupedList>
          <SettingRow
            label="QoreChain address"
            value={<span className="mono wrap">{key.bech32}</span>}
            trailing={<CopyButton value={key.bech32} label="Copy" />}
          />
          <SettingRow
            label="EVM address"
            value={<span className="mono wrap">{key.address}</span>}
          />
          <SettingRow label="Algorithms" value="ML-DSA-87 (FIPS 204) with secp256k1" />
          <SettingRow
            label="Stored"
            value={
              key.kind === "dev"
                ? "Devnet test key"
                : remembered
                  ? "On this device until removed"
                  : "Until this tab closes"
            }
          />
        </GroupedList>
      </FieldGroup>
      <FieldGroup label="On QoreChain">
        <GroupedList>
          <SettingRow
            label="ML-DSA-87 registration"
            value={
              chain.status === undefined ? (
                "Checking…"
              ) : registered ? (
                <Badge tone="success">Registered with proof of possession</Badge>
              ) : chain.status.registered ? (
                <Badge tone="warn">Registered without proof of possession</Badge>
              ) : (
                <Badge tone="warn">Not registered</Badge>
              )
            }
          />
          {!local && chain.balance !== undefined && (
            <SettingRow
              label="Balance for network fees"
              value={<span className="tabular">{formatUnits(chain.balance, 6)} QOR</span>}
            />
          )}
        </GroupedList>
      </FieldGroup>
      {!registered && chain.status && !local && (
        <div className="surface-card card-pad">
          <h2 className="card-title">Register the key</h2>
          <p className="muted">
            Customers and the ChitPay contract check your request signatures against the key
            registered for this address. Registration costs about{" "}
            {formatUnits(registrationFeeUqor, 6)} QOR in fees.
          </p>
          {needsFunds && (
            <>
              <p>
                Step 1: send {formatUnits(FUNDING_UQOR, 6)} QOR to this key from your QoreX wallet.
              </p>
              <div className="actions">
                <Button
                  disabled={Boolean(busy) || !hasQorex()}
                  onClick={() =>
                    void run(
                      "fund",
                      () => sendFromQorex({ to: key.bech32, uqor: FUNDING_UQOR }),
                      "QOR sent. The balance updates after the next block.",
                    )
                  }
                >
                  {busy === "fund"
                    ? "Waiting for QoreX…"
                    : `Send ${formatUnits(FUNDING_UQOR, 6)} QOR from QoreX`}
                </Button>
                {!hasQorex() && (
                  <span className="field-hint">
                    QoreX is not installed in this browser. Send QOR to the address above from any
                    wallet.
                  </span>
                )}
              </div>
            </>
          )}
          <div className="actions">
            <Button
              disabled={Boolean(busy) || needsFunds}
              onClick={() =>
                void run(
                  "register",
                  () => registerKey(ep, key),
                  "Registration sent. It takes effect after the next block.",
                )
              }
            >
              {busy === "register"
                ? "Registering…"
                : needsFunds
                  ? "Step 2: register the key"
                  : "Register the key"}
            </Button>
          </div>
        </div>
      )}
      {key.phrase && (
        <Disclosure summary="Show recovery phrase">
          <p className="muted">Anyone with these words can sign requests as you.</p>
          <p className="mono wrap">{key.phrase}</p>
        </Disclosure>
      )}
      <div className="actions">
        <Button variant="text" danger onClick={() => setConfirmForget(true)}>
          <KeyRound size={15} aria-hidden="true" />
          Remove key from this browser
        </Button>
      </div>
      <ConfirmDialog
        open={confirmForget}
        title="Remove the signing key?"
        description="You can add it again with its recovery phrase. Requests you already signed stay valid."
        confirmLabel="Remove key"
        onConfirm={() => {
          setConfirmForget(false);
          setKey(undefined);
        }}
        onCancel={() => setConfirmForget(false)}
      />
    </div>
  );
}
