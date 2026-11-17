// One place that knows what "now" means, so every list row and every case view
// measures deadlines against the same instant. TICKET-06 replaces the constant with
// the demo clock table; until then the demo is pinned to day 0.

export type Clock = {
  now: string;
  is_demo: boolean;
  day: number;
  referral_limit_days: number;
};

export const REFERRAL_LIMIT_DAYS = 31;

const DEMO_NOW = "2026-11-17T11:42:00+07:00";

export function getClock(): Clock {
  return {
    now: DEMO_NOW,
    is_demo: true,
    day: 0,
    referral_limit_days: REFERRAL_LIMIT_DAYS,
  };
}

// The `clock` object embedded in a read response carries only these three fields.
export function embeddedClock(): { now: string; is_demo: boolean; day: number } {
  const { now, is_demo, day } = getClock();
  return { now, is_demo, day };
}

// Signed hours from `from` to `to`: negative means the deadline has passed.
export function hoursBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return (b - a) / 3_600_000;
}

export function addHours(iso: string, hours: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return new Date(at + hours * 3_600_000).toISOString();
}

// Display text for a deadline, e.g. "18 Nov 09:00". The server formats dates the
// same way it formats flags: the client prints the string and never derives a date.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
