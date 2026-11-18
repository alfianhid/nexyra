// A small seeded generator so two runs of the cohort produce identical data. No
// dependency: mulberry32 is a few lines and good enough for synthetic data.

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  // Uniform in [0, 1).
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  // Draw a key by weight; the weights need not sum to 1.
  weighted<T extends string>(weights: Record<T, number>): T {
    const entries = Object.entries(weights) as [T, number][];
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let at = this.next() * total;
    for (const [key, weight] of entries) {
      at -= weight;
      if (at < 0) return key;
    }
    return (entries[entries.length - 1] as [T, number])[0];
  }

  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Log-normal hours with the given median, never below one hour so that two steps in a
  // case never share an instant.
  lognormalHours(median: number, sigma: number): number {
    return Math.max(1, Math.round(median * Math.exp(sigma * this.normal())));
  }
}
