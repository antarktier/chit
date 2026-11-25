import { api } from "./api";
import { dianaSource } from "./chain";
import { config } from "./config";
import { indexOnce } from "./indexer";
import { sqliteStore } from "./sqlite";

const cfg = config(process.env);
const store = sqliteStore(process.env.CHIT_SQLITE ?? "chit.sqlite");
const chain = dianaSource(cfg);
if (process.argv.includes("--index-once")) {
  console.log(await indexOnce(store, chain, cfg));
  store.close();
} else {
  const server = Bun.serve({
    port: Number(process.env.CHIT_API_PORT ?? 8787),
    hostname: process.env.CHIT_API_HOST ?? "127.0.0.1",
    fetch: api(store, chain, cfg),
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
