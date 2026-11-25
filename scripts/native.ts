import { NATIVE_CHAIN_ID as nativeChainId } from "@chit/core";
import { buildRegisterPqKeyMessage } from "@qorechain/qoresign";
import {
  broadcastTx,
  fetchPqKeyStatus,
  resolveSignBytesVersion,
  simulateTx,
} from "@qorechain/qoresign/network";
import {
  calculateFee,
  msg,
  qorechainRegistry,
  signClassicalEth,
  signHybridEth,
  RestClient,
  waitForTx,
} from "@qorechain/sdk";
import { bytesToHex, formatUnits, type Hash } from "viem";

import { dianaEndpoints, rest as restGet, RestError } from "./common";
import type { Identity } from "./identity";

const rest = dianaEndpoints.rest;
const registry = qorechainRegistry();
type Message = ReturnType<typeof buildRegisterPqKeyMessage>;
export const nativePrice = process.env.CHIT_NATIVE_GAS_PRICE ?? "0.15uqor";
export const nativeFee = (gas: bigint) => calculateFee(String(gas), nativePrice);
export const nativeCost = (gas: bigint) => BigInt(nativeFee(gas).amount[0].amount);

export async function nativeBalance(identity: Identity) {
  const { balance } = await restGet<{ balance: { amount: string } | null }>(
    `/cosmos/bank/v1beta1/balances/${identity.bech32}/by_denom?denom=uqor`,
  );
  return BigInt(balance?.amount ?? 0);
}

export function pqStatus(identity: Identity) {
  return fetchPqKeyStatus({ rest, address: identity.bech32 });
}

export async function requireRegistered(identity: Identity) {
  const status = await pqStatus(identity);
  if (
    !status.registered ||
    !status.possessionProven ||
    !status.publicKey ||
    bytesToHex(status.publicKey) !== bytesToHex(identity.pqc.publicKey)
  )
    throw new Error(
      `${identity.bech32} requires matching ML-DSA-87 registration with proof of possession`,
    );
}

export function registration(identity: Identity) {
  return buildRegisterPqKeyMessage({
    chainId: nativeChainId,
    account: identity.bech32,
    pqKey: identity.pqc,
    classicalPublicKey: identity.classical.publicKey,
  });
}

export function bankSend(identity: Identity, recipient: string, amount: bigint) {
  return registry.encodeAsAny(
    msg.bank.send({
      fromAddress: identity.bech32,
      toAddress: recipient,
      amount: [{ denom: "uqor", amount: String(amount) }],
    }),
  );
}

export async function ensureNative(identity: Identity, required: bigint) {
  const available = await nativeBalance(identity);
  if (available < required)
    throw new Error(`${identity.bech32} needs ${formatUnits(required - available, 6)} QOR`);
}

async function prepareNative(
  identity: Identity,
  message: Message,
  amount: bigint,
  hybrid: boolean,
  simulate: boolean,
  memo = "",
) {
  const initialGas = 350000n;
  await ensureNative(identity, amount + (simulate ? 1n : nativeCost(initialGas)));
  if (hybrid) await requireRegistered(identity);
  type Account = { address: string; account_number?: string; sequence?: string };
  const auth = await restGet<{ account: Account & { base_account?: Account } }>(
    `/cosmos/auth/v1beta1/accounts/${identity.bech32}`,
  ).catch((error: unknown) => {
    if (error instanceof RestError && error.status === 404)
      throw new Error(`${identity.bech32} needs a funded native account`);
    throw error;
  });
  const account = auth.account.base_account ?? auth.account;
  if (account.address !== identity.bech32) throw new Error("Native signer address mismatch");
  const version = hybrid
    ? await resolveSignBytesVersion({ rest, chainId: nativeChainId })
    : undefined;
  const sign = (gas: bigint) =>
    (hybrid ? signHybridEth : signClassicalEth)({
      account: {
        privateKey: identity.privateKey,
        publicKey: bytesToHex(identity.classical.publicKey),
        pqc: identity.pqc,
      },
      chainId: nativeChainId,
      accountNumber: BigInt(account.account_number ?? "0"),
      sequence: BigInt(account.sequence ?? "0"),
      fee: nativeFee(gas),
      messages: [message],
      memo,
      signBytesVersion: version,
    }).txRawBytes;
  const first = sign(initialGas);
  const estimate = simulate ? await simulateTx({ rest, txBytes: first }) : undefined;
  const limit = estimate?.suggestedGasLimit ?? initialGas;
  await ensureNative(identity, amount + nativeCost(limit));
  const txBytes = limit === initialGas ? first : sign(limit);
  return {
    nonce: account.sequence ?? "0",
    estimate: estimate?.gasUsed,
    async submit(): Promise<Hash> {
      const result = await broadcastTx({ rest, txBytes });
      if (result.code)
        throw new Error(`Native broadcast rejected (${result.codespace}/${result.code})`);
      return `0x${result.txhash.toLowerCase()}`;
    },
  };
}

export async function sendNative(
  identity: Identity,
  message: Message,
  amount = 0n,
  hybrid = true,
  memo = "",
) {
  const prepared = await prepareNative(identity, message, amount, hybrid, false, memo);
  const hash = await prepared.submit();
  const receipt = await waitForTx(new RestClient(rest), hash.slice(2));
  if (receipt.code) throw new Error(`Native transaction reverted: ${hash}`);
  return hash;
}
