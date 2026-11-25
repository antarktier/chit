import {
  chitPayAbi,
  fromBech32,
  memoForRequest,
  NATIVE_CHAIN_ID,
  referenceToBytes32,
  requestMessageBytes,
  toBech32,
  UQOR_TO_WEI,
  type PaymentRequest,
} from "@chit/core";
import type { MessageSignature } from "@qorechain/qoresign";
import type { QorexNativeProvider } from "@qorechain/qorex-types";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  custom,
  getAddress,
  http,
  parseAbi,
  UserRejectedRequestError,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { evmChain, keyStatus, publicClient, tokenAbi, type Endpoints } from "./chain";
import { DEV_PAYER_INDEX, devIdentity, mockPqSignature } from "./dev-keys";

type QorexWindow = Window & {
  qorex?: { native?: QorexNativeProvider; evm?: EIP1193Provider };
  ethereum?: EIP1193Provider;
};
const browser = () => window as QorexWindow;

export const QOREX_INSTALL = "https://www.qorechain.io";

export function hasQorex() {
  return Boolean(browser().qorex?.native);
}

export interface QorexAccount {
  bech32: string;
  address: Address;
}

export async function connectQorex(): Promise<QorexAccount> {
  const native = browser().qorex?.native;
  if (!native) throw new Error("Install or unlock the QoreX wallet, then try again.");
  await native.enable(NATIVE_CHAIN_ID);
  const key = await native.getKey(NATIVE_CHAIN_ID);
  return { bech32: key.bech32Address, address: fromBech32(key.bech32Address) };
}

/** A native QOR bank send signed and broadcast by QoreX (hybrid secp256k1 + ML-DSA-87). */
export async function sendFromQorex(args: { to: string; uqor: bigint; memo?: string }) {
  const native = browser().qorex?.native;
  if (!native?.signAndBroadcast)
    throw new Error("Update QoreX to a version that can send QoreChain transactions.");
  const account = await connectQorex();
  const { MsgSend } = await import("cosmjs-types/cosmos/bank/v1beta1/tx");
  const result = await native.signAndBroadcast({
    chainId: NATIVE_CHAIN_ID,
    messages: [
      {
        typeUrl: MsgSend.typeUrl,
        value: MsgSend.encode(
          MsgSend.fromPartial({
            fromAddress: account.bech32,
            toAddress: args.to,
            amount: [{ denom: "uqor", amount: args.uqor.toString() }],
          }),
        ).finish(),
      },
    ],
    memo: args.memo,
  });
  if (result.code)
    throw new Error(`QoreChain rejected the transfer (code ${result.code}). Nothing was sent.`);
  return `0x${result.txHash.replace(/^0x/i, "").toLowerCase()}` as Hex;
}

/** Pays a native-QOR request with a bank send whose memo binds it to the request ID. */
export function payWithMemo(request: PaymentRequest, id: Hex, amountWei: bigint) {
  if (amountWei % UQOR_TO_WEI !== 0n)
    throw new Error("Native transfers use 6 decimal places. Round the amount and try again.");
  return sendFromQorex({
    to: toBech32(request.recipient),
    uqor: amountWei / UQOR_TO_WEI,
    memo: memoForRequest(id),
  });
}

const chitPayErrors = parseAbi([
  "error WrongDomain()",
  "error Expired()",
  "error InvalidSignature()",
  "error PqcPrecompileUnavailable(address precompile)",
  "error PqcKeyNotProven()",
  "error UnsupportedPqcAlgorithm()",
  "error ZeroAmount()",
  "error AlreadySettled()",
  "error ExceedsOutstanding(uint256 outstanding)",
  "error PartialNotAllowed()",
  "error ReferenceReused()",
  "error WrongValue()",
  "error TransferFailed()",
  "error Reentrancy()",
]);
const abi = [...chitPayAbi, ...chitPayErrors];

const revertText: Record<string, string> = {
  WrongDomain: "This request is for a different payment contract or network.",
  Expired: "This request has expired. Ask the merchant for a new one.",
  InvalidSignature: "The merchant's signature does not verify on chain. Do not pay this request.",
  PqcPrecompileUnavailable: "The network's ML-DSA-87 verifier is unavailable. Try again later.",
  PqcKeyNotProven: "The merchant's ML-DSA-87 key is not registered on chain.",
  UnsupportedPqcAlgorithm: "The merchant's key uses an unsupported algorithm.",
  ZeroAmount: "Enter an amount greater than 0.",
  AlreadySettled: "This request is already paid in full.",
  ExceedsOutstanding: "The amount is more than what is still owed.",
  PartialNotAllowed: "This request needs one payment of the full outstanding amount.",
  ReferenceReused: "The merchant used this reference for another request.",
  WrongValue: "The payment asset does not match the request.",
  TransferFailed: "The transfer failed. Check your balance and token approval.",
};

