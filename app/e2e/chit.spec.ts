import { mkdir, readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  EVM_CHAIN_ID,
  generateReference,
  hashDetails,
  NATIVE_ASSET,
  serializeRequest,
  signRequest,
} from "@chit/core";
import { bytesToHex, parseEther, type Address } from "viem";
import { devIdentity } from "../src/dev-keys";

const shots = process.env.CHIT_SCREENSHOTS;
const api = `http://127.0.0.1:${process.env.CHIT_E2E_API_PORT ?? "48787"}`;
const rpc = `http://127.0.0.1:${process.env.CHIT_E2E_RPC_PORT ?? "48545"}`;
const RECIPIENT = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // Anvil account 3

async function audit(page: Page, label: string) {
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(width.content, label).toBeLessThanOrEqual(width.viewport);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.screenshot({
    path: `${shots}/${name}-${test.info().project.name}.png`,
    fullPage: true,
  });
}

test("merchant signs a request, customer pays in two parts, receipt verifies", async ({
  page,
  request,
}) => {
  async function confirm() {
    await expect(page.getByText("1 of 2 confirmations")).toBeVisible();
    const mined = await request.post(rpc, {
      data: { jsonrpc: "2.0", id: 1, method: "evm_mine", params: [] },
    });
    expect(await mined.json()).toHaveProperty("result");
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/404 \(Not Found\)/.test(m.text())) errors.push(m.text());
  });
  if (shots) await mkdir(shots, { recursive: true });

  // 1. No key yet: the dashboard asks for one instead of showing empty numbers.
  await page.goto("/");
  await expect(page.getByText("LOCAL DEVNET · ANVIL 9800")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up your signing key" })).toBeVisible();
  await expect(page.locator(".metrics")).toHaveCount(0);
  await audit(page, "empty dashboard");

  // 2. Create and register an ML-DSA-87 signing key.
  await page.getByRole("link", { name: "Set up a signing key" }).click();
  await expect(
    page.getByRole("list", { name: "Recovery phrase" }).getByRole("listitem"),
  ).toHaveCount(24);
  const use = page.getByRole("button", { name: "Use this key" });
  await expect(use).toBeDisabled();
  await audit(page, "key setup");
  await page.getByText("I have written down my recovery phrase").click();
  await use.click();
  await expect(page.getByText("Not registered")).toBeVisible();
  await page.getByRole("button", { name: "Register the key" }).click();
  await expect(page.getByText("Registered with proof of possession")).toBeVisible();
  await audit(page, "key registered");
  await shot(page, "key");

  // 3. Validation: GOV.UK-style error summary linked to each field.
  await page.getByRole("link", { name: "New request" }).click();
  await page.getByRole("button", { name: "Sign and create request" }).click();
  const summary = page.getByRole("alert").first();
  await expect(summary).toContainText("Enter an amount.");
  await expect(summary).toContainText("Enter a QoreChain address");
  await expect(summary).toContainText("Describe what the payment is for");
  await page.getByLabel("Amount in QOR").fill("1,5");
  await page.getByRole("button", { name: "Sign and create request" }).click();
  await expect(summary).toContainText("Use digits and one decimal point");

  // 4. Sign and create a request that accepts partial payments.
  await page.getByLabel("Amount in QOR").fill("1.5");
  await page.getByLabel("Pay to").fill(RECIPIENT);
  await page.getByLabel("What is it for?").fill("Invoice 1042: logo design, two rounds of changes");
  await page.getByRole("switch", { name: "Accept partial payments" }).click();
  await page.getByRole("combobox", { name: "Expires after" }).click();
  await page.getByRole("option", { name: "30 days" }).click();
  await audit(page, "new request");
  await shot(page, "new-request");
  await page.getByRole("button", { name: "Sign and create request" }).click();
  await expect(page).toHaveURL(/\/requests\/0x[0-9a-f]{64}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByText("Unpaid")).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code for the payment link/ })).toBeVisible();
  await expect(page.getByText("No payments yet.")).toBeVisible();
  await audit(page, "request detail (unpaid)");

  // 5. Customer page: the browser verifies the ML-DSA-87 signature against the on-chain key.
  await page.goto(`/pay/${id}`);
  await expect(page.getByText("Signed by the merchant.")).toBeVisible();
  await expect(page.getByText("Invoice 1042: logo design")).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code for the payment link" })).toBeVisible();
  await audit(page, "pay page");
  await shot(page, "pay");
  const amount = page.getByLabel("Amount in QOR");
  await expect(amount).toHaveValue("1.5");
  await amount.fill("2");
  await expect(page.getByText("That is more than what is still owed.")).toBeVisible();
  await amount.fill("0.5");
  await page.getByRole("button", { name: "Pay 0.5 QOR" }).click();
  await confirm();
  await expect(page.getByText("Partly paid")).toBeVisible({ timeout: 30_000 });
  await expect(amount).toHaveValue("1");
  await page.getByRole("button", { name: "Pay 1 QOR" }).click();
  await confirm();
  await expect(page.getByText("Paid in full")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
  await audit(page, "pay page (paid)");

  // 6. Receipt: attestation and merchant signature both verified in the browser.
  await page.getByRole("link", { name: "View the receipt" }).click();
  await expect(page).toHaveURL(new RegExp(`/receipts/${id}$`));
  await expect(page.getByText("Sealed by Chit.")).toBeVisible();
  await expect(
    page.getByText("Receipt matches the confirmed QoreChain transactions."),
  ).toBeVisible();
  await expect(page.getByText("Signed by the merchant.")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Payments on this receipt" }).getByRole("row"),
  ).toHaveCount(3);
  await shot(page, "receipt");
  const receiptLink = page.getByRole("link", { name: "Download receipt (JSON)" });
  const [receiptFile] = await Promise.all([
    page.waitForEvent("download"),
    test.info().project.name === "mobile" ? receiptLink.tap() : receiptLink.click(),
  ]);
  const receipt = JSON.parse(await readFile((await receiptFile.path())!, "utf8")) as {
    receipt: { requestId: string; status: string; paid: string; payments: { txHash: string }[] };
  };
  expect(receipt.receipt.requestId).toBe(id);
  expect(receipt.receipt.status).toBe("completed");
  expect(receipt.receipt.paid).toBe("1500000000000000000");
  const replay = await request.post(`${api}/v1/payments`, {
    data: { txHash: receipt.receipt.payments[0].txHash, source: "evm" },
  });
  expect(replay.status()).toBe(202);
  await audit(page, "receipt");

  // 7. Merchant views: detail, list, report and export.
  await page.goto(`/requests/${id}`);
  await expect(
    page.getByRole("table", { name: "Payments for this request" }).getByRole("row"),
  ).toHaveCount(3);
  await expect(page.getByText("Counted", { exact: true })).toHaveCount(2);
  await audit(page, "request detail (paid)");
  await shot(page, "request");
  await page.getByRole("link", { name: "Requests", exact: true }).click();
  await expect(page.getByRole("table", { name: "Payment requests, newest first" })).toContainText(
    "Invoice 1042",
  );
  await expect(page.locator(".metrics")).toContainText("1.5 QOR");
  await audit(page, "dashboard");
  await shot(page, "requests");
  await page.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByText("Requests by status")).toBeVisible();
  await page.getByRole("radio", { name: "Last 30 days" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Last 90 days" })).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
  await audit(page, "reports");
  await shot(page, "reports");
  const csvHref = await page.getByRole("link", { name: "Download CSV" }).getAttribute("href");
  const csv = await (await page.request.get(csvHref!)).text();
  expect(csv).toContain(id);
  expect(csv.split("\r\n").filter((line) => line.startsWith('"payment"'))).toHaveLength(2);
  const jsonHref = await page.getByRole("link", { name: "Download JSON" }).getAttribute("href");
  const exported = await (await request.get(jsonHref!)).json();
  expect(exported).toEqual([expect.objectContaining({ id, payments: expect.any(Array) })]);
  expect(exported[0].payments).toHaveLength(2);

  // 8. Dark theme passes the same audit.
  await page.getByRole("combobox", { name: "Theme" }).click();
  await page.getByRole("option", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await audit(page, "reports (dark)");
  await page.goto(`/pay/${id}`);
  await expect(page.getByText("Paid in full")).toBeVisible();
  await audit(page, "pay (dark)");
  await shot(page, "pay-dark");

  expect(errors).toEqual([]);
});

test("an unknown request is refused on the payment page", async ({ page, request }) => {
  const missing = await request.get(`${api}/v1/requests/0x${"ab".repeat(32)}`);
  expect(missing.status()).toBe(404);
  await page.goto(`/pay/0x${"ab".repeat(32)}`);
  await expect(page.getByRole("heading", { name: "This payment link is not valid" })).toBeVisible();
  await audit(page, "invalid link");
  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("an expired signed request cannot be paid", async ({ page, request }) => {
  const merchant = devIdentity(1);
  const registered = await request.post(`${api}/local/register-key`, {
    data: { address: merchant.address, publicKey: bytesToHex(merchant.pq.publicKey) },
  });
  expect(registered.ok()).toBe(true);
  const { chitPay } = (await (await request.get(`${api}/v1/status`)).json()) as {
    chitPay: Address;
  };
  const details = "Expired invoice";
  const expired = {
    merchant: merchant.address,
    recipient: RECIPIENT,
    asset: NATIVE_ASSET,
    amount: parseEther("1"),
    expiresAt: BigInt(Math.floor(Date.now() / 1000) - 60),
    reference: generateReference(),
    detailsHash: hashDetails(details),
    partialAllowed: true,
    payContract: chitPay,
    chainId: EVM_CHAIN_ID,
  } as const;
  const created = await request.post(`${api}/v1/requests`, {
    data: {
      request: serializeRequest(expired),
      signature: signRequest(expired, merchant.classical, merchant.pq),
      details,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  await page.goto(`/pay/${id}`);
  await expect(page.getByText("Signed by the merchant.")).toBeVisible();
  await expect(page.getByText("This request has expired")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
  await audit(page, "expired request");
});
