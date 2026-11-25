import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fetchEvmWindow } from "@qorechain/qoresign/network";
import { openEvmWindowMsg, qorechainRegistry } from "@qorechain/sdk";
import {
  chitPayAbi,
  EVM_CHAIN_ID,
  explorerTx,
  generateReference,
  hashDetails,
  memoForRequest,
  NATIVE_ASSET,
  referenceToBytes32,
  requestId,
  serializeRequest,
  signRequest,
  type PaymentRequest,
} from "@chit/core";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  toHex,
  type Address,
} from "viem";
import { artifact, checkDiana, evm, evmSend, readJson, writeJson, dianaEndpoints } from "./common";
import { chitAccounts, funderIdentity, type Identity } from "./identity";
import {
  bankSend,
  ensureNative,
  nativeBalance,
  nativeCost,
  pqStatus,
  registration,
  requireRegistered,
  sendNative,
} from "./native";

const deploymentPath = "deployments/diana.json";
const demoPath = "deployments/diana-demo.json";
const FUNDER_LOCK = process.env.CHIT_FUNDER_LOCK ?? "/workspace/.plinth-deployer.lock";
/** The shared funder must never drop below 1 QOR. */
const FUNDER_FLOOR_UQOR = 1_000_000n;
const QOR = 10n ** 18n;

type Deployment = { chitPay: Address; deployTx: string; block: string; gasUsed: string };

function requireDeployment(): Deployment {
  const d = readJson<Deployment>(deploymentPath);
  if (!d?.chitPay) throw new Error("Run bun run diana:deploy first");
  return d;
}

function rawPq(sig: ReturnType<typeof signRequest>) {
  if (!sig.pq) throw new Error("Missing ML-DSA-87 signature");
  return toHex(Buffer.from(sig.pq.signature, "base64"));
}

