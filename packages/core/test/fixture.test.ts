import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { fixture } from "./generate-fixture";

test("committed Solidity fixture matches the TypeScript canonical encoding", () => {
  const committed = JSON.parse(readFileSync("contracts/test/fixtures/request.json", "utf8"));
  expect(committed).toEqual(JSON.parse(JSON.stringify(fixture())));
});
