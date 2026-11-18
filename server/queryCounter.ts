import type { Db } from "./db.js";

// TICKET-17 performance check. Deployed, every query is a round trip to Turso (about
// 20-50 ms), so what matters for a request is how many times it reaches the database,
// not how much SQL it runs. This wraps a Db's libSQL client in place and counts those
// round trips; `latencyMs` adds a fixed delay to each one so a local run can show what a
// request costs against a remote database. Used by tests and `npm run perf`, never by
// the app itself.

export type QueryCounter = {
  readonly execute: number;
  readonly batch: number;
  readonly executeMultiple: number;
  // Statements sent inside batches (one round trip each batch, however many statements).
  readonly batchedStatements: number;
  readonly total: number;
  reset(): void;
  restore(): void;
};

type Patchable = Record<"execute" | "batch" | "executeMultiple", (...args: unknown[]) => Promise<unknown>>;

export function countQueries(db: Db, options: { latencyMs?: number } = {}): QueryCounter {
  const client = db.client as unknown as Patchable;
  const original = {
    execute: client.execute,
    batch: client.batch,
    executeMultiple: client.executeMultiple,
  };
  const counts = { execute: 0, batch: 0, executeMultiple: 0, batchedStatements: 0 };
  const delay = options.latencyMs ?? 0;
  const wait = () => (delay > 0 ? new Promise((resolve) => setTimeout(resolve, delay)) : Promise.resolve());

  for (const name of ["execute", "batch", "executeMultiple"] as const) {
    const fn = original[name];
    client[name] = async (...args: unknown[]) => {
      counts[name] += 1;
      if (name === "batch" && Array.isArray(args[0])) counts.batchedStatements += args[0].length;
      await wait();
      return fn.apply(db.client, args);
    };
  }

  return {
    get execute() {
      return counts.execute;
    },
    get batch() {
      return counts.batch;
    },
    get executeMultiple() {
      return counts.executeMultiple;
    },
    get batchedStatements() {
      return counts.batchedStatements;
    },
    get total() {
      return counts.execute + counts.batch + counts.executeMultiple;
    },
    reset() {
      counts.execute = 0;
      counts.batch = 0;
      counts.executeMultiple = 0;
      counts.batchedStatements = 0;
    },
    restore() {
      client.execute = original.execute;
      client.batch = original.batch;
      client.executeMultiple = original.executeMultiple;
    },
  };
}
