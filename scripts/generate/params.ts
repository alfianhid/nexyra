import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// data/generator-assumptions.json is the one place a parameter lives. Code reads it by
// name, and a missing name is an error rather than a silent default, so the file cannot
// drift away from what the generator uses.

export type TimeParam = { median_hours: number; sigma: number };
export type ParamValue = number | TimeParam;
export type AssumptionRow = { name: string; value: ParamValue; unit?: string; source: string };

export const ASSUMPTIONS_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/generator-assumptions.json",
);

export function readAssumptions(): { parameters: AssumptionRow[]; references: AssumptionRow[] } {
  return JSON.parse(readFileSync(ASSUMPTIONS_FILE, "utf8")) as {
    parameters: AssumptionRow[];
    references: AssumptionRow[];
  };
}

export class Params {
  constructor(private readonly values: Map<string, ParamValue>) {}

  static load(overrides: Record<string, ParamValue> = {}): Params {
    const map = new Map<string, ParamValue>();
    for (const row of readAssumptions().parameters) map.set(row.name, row.value);
    for (const [name, value] of Object.entries(overrides)) {
      if (!map.has(name)) throw new Error(`Unknown generator parameter "${name}".`);
      map.set(name, value);
    }
    return new Params(map);
  }

  num(name: string): number {
    const value = this.values.get(name);
    if (typeof value !== "number") throw new Error(`Generator parameter "${name}" is not a number.`);
    return value;
  }

  time(name: string): TimeParam {
    const value = this.values.get(name);
    if (typeof value !== "object") throw new Error(`Generator parameter "${name}" is not a time.`);
    return value;
  }

  // Parameters sharing a prefix, as { suffix: value }, for the language and pathology mixes.
  mix(prefix: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, value] of this.values) {
      if (name.startsWith(prefix) && typeof value === "number") out[name.slice(prefix.length)] = value;
    }
    return out;
  }
}
