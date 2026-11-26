import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect, test, type Page } from "@playwright/test";
import {
  chitPayAbi,
  deserializeRequest,
  diana,
  EVM_CHAIN_ID,
  generateReference,
  hashDetails,
  NATIVE_ASSET,
  NATIVE_CHAIN_ID,
  referenceToBytes32,
  requestId,
  serializeRequest,
  signRequest,
} from "@chit/core";
import type { MessageSignature } from "@qorechain/qoresign";
import { fetchEvmWindow } from "@qorechain/qoresign/network";
import { openEvmWindowMsg, qorechainRegistry } from "@qorechain/sdk";
import {
  BaseError,
  encodeFunctionData,
  isAddressEqual,
  parseEther,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { checkDiana, dianaEndpoints, evmSend, readJson, writeJson } from "../../scripts/common";
import { chitAccounts } from "../../scripts/identity";
import { requireRegistered, sendNative } from "../../scripts/native";

const origin = "https://chit.antarktier.com";
const api = "https://chit-api.antarktier.com";
const extension = process.env.CHIT_QOREX_DIR ?? "/workspace/tools/qorex/unpacked";
const resultPath = "/tmp/chit-codex/live-result.json";
const shots = "/workspace/chit-shots";
const fromRoot = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const amount = parseEther("0.001");
const windowBudget = 60_000n;
const verified = "Signed by the merchant.";
const payButton = (page: Page) => page.getByRole("button", { name: "Pay 0.001 QOR" });

test("Diana browser payment through ChitPay and native QoreX handoff", async ({
  page,
  request: apiRequest,
}) => {
  const result: Record<string, unknown> = { amountQor: "0.001", status: "failed" };
  const audits: Record<string, string[]> = {};
  const save = () => writeJson(resultPath, { ...result, audits });
  mkdirSync(shots, { recursive: true });

  async function capture(target: Page, name: string) {
    await target.screenshot({ path: `${shots}/live-${name}.png`, fullPage: true });
    const audit = await new AxeBuilder({ page: target })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    audits[name] = audit.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ id }) => id);
    save();
  }

  try {
    expect(dianaEndpoints.evm).toBe(diana.evm);
    expect(dianaEndpoints.rest).toBe(diana.rest);
    await checkDiana();
    const [merchant, recipient] = chitAccounts(false, fromRoot("keys/chit-accounts.json"));
    const deployment = readJson<{ chitPay: Address }>(fromRoot("deployments/diana.json"));
    if (!deployment) throw new Error("Diana deployment metadata is missing");
    await requireRegistered(merchant);
    const details = "Chit live browser payment test";
    const resume = process.env.CHIT_LIVE_REQUEST_ID;
    const previous = readJson<{
      requestId?: string;
      windowTx?: Hex;
      windowTxs?: Hex[];
      evmTx?: Hex;
    }>(resultPath);
    let payment = {
      merchant: merchant.account.address,
      recipient: recipient.account.address,
      asset: NATIVE_ASSET,
      amount,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 900),
      reference: generateReference(),
      detailsHash: hashDetails(details),
      partialAllowed: false,
      payContract: deployment.chitPay,
      chainId: EVM_CHAIN_ID,
    };
    result.stage = "create request";
    let signature: MessageSignature;
    if (resume) {
      expect(resume).toMatch(/^0x[0-9a-f]{64}$/);
      const existing = await apiRequest.get(`${api}/v1/requests/${resume}`);
      expect(existing.ok()).toBe(true);
      const detail = await existing.json();
      const restored = deserializeRequest(detail.request);
      expect(restored).toMatchObject({
        merchant: payment.merchant,
        recipient: payment.recipient,
        asset: payment.asset,
        amount,
        partialAllowed: false,
        detailsHash: payment.detailsHash,
        payContract: payment.payContract,
        chainId: EVM_CHAIN_ID,
      });
      expect(detail.reconciliation.status).toBe("unpaid");
      expect(detail.events).toEqual([]);
      payment = restored;
      signature = detail.signature;
      if (previous?.requestId === resume) {
        expect(previous?.evmTx).toBeUndefined();
        result.windowTxs = previous?.windowTxs ?? (previous?.windowTx ? [previous.windowTx] : []);
      }
    } else {
      signature = signRequest(payment, merchant.classical, merchant.pqc);
      const created = await apiRequest.post(`${api}/v1/requests`, {
        data: { request: serializeRequest(payment), signature, details },
      });
      expect(created.ok(), `Create request HTTP ${created.status()}`).toBe(true);
      expect((await created.json()).id).toBe(requestId(payment));
    }
    const id = requestId(payment);
    if (resume) expect(id).toBe(resume);
    const url = `${origin}/pay/${id}`;
    Object.assign(result, {
      requestId: id,
      url,
      payer: merchant.account.address,
      recipient: payment.recipient,
    });

    result.stage = "native QoreX";
    if (existsSync(`${extension}/manifest.json`)) {
      const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        viewport: { width: 1440, height: 900 },
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      });
      try {
        const worker =
          context.serviceWorkers()[0] ??
          (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
        const native = await context.newPage();
        await native.goto(url);
        await expect(native.getByText(verified)).toBeVisible();
        await expect(payButton(native)).toBeEnabled();
        await capture(native, "qorex");
        const canSend = await native.evaluate(
          () =>
            typeof (
              document.defaultView as Window & {
                qorex?: { native?: { signAndBroadcast?: unknown } };
              }
            ).qorex?.native?.signAndBroadcast === "function",
        );
        await payButton(native).click();
        if (canSend) {
          const handoff = await Promise.race([
            context.waitForEvent("page", { timeout: 5000 }).then(async (popup) => {
              await popup.waitForLoadState();
              return popup.url().startsWith(`chrome-extension://${new URL(worker.url()).host}/`)
                ? "extension page opened"
                : "browser opened another page";
            }),
            native
              .getByRole("alert")
              .waitFor({ timeout: 5000 })
              .then(async () => (await native.getByRole("alert").innerText()).split("\n")[0]),
          ]).catch(() => "No visible approval in the fresh profile");
          result.nativeHandoff = handoff;
          await capture(native, "qorex-handoff");
        } else {
          await expect(
            native.getByText("Update QoreX to a version that can send QoreChain transactions."),
          ).toBeVisible();
          await capture(native, "qorex-update");
        }
        result.native = {
          worker: worker.url(),
          canSend,
          status: canSend
            ? "Wallet setup and human approval required"
            : "Extension lacks native send method",
        };
      } finally {
        await context.close();
      }
    } else {
      await page.goto(url);
      await expect(page.getByRole("link", { name: "QoreX wallet" })).toBeVisible();
      await expect(payButton(page)).toBeDisabled();
      await capture(page, "qorex-missing");
      result.native = { status: "Install QoreX, set up a Diana account and approve the payment" };
    }
    save();

    result.stage = "open EVM window";
    // The signing account has funds for the authorization fee. The other Chit account receives the payment.
    const window = await fetchEvmWindow({ rest: diana.rest, address: merchant.bech32 });
    if (
      !window.live ||
      window.remainingTxs < 1n ||
      BigInt(window.remainingValue) < windowBudget ||
      !window.allowedTargets.some(
        (target) => target.toLowerCase() === payment.payContract.toLowerCase(),
      )
    ) {
      // Diana counts the gas allowance as well as the transfer value against the window.
      const windowTx = await sendNative(
        merchant,
        qorechainRegistry().encodeAsAny(
          openEvmWindowMsg({
            sender: merchant.bech32,
            blocks: 120n,
            maxTxs: 1n,
            maxValue: windowBudget,
            allowedTargets: [payment.payContract],
          }),
        ),
      );
      result.windowTxs = [...((result.windowTxs as Hex[] | undefined) ?? []), windowTx];
      save();
    }

    result.stage = "browser EVM payment";
    if (!signature.pq) throw new Error("Missing merchant ML-DSA-87 signature");
    const data = encodeFunctionData({
      abi: chitPayAbi,
      functionName: "payNative",
      args: [
        { ...payment, paymentRef: referenceToBytes32(payment.reference) },
        toHex(Buffer.from(signature.pq.signature, "base64")),
      ],
    });
    let submitted = false;
    await page.exposeBinding(
      "chitLiveWallet",
      async (
        { frame },
        tx: {
          from: Address;
          to: Address;
          value: Hex;
          data: Hex;
        },
      ) => {
        if (
          frame !== page.mainFrame() ||
          frame.url() !== url ||
          submitted ||
          !isAddressEqual(tx.from, merchant.account.address) ||
          !isAddressEqual(tx.to, payment.payContract) ||
          BigInt(tx.value) !== amount ||
          tx.data !== data
        ) {
          throw new Error("Live wallet refused an unexpected transaction");
        }
        submitted = true;
        result.walletBinding = "validated";
        save();
        const receipt = await evmSend(
          merchant.account,
          { to: payment.payContract, value: amount, data },
          (hash) => {
            result.evmTx = hash;
            save();
          },
        ).catch((error: unknown) => {
          result.walletError =
            error instanceof Error ? error.message.split("\n")[0] : "Wallet RPC failed";
          if (error instanceof BaseError && error.details) {
            result.rpcDetails = error.details.replace(/(?:0x)?[a-f0-9]{64,}/gi, "[hex omitted]");
          }
          save();
          throw new Error(String(result.walletError));
        });
        return receipt.transactionHash;
      },
    );
    await page.addInitScript(
      ({ account, chainId, nativeChain, bech32, url }) => {
        const view = document.defaultView;
        if (!view || location.href !== url || view.top !== view) return;
        const injected = view as Window & {
          chitLiveWallet?: (tx: unknown) => Promise<string>;
        };
        // The app checks native identity before connecting the EVM provider.
        Object.defineProperty(window, "qorex", {
          value: {
            native: {
              enable: (chain: string) => {
                if (chain !== nativeChain) throw new Error("Expected Diana");
              },
              getKey: () => ({ bech32Address: bech32 }),
            },
          },
        });
        Object.defineProperty(window, "ethereum", {
          value: {
            request: ({ method, params }: { method: string; params?: unknown[] }) => {
              switch (method) {
                case "eth_requestAccounts":
                case "eth_accounts":
                  return [account];
                case "eth_chainId":
                  return chainId;
                case "eth_sendTransaction":
                  return injected.chitLiveWallet?.(params?.[0]);
                default:
                  throw new Error(`Unsupported wallet method: ${method}`);
              }
            },
          },
        });
      },
      {
        account: merchant.account.address,
        chainId: toHex(EVM_CHAIN_ID),
        nativeChain: NATIVE_CHAIN_ID,
        bech32: merchant.bech32,
        url,
      },
    );

    await page.goto(url);
    await expect(page.getByText(verified)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Payment request 0\.001 QOR/ })).toBeVisible();
    await expect(page.getByText(payment.recipient, { exact: true })).toBeVisible();
    await expect(page.getByText(payment.reference, { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "ChitPay contract" }).click();
    await capture(page, "evm-unpaid");
    await payButton(page).click();
    const paidLabel = page.getByText("Paid in full", { exact: true });
    const walletError = page.getByRole("alert");
    await expect(paidLabel.or(walletError)).toBeVisible({ timeout: 55_000 });
    if (await walletError.isVisible()) {
      result.uiError = await walletError.innerText();
      await capture(page, "evm-error");
      throw new Error(String(result.uiError));
    }
    await capture(page, "evm-paid");
    const paid = await apiRequest.get(`${api}/v1/requests/${id}`);
    expect(paid.ok()).toBe(true);
    expect(await paid.json()).toMatchObject({
      reconciliation: { status: "completed", paid: amount.toString(), outstanding: "0" },
      events: expect.arrayContaining([
        expect.objectContaining({ source: "evm", txHash: result.evmTx }),
      ]),
    });
    result.apiStatus = "completed";
    expect(Object.values(audits).flat()).toEqual([]);
    result.status = "passed";
    delete result.stage;
  } finally {
    save();
  }
});
