import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, openDatabase, type Db } from "./db";

const created: string[] = [];
const opened: Db[] = [];

function tempDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), "nexyra-db-"));
  created.push(dir);
  const db = openDatabase(join(dir, "test.sqlite"));
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  closeDb();
  for (const dir of created.splice(0)) {
    // Windows can hold the -wal/-shm handles for a moment after close.
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("events table", () => {
  it("stores an event and reads it back with its actor and payload", () => {
    const db = tempDb();
    db.prepare("INSERT INTO cases (id, patient_name, patient_age, patient_language, pathway_id, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "c_1", "Patient 001", 58, "ar", "fit-colonoscopy", "result_received", "2026-11-17T09:00:00+07:00", "2026-11-17T09:00:00+07:00",
    );

    db.prepare(
      "INSERT INTO events (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "e_1", "c_1", "case_created", "act_system", "system",
      "2026-11-17T09:00:00+07:00", "2026-11-17T09:00:05+07:00", '{"summary":"created"}',
    );

    const row = db.prepare("SELECT * FROM events WHERE id = ?").get("e_1") as Record<string, unknown>;

    expect(row.case_id).toBe("c_1");
    expect(row.actor_id).toBe("act_system");
    expect(row.actor_role).toBe("system");
    expect(row.occurred_at).toBe("2026-11-17T09:00:00+07:00");
    expect(row.recorded_at).toBe("2026-11-17T09:00:05+07:00");
    expect(JSON.parse(row.payload as string)).toEqual({ summary: "created" });
  });

  it("rejects an update (append-only, enforced by a trigger)", () => {
    const db = tempDb();
    db.prepare("INSERT INTO cases (id, patient_name, patient_age, patient_language, pathway_id, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "c_2", "Patient 002", 47, "en", "fit-colonoscopy", "result_received", "2026-11-17T09:00:00+07:00", "2026-11-17T09:00:00+07:00",
    );
    db.prepare(
      "INSERT INTO events (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("e_2", "c_2", "case_created", "act_system", "system", "2026-11-17T09:00:00+07:00", "2026-11-17T09:00:00+07:00", "{}");

    expect(() =>
      db.prepare("UPDATE events SET type = ? WHERE id = ?").run("tampered", "e_2"),
    ).toThrow(/append-only/);

    const row = db.prepare("SELECT type FROM events WHERE id = ?").get("e_2") as { type: string };
    expect(row.type).toBe("case_created");
  });

  it("rejects a delete (append-only, enforced by a trigger)", () => {
    const db = tempDb();
    db.prepare("INSERT INTO cases (id, patient_name, patient_age, patient_language, pathway_id, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "c_3", "Patient 003", 52, "en", "fit-colonoscopy", "result_received", "2026-11-17T09:00:00+07:00", "2026-11-17T09:00:00+07:00",
    );
    db.prepare(
      "INSERT INTO events (id, case_id, type, actor_id, actor_role, occurred_at, recorded_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("e_3", "c_3", "case_created", "act_system", "system", "2026-11-17T09:00:00+07:00", "2026-11-17T09:00:00+07:00", "{}");

    expect(() => db.prepare("DELETE FROM events WHERE id = ?").run("e_3")).toThrow(/append-only/);
    expect((db.prepare("SELECT count(*) AS n FROM events").get() as { n: number }).n).toBe(1);
  });
});