async function payNative(
  payer: Identity,
  chitPay: Address,
  req: PaymentRequest,
  sig: `0x${string}`,
  value: bigint,
) {
  const tuple = { ...req, paymentRef: referenceToBytes32(req.reference) };
  const { reference: _r, ...args } = tuple;
  const receipt = await evmSend(payer.account, {
    to: chitPay,
    value,
    data: encodeFunctionData({ abi: chitPayAbi, functionName: "payNative", args: [args, sig] }),
  });
  return {
    hash: receipt.transactionHash,
    block: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
}

async function run(command: string, flags: string[]) {
  const known = ["accounts", "status", "register", "fund", "windows", "deploy", "demo"];
  if (!known.includes(command)) throw new Error(`Unknown command. Use one of: ${known.join(", ")}`);
  const accounts = chitAccounts(command === "accounts");
  const [merchant, payer] = accounts as [Identity, Identity];
  if (command === "accounts") {
    for (const id of accounts) console.log(`${id.role} ${id.bech32} ${id.account.address}`);
    return;
  }
  await checkDiana();
  if (command === "status") {
    for (const id of accounts) {
      const [native, status, window] = await Promise.all([
        nativeBalance(id),
        pqStatus(id),
        fetchEvmWindow({ rest: dianaEndpoints.rest, address: id.bech32 }),
      ]);
      console.log(
        `${id.role} ${id.bech32} ${id.account.address} balance=${formatUnits(native, 6)} QOR registered=${status.registered} possessionProven=${status.possessionProven} window=${window.live}`,
      );
    }
    const d = readJson<Deployment>(deploymentPath);
    if (d)
      console.log(
        `ChitPay ${d.chitPay} code=${Boolean(await evm.getCode({ address: d.chitPay }))}`,
      );
    return;
  }
  if (command === "fund") {
    // Serialise every send from the shared funder with flock, then re-read balances inside the lock.
    if (process.env.CHIT_FUNDER_LOCKED !== "1") {
      const r = spawnSync("flock", [FUNDER_LOCK, process.execPath, ...process.argv.slice(1)], {
        stdio: "inherit",
        env: { ...process.env, CHIT_FUNDER_LOCKED: "1" },
      });
      process.exitCode = r.status ?? 1;
      return;
    }
    const funder = funderIdentity();
    const target = BigInt(process.env.CHIT_FUND_TARGET_UQOR ?? "600000");
    const transfers = [];
    for (const id of accounts) {
      const missing = target - (await nativeBalance(id));
      if (missing > 0n) transfers.push({ id, amount: missing });
    }
    const total = transfers.reduce((s, t) => s + t.amount + nativeCost(350000n), 0n);
    const available = await nativeBalance(funder);
    if (available - total < FUNDER_FLOOR_UQOR)
      throw new Error(
        `Funder would drop below 1 QOR (has ${formatUnits(available, 6)}, needs ${formatUnits(total, 6)}). Send QOR to: ${transfers.map((t) => `${t.id.bech32} ${formatUnits(t.amount, 6)}`).join("; ")}`,
      );
    for (const { id, amount } of transfers)
      console.log(
        `${id.role} +${formatUnits(amount, 6)} QOR ${await sendNative(funder, bankSend(funder, id.bech32, amount), amount)}`,
      );
    console.log(`funder balance ${formatUnits(await nativeBalance(funder), 6)} QOR`);
    return;
  }
  mkdirSync("keys/.diana-lock");
  try {
    if (command === "register") {
      for (const id of accounts) {
        if ((await pqStatus(id)).registered) {
          await requireRegistered(id);
          console.log(`${id.role} already registered`);
        } else {
          await ensureNative(id, nativeCost(350000n));
          console.log(`${id.role} ${await sendNative(id, registration(id), 0n, false)}`);
        }
      }
    }
    if (command === "windows") {
      const creation = flags.includes("--deploy");
      const blocks = BigInt(process.env.CHIT_WINDOW_BLOCKS ?? "1200");
      const maxValue = BigInt(process.env.CHIT_WINDOW_MAX_UQOR ?? "300000");
      const selected = creation ? [merchant] : [payer];
      const targets = creation ? [] : [requireDeployment().chitPay];
      for (const id of selected) {
        await requireRegistered(id);
        const window = openEvmWindowMsg({
          sender: id.bech32,
          blocks,
          maxTxs: creation ? 2n : 20n,
          maxValue,
          allowedTargets: targets,
        });
        console.log(
          `${id.role} window ${await sendNative(id, qorechainRegistry().encodeAsAny(window))}`,
        );
      }
    }
    if (command === "deploy") {
      const existing = readJson<Deployment>(deploymentPath);
      if (existing?.chitPay && (await evm.getCode({ address: existing.chitPay }))) {
        console.log(`ChitPay already deployed at ${existing.chitPay}`);
        return;
      }
      await requireRegistered(merchant);
      const receipt = await evmSend(merchant.account, {
        data: artifact("ChitPay").bytecode.object,
      });
      if (!receipt.contractAddress) throw new Error("No contract address");
      const d: Deployment = {
        chitPay: getAddress(receipt.contractAddress),
        deployTx: receipt.transactionHash,
        block: receipt.blockNumber.toString(),
        gasUsed: receipt.gasUsed.toString(),
      };
      writeJson(deploymentPath, d);
      console.log(`ChitPay ${d.chitPay} ${explorerTx(d.deployTx)} gas=${d.gasUsed}`);
    }
    if (command === "demo") {
      const { chitPay } = requireDeployment();
      await requireRegistered(merchant);
      await requireRegistered(payer);
      const head = await evm.getBlock();
      const make = (amount: bigint, partialAllowed: boolean, details: string): PaymentRequest => ({
        merchant: merchant.account.address,
        recipient: merchant.account.address,
        asset: NATIVE_ASSET,
        amount,
        expiresAt: head.timestamp + 86_400n,
        reference: generateReference(),
        detailsHash: hashDetails(details),
        partialAllowed,
        payContract: chitPay,
        chainId: EVM_CHAIN_ID,
      });
      const out: Record<string, unknown>[] = [];
      // 1. Partial then completing payment through ChitPay (on-chain ML-DSA-87 verification on the first).
      const a = make(QOR / 20n, true, "Demo invoice A: two instalments via ChitPay");
      const aSig = signRequest(a, merchant.classical, merchant.pqc);
      const a1 = await payNative(payer, chitPay, a, rawPq(aSig), QOR / 50n);
      const a2 = await payNative(payer, chitPay, a, "0x", QOR / 20n - QOR / 50n);
      out.push({
        details: "Demo invoice A: two instalments via ChitPay",
        request: serializeRequest(a),
        signature: aSig,
        requestId: requestId(a),
        txs: [a1, a2],
      });
      // 2. Native hybrid-signed bank send with an on-chain chit memo, then an accidental duplicate.
      const b = make(QOR / 100n, false, "Demo invoice B: native QOR transfer with memo");
      const bSig = signRequest(b, merchant.classical, merchant.pqc);
      const uqor = b.amount / 10n ** 12n;
      const b1 = await sendNative(
        payer,
        bankSend(payer, merchant.bech32, uqor),
        uqor,
        true,
        memoForRequest(requestId(b)),
      );
      const b2 = await sendNative(
        payer,
        bankSend(payer, merchant.bech32, uqor),
        uqor,
        true,
        memoForRequest(requestId(b)),
      );
      out.push({
        details: "Demo invoice B: native QOR transfer with memo",
        request: serializeRequest(b),
        signature: bSig,
        requestId: requestId(b),
        txs: [{ hash: b1 }, { hash: b2 }],
      });
      writeJson(demoPath, { createdAt: new Date().toISOString(), chitPay, requests: out });
      for (const r of out)
        for (const t of r.txs as { hash: string }[]) console.log(explorerTx(t.hash));
      console.log(
        `payer balance ${formatEther(await evm.getBalance({ address: payer.account.address }))} QOR`,
      );
    }
  } finally {
    rmSync("keys/.diana-lock", { recursive: true });
  }
}

const [command = "", ...flags] = process.argv.slice(2).filter((arg) => arg !== "--");
try {
  await run(command, flags);
} catch (error) {
  console.error(error instanceof Error ? error.message.split("\n")[0] : "Diana command failed");
  process.exitCode = 1;
}
