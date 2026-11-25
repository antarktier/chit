import {
  deserializeRequest,
  nativePaymentEvents,
  paymentReceivedEvent,
  reconcile,
  requestId,
  verifyRequest,
  type CosmosTxResponse,
  type PaymentEvent,
  type Receipt,
} from "@chit/core";
import type { MessageSignature } from "@qorechain/qoresign";
import { decodeEventLog, getAddress, type Hex } from "viem";
import type { ServiceStatus } from "./api";
import { keyStatus, publicClient, type Endpoints } from "./chain";

async function transactionEvents(ep: Endpoints, contract: string, source: string, hash: Hex) {
  if (source === "native") {
    const url = `${ep.rest}/cosmos/tx/v1beta1/txs/${hash.slice(2).toUpperCase()}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Native transaction lookup failed");
    const { tx_response } = (await response.json()) as { tx_response: CosmosTxResponse };
    return nativePaymentEvents(tx_response);
  }
  const client = publicClient(ep.evm);
  const tx = await client.getTransactionReceipt({ hash });
  if (tx.status !== "success") return [];
  const block = await client.getBlock({ blockNumber: tx.blockNumber });
  if (block.hash !== tx.blockHash) return [];
  const events: PaymentEvent[] = [];
  for (const log of tx.logs) {
    if (getAddress(log.address) !== getAddress(contract)) continue;
    try {
      const { args } = decodeEventLog({
        abi: [paymentReceivedEvent],
        data: log.data,
        topics: log.topics,
      });
      events.push({
        source: "evm",
        txHash: tx.transactionHash,
        index: log.logIndex,
        blockHeight: tx.blockNumber,
        blockTime: block.timestamp,
        ...args,
      });
    } catch {
      // Other contract logs carry no payment.
    }
  }
  return events;
}

export async function verifyReceiptChain(
  receipt: Receipt,
  id: string,
  ep: Endpoints,
  status: ServiceStatus,
) {
  const request = deserializeRequest(receipt.request);
  if (
    requestId(request) !== id ||
    receipt.requestId !== id ||
    getAddress(status.chitPay) !== request.payContract ||
    request.chainId !== BigInt(status.chainId)
  )
    return false;
  const client = publicClient(ep.evm);
  const [chainId, headHeight, key] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber({ cacheTime: 0 }),
    keyStatus(ep, request.merchant),
  ]);
  if (
    BigInt(chainId) !== request.chainId ||
    !key.registered ||
    !key.possessionProven ||
    !key.publicKey ||
    !verifyRequest(request, receipt.merchantSignature as MessageSignature, key.publicKey)
  )
    return false;

  const transactions = new Map<string, Promise<PaymentEvent[]>>();
  const events = await Promise.all(
    receipt.payments.map(async (payment) => {
      const transaction = `${payment.source}:${payment.txHash.toLowerCase()}`;
      let lookup = transactions.get(transaction);
      if (!lookup) {
        lookup = transactionEvents(ep, request.payContract, payment.source, payment.txHash as Hex);
        transactions.set(transaction, lookup);
      }
      return (await lookup).find(
        (event) =>
          event.txHash.toLowerCase() === payment.txHash.toLowerCase() &&
          event.index === payment.index &&
          event.blockHeight.toString() === payment.blockHeight &&
          event.blockTime.toString() === payment.blockTime &&
          event.payer.toLowerCase() === payment.payer.toLowerCase() &&
          event.amount.toString() === payment.amount,
      );
    }),
  );
  const matched = events.filter((event) => event !== undefined);
  if (matched.length !== receipt.payments.length) return false;
  const verified = reconcile(receipt.requestId, request, matched, {
    headHeight,
    minConfirmations: BigInt(status.minConfirmations),
    now: BigInt(Math.floor(Date.parse(receipt.issuedAt) / 1000)),
  });
  return (
    verified.events.length === matched.length &&
    verified.events.every(({ class: state }) => state === "counted" || state === "duplicate") &&
    verified.paid.toString() === receipt.paid &&
    verified.overpaidBy.toString() === receipt.overpaidBy &&
    verified.status === receipt.status &&
    verified.completedAt?.txHash === receipt.completedAt?.txHash &&
    verified.completedAt?.blockHeight.toString() === receipt.completedAt?.blockHeight &&
    verified.completedAt?.blockTime.toString() === receipt.completedAt?.blockTime
  );
}
