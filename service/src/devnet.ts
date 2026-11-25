// LOCAL DEVNET helpers (Anvil only). Lets the e2e browser register a merchant key with the
// TEST-ONLY mock precompile and fund wallets. Never mounted when CHIT_ENVIRONMENT is DIANA.
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  isHex,
  parseAbi,
  parseEther,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import type { Config } from "./config";

const KEY_STATUS = "0x0000000000000000000000000000000000000a02";
const mockAbi = parseAbi([
  "struct KeyStatus { bool registered; uint8 algorithmId; bytes pubkey; bool possessionProven; }",
  "function setKeyStatus(address account, KeyStatus status)",
]);

export function devnetRoutes(cfg: Config, mnemonic: string) {
  const chain = {
    id: 9800,
    name: "Chit local devnet",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [cfg.evmUrl] } },
  } as const;
  const pub = createPublicClient({ chain, transport: http() });
  const test = createTestClient({ chain, mode: "anvil", transport: http() });
  const operator = createWalletClient({
    account: mnemonicToAccount(mnemonic),
    chain,
    transport: http(),
  });
  return async (req: Request): Promise<Response | undefined> => {
    const url = new URL(req.url);
    if (req.method !== "POST" || !url.pathname.startsWith("/local/")) return undefined;
    const body = (await req.json().catch(() => ({}))) as { address?: string; publicKey?: string };
    if (!body.address || !isAddress(body.address))
      return Response.json({ error: "address required" }, { status: 400 });
    const address = getAddress(body.address);
    if (url.pathname === "/local/fund") {
      await test.setBalance({ address, value: parseEther("1000") });
      return Response.json({ address, balance: "1000000000000000000000" });
    }
    if (url.pathname === "/local/register-key") {
      if (!body.publicKey || !isHex(body.publicKey) || body.publicKey.length !== 2 + 2592 * 2)
        return Response.json(
          { error: "publicKey must be a 2592-byte ML-DSA-87 key" },
          { status: 400 },
        );
      const hash = await operator.writeContract({
        address: KEY_STATUS,
        abi: mockAbi,
        functionName: "setKeyStatus",
        args: [
          address,
          {
            registered: true,
            algorithmId: 1,
            pubkey: body.publicKey as Hex,
            possessionProven: true,
          },
        ],
      });
      await pub.waitForTransactionReceipt({ hash, pollingInterval: 50 });
      return Response.json({ address, registered: true });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  };
}
