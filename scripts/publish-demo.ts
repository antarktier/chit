// Registers the live Diana demo requests (deployments/diana-demo.json) with a Chit API.
import { readFileSync } from "node:fs";

const api = process.env.CHIT_API ?? "http://127.0.0.1:8787";
const demo = JSON.parse(readFileSync("deployments/diana-demo.json", "utf8")) as {
  requests: { details: string; request: unknown; signature: unknown }[];
};
for (const r of demo.requests) {
  const res = await fetch(`${api}/v1/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: r.request, signature: r.signature, details: r.details }),
  });
  const body = (await res.json()) as { id?: string; error?: string; reconciliation?: { status: string } };
  console.log(res.status, body.id ?? body.error, body.reconciliation?.status ?? "");
  if (!res.ok) process.exitCode = 1;
}
