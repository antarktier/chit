import { api } from "./api";
import { dianaSource } from "./chain";
import { config } from "./config";
import { d1Store, type D1 } from "./store";

interface Env {
  DB: D1;
  [key: string]: unknown;
}

function settings(env: Env) {
  return config(
    Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<
      string,
      string
    >,
  );
}

export default {
  fetch(request: Request, env: Env) {
    const cfg = settings(env);
    return api(d1Store(env.DB), dianaSource(cfg), cfg)(request);
  },
};
