import { addressFromBytes, parseAddress } from "@qorechain/qoresign";
import {
  bytesToHex,
  getAddress,
  hexToBytes,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { requestIdFromMemo, type PaymentEvent } from "./reconcile";
import { NATIVE_ASSET } from "./request";

export const diana = {
  evm: "https://evm-testnet.qore.host",
  rest: "https://api-testnet.qore.host",
  explorer: "https://explore.qore.network",
} as const;

/** Native bank amounts are 6-decimal uqor; EVM and requests use 18-decimal wei. */
export const UQOR_TO_WEI = 1_000_000_000_000n;

const requestTuple =
  "(address merchant,address recipient,address asset,uint256 amount,uint64 expiresAt,bytes32 paymentRef,bytes32 detailsHash,bool partialAllowed,address payContract,uint256 chainId)";

export const chitPayAbi = parseAbi([
  `function payNative(${requestTuple} req, bytes pqSignature) payable`,
  `function payToken(${requestTuple} req, bytes pqSignature, uint256 amount)`,
  `function requestId(${requestTuple} req) pure returns (bytes32)`,
  `function outstanding(${requestTuple} req) view returns (uint256)`,
  "function paid(bytes32) view returns (uint256)",
  "function authenticated(bytes32) view returns (bool)",
  "event RequestAuthenticated(bytes32 indexed requestId, address indexed merchant, bytes32 indexed paymentRef)",
  "event PaymentReceived(bytes32 indexed requestId, bytes32 indexed paymentRef, address indexed payer, address recipient, address asset, uint256 amount, uint256 totalPaid)",
]);

export const paymentReceivedEvent = parseAbiItem(
  "event PaymentReceived(bytes32 indexed requestId, bytes32 indexed paymentRef, address indexed payer, address recipient, address asset, uint256 amount, uint256 totalPaid)",
);

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export function toBech32(address: Address): string {
  return addressFromBytes(hexToBytes(address)).bech32;
}

export function fromBech32(bech32: string): Address {
  return getAddress(bytesToHex(parseAddress(bech32).bytes));
}

/** Shape of `/cosmos/tx/v1beta1/txs` entries we rely on. */
export interface CosmosTxResponse {
  txhash: string;
  height: string;
  code: number;
  timestamp: string;
  tx: {
    body: {
      memo: string;
      messages: {
        "@type": string;
        from_address?: string;
        to_address?: string;
        amount?: { denom: string; amount: string }[];
      }[];
    };
  };
}

/**
 * Extracts Chit payments from a confirmed native transaction: every successful
 * MsgSend of uqor in a tx whose memo is `chit:v1:<requestId>`.
 */
export function nativePaymentEvents(tx: CosmosTxResponse): PaymentEvent[] {
  if (tx.code !== 0) return [];
  const id = requestIdFromMemo(tx.tx.body.memo ?? "");
  if (!id) return [];
  const out: PaymentEvent[] = [];
  tx.tx.body.messages.forEach((m, index) => {
    if (m["@type"] !== "/cosmos.bank.v1beta1.MsgSend" || !m.to_address || !m.from_address) return;
    const uqor = (m.amount ?? [])
      .filter((c) => c.denom === "uqor")
      .reduce((s, c) => s + BigInt(c.amount), 0n);
    if (uqor === 0n) return;
    out.push({
      source: "native",
      txHash: `0x${tx.txhash.toLowerCase()}`,
      index,
      blockHeight: BigInt(tx.height),
      blockTime: BigInt(Math.floor(Date.parse(tx.timestamp) / 1000)),
      requestId: id,
      payer: m.from_address,
      recipient: fromBech32(m.to_address),
      asset: NATIVE_ASSET,
      amount: uqor * UQOR_TO_WEI,
    });
  });
  return out;
}

export function explorerTx(hash: string): string {
  return `${diana.explorer}/tx/${hash}`;
}

export type { Hex };
