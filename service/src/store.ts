export type Param = string | number | null;
export type Statement = [sql: string, ...params: Param[]];
export interface Store {
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
  batch(statements: Statement[]): Promise<void>;
}

interface D1Statement {
  bind(...params: Param[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1 {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export function d1Store(db: D1): Store {
  return {
    all: async <T>(sql: string, ...params: Param[]) =>
      (
        await db
          .prepare(sql)
          .bind(...params)
          .all<T>()
      ).results,
    batch: async (statements) => {
      await db.batch(statements.map(([sql, ...params]) => db.prepare(sql).bind(...params)));
    },
  };
}
