// LOCAL DEVNET for end-to-end tests: Anvil (chain 9800) + TEST-ONLY PQC mock precompiles + ChitPay
// + the Chit service in "LOCAL DEVNET" mode. Never used for the Diana deployment.
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { artifact, writeJson } from "./common";

const anvilPort = Number(process.env.ANVIL_PORT ?? 8545);
const apiPort = Number(process.env.CHIT_API_PORT ?? 8787);
const deploymentPath = process.env.CHIT_LOCAL_DEPLOYMENT ?? ".deployments-local/devnet.json";
const mnemonic = "test test test test test test test test test test test junk";
const rpc = `http://127.0.0.1:${anvilPort}`;
const KEY_STATUS: Address = "0x0000000000000000000000000000000000000a02";
const VERIFY: Address = "0x0000000000000000000000000000000000000a01";

execFileSync("forge", ["build"], { stdio: ["ignore", "ignore", "inherit"] });
const anvil = spawn(
  "anvil",
  [
    "--host",
    "127.0.0.1",
    "--port",
    String(anvilPort),
    "--chain-id",
    "9800",
    "--mnemonic",
    mnemonic,
    "--silent",
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
let service: ReturnType<typeof spawn> | undefined;
const stop = () => {
  service?.kill("SIGTERM");
  anvil.kill("SIGTERM");
};
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stop();
    process.exit(0);
  });

const chain = {
  id: 9800,
  name: "Chit local devnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
} as const;
const publicClient = createPublicClient({ chain, transport: http() });
const testClient = createTestClient({ chain, mode: "anvil", transport: http() });
const operator = createWalletClient({
  account: mnemonicToAccount(mnemonic),
  chain,
  transport: http(),
});

try {
  for (let i = 0; ; i++) {
    if (anvil.exitCode !== null || i === 100) throw new Error("Anvil failed to start");
    if ((await publicClient.getChainId().catch(() => 0)) === 9800) break;
    await delay(100);
  }
  const mock = artifact("DevnetQorePQC") as unknown as { deployedBytecode: { object: Hex } };
  await testClient.setCode({ address: KEY_STATUS, bytecode: mock.deployedBytecode.object });
  await testClient.setCode({ address: VERIFY, bytecode: mock.deployedBytecode.object });
  const hash = await operator.deployContract({
    abi: [],
    bytecode: artifact("ChitPay").bytecode.object,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 50 });
  const chitPay = getAddress(receipt.contractAddress!);
  writeJson(deploymentPath, {
    rpc,
    api: `http://127.0.0.1:${apiPort}`,
    chitPay,
    block: receipt.blockNumber,
  });
  service = spawn(process.execPath, ["service/src/local.ts"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      CHIT_ENVIRONMENT: "LOCAL DEVNET",
      CHIT_EVM_URL: rpc,
      CHIT_PAY: chitPay,
      CHIT_START_BLOCK: String(receipt.blockNumber),
      CHIT_MIN_CONFIRMATIONS: process.env.CHIT_MIN_CONFIRMATIONS ?? "1",
      CHIT_API_PORT: String(apiPort),
      CHIT_SQLITE: ":memory:",
      CHIT_EXPLORER: "",
      // Deterministic, test-only attestation seed for the devnet.
      CHIT_ATTESTATION_SEED: `0x${"11".repeat(32)}`,
      CHIT_DEVNET_OPERATOR_MNEMONIC: mnemonic,
    },
  });
  console.log(
    `LOCAL DEVNET ready: anvil ${rpc}, ChitPay ${chitPay}, API http://127.0.0.1:${apiPort}`,
  );
  await new Promise((resolve) => service?.once("exit", resolve));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stop();
}
