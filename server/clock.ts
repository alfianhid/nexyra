import { getDb, type Db } from "./db.js";
import { REPORTED_LIMIT } from "./engine.js";

// TICKET-06: the demo clock is a row in the database, not a constant, so it survives a
// restart and every read measures deadlines against the same instant. Day 0 is the
// moment the seed was written; `day` is the offset the demo controls move.

export type Clock = {
  now: string;
  is_demo: boolean;
  day: number;
  referral_limit_days: number;
  // Display text, formatted here for the same reason stage_due_label is: the client
  // prints the string and never derives a date.
  label: string;
};

// The referral-to-colonoscopy limit, from the pathway template (the one limit with a
// source: HAAD standard, cited in BMC Cancer 2021).
export const REFERRAL_LIMIT_DAYS: number = REPORTED_LIMIT?.max_days ?? 0;

// 17 Nov 2026 11:42 UTC+7, the moment the demo data was generated.
export const DEMO_START = "2026-11-17T11:42:00+07:00";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// All demo timestamps carry the same +07:00 offset, so arithmetic keeps an offset
// instead of dropping to a bare `Z`, which would print as the wrong wall time.
const OFFSET_MINUTES = 7 * 60;

function toOffsetIso(at: number): string {
  const shifted = new Date(at + OFFSET_MINUTES * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `+07:00`
  );
}

export function addHours(iso: string, hours: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return toOffsetIso(at + hours * 3_600_000);
}

// Signed hours from `from` to `to`: negative means the deadline has passed.
export function hoursBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return (b - a) / 3_600_000;
}

type ClockRow = { now: string; day: number };

async function ensureClock(db: Db): Promise<ClockRow> {
  await db.prepare("INSERT OR IGNORE INTO clocks (id, now, day) VALUES (1, ?, 0)").run(DEMO_START);
  const row = await db.prepare("SELECT now, day FROM clocks WHERE id = 1").get<ClockRow>();
  return row ?? { now: DEMO_START, day: 0 };
}

export async function getClock(db?: Db): Promise<Clock> {
  const row = await ensureClock(db ?? (await getDb()));
  return {
    now: row.now,
    is_demo: true,
    day: row.day,
    referral_limit_days: REFERRAL_LIMIT_DAYS,
    label: formatClockLabel(row.now),
  };
}

// The `clock` object embedded in a read response carries only these three fields.
export async function embeddedClock(
  db?: Db,
): Promise<{ now: string; is_demo: boolean; day: number }> {
  const { now, is_demo, day } = await getClock(db);
  return { now, is_demo, day };
}

export async function setClock(db: Db, now: string, day: number): Promise<Clock> {
  await ensureClock(db);
  await db.prepare("UPDATE clocks SET now = ?, day = ? WHERE id = 1").run(now, day);
  return getClock(db);
}

export async function advanceDays(db: Db, days: number): Promise<Clock> {
  const row = await ensureClock(db);
  return setClock(db, addHours(row.now, days * 24), row.day + days);
}

// The earliest stage deadline still ahead of `now`, so "advance to next deadline" lands
// exactly on the next thing that can escalate. Null when nothing is ahead.
export function nextDeadline(now: string, deadlines: readonly string[]): string | null {
  const ahead = deadlines
    .filter((iso) => !Number.isNaN(Date.parse(iso)))
    .filter((iso) => Date.parse(iso) > Date.parse(now))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return ahead[0] ?? null;
}

// Display text for a deadline, e.g. "18 Nov 09:00". The server formats dates the
// same way it formats flags: the client prints the string and never derives a date.
export function formatDue(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const month = Number(value("month"));
  return `${Number(value("day"))} ${MONTHS[month - 1] ?? value("month")} ${value("hour")}:${value(
    "minute",
  )}`;
}

// Header text, e.g. "17 Nov 2026 · 11:42".
export function formatClockLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const value = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const month = Number(value("month"));
  return `${Number(value("day"))} ${MONTHS[month - 1] ?? value("month")} ${value("year")} · ${value(
    "hour",
  )}:${value("minute")}`;
}
