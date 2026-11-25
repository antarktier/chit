import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import type { Param, Store } from "./store";

export function sqliteStore(path = ":memory:") {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  db.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  const store: Store = {
    all: (sql, ...params) => Promise.resolve(db.query<never, Param[]>(sql).all(...params)),
    batch: (statements) => {
      db.transaction(() => {
        for (const [sql, ...params] of statements) db.query(sql).run(...params);
      })();
      return Promise.resolve();
    },
  };
  return { ...store, close: () => db.close() };
}