export function paymentError(error: unknown) {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError))
      return "You cancelled the payment in your wallet. Nothing was sent.";
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName)
      return revertText[revert.data.errorName] ?? `The contract refused: ${revert.data.errorName}.`;
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "The payment failed.";
}

function base64ToHex(value: string): Hex {
  const bin = atob(value);
  let hex = "0x";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex as Hex;
}

function tuple(request: PaymentRequest) {
  return {
    merchant: request.merchant,
    recipient: request.recipient,
    asset: request.asset,
    amount: request.amount,
    expiresAt: request.expiresAt,
    paymentRef: referenceToBytes32(request.reference),
    detailsHash: request.detailsHash,
    partialAllowed: request.partialAllowed,
    payContract: request.payContract,
    chainId: request.chainId,
  };
}

async function evmProvider(): Promise<EIP1193Provider> {
  const injected = browser().qorex?.evm;
  if (injected) return injected;
  const announced = await new Promise<EIP1193Provider | undefined>((resolve) => {
    const timer = setTimeout(() => finish(browser().ethereum), 400);
    function finish(provider?: EIP1193Provider) {
      clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", announce);
      resolve(provider);
    }
    function announce(event: Event) {
      const { detail } = event as CustomEvent<{
        info: { rdns: string };
        provider: EIP1193Provider;
      }>;
      if (detail?.info?.rdns === "network.qore.qorex") finish(detail.provider);
    }
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  });
  if (!announced) throw new Error("Install or unlock the QoreX wallet, then try again.");
  return announced;
}

async function payerWallet(ep: Endpoints) {
  const chain = evmChain(ep.evm);
  if (ep.environment === "LOCAL DEVNET") {
    const url = new URL(ep.evm);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
      throw new Error("Local devnet payments need a loopback Anvil RPC.");
    const { account } = devIdentity(DEV_PAYER_INDEX);
    return {
      account: account.address,
      client: createWalletClient({ account, chain, transport: http(ep.evm) }),
    };
  }
  const provider = await evmProvider();
  const [first] = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!first) throw new Error("QoreX did not share an EVM account.");
  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (Number(chainId) !== chain.id)
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chain.id.toString(16)}` }],
    });
  const account = getAddress(first);
  return {
    account,
    client: createWalletClient({ account, chain, transport: custom(provider, { retryCount: 0 }) }),
  };
}

/**
 * Pays through ChitPay, which verifies the merchant's ML-DSA-87 signature on chain on the
 * first payment for a request and moves the funds straight to the recipient.
 */
export async function payWithContract(args: {
  ep: Endpoints;
  request: PaymentRequest;
  id: Hex;
  signature: MessageSignature;
  amount: bigint;
  onStep?: (step: string) => void;
}) {
  const { ep, request, id, amount, onStep } = args;
  const client = publicClient(ep.evm);
  const { account, client: wallet } = await payerWallet(ep);
  const authenticated = await client.readContract({
    address: request.payContract,
    abi,
    functionName: "authenticated",
    args: [id],
  });
  let pqSignature: Hex = "0x";
  if (!authenticated) {
    if (ep.environment === "LOCAL DEVNET") {
      const status = await keyStatus(ep, request.merchant);
      if (!status.publicKey) throw new Error("The merchant key is not registered on the devnet.");
      pqSignature = mockPqSignature(status.publicKey, requestMessageBytes(request));
    } else {
      if (!args.signature.pq) throw new Error("This request has no ML-DSA-87 signature.");
      pqSignature = base64ToHex(args.signature.pq.signature);
    }
  }
  const req = tuple(request);
  let hash: Hex;
  if (request.asset === "0x0000000000000000000000000000000000000000") {
    onStep?.("Confirm the payment in your wallet");
    const { request: call } = await client.simulateContract({
      account,
      address: request.payContract,
      abi,
      functionName: "payNative",
      args: [req, pqSignature],
      value: amount,
    });
    hash = await wallet.writeContract(call);
  } else {
    const allowance = await client.readContract({
      address: request.asset,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account, request.payContract],
    });
    if (allowance < amount) {
      onStep?.("Approve the token amount in your wallet");
      const approve = await wallet.writeContract({
        address: request.asset,
        abi: tokenAbi,
        functionName: "approve",
        args: [request.payContract, amount],
        account,
        chain: wallet.chain,
      });
      await client.waitForTransactionReceipt({ hash: approve });
    }
    onStep?.("Confirm the payment in your wallet");
    const { request: call } = await client.simulateContract({
      account,
      address: request.payContract,
      abi,
      functionName: "payToken",
      args: [req, pqSignature, amount],
    });
    hash = await wallet.writeContract(call);
  }
  onStep?.("Waiting for the block");
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The payment transaction reverted.");
  return hash;
}

export async function payerAddress(ep: Endpoints) {
  return ep.environment === "LOCAL DEVNET"
    ? devIdentity(DEV_PAYER_INDEX).address
    : (await payerWallet(ep)).account;
}
