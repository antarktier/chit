import { api } from "./api";
import { dianaSource } from "./chain";
import { config } from "./config";
import { indexOnce } from "./indexer";
import { devnetRoutes } from "./devnet";
import { sqliteStore } from "./sqlite";

const cfg = config(process.env);
const store = sqliteStore(process.env.CHIT_SQLITE ?? "chit.sqlite");
const chain = dianaSource(cfg);
let local: ReturnType<typeof devnetRoutes> | undefined;
if (process.argv.includes("--index-once")) {
  console.log(await indexOnce(store, chain, cfg));
  store.close();
} else {
  const server = Bun.serve({
    port: Number(process.env.CHIT_API_PORT ?? 8787),
    hostname: process.env.CHIT_API_HOST ?? "127.0.0.1",
    fetch: async (req) => {
      const handle = api(store, chain, cfg);
      if (cfg.environment === "LOCAL DEVNET" && process.env.CHIT_DEVNET_OPERATOR_MNEMONIC) {
        local ??= devnetRoutes(cfg, process.env.CHIT_DEVNET_OPERATOR_MNEMONIC);
        const res = await local(req);
        if (res) {
          const origin = req.headers.get("origin");
          if (origin) res.headers.set("access-control-allow-origin", origin);
          return res;
        }
        if (req.method === "OPTIONS" && new URL(req.url).pathname.startsWith("/local/"))
          return new Response(null, {
            status: 204,
            headers: {
              "access-control-allow-origin": req.headers.get("origin") ?? "*",
              "access-control-allow-methods": "POST",
              "access-control-allow-headers": "content-type",
            },
          });
      }
      return handle(req);
    },
  });
  console.log(`${cfg.environment} API ${server.url}`);
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await indexOnce(store, chain, cfg);
    } catch (error) {
      console.error("indexer failed:", error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  };
  void tick();
  setInterval(() => void tick(), cfg.environment === "LOCAL DEVNET" ? 1000 : 15_000);
}
