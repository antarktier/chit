// Writes the cross-language encoding fixture consumed by contracts/test/Encoding.t.sol.
import { writeFileSync } from "node:fs";
import { bytesToHex } from "viem";
import {
  hashDetails,
  referenceToBytes32,
  requestId,
  requestMessageBytes,
  type PaymentRequest,
} from "../src/index";

export const fixtureRequest: PaymentRequest = {
  merchant: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
  recipient: "0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF",
  asset: "0x0000000000000000000000000000000000000000",
  amount: 1_250_000_000_000_000_000n,
  expiresAt: 1_900_000_000n,
  reference: "CH-3333-3333-3333-E",
  detailsHash: hashDetails("Invoice 42: design work"),
  partialAllowed: true,
  payContract: "0x1111111111111111111111111111111111111111",
  chainId: 9800n,
};

export function fixture() {
  const r = fixtureRequest;
  return {
    request: {
      ...r,
      amount: r.amount.toString(),
      expiresAt: r.expiresAt.toString(),
      chainId: r.chainId.toString(),
      paymentRef: referenceToBytes32(r.reference),
    },
    message: bytesToHex(requestMessageBytes(r)),
    requestId: requestId(r),
  };
}

if (import.meta.main) {
  writeFileSync("contracts/test/fixtures/request.json", JSON.stringify(fixture(), null, 2) + "\n");
}
