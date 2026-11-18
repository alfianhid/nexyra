import { describe, expect, it } from "vitest";
import { isTransientNetworkError, withRetry } from "./db.js";

// The shape undici throws when Turso has closed an idle keep-alive connection, as seen in
// the Vercel logs on 18 Nov: TypeError("fetch failed") with a SocketError cause.
function staleSocketError(): Error {
  const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

describe("database calls over a stale connection", () => {
  it("recognises a closed keep-alive connection, and not a SQL error", () => {
    expect(isTransientNetworkError(staleSocketError())).toBe(true);
    const sqlError = Object.assign(new Error("SQLITE_CONSTRAINT: events are append-only"), {
      code: "SQLITE_CONSTRAINT",
    });
    expect(isTransientNetworkError(sqlError)).toBe(false);
  });

  it("retries a request once when the connection had been closed", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw staleSocketError();
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("never retries a real SQL error", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw Object.assign(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed"), {
          code: "SQLITE_CONSTRAINT",
        });
      }),
    ).rejects.toThrow(/UNIQUE/);
    expect(calls).toBe(1);
  });

  it("gives up after one retry", async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls += 1;
        throw staleSocketError();
      }),
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(2);
  });
});
